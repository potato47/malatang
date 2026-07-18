import Foundation

public enum NavigationDecision: Equatable, Sendable {
    case allow
    case cancel
    case openExternal(URL)
}

public struct NavigationPolicy: Equatable, Sendable {
    public let origin: URL

    public init(origin: URL) {
        self.origin = origin
    }

    public func decide(url: URL?, isMainFrame: Bool, isUserActivatedLink: Bool) -> NavigationDecision {
        guard let url else { return .cancel }
        if url.scheme == "about", url.absoluteString == "about:blank" { return .allow }
        if sameOrigin(url, origin) { return .allow }
        guard isMainFrame,
              isUserActivatedLink,
              url.scheme == "http" || url.scheme == "https"
        else { return .cancel }
        return .openExternal(url)
    }

    private func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        guard let left = URLComponents(url: lhs, resolvingAgainstBaseURL: false),
              let right = URLComponents(url: rhs, resolvingAgainstBaseURL: false)
        else { return false }
        return left.scheme?.lowercased() == right.scheme?.lowercased()
            && left.host?.lowercased() == right.host?.lowercased()
            && effectivePort(left) == effectivePort(right)
    }

    private func effectivePort(_ components: URLComponents) -> Int? {
        if let port = components.port { return port }
        return switch components.scheme?.lowercased() {
        case "http": 80
        case "https": 443
        default: nil
        }
    }
}
