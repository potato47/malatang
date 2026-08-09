import AppKit
import FIAHostCore
import Foundation
import WebKit

@MainActor
final class WebViewRegistry {
    var onEvent: (([String: Any]) -> Void)?
    var onFramesChanged: (([String: DesktopWindowFrame]) -> Void)?

    private let appName: String
    private let inspectable: Bool
    private let dataStore = WKWebsiteDataStore.nonPersistent()
    private var storedFrames: [String: DesktopWindowFrame]
    private var controllers: [String: HostWindowController] = [:]

    init(appName: String, inspectable: Bool, storedFrames: [String: DesktopWindowFrame]) {
        self.appName = appName
        self.inspectable = inspectable
        self.storedFrames = storedFrames
    }

    func execute(method: String, params: [String: Any]) throws -> Any? {
        switch method {
        case "webviews.open": return try open(params)
        case "webviews.navigate":
            let controller = try controller(params)
            controller.navigate(to: try url(params["url"]))
            return controller.state()
        case "webviews.show":
            let controller = try controller(params); controller.show(); return controller.state()
        case "webviews.hide":
            let controller = try controller(params); controller.hide(); return controller.state()
        case "webviews.focus":
            let controller = try controller(params); controller.focus(); return controller.state()
        case "webviews.close":
            let id = try identifier(params["id"])
            guard let controller = controllers.removeValue(forKey: id) else { throw notFound(id) }
            controller.onClosed = nil
            controller.close()
            emit(type: "closed", state: controller.state())
            return nil
        case "webviews.update":
            let controller = try controller(params)
            try controller.update(
                title: try optionalString(params["title"], field: "title"),
                width: try optionalDimension(params["width"], field: "width"),
                height: try optionalDimension(params["height"], field: "height"),
                minWidth: try optionalDimension(params["minWidth"], field: "minWidth"),
                minHeight: try optionalDimension(params["minHeight"], field: "minHeight"),
                closeBehavior: try optionalCloseBehavior(params["closeBehavior"]),
                alwaysOnTop: try optionalBool(params["alwaysOnTop"], field: "alwaysOnTop"),
                visibleOnAllSpaces: try optionalBool(params["visibleOnAllSpaces"], field: "visibleOnAllSpaces"),
                visibleOverFullScreen: try optionalBool(params["visibleOverFullScreen"], field: "visibleOverFullScreen")
            )
            return controller.state()
        case "webviews.list": return controllers.keys.sorted().compactMap { controllers[$0]?.state() }
        default: throw HostRequestExecutionError(code: .invalidRequest, message: "unknown WebView method: \(method)")
        }
    }

    func focusFirstWindow() -> Bool {
        guard let controller = controllers.keys.sorted().compactMap({ controllers[$0] }).first else { return false }
        controller.focus()
        return true
    }

    func currentFrames() -> [String: DesktopWindowFrame] {
        var frames = storedFrames
        for (id, controller) in controllers { if let frame = controller.currentFrame { frames[id] = frame } }
        return frames
    }

