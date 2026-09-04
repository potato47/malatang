@preconcurrency import NIOCore
import NIOFileSystem
@preconcurrency import NIOHTTP1
@preconcurrency import NIOPosix
@preconcurrency import NIOWebSocket
import Foundation

public struct FIAGatewayResource: Sendable {
    public let fileURL: URL
    public let contentType: String
    public let size: Int64

    public init(fileURL: URL, contentType: String, size: Int64) {
        self.fileURL = fileURL
        self.contentType = contentType
        self.size = size
    }
}

public struct FIABackendEndpoint: Sendable {
    public let origin: URL
    public let session: String
    public let mount: String
    public init(origin: URL, session: String, mount: String = "/api") {
        self.origin = origin
        self.session = session
        self.mount = mount
    }
}

public struct FIAGatewayEndpoint: Codable, Sendable {
    public let origin: String
    public let bootstrapURL: String
    public let session: String

    public init(origin: String, bootstrapURL: String, session: String) {
        self.origin = origin
        self.bootstrapURL = bootstrapURL
        self.session = session
    }
}

public struct FIAGatewayResponse: Sendable {
    public let status: HTTPResponseStatus
    public let headers: HTTPHeaders
    public let body: FIAGatewayBody

    public init(status: HTTPResponseStatus, headers: HTTPHeaders = HTTPHeaders(), body: Data = Data()) {
        self.status = status
        self.headers = headers
        self.body = .data(body)
    }

    public init(status: HTTPResponseStatus, headers: HTTPHeaders, fileURL: URL, size: Int64) {
        self.status = status
        self.headers = headers
        body = .file(fileURL, size)
    }
}

public enum FIAGatewayBody: Sendable {
    case data(Data)
    case file(URL, Int64)
}

public typealias FIAGatewayDispatcher = @Sendable (_ method: String, _ params: Data, _ mode: String) async -> Result<Data, Error>
public typealias FIAGatewayResourceProvider = @Sendable (_ id: String, _ session: String) async -> FIAGatewayResource?

public final class FIAGateway: @unchecked Sendable {
    private let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
    private let state: GatewayState
    private var channel: (any Channel)?

    public init(
        staticDirectory: URL?,
        developmentOrigin: URL?,
        backendMount: String = "/api",
        backendEndpoint: @escaping @Sendable () -> FIABackendEndpoint?,
        dispatcher: @escaping FIAGatewayDispatcher,
        resource: @escaping FIAGatewayResourceProvider
    ) {
        state = GatewayState(
            staticDirectory: staticDirectory,
            developmentOrigin: developmentOrigin,
            backendMount: backendMount,
            backendEndpoint: backendEndpoint,
            dispatcher: dispatcher,
            resource: resource
        )
    }

    deinit {
        try? channel?.close().wait()
        try? group.syncShutdownGracefully()
    }

    public func start() throws -> FIAGatewayEndpoint {
        let bootstrap = ServerBootstrap(group: group)
            .serverChannelOption(ChannelOptions.backlog, value: 128)
            .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelInitializer { [state] channel in
                let upgrader = NIOWebSocketServerUpgrader(
                    maxFrameSize: 1 << 20,
                    shouldUpgrade: { channel, head in
                        state.webSocketTarget(head) != nil
                            ? channel.eventLoop.makeSucceededFuture([:])
                            : channel.eventLoop.makeFailedFuture(GatewayFailure.unauthorized)
                    },
                    upgradePipelineHandler: { channel, head in
                        guard let target = state.webSocketTarget(head) else {
                            return channel.eventLoop.makeFailedFuture(GatewayFailure.unauthorized)
                        }
                        switch target {
                        case let .native(mode):
                            return channel.pipeline.addHandler(NativeWebSocketHandler(state: state, mode: mode))
                        case let .backend(endpoint, path):
                            return channel.pipeline.addHandler(BackendWebSocketProxy(endpoint: endpoint, path: path))
                        }
                    }
                )
                let upgrade: NIOHTTPServerUpgradeSendableConfiguration = (
                    upgraders: [upgrader],
                    completionHandler: { context in
                        context.pipeline.syncOperations.removeHandler(name: "fia.http", promise: nil)
                    }
                )
                return channel.pipeline.configureHTTPServerPipeline(withServerUpgrade: upgrade).flatMap {
                    channel.pipeline.addHandler(HTTPHandler(state: state), name: "fia.http")
                }
            }
            .childChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
        channel = try bootstrap.bind(host: "127.0.0.1", port: 0).wait()
        guard let port = channel?.localAddress?.port else { throw GatewayFailure.bind }
        return state.activate(port: port)
    }

