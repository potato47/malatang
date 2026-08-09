import FIAHostCore
import Foundation
import Security

protocol KeychainClient {
    func get(service: String, account: String) throws -> Data?
    func set(service: String, account: String, value: Data) throws
    func delete(service: String, account: String) throws -> Bool
}

struct SystemKeychainClient: KeychainClient {
    func get(service: String, account: String) throws -> Data? {
        var query = baseQuery(service: service, account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try requireSuccess(status)
        guard let data = result as? Data else { throw KeychainClientError.invalidResult }
        return data
    }

    func set(service: String, account: String, value: Data) throws {
        let query = baseQuery(service: service, account: account)
        let attributes: [String: Any] = [
            kSecValueData as String: value,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            attributes.forEach { item[$0.key] = $0.value }
            try requireSuccess(SecItemAdd(item as CFDictionary, nil))
            return
        }
        try requireSuccess(status)
    }

    func delete(service: String, account: String) throws -> Bool {
        let status = SecItemDelete(baseQuery(service: service, account: account) as CFDictionary)
        if status == errSecItemNotFound { return false }
        try requireSuccess(status)
        return true
    }

    private func baseQuery(service: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
        ]
    }

    private func requireSuccess(_ status: OSStatus) throws {
        guard status == errSecSuccess else { throw KeychainClientError.status(status) }
    }
}

enum KeychainClientError: Error, LocalizedError {
    case invalidResult
    case status(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidResult:
            "Keychain returned an invalid value"
        case let .status(status):
            SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
        }
    }
}

final class KeychainController {
    private let service: String
    private let client: KeychainClient

    init(service: String, client: KeychainClient = SystemKeychainClient()) {
        self.service = service
        self.client = client
    }

    func execute(method: String, params: [String: Any]) throws -> Any? {
        switch method {
        case "keychain.get":
            try requireKeys(params, allowed: ["key"])
            guard let data = try client.get(service: service, account: try key(params["key"])) else {
                return NSNull()
            }
            guard let value = String(data: data, encoding: .utf8) else {
                throw HostRequestExecutionError(code: .nativeFailure, message: "Keychain value is not valid UTF-8")
            }
            return value
        case "keychain.set":
            try requireKeys(params, allowed: ["key", "value"])
            guard let value = params["value"] as? String else { throw invalid("value must be a string") }
            try client.set(service: service, account: try key(params["key"]), value: Data(value.utf8))
            return nil
        case "keychain.delete":
            try requireKeys(params, allowed: ["key"])
            return try client.delete(service: service, account: try key(params["key"]))
        default:
            throw HostRequestExecutionError(code: .invalidRequest, message: "unknown Keychain method: \(method)")
        }
    }

    private func key(_ value: Any?) throws -> String {
        guard let value = value as? String, !value.isEmpty, value.count <= 256, !value.contains("\0") else {
            throw invalid("key must be a non-empty string of at most 256 characters")
        }
        return value
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed) else {
            throw invalid("Keychain parameters contain unknown fields")
        }
    }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }
}