    private func open(_ params: [String: Any]) throws -> [String: Any] {
        let id = try identifier(params["id"])
        let targetURL = try url(params["url"])
        let title = try optionalString(params["title"], field: "title") ?? appName
        let focus = try optionalBool(params["focus"], field: "focus") ?? true
        if let existing = controllers[id] {
            try existing.update(
                title: try optionalString(params["title"], field: "title"),
                width: try optionalDimension(params["width"], field: "width"),
                height: try optionalDimension(params["height"], field: "height"),
                minWidth: try optionalDimension(params["minWidth"], field: "minWidth"),
                minHeight: try optionalDimension(params["minHeight"], field: "minHeight"),
                closeBehavior: try optionalCloseBehavior(params["closeBehavior"]),
                alwaysOnTop: try optionalBool(params["alwaysOnTop"], field: "alwaysOnTop"),
                visibleOnAllSpaces: try optionalBool(params["visibleOnAllSpaces"], field: "visibleOnAllSpaces"),
                visibleOverFullScreen: try optionalBool(params["visibleOverFullScreen"], field: "visibleOverFullScreen")
            )
            existing.navigate(to: targetURL)
            existing.focus()
            return existing.state()
        }
        let width = try dimension(params["width"], field: "width", fallback: 1024)
        let height = try dimension(params["height"], field: "height", fallback: 700)
        let minWidth = try dimension(params["minWidth"], field: "minWidth", fallback: 720)
        let minHeight = try dimension(params["minHeight"], field: "minHeight", fallback: 480)
        guard width >= minWidth, height >= minHeight else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "window size must not be smaller than its minimum size")
        }
        let closeValue = try optionalString(params["closeBehavior"], field: "closeBehavior") ?? "hide"
        guard closeValue == "hide" || closeValue == "close" else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "closeBehavior must be hide or close")
        }
        let restoreFrame = try optionalBool(params["restoreFrame"], field: "restoreFrame") ?? true
        let controller = HostWindowController(
            id: id,
            url: targetURL,
            title: title,
            width: width,
            height: height,
            minWidth: minWidth,
            minHeight: minHeight,
            restoredFrame: restoreFrame ? storedFrames[id] : nil,
            dataStore: dataStore,
            closeBehavior: closeValue == "hide" ? .hide : .close,
            alwaysOnTop: try optionalBool(params["alwaysOnTop"], field: "alwaysOnTop") ?? false,
            visibleOnAllSpaces: try optionalBool(params["visibleOnAllSpaces"], field: "visibleOnAllSpaces") ?? false,
            visibleOverFullScreen: try optionalBool(params["visibleOverFullScreen"], field: "visibleOverFullScreen") ?? false,
            inspectable: inspectable
        )
        controllers[id] = controller
        controller.onStateChanged = { [weak self, weak controller] in
            guard let self, let controller else { return }
            self.emit(type: "changed", state: controller.state())
        }
        controller.onFrameChanged = { [weak self, weak controller] in
            guard let self, let controller, let frame = controller.currentFrame else { return }
            self.storedFrames[id] = frame
            self.onFramesChanged?(self.currentFrames())
        }
        controller.onClosed = { [weak self, weak controller] in
            guard let self, let controller else { return }
            self.controllers.removeValue(forKey: id)
            self.emit(type: "closed", state: controller.state())
        }
        if focus { controller.focus() } else { controller.show() }
        return controller.state()
    }

    private func controller(_ params: [String: Any]) throws -> HostWindowController {
        let id = try identifier(params["id"])
        guard let controller = controllers[id] else { throw notFound(id) }
        return controller
    }

    private func identifier(_ value: Any?) throws -> String {
        guard let value = value as? String,
              value.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil,
              value.count <= 128 else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "invalid window id")
        }
        return value
    }

    private func url(_ value: Any?) throws -> URL {
        guard let value = value as? String, let url = URL(string: value),
              url.scheme == "http" || url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "WebView URL must be HTTP(S)")
        }
        return url
    }

    private func dimension(_ value: Any?, field: String, fallback: Double) throws -> Double {
        try optionalDimension(value, field: field) ?? fallback
    }

    private func optionalDimension(_ value: Any?, field: String) throws -> Double? {
        guard let value else { return nil }
        guard !(value is Bool), let number = value as? NSNumber,
              number.doubleValue.isFinite, number.doubleValue > 0, number.doubleValue <= 16_384 else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "\(field) must be greater than zero")
        }
        return number.doubleValue
    }

    private func optionalCloseBehavior(_ value: Any?) throws -> HostWindowController.CloseBehavior? {
        guard let value else { return nil }
        guard let value = value as? String else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "closeBehavior must be hide or close")
        }
        switch value {
        case "hide": return .hide
        case "close": return .close
        default: throw HostRequestExecutionError(code: .invalidArgument, message: "closeBehavior must be hide or close")
        }
    }

    private func optionalBool(_ value: Any?, field: String) throws -> Bool? {
        guard let value else { return nil }
        guard let value = value as? Bool else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "\(field) must be a boolean")
        }
        return value
    }

    private func optionalString(_ value: Any?, field: String) throws -> String? {
        guard let value else { return nil }
        guard let value = value as? String, !value.isEmpty, !value.contains("\0"), value.count <= 512 else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "\(field) must be a non-empty string")
        }
        return value
    }

    private func notFound(_ id: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .notFound, message: "WebView not found: \(id)")
    }

    private func emit(type: String, state: [String: Any]) {
        onEvent?(["type": type, "window": state])
    }
}