    public func stop() async {
        try? await channel?.close()
        channel = nil
    }

    public func makeBootstrapURL(target: String = "/") -> URL? {
        state.makeBootstrapURL(target: target)
    }

    public func publish(event: String, payload: Data?) {
        state.publish(event: event, payload: payload)
    }
}

private enum GatewayFailure: Error {
    case bind
    case unauthorized
}

private enum GatewayWebSocketTarget {
    case native(mode: String)
    case backend(endpoint: FIABackendEndpoint, path: String)
}

private final class UncheckedBox<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) { self.value = value }
}

private final class GatewayState: @unchecked Sendable {
    private struct BootstrapCode {
        let expiration: Date
        let mode: String
    }

    let staticDirectory: URL?
    let developmentOrigin: URL?
    let backendMount: String
    let backendEndpoint: @Sendable () -> FIABackendEndpoint?
    let dispatcher: FIAGatewayDispatcher
    let resource: FIAGatewayResourceProvider
    let session = GatewayState.randomSecret()
    private let lock = NSLock()
    private var origin = ""
    private var bootstrapCodes: [String: BootstrapCode] = [:]
    private var clients: [UUID: @Sendable (String) -> Void] = [:]
    private var activeHTTPRequests = 0

    init(
        staticDirectory: URL?,
        developmentOrigin: URL?,
        backendMount: String,
        backendEndpoint: @escaping @Sendable () -> FIABackendEndpoint?,
        dispatcher: @escaping FIAGatewayDispatcher,
        resource: @escaping FIAGatewayResourceProvider
    ) {
        self.staticDirectory = staticDirectory
        self.developmentOrigin = developmentOrigin
        self.backendMount = backendMount
        self.backendEndpoint = backendEndpoint
        self.dispatcher = dispatcher
        self.resource = resource
    }

    func activate(port: Int) -> FIAGatewayEndpoint {
        lock.lock()
        defer { lock.unlock() }
        origin = "http://127.0.0.1:\(port)"
        let code = Self.randomSecret()
        bootstrapCodes[code] = BootstrapCode(expiration: Date().addingTimeInterval(30), mode: "browserCompanion")
        let target = developmentOrigin?.absoluteString ?? "/"
        let escaped = target.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "%2F"
        return FIAGatewayEndpoint(
            origin: origin,
            bootstrapURL: "\(origin)/_fia/bootstrap?code=\(code)&target=\(escaped)",
            session: session
        )
    }

    func makeBootstrapURL(target: String) -> URL? {
        lock.lock()
        defer { lock.unlock() }
        guard !origin.isEmpty else { return nil }
        let code = Self.randomSecret()
        bootstrapCodes[code] = BootstrapCode(expiration: Date().addingTimeInterval(30), mode: "application")
        let destination: String
        if let developmentOrigin, target.hasPrefix("/"), !target.hasPrefix("//") {
            destination = URL(string: target, relativeTo: developmentOrigin)?.absoluteString ?? developmentOrigin.absoluteString
        } else {
            destination = target
        }
        var components = URLComponents(string: origin + "/_fia/bootstrap")
        components?.queryItems = [URLQueryItem(name: "code", value: code), URLQueryItem(name: "target", value: destination)]
        return components?.url
    }

    func addClient(_ send: @escaping @Sendable (String) -> Void) -> UUID {
        lock.withLock {
            let id = UUID()
            clients[id] = send
            return id
        }
    }

