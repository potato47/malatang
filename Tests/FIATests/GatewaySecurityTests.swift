import FIAWeb
import Darwin
import Foundation
@preconcurrency import NIOCore
@preconcurrency import NIOHTTP1
@preconcurrency import NIOPosix
@preconcurrency import NIOWebSocket
import XCTest

private final class RedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

final class GatewaySecurityTests: XCTestCase {
    func testStaticApplicationIsPublicButFrameworkRoutesStayProtected() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "fia-static-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("<h1>FIA</h1>".utf8).write(to: directory.appending(path: "index.html"))
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let gateway = FIAGateway(
            staticDirectory: directory,
            developmentOrigin: nil,
            backendEndpoint: { nil },
            dispatcher: { _, _, _ in .success(Data("{}".utf8)) },
            resource: { _, _ in nil }
        )
        let endpoint = try startGateway(gateway)
        addTeardownBlock { await gateway.stop() }

        let (document, documentResponse) = try await URLSession.shared.data(
            from: try XCTUnwrap(URL(string: endpoint.origin + "/"))
        )
        XCTAssertEqual((documentResponse as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(String(decoding: document, as: UTF8.self), "<h1>FIA</h1>")

        let (_, frameworkResponse) = try await URLSession.shared.data(
            from: try XCTUnwrap(URL(string: endpoint.origin + "/_fia/unknown"))
        )
        XCTAssertEqual((frameworkResponse as? HTTPURLResponse)?.statusCode, 401)
    }

    func testCustomBackendMountScopesCookieAndReportsUnavailableBackend() async throws {
        let gateway = FIAGateway(
            staticDirectory: nil,
            developmentOrigin: nil,
            backendMount: "/service",
            backendEndpoint: { nil },
            dispatcher: { _, _, _ in .success(Data("{}".utf8)) },
            resource: { _, _ in nil }
        )
        let endpoint = try startGateway(gateway)
        addTeardownBlock { await gateway.stop() }

        let delegate = RedirectBlocker()
        var bootstrap = URLRequest(url: try XCTUnwrap(URL(string: endpoint.bootstrapURL)))
        bootstrap.httpShouldHandleCookies = false
        let (_, bootstrapResponse) = try await URLSession.shared.data(for: bootstrap, delegate: delegate)
        let response = try XCTUnwrap(bootstrapResponse as? HTTPURLResponse)
        XCTAssertEqual(response.statusCode, 302)
        XCTAssertTrue(response.value(forHTTPHeaderField: "set-cookie")?.contains("Path=/service") == true)

        var mounted = URLRequest(url: try XCTUnwrap(URL(string: endpoint.origin + "/service/items")))
        mounted.setValue(endpoint.session, forHTTPHeaderField: "x-fia-session")
        let (_, mountedResponse) = try await URLSession.shared.data(for: mounted)
        XCTAssertEqual((mountedResponse as? HTTPURLResponse)?.statusCode, 502)
    }

    func testBackendProxyCannotEscapeItsConfiguredAuthority() async throws {
        let gateway = FIAGateway(
            staticDirectory: nil,
            developmentOrigin: nil,
            backendEndpoint: {
                FIABackendEndpoint(
                    origin: URL(string: "http://127.0.0.1:49151")!,
                    session: "backend-secret"
                )
            },
            dispatcher: { _, _, _ in .success(Data("{}".utf8)) },
            resource: { _, _ in nil }
        )
        let endpoint = try startGateway(gateway)
        addTeardownBlock { await gateway.stop() }

        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint.origin + "/api//example.com/private")))
        request.setValue(endpoint.session, forHTTPHeaderField: "x-fia-session")
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 400)
    }

    func testBootstrapIsOneTimeAndProtectedRoutesRequireSession() async throws {
        let gateway = FIAGateway(
            staticDirectory: nil,
            developmentOrigin: nil,
            backendEndpoint: { nil },
            dispatcher: { _, _, _ in .success(Data("{}".utf8)) },
            resource: { _, _ in nil }
        )
        let endpoint = try startGateway(gateway)
        addTeardownBlock { await gateway.stop() }

        let delegate = RedirectBlocker()
        var bootstrap = URLRequest(url: try XCTUnwrap(URL(string: endpoint.bootstrapURL)))
        bootstrap.httpShouldHandleCookies = false
        let (_, firstResponse) = try await URLSession.shared.data(for: bootstrap, delegate: delegate)
        let first = try XCTUnwrap(firstResponse as? HTTPURLResponse)
        XCTAssertEqual(first.statusCode, 302)
        XCTAssertTrue(first.value(forHTTPHeaderField: "set-cookie")?.contains("HttpOnly; SameSite=Strict") == true)

        let (_, replayResponse) = try await URLSession.shared.data(for: bootstrap, delegate: delegate)
        XCTAssertEqual((replayResponse as? HTTPURLResponse)?.statusCode, 403)

        let resourceURL = try XCTUnwrap(URL(string: endpoint.origin + "/_fia/resources/missing"))
        let (_, unauthorizedResponse) = try await URLSession.shared.data(from: resourceURL)
        XCTAssertEqual((unauthorizedResponse as? HTTPURLResponse)?.statusCode, 401)

        var authorized = URLRequest(url: resourceURL)
        authorized.setValue(endpoint.session, forHTTPHeaderField: "x-fia-session")
        let (_, missingResponse) = try await URLSession.shared.data(for: authorized)
        XCTAssertEqual((missingResponse as? HTTPURLResponse)?.statusCode, 404)

        var wrongOrigin = authorized
        wrongOrigin.setValue("http://127.0.0.1:65535", forHTTPHeaderField: "origin")
        let (_, wrongOriginResponse) = try await URLSession.shared.data(for: wrongOrigin)
        XCTAssertEqual((wrongOriginResponse as? HTTPURLResponse)?.statusCode, 401)

        let healthURL = try XCTUnwrap(URL(string: endpoint.origin + "/_fia/health"))
        let (_, healthResponse) = try await URLSession.shared.data(from: healthURL)
        XCTAssertEqual((healthResponse as? HTTPURLResponse)?.statusCode, 204)
    }

    func testResourceDataPlaneStreamsAuthorizedFiles() async throws {
        let file = FileManager.default.temporaryDirectory.appending(path: "fia-gateway-\(UUID().uuidString)")
        let payload = Data(repeating: 0xA5, count: 300_000)
        try payload.write(to: file)
        addTeardownBlock { try? FileManager.default.removeItem(at: file) }
        let gateway = FIAGateway(
            staticDirectory: nil,
            developmentOrigin: nil,
            backendEndpoint: { nil },
            dispatcher: { _, _, _ in .success(Data("{}".utf8)) },
            resource: { id, _ in
                id == "stream" ? FIAGatewayResource(fileURL: file, contentType: "application/octet-stream", size: Int64(payload.count)) : nil
            }
        )
        let endpoint = try startGateway(gateway)
        addTeardownBlock { await gateway.stop() }
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint.origin + "/_fia/resources/stream")))
        request.setValue(endpoint.session, forHTTPHeaderField: "x-fia-session")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(data, payload)
    }

    func testAPIWebSocketProxyInjectsBackendSessionAndForwardsFrames() async throws {
        let backend = EchoWebSocketServer(session: "backend-secret")
        let port = try await startEchoServer(backend)
        addTeardownBlock { await backend.stop() }
        let gateway = FIAGateway(
            staticDirectory: nil,
            developmentOrigin: nil,
            backendEndpoint: {
                FIABackendEndpoint(
                    origin: URL(string: "http://127.0.0.1:\(port)")!,
                    session: "backend-secret"
                )
            },
            dispatcher: { _, _, _ in .success(Data("{}".utf8)) },
            resource: { _, _ in nil }
        )
        let endpoint = try startGateway(gateway)
        addTeardownBlock { await gateway.stop() }
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint.origin + "/api/socket?value=1")))
        request.setValue(endpoint.session, forHTTPHeaderField: "x-fia-session")
        request.setValue(endpoint.origin, forHTTPHeaderField: "origin")
        let socket = URLSession.shared.webSocketTask(with: request)
        socket.resume()
        try await socket.send(.string("through-gateway"))
        let message = try await socket.receive()
        guard case let .string(value) = message else { return XCTFail("expected a text frame") }
        XCTAssertEqual(value, "through-gateway")
        socket.cancel(with: .normalClosure, reason: nil)
    }

    func testNativeWebSocketModeComesFromTrustedTransportMetadata() async throws {
        let gateway = FIAGateway(
            staticDirectory: nil,
            developmentOrigin: nil,
            backendEndpoint: { nil },
            dispatcher: { _, _, mode in
                .success((try? JSONSerialization.data(withJSONObject: ["mode": mode])) ?? Data("{}".utf8))
            },
            resource: { _, _ in nil }
        )
        let endpoint = try startGateway(gateway)
        addTeardownBlock { await gateway.stop() }

        let spoofed = try await nativeMode(endpoint: endpoint, query: "?client=application", trustedMode: nil)
        XCTAssertEqual(spoofed, "browserCompanion")
        let application = try await nativeMode(endpoint: endpoint, query: "", trustedMode: "application")
        XCTAssertEqual(application, "application")
    }

    func testNativeWebSocketRoundTripsTopLevelJSONFragments() async throws {
        let gateway = FIAGateway(
            staticDirectory: nil,
            developmentOrigin: nil,
            backendEndpoint: { nil },
            dispatcher: { _, params, _ in .success(params) },
            resource: { _, _ in nil }
        )
        let endpoint = try startGateway(gateway)
        addTeardownBlock { await gateway.stop() }

        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint.origin + "/_fia/native")))
        request.setValue(endpoint.session, forHTTPHeaderField: "x-fia-session")
        request.setValue(endpoint.origin, forHTTPHeaderField: "origin")
        request.setValue("application", forHTTPHeaderField: "x-fia-client-mode")
        let socket = URLSession.shared.webSocketTask(with: request)
        socket.resume()
        defer { socket.cancel(with: .normalClosure, reason: nil) }

        let stringResult = try await nativeResult(socket: socket, id: 1, paramsJSON: #""input""#)
        XCTAssertEqual(stringResult as? String, "input")

        let nullResult = try await nativeResult(socket: socket, id: 2, paramsJSON: "null")
        XCTAssertTrue(nullResult is NSNull)

        gateway.publish(event: "test.fragment", payload: Data(#""payload""#.utf8))
        let message = try await socket.receive()
        guard case let .string(text) = message,
              let data = text.data(using: .utf8),
              let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return XCTFail("Native WebSocket did not return an event frame") }
        XCTAssertEqual(frame["event"] as? String, "test.fragment")
        XCTAssertEqual(frame["payload"] as? String, "payload")
    }

    private func nativeMode(endpoint: FIAGatewayEndpoint, query: String, trustedMode: String?) async throws -> String {
        var request = URLRequest(url: try XCTUnwrap(URL(string: endpoint.origin + "/_fia/native" + query)))
        request.setValue(endpoint.session, forHTTPHeaderField: "x-fia-session")
        request.setValue(endpoint.origin, forHTTPHeaderField: "origin")
        if let trustedMode { request.setValue(trustedMode, forHTTPHeaderField: "x-fia-client-mode") }
        let socket = URLSession.shared.webSocketTask(with: request)
        socket.resume()
        try await socket.send(.string(#"{"v":1,"type":"request","id":1,"method":"test.mode","params":{}}"#))
        let message = try await socket.receive()
        socket.cancel(with: .normalClosure, reason: nil)
        guard case let .string(text) = message,
              let data = text.data(using: .utf8),
              let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = frame["result"] as? [String: Any],
              let mode = result["mode"] as? String
        else {
            XCTFail("Native WebSocket did not return a result frame")
            return ""
        }
        return mode
    }

    private func nativeResult(
        socket: URLSessionWebSocketTask,
        id: Int,
        paramsJSON: String
    ) async throws -> Any {
        let request = #"{"v":1,"type":"request","id":\#(id),"method":"test.fragment","params":\#(paramsJSON)}"#
        try await socket.send(.string(request))
        let message = try await socket.receive()
        guard case let .string(text) = message,
              let data = text.data(using: .utf8),
              let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            XCTFail("Native WebSocket did not return a result frame")
            return NSNull()
        }
        return try XCTUnwrap(frame["result"])
    }
}

private func startGateway(_ gateway: FIAGateway) throws -> FIAGatewayEndpoint {
    do {
        return try gateway.start()
    } catch let error as IOError where error.errnoCode == EPERM {
        throw XCTSkip("This environment does not permit loopback listeners")
    }
}

private func startEchoServer(_ server: EchoWebSocketServer) async throws -> Int {
    do {
        return try server.start()
    } catch let error as IOError where error.errnoCode == EPERM {
        await server.stop()
        throw XCTSkip("This environment does not permit loopback listeners")
    }
}

private final class EchoWebSocketServer: @unchecked Sendable {
    private let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
    private let session: String
    private var channel: (any Channel)?

    init(session: String) { self.session = session }

    func start() throws -> Int {
        let session = session
        let bootstrap = ServerBootstrap(group: group).childChannelInitializer { channel in
            let upgrader = NIOWebSocketServerUpgrader(
                maxFrameSize: 1 << 20,
                shouldUpgrade: { channel, head in
                    head.headers["x-fia-backend-session"].first == session
                        ? channel.eventLoop.makeSucceededFuture([:])
                        : channel.eventLoop.makeSucceededFuture(nil)
                },
                upgradePipelineHandler: { channel, _ in channel.pipeline.addHandler(EchoWebSocketHandler()) }
            )
            let upgrade: NIOHTTPServerUpgradeSendableConfiguration = (
                upgraders: [upgrader],
                completionHandler: { context in
                    context.pipeline.syncOperations.removeHandler(name: "echo.http", promise: nil)
                }
            )
            return channel.pipeline.configureHTTPServerPipeline(withServerUpgrade: upgrade).flatMap {
                channel.pipeline.addHandler(EchoHTTPHandler(), name: "echo.http")
            }
        }
        channel = try bootstrap.bind(host: "127.0.0.1", port: 0).wait()
        return try XCTUnwrap(channel?.localAddress?.port)
    }

    func stop() async {
        try? await channel?.close()
        channel = nil
        try? await group.shutdownGracefully()
    }
}

private final class EchoHTTPHandler: ChannelInboundHandler, RemovableChannelHandler, Sendable {
    typealias InboundIn = HTTPServerRequestPart
}

private final class EchoWebSocketHandler: ChannelInboundHandler, Sendable {
    typealias InboundIn = WebSocketFrame
    typealias OutboundOut = WebSocketFrame

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let incoming = unwrapInboundIn(data)
        let response = WebSocketFrame(
            fin: incoming.fin,
            rsv1: incoming.rsv1,
            rsv2: incoming.rsv2,
            rsv3: incoming.rsv3,
            opcode: incoming.opcode,
            data: incoming.unmaskedData,
            extensionData: incoming.unmaskedExtensionData
        )
        context.writeAndFlush(wrapOutboundOut(response), promise: nil)
    }
}
