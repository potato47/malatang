import Foundation
import FIAHostCore
import UserNotifications

@MainActor
protocol NotificationClient: AnyObject {
    var onClick: ((String) -> Void)? { get set }
    func authorizationStatus() async -> UNAuthorizationStatus
    func requestAuthorization() async throws
    func send(id: String, title: String, subtitle: String?, body: String?, sound: Bool) async throws
    func remove(id: String)
    func removeAll()
}

@MainActor
final class SystemNotificationClient: NSObject, NotificationClient, UNUserNotificationCenterDelegate {
    var onClick: ((String) -> Void)?

    private let center: UNUserNotificationCenter

    init(center: UNUserNotificationCenter = .current()) {
        self.center = center
        super.init()
        center.delegate = self
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func requestAuthorization() async throws {
        _ = try await center.requestAuthorization(options: [.alert, .sound])
    }

    func send(id: String, title: String, subtitle: String?, body: String?, sound: Bool) async throws {
        let content = UNMutableNotificationContent()
        content.title = title
        if let subtitle { content.subtitle = subtitle }
        if let body { content.body = body }
        if sound { content.sound = .default }
        center.removePendingNotificationRequests(withIdentifiers: [id])
        center.removeDeliveredNotifications(withIdentifiers: [id])
        try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    func remove(id: String) {
        center.removePendingNotificationRequests(withIdentifiers: [id])
        center.removeDeliveredNotifications(withIdentifiers: [id])
    }

    func removeAll() {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let id = response.notification.request.identifier
        Task { @MainActor [weak self] in self?.onClick?(id) }
        completionHandler()
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        var options: UNNotificationPresentationOptions = [.banner]
        if notification.request.content.sound != nil { options.insert(.sound) }
        completionHandler(options)
    }
}

@MainActor
final class NotificationController {
    var onEvent: (([String: Any]) -> Void)?

    private let client: NotificationClient
    private let diagnostic: (String) -> Void
    private var backendReady = false
    private var queuedClicks: [String] = []
    private let maximumQueuedClicks = 64

    init(
        client: NotificationClient = SystemNotificationClient(),
        diagnostic: @escaping (String) -> Void = { _ in }
    ) {
        self.client = client
        self.diagnostic = diagnostic
        client.onClick = { [weak self] id in self?.clicked(id) }
    }

    func setBackendReady(_ ready: Bool) {
        backendReady = ready
        guard ready, !queuedClicks.isEmpty else { return }
        let queued = queuedClicks
        queuedClicks.removeAll(keepingCapacity: true)
        queued.forEach { emit($0) }
    }

    func execute(method: String, params: [String: Any]) async throws -> Any? {
        switch method {
        case "notifications.getAuthorizationStatus":
            try requireKeys(params, allowed: [])
            return Self.statusName(await client.authorizationStatus())
        case "notifications.requestAuthorization":
            try requireKeys(params, allowed: [])
            try await client.requestAuthorization()
            return Self.statusName(await client.authorizationStatus())
        case "notifications.send":
            try requireKeys(params, allowed: ["id", "title", "subtitle", "body", "sound"])
            let status = await client.authorizationStatus()
            guard Self.canSend(status) else {
                throw HostRequestExecutionError(
                    code: .unsafeState,
                    message: "notification authorization has not been granted"
                )
            }
            let id = try optionalString(params["id"], field: "id", maximum: 128) ?? UUID().uuidString
            let title = try requiredString(params["title"], field: "title", maximum: 256)
            let subtitle = try optionalString(params["subtitle"], field: "subtitle", maximum: 512)
            let body = try optionalString(params["body"], field: "body", maximum: 4_096)
            let sound = try optionalBool(params["sound"], field: "sound") ?? false
            try await client.send(id: id, title: title, subtitle: subtitle, body: body, sound: sound)
            return ["id": id]
        case "notifications.remove":
            try requireKeys(params, allowed: ["id"])
            client.remove(id: try requiredString(params["id"], field: "id", maximum: 128))
            return nil
        case "notifications.removeAll":
            try requireKeys(params, allowed: [])
            client.removeAll()
            return nil
        default:
            throw HostRequestExecutionError(code: .invalidRequest, message: "unknown notification method: \(method)")
        }
    }

    private func clicked(_ id: String) {
        guard backendReady else {
            if queuedClicks.count == maximumQueuedClicks {
                queuedClicks.removeFirst()
                diagnostic("notification click queue overflow; discarded oldest event")
            }
            queuedClicks.append(id)
            return
        }
        emit(id)
    }

    private func emit(_ id: String) { onEvent?(["id": id]) }

    private static func canSend(_ status: UNAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .provisional, .ephemeral: true
        default: false
        }
    }

    private static func statusName(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: "notDetermined"
        case .denied: "denied"
        case .authorized: "authorized"
        case .provisional: "provisional"
        case .ephemeral: "ephemeral"
        @unknown default: "unknown"
        }
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed) else {
            throw invalid("notification parameters contain unknown fields")
        }
    }

    private func requiredString(_ value: Any?, field: String, maximum: Int) throws -> String {
        guard let value = try optionalString(value, field: field, maximum: maximum) else {
            throw invalid("\(field) must be a non-empty string")
        }
        return value
    }

    private func optionalString(_ value: Any?, field: String, maximum: Int) throws -> String? {
        guard let value else { return nil }
        guard let value = value as? String, !value.isEmpty, !value.contains("\0"), value.count <= maximum else {
            throw invalid("\(field) must be a non-empty string of at most \(maximum) characters")
        }
        return value
    }

    private func optionalBool(_ value: Any?, field: String) throws -> Bool? {
        guard let value else { return nil }
        guard let value = value as? Bool else { throw invalid("\(field) must be a boolean") }
        return value
    }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }
}