    func removeClient(_ id: UUID) { _ = lock.withLock { clients.removeValue(forKey: id) } }

    func publish(event: String, payload: Data?) {
        var object: [String: Any] = ["v": 1, "type": "event", "event": event]
        if let payload, let value = try? JSONSerialization.jsonObject(with: payload) { object["payload"] = value }
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let string = String(data: data, encoding: .utf8)
        else { return }
        for send in lock.withLock({ Array(clients.values) }) { send(string) }
    }

    func beginHTTPRequest() -> Bool {
        lock.withLock {
            guard activeHTTPRequests < 128 else { return false }
            activeHTTPRequests += 1
            return true
        }
    }

    func finishHTTPRequest() {
        lock.withLock { activeHTTPRequests = max(0, activeHTTPRequests - 1) }
    }

    func authorize(_ head: HTTPRequestHead) -> Bool {
        guard exactHost(head.headers["host"].first) else { return false }
        if head.headers["x-fia-session"].first == session {
            return head.headers["origin"].first.map(validOrigin) ?? true
        }
        let hasCookie = hasSessionCookie(head, name: "fia_application_session")
            || hasSessionCookie(head, name: "fia_browser_session")
            || hasSessionCookie(head, name: "fia_application_session_api")
            || hasSessionCookie(head, name: "fia_browser_session_api")
        guard hasCookie else { return false }
        if let requestOrigin = head.headers["origin"].first { return validOrigin(requestOrigin) }
        if let referer = head.headers["referer"].first { return validReferer(referer) }
        return false
    }

    func webSocketTarget(_ head: HTTPRequestHead) -> GatewayWebSocketTarget? {
        guard authorize(head), let requestOrigin = head.headers["origin"].first,
              validOrigin(requestOrigin),
              let components = URLComponents(string: origin + head.uri)
        else { return nil }
        if components.path == "/_fia/native" {
            guard let mode = webSocketClientMode(head) else { return nil }
            return .native(mode: mode)
        }
        guard let endpoint = backendEndpoint(), isMountedPath(components.path, at: endpoint.mount) else {
            return nil
        }
        let path = stripMount(from: head.uri, mount: endpoint.mount)
        return .backend(endpoint: endpoint, path: path)
    }

    func response(head: HTTPRequestHead, body: Data) async -> FIAGatewayResponse {
        guard exactHost(head.headers["host"].first), let components = URLComponents(string: origin + head.uri) else {
            return text(.unauthorized, "Unauthorized")
        }
        let path = components.path
        if path == "/_fia/bootstrap" { return bootstrap(head: head, components: components) }
        if path == "/_fia/health" { return FIAGatewayResponse(status: .noContent) }
        if path.hasPrefix("/_fia/resources/") {
            guard authorize(head) else { return text(.unauthorized, "Unauthorized") }
            let id = String(path.dropFirst("/_fia/resources/".count))
            guard let item = await resource(id, session) else {
                return text(.notFound, "Not Found")
            }
            var headers = HTTPHeaders()
            headers.add(name: "content-type", value: item.contentType)
            headers.add(name: "content-length", value: String(item.size))
            headers.add(name: "cache-control", value: "no-store")
            return FIAGatewayResponse(status: .ok, headers: headers, fileURL: item.fileURL, size: item.size)
        }
        if isMountedPath(path, at: backendMount) {
            guard authorize(head) else { return text(.unauthorized, "Unauthorized") }
            guard let backend = backendEndpoint() else { return text(.badGateway, "Backend is unavailable") }
            return await proxy(head: head, body: body, endpoint: backend)
        }
        if path.hasPrefix("/_fia/") {
            guard authorize(head) else { return text(.unauthorized, "Unauthorized") }
            return text(.notFound, "Not Found")
        }
        return staticResponse(path: path)
    }

