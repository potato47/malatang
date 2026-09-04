import Foundation

public struct FIAErrorCode: RawRepresentable, Codable, Sendable, Hashable {
    public let rawValue: String

    public init(rawValue: String) { self.rawValue = rawValue }

    public init(from decoder: any Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public static let invalidRequest = FIAErrorCode(rawValue: "invalid_request")
    public static let invalidArgument = FIAErrorCode(rawValue: "invalid_argument")
    public static let notFound = FIAErrorCode(rawValue: "not_found")
    public static let unsafeState = FIAErrorCode(rawValue: "unsafe_state")
    public static let nativeFailure = FIAErrorCode(rawValue: "native_failure")
    public static let protocolFailure = FIAErrorCode(rawValue: "protocol_failure")
    public static let timeout = FIAErrorCode(rawValue: "timeout")
    public static let cancelled = FIAErrorCode(rawValue: "cancelled")
    public static let conflict = FIAErrorCode(rawValue: "conflict")
    public static let permissionDenied = FIAErrorCode(rawValue: "permission_denied")
    public static let capabilityUnavailable = FIAErrorCode(rawValue: "capability_unavailable")
    public static let resourceLimit = FIAErrorCode(rawValue: "resource_limit")
}

public struct FIAError: Error, Codable, LocalizedError, Sendable {
    public let code: FIAErrorCode
    public let component: String
    public let method: String?
    public let message: String
    public let recoverable: Bool
    public let details: FIAJSONValue?

    public init(
        code: FIAErrorCode,
        component: String,
        method: String? = nil,
        message: String,
        recoverable: Bool = false,
        details: FIAJSONValue? = nil
    ) {
        self.code = code
        self.component = component
        self.method = method
        self.message = message
        self.recoverable = recoverable
        self.details = details
    }

    public init<Code: RawRepresentable>(
        code: Code,
        component: String,
        method: String? = nil,
        message: String,
        recoverable: Bool = false,
        details: FIAJSONValue? = nil
    ) where Code.RawValue == String {
        self.init(
            code: FIAErrorCode(rawValue: code.rawValue),
            component: component,
            method: method,
            message: message,
            recoverable: recoverable,
            details: details
        )
    }

    public var errorDescription: String? { message }
}

public enum FIAJSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([FIAJSONValue])
    case object([String: FIAJSONValue])

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([FIAJSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: FIAJSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case let .bool(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }
}

public struct FIAEmpty: Codable, Sendable, Equatable {
    public init() {}
}
