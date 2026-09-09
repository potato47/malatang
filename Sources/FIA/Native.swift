import FIACore
import Foundation

public typealias FIAError = FIACore.FIAError
public typealias FIAErrorCode = FIACore.FIAErrorCode
public typealias FIAJSONValue = FIACore.FIAJSONValue
public typealias FIAEmpty = FIACore.FIAEmpty

public protocol NativeMethodProvider: Sendable {
    @MainActor func registerMethods(in registry: NativeMethodRegistry)
}

@MainActor
public final class NativeMethodRegistry {
    public static let maximumConcurrentCalls = 128

    private typealias Handler = @Sendable (Data) async throws -> Data
    private var handlers: [String: Handler] = [:]
    private var permissions: [String: Bool] = [:]
    private var acceptingRequests = true
    private var active: [UUID: Task<Data, Error>] = [:]

    public init() {}

    public func setPermissions(_ values: [String: Bool]) { permissions = values }

    public func register(_ provider: any NativeMethodProvider) {
        provider.registerMethods(in: self)
    }

    public func register<Input: Decodable & Sendable, Output: Encodable & Sendable>(
        _ method: String,
        input: Input.Type,
        output: Output.Type,
        permission: String? = nil,
        handler: @escaping @Sendable (Input) async throws -> Output
    ) {
        precondition(!method.isEmpty && handlers[method] == nil, "Native method names must be unique")
        handlers[method] = { [permissions] data in
            if let permission, permissions[permission] != true {
                throw FIAError(
                    code: .permissionDenied,
                    component: "native",
                    method: method,
                    message: "Native capability \(permission) is not permitted"
                )
            }
            let value: Input
            do { value = try JSONDecoder().decode(Input.self, from: data) }
            catch {
                throw FIAError(
                    code: .invalidArgument,
                    component: "native",
                    method: method,
                    message: "Native method parameters do not match the native API contract",
                    details: .string(error.localizedDescription)
                )
            }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            return try encoder.encode(try await handler(value))
        }
    }

    public var methods: [String] { handlers.keys.sorted() }

    public func beginShutdown() { acceptingRequests = false }

    public func cancelActive() {
        for task in active.values { task.cancel() }
    }

    public func dispatch(method: String, params: Data) async -> Result<Data, Error> {
        guard acceptingRequests else {
            return .failure(FIAError(
                code: .unsafeState,
                component: "native",
                method: method,
                message: "Native Runtime is shutting down",
                recoverable: true
            ))
        }
        guard let handler = handlers[method] else {
            return .failure(FIAError(
                code: .notFound,
                component: "native",
                method: method,
                message: "Native method is not registered: \(method)"
            ))
        }
        guard active.count < Self.maximumConcurrentCalls else {
            return .failure(FIAError(
                code: .resourceLimit,
                component: "native",
                method: method,
                message: "Native request concurrency limit exceeded",
                recoverable: true
            ))
        }
        let id = UUID()
        let operation = Task { try await handler(params) }
        active[id] = operation
        defer { active.removeValue(forKey: id) }
        do {
            return .success(try await withTaskCancellationHandler {
                try await operation.value
            } onCancel: {
                operation.cancel()
            })
        }
        catch let error as FIAError { return .failure(error) }
        catch is CancellationError {
            return .failure(FIAError(
                code: .cancelled,
                component: "native",
                method: method,
                message: "Native operation was cancelled",
                recoverable: true
            ))
        } catch {
            return .failure(FIAError(
                code: .nativeFailure,
                component: "native",
                method: method,
                message: error.localizedDescription
            ))
        }
    }
}

public struct NativeResourceDescriptor: Codable, Sendable, Equatable {
    public let id: String
    public let url: String
    public let contentType: String
    public let byteLength: Int64
    public let expiresAt: Date

    public init(id: String, url: String, contentType: String, byteLength: Int64, expiresAt: Date) {
        self.id = id
        self.url = url
        self.contentType = contentType
        self.byteLength = byteLength
        self.expiresAt = expiresAt
    }
}

public struct NativeResource: Sendable {
    public let descriptor: NativeResourceDescriptor
    public let fileURL: URL

    public init(descriptor: NativeResourceDescriptor, fileURL: URL) {
        self.descriptor = descriptor
        self.fileURL = fileURL
    }
}

public actor ResourceStore {
    public static let maximumCount = 128
    public static let maximumBytes: Int64 = 512 * 1024 * 1024
    public static let timeToLive: TimeInterval = 10 * 60

    private struct Entry: Sendable {
        let resource: NativeResource
        let session: String
    }

    public nonisolated let directory: URL
    private var entries: [String: Entry] = [:]
    private var totalBytes: Int64 = 0

    public init(directory: URL? = nil) throws {
        let base = directory ?? FileManager.default.temporaryDirectory
            .appending(path: "fia-resources-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        self.directory = base
    }

    deinit { try? FileManager.default.removeItem(at: directory) }

    public func create(data: Data, contentType: String, session: String, origin: URL) throws -> NativeResource {
        purgeExpired()
        guard entries.count < Self.maximumCount, totalBytes + Int64(data.count) <= Self.maximumBytes else {
            throw FIAError(
                code: .resourceLimit,
                component: "resources",
                method: "create",
                message: "NativeResource quota exceeded",
                recoverable: true
            )
        }
        let id = UUID().uuidString.lowercased()
        let file = directory.appending(path: id)
        try data.write(to: file, options: [.atomic])
        let expiresAt = Date().addingTimeInterval(Self.timeToLive)
        let descriptor = NativeResourceDescriptor(
            id: id,
            url: origin.appending(path: "_fia/resources/\(id)").absoluteString,
            contentType: contentType,
            byteLength: Int64(data.count),
            expiresAt: expiresAt
        )
        let resource = NativeResource(descriptor: descriptor, fileURL: file)
        entries[id] = Entry(resource: resource, session: session)
        totalBytes += Int64(data.count)
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.timeToLive))
            await self?.expire(id: id, at: expiresAt)
        }
        return resource
    }

    public func resource(id: String, session: String) -> NativeResource? {
        purgeExpired()
        guard let entry = entries[id], entry.session == session else { return nil }
        return entry.resource
    }

    public func dispose(id: String, session: String) {
        guard let entry = entries[id], entry.session == session else { return }
        remove(id: id, entry: entry)
    }

    public func cleanup(session: String) {
        for (id, entry) in entries where entry.session == session { remove(id: id, entry: entry) }
    }

    public func cleanupAll() {
        for (id, entry) in entries { remove(id: id, entry: entry) }
    }

    private func purgeExpired() {
        let now = Date()
        for (id, entry) in entries where entry.resource.descriptor.expiresAt <= now {
            remove(id: id, entry: entry)
        }
    }

    private func expire(id: String, at expiration: Date) {
        guard let entry = entries[id], entry.resource.descriptor.expiresAt == expiration,
              expiration <= Date()
        else { return }
        remove(id: id, entry: entry)
    }

    private func remove(id: String, entry: Entry) {
        entries.removeValue(forKey: id)
        totalBytes -= entry.resource.descriptor.byteLength
        try? FileManager.default.removeItem(at: entry.resource.fileURL)
    }
}