    private func bootstrap(head: HTTPRequestHead, components: URLComponents) -> FIAGatewayResponse {
        guard head.method == .GET,
              let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
              let mode = consume(code: code)
        else { return text(.forbidden, "Invalid or expired FIA session link") }
        let requestedTarget = components.queryItems?.first(where: { $0.name == "target" })?.value ?? "/"
        guard let target = safeBootstrapTarget(requestedTarget) else {
            return text(.forbidden, "Invalid FIA bootstrap target")
        }
        var headers = HTTPHeaders()
        let cookie = mode == "application" ? "fia_application_session" : "fia_browser_session"
        headers.add(name: "set-cookie", value: "\(cookie)=\(session); HttpOnly; SameSite=Strict; Path=/_fia")
        headers.add(name: "set-cookie", value: "\(cookie)_api=\(session); HttpOnly; SameSite=Strict; Path=\(backendMount)")
        headers.add(name: "location", value: target)
        headers.add(name: "cache-control", value: "no-store")
        return FIAGatewayResponse(status: .found, headers: headers)
    }

    private func consume(code: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard let value = bootstrapCodes.removeValue(forKey: code), value.expiration > Date() else { return nil }
        return value.mode
    }

    private func exactHost(_ host: String?) -> Bool {
        guard let host, let url = URL(string: origin), let expectedHost = url.host, let port = url.port else { return false }
        return host == "\(expectedHost):\(port)"
    }

    private func validOrigin(_ requestOrigin: String) -> Bool {
        return requestOrigin == origin || requestOrigin == developmentOrigin?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func validReferer(_ value: String) -> Bool {
        guard let referer = URL(string: value) else { return false }
        return [URL(string: origin), developmentOrigin].compactMap { $0 }.contains {
            referer.scheme == $0.scheme && referer.host == $0.host && referer.port == $0.port
        }
    }

    private func hasSessionCookie(_ head: HTTPRequestHead, name: String) -> Bool {
        head.headers["cookie"].contains { header in
            header.split(separator: ";").contains {
                $0.trimmingCharacters(in: .whitespaces) == "\(name)=\(session)"
            }
        }
    }

    private func webSocketClientMode(_ head: HTTPRequestHead) -> String? {
        if head.headers["x-fia-session"].first == session {
            return head.headers["x-fia-client-mode"].first == "application" ? "application" : "browserCompanion"
        }
        if hasSessionCookie(head, name: "fia_application_session") { return "application" }
        if hasSessionCookie(head, name: "fia_browser_session") { return "browserCompanion" }
        return nil
    }

    private func safeBootstrapTarget(_ target: String) -> String? {
        if target.hasPrefix("/"), !target.hasPrefix("//") { return target }
        guard let candidate = URL(string: target), let developmentOrigin,
              candidate.scheme == developmentOrigin.scheme,
              candidate.host == developmentOrigin.host,
              candidate.port == developmentOrigin.port
        else { return nil }
        return candidate.absoluteString
    }

    private func isMountedPath(_ path: String, at mount: String) -> Bool {
        path == mount || path.hasPrefix(mount + "/")
    }

    private func stripMount(from uri: String, mount: String) -> String {
        guard let queryIndex = uri.firstIndex(of: "?") else {
            let path = String(uri.dropFirst(mount.count))
            return path.isEmpty ? "/" : path
        }
        let path = String(uri[..<queryIndex].dropFirst(mount.count))
        return (path.isEmpty ? "/" : path) + String(uri[queryIndex...])
    }

    private func staticResponse(path: String) -> FIAGatewayResponse {
        guard let root = staticDirectory else { return text(.notFound, "Not Found") }
        let requested = path == "/" ? "index.html" : String(path.drop(while: { $0 == "/" }))
        let physicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let candidate = root.appending(path: requested).standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(physicalRoot.path + "/"),
              let data = try? Data(contentsOf: candidate)
        else {
            let fallback = root.appending(path: "index.html")
            guard let data = try? Data(contentsOf: fallback) else { return text(.notFound, "Not Found") }
            return file(data, extension: "html")
        }
        return file(data, extension: candidate.pathExtension)
    }

    private func proxy(head: HTTPRequestHead, body: Data, endpoint: FIABackendEndpoint) async -> FIAGatewayResponse {
        let forwarded = stripMount(from: head.uri, mount: endpoint.mount)
        guard let url = URL(string: forwarded, relativeTo: endpoint.origin)?.absoluteURL,
              url.scheme == endpoint.origin.scheme,
              url.host == endpoint.origin.host,
              url.port == endpoint.origin.port,
              url.user == nil,
              url.password == nil
        else { return text(.badRequest, "Bad Request") }
        var request = URLRequest(url: url)
        request.httpMethod = head.method.rawValue
        request.httpBody = body.isEmpty ? nil : body
        request.timeoutInterval = 30
        request.setValue(endpoint.session, forHTTPHeaderField: "x-fia-backend-session")
        let excluded = Set([
            "connection", "content-length", "cookie", "host", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
            "x-fia-backend-session", "x-fia-session",
        ])
        for header in head.headers where !excluded.contains(header.name.lowercased()) {
            request.addValue(header.value, forHTTPHeaderField: header.name)
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse else { return text(.badGateway, "Bad Gateway") }
            guard data.count <= 8 * 1024 * 1024 else { return text(.payloadTooLarge, "Backend response exceeds 8 MiB") }
            var headers = HTTPHeaders()
            let hopByHop = Set(["connection", "content-length", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"])
            for (name, value) in response.allHeaderFields {
                if let name = name as? String, let value = value as? String, !hopByHop.contains(name.lowercased()) {
                    headers.add(name: name, value: value)
                }
            }
            return FIAGatewayResponse(status: HTTPResponseStatus(statusCode: response.statusCode), headers: headers, body: data)
        } catch {
            return text(.badGateway, "Backend unavailable")
        }
    }

    private func file(_ data: Data, extension value: String) -> FIAGatewayResponse {
        let types = [
            "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
            "css": "text/css; charset=utf-8", "json": "application/json", "svg": "image/svg+xml",
            "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
        ]
        var headers = HTTPHeaders()
        headers.add(name: "content-type", value: types[value.lowercased()] ?? "application/octet-stream")
        headers.add(name: "content-length", value: String(data.count))
        headers.add(name: "cache-control", value: "no-cache")
        return FIAGatewayResponse(status: .ok, headers: headers, body: data)
    }

    private func text(_ status: HTTPResponseStatus, _ value: String) -> FIAGatewayResponse {
        var headers = HTTPHeaders()
        headers.add(name: "content-type", value: "text/plain; charset=utf-8")
        return FIAGatewayResponse(status: status, headers: headers, body: Data(value.utf8))
    }

    private static func randomSecret() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-")
    }
}

private final class HTTPHandler: ChannelInboundHandler, RemovableChannelHandler, @unchecked Sendable {
    typealias InboundIn = HTTPServerRequestPart
    typealias OutboundOut = HTTPServerResponsePart
    private let state: GatewayState
    private var head: HTTPRequestHead?
    private var body = Data()
    private var bodyExceeded = false

    init(state: GatewayState) { self.state = state }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        switch unwrapInboundIn(data) {
        case let .head(head):
            self.head = head
            body.removeAll(keepingCapacity: true)
            bodyExceeded = false
        case var .body(buffer):
            guard let bytes = buffer.readBytes(length: buffer.readableBytes) else { return }
            if body.count + bytes.count <= 8 * 1024 * 1024 { body.append(contentsOf: bytes) }
            else { bodyExceeded = true }
        case .end:
            guard let head else { return }
            guard !bodyExceeded else {
                write(FIAGatewayResponse(status: .payloadTooLarge, body: Data("Request exceeds 8 MiB".utf8)), context: context)
                return
            }
            guard state.beginHTTPRequest() else {
                write(FIAGatewayResponse(status: .tooManyRequests, body: Data("Too many requests".utf8)), context: context)
                return
            }
            let requestBody = body
            let context = UncheckedBox(context)
            Task { [state] in
                let response = await state.response(head: head, body: requestBody)
                state.finishHTTPRequest()
                context.value.eventLoop.execute { self.write(response, context: context.value) }
            }
        }
    }

    private func write(_ response: FIAGatewayResponse, context: ChannelHandlerContext) {
        var headers = response.headers
        if headers["content-length"].isEmpty {
            switch response.body {
            case let .data(data): headers.add(name: "content-length", value: String(data.count))
            case let .file(_, size): headers.add(name: "content-length", value: String(size))
            }
        }
        let head = HTTPResponseHead(version: .http1_1, status: response.status, headers: headers)
        context.write(wrapOutboundOut(.head(head)), promise: nil)
        switch response.body {
        case let .data(data) where !data.isEmpty:
            var buffer = context.channel.allocator.buffer(capacity: data.count)
            buffer.writeBytes(data)
            context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
        case let .file(url, size):
            streamFile(url: url, size: size, context: context)
            return
        case .data: break
        }
        context.writeAndFlush(wrapOutboundOut(.end(nil)), promise: nil)
    }

    private func streamFile(url: URL, size: Int64, context: ChannelHandlerContext) {
        let channel = context.channel
        Task {
            do {
                let handle = try await FileSystem.shared.openFile(forReadingAt: FilePath(url.path))
                do {
                    for try await chunk in handle.readChunks(in: 0..<size, chunkLength: .kibibytes(128)) {
                        try await channel.writeAndFlush(HTTPServerResponsePart.body(.byteBuffer(chunk)))
                    }
                    try await handle.close()
                } catch {
                    try? await handle.close()
                    throw error
                }
                try await channel.writeAndFlush(HTTPServerResponsePart.end(nil))
            } catch {
                try? await channel.close()
            }
        }
    }
}

private final class NativeWebSocketHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = WebSocketFrame
    typealias OutboundOut = WebSocketFrame
    private let state: GatewayState
    private let mode: String
    private var tasks: [Int: Task<Void, Never>] = [:]
    private var clientID: UUID?
    init(state: GatewayState, mode: String) { self.state = state; self.mode = mode }

    func handlerAdded(context: ChannelHandlerContext) {
        let context = UncheckedBox(context)
        clientID = state.addClient { string in
            context.value.eventLoop.execute {
                var buffer = context.value.channel.allocator.buffer(capacity: string.utf8.count)
                buffer.writeString(string)
                let frame = WebSocketFrame(fin: true, opcode: .text, data: buffer)
                context.value.writeAndFlush(NIOAny(frame), promise: nil)
            }
        }
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let frame = unwrapInboundIn(data)
        if frame.opcode == .connectionClose { context.close(promise: nil); return }
        guard frame.opcode == .text else { return }
        var payload = frame.unmaskedData
        guard payload.readableBytes <= 1024 * 1024,
              let text = payload.readString(length: payload.readableBytes),
              let data = text.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["v"] as? Int == 1,
              let type = value["type"] as? String,
              let id = value["id"] as? Int
        else { return }
        if type == "cancel" {
            tasks.removeValue(forKey: id)?.cancel()
            return
        }
        guard type == "request", let method = value["method"] as? String else { return }
        guard tasks[id] == nil, tasks.count < 128 else {
            send([
                "v": 1, "type": "response", "id": id,
                "error": ["code": "resource_limit", "component": "native", "method": method, "message": "Native RPC concurrency limit exceeded", "recoverable": true],
            ], context: context)
            return
        }
        let params = (try? JSONSerialization.data(withJSONObject: value["params"] ?? [:])) ?? Data("{}".utf8)
        let context = UncheckedBox(context)
        let task = Task { [state] in
            let result = await state.dispatcher(method, params, mode)
            let object: [String: Any]
            switch result {
            case let .success(data):
                object = ["v": 1, "type": "response", "id": id, "result": (try? JSONSerialization.jsonObject(with: data)) ?? NSNull()]
            case let .failure(error):
                if let error = error as? (any Encodable),
                   let data = try? JSONEncoder().encode(AnyEncodable(error)),
                   let encoded = try? JSONSerialization.jsonObject(with: data) {
                    object = ["v": 1, "type": "response", "id": id, "error": encoded]
                } else {
                    object = ["v": 1, "type": "response", "id": id, "error": ["code": "native_failure", "component": "native", "method": method, "message": error.localizedDescription, "recoverable": false]]
                }
            }
            guard let data = try? JSONSerialization.data(withJSONObject: object),
                  data.count <= 1024 * 1024,
                  let string = String(data: data, encoding: .utf8)
            else { return }
            context.value.eventLoop.execute {
                self.tasks.removeValue(forKey: id)
                self.send(string, context: context.value)
            }
        }
        tasks[id] = task
    }

    func channelInactive(context: ChannelHandlerContext) {
        if let clientID { state.removeClient(clientID) }
        clientID = nil
        for task in tasks.values { task.cancel() }
        tasks.removeAll()
        context.fireChannelInactive()
    }

    private func send(_ object: [String: Any], context: ChannelHandlerContext) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              data.count <= 1024 * 1024,
              let string = String(data: data, encoding: .utf8)
        else { return }
        send(string, context: context)
    }

    private func send(_ string: String, context: ChannelHandlerContext) {
        var buffer = context.channel.allocator.buffer(capacity: string.utf8.count)
        buffer.writeString(string)
        context.writeAndFlush(wrapOutboundOut(WebSocketFrame(fin: true, opcode: .text, data: buffer)), promise: nil)
    }
}

private final class BackendWebSocketProxy: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = WebSocketFrame

    private let endpoint: FIABackendEndpoint
    private let path: String
    private let bridge = BackendWebSocketBridge()

    init(endpoint: FIABackendEndpoint, path: String) {
        self.endpoint = endpoint
        self.path = path
    }

    func handlerAdded(context: ChannelHandlerContext) {
        bridge.attachServer(context.channel)
        connectBackend(from: context.channel)
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        bridge.forwardToBackend(Self.normalized(unwrapInboundIn(data), masked: true))
    }

    func channelInactive(context: ChannelHandlerContext) {
        bridge.closeBackend()
        context.fireChannelInactive()
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        bridge.close()
    }

    private func connectBackend(from serverChannel: any Channel) {
        guard endpoint.origin.scheme == "http", let host = endpoint.origin.host
        else {
            bridge.close()
            return
        }
        let port = endpoint.origin.port ?? 80
        let bridge = bridge
        let upgrader = NIOWebSocketClientUpgrader(maxFrameSize: 1 << 20) { channel, _ in
            bridge.attachBackend(channel)
            return channel.pipeline.addHandler(BackendWebSocketPeer(bridge: bridge))
        }
        let upgrade: NIOHTTPClientUpgradeSendableConfiguration = (
            upgraders: [upgrader],
            completionHandler: { context in
                context.pipeline.syncOperations.removeHandler(name: "fia.backend.http", promise: nil)
            }
        )
        let request = BackendWebSocketUpgradeRequest(
            host: port == 80 ? host : "\(host):\(port)",
            path: path,
            session: endpoint.session
        )
        ClientBootstrap(group: serverChannel.eventLoop)
            .channelOption(ChannelOptions.connectTimeout, value: .seconds(5))
            .channelInitializer { channel in
                channel.pipeline.addHTTPClientHandlers(withClientUpgrade: upgrade).flatMap {
                    channel.pipeline.addHandler(request, name: "fia.backend.http")
                }
            }
            .connect(host: host, port: port)
            .whenFailure { _ in bridge.close() }
    }

    fileprivate static func normalized(_ frame: WebSocketFrame, masked: Bool) -> WebSocketFrame {
        WebSocketFrame(
            fin: frame.fin,
            rsv1: frame.rsv1,
            rsv2: frame.rsv2,
            rsv3: frame.rsv3,
            opcode: frame.opcode,
            maskKey: masked ? .random() : nil,
            data: frame.unmaskedData,
            extensionData: frame.unmaskedExtensionData
        )
    }
}

private final class BackendWebSocketUpgradeRequest: ChannelInboundHandler, RemovableChannelHandler, Sendable {
    typealias InboundIn = HTTPClientResponsePart
    typealias OutboundOut = HTTPClientRequestPart

    private let host: String
    private let path: String
    private let session: String

    init(host: String, path: String, session: String) {
        self.host = host
        self.path = path
        self.session = session
    }

    func channelActive(context: ChannelHandlerContext) {
        var headers = HTTPHeaders()
        headers.add(name: "host", value: host)
        headers.add(name: "x-fia-backend-session", value: session)
        let head = HTTPRequestHead(version: .http1_1, method: .GET, uri: path, headers: headers)
        context.write(wrapOutboundOut(.head(head)), promise: nil)
        context.writeAndFlush(wrapOutboundOut(.end(nil)), promise: nil)
        context.fireChannelActive()
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        if case let .head(head) = unwrapInboundIn(data), head.status != .switchingProtocols {
            context.close(promise: nil)
        }
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        context.close(promise: nil)
    }
}

private final class BackendWebSocketPeer: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = WebSocketFrame
    private let bridge: BackendWebSocketBridge

    init(bridge: BackendWebSocketBridge) { self.bridge = bridge }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        bridge.forwardToServer(BackendWebSocketProxy.normalized(unwrapInboundIn(data), masked: false))
    }

    func channelInactive(context: ChannelHandlerContext) {
        bridge.closeServer()
        context.fireChannelInactive()
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        bridge.close()
    }
}

private final class BackendWebSocketBridge: @unchecked Sendable {
    private let lock = NSLock()
    private var server: (any Channel)?
    private var backend: (any Channel)?
    private var pending: [WebSocketFrame] = []
    private var pendingBytes = 0
    private var closed = false

    func attachServer(_ channel: any Channel) {
        lock.withLock { if !closed { server = channel } }
    }

    func attachBackend(_ channel: any Channel) {
        let result: (closed: Bool, frames: [WebSocketFrame]) = lock.withLock {
            guard !closed else { return (true, []) }
            backend = channel
            let frames = pending
            pending.removeAll(keepingCapacity: false)
            pendingBytes = 0
            return (false, frames)
        }
        if result.closed {
            close(channel)
            return
        }
        for frame in result.frames { write(frame, to: channel) }
    }

    func forwardToBackend(_ frame: WebSocketFrame) {
        let channel: (any Channel)? = lock.withLock {
            guard !closed else { return nil }
            if let backend { return backend }
            guard pending.count < 128, pendingBytes + frame.length <= 1 << 20 else {
                closed = true
                return nil
            }
            pending.append(frame)
            pendingBytes += frame.length
            return nil
        }
        if let channel { write(frame, to: channel) }
        if lock.withLock({ closed }) { closeChannels() }
    }

    func forwardToServer(_ frame: WebSocketFrame) {
        if let channel = lock.withLock({ closed ? nil : server }) { write(frame, to: channel) }
    }

    func closeServer() {
        let channel = lock.withLock { () -> (any Channel)? in
            closed = true
            return server
        }
        close(channel)
    }

    func closeBackend() {
        let channel = lock.withLock { () -> (any Channel)? in
            closed = true
            return backend
        }
        close(channel)
    }

    func close() {
        lock.withLock { closed = true }
        closeChannels()
    }

    private func closeChannels() {
        let channels = lock.withLock { [server, backend] }
        channels.forEach(close)
    }

    private func write(_ frame: WebSocketFrame, to channel: any Channel) {
        channel.eventLoop.execute { channel.writeAndFlush(frame, promise: nil) }
    }

    private func close(_ channel: (any Channel)?) {
        guard let channel else { return }
        channel.eventLoop.execute { channel.close(promise: nil) }
    }
}

private struct AnyEncodable: Encodable {
    private let encodeValue: (any Encoder) throws -> Void
    init(_ value: any Encodable) { encodeValue = value.encode }
    func encode(to encoder: any Encoder) throws { try encodeValue(encoder) }
}
