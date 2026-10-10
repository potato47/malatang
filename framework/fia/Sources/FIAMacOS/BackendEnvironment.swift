import CFNetwork
import Foundation

/// Bun does not read macOS proxy settings. Resolve them when launching the backend.
enum BackendEnvironment {
    static func make(
        development: Bool,
        parent: [String: String] = ProcessInfo.processInfo.environment,
        temporaryDirectory: String = FileManager.default.temporaryDirectory.path,
        systemProxies: [String: Any] = CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? [String: Any] ?? [:]
    ) -> [String: String] {
        let proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
        var result = development ? parent : ["PATH": "/usr/bin:/bin", "TMPDIR": temporaryDirectory]
        // Explicit environment configuration (including empty values) wins as a whole.
        if proxyKeys.contains(where: { parent[$0] != nil }) {
            for key in proxyKeys { result[key] = parent[key] }
        } else {
            result["HTTP_PROXY"] = proxyURL(systemProxies, prefix: "HTTP")
            result["HTTPS_PROXY"] = proxyURL(systemProxies, prefix: "HTTPS")
        }
        let explicitBypass = [parent["no_proxy"], parent["NO_PROXY"]].compactMap { $0 }.first { !$0.isEmpty }
        let systemBypass = (systemProxies["ExceptionsList"] as? [String] ?? [])
            // macOS's <local> token has no equivalent in Bun's NO_PROXY syntax.
            .filter { !$0.contains("<") && !$0.contains(">") }.joined(separator: ",")
        let usesSystemProxy = !proxyKeys.contains(where: { parent[$0] != nil })
        let bypass = explicitBypass ?? (usesSystemProxy ? systemBypass : "")
        // Keep framework loopback traffic away from proxies, in either casing convention.
        let noProxy = (["localhost", "127.0.0.1", "::1"] + (bypass.isEmpty ? [] : [bypass])).joined(separator: ",")
        result["NO_PROXY"] = noProxy
        result["no_proxy"] = noProxy
        return result
    }

    private static func proxyURL(_ settings: [String: Any], prefix: String) -> String? {
        guard (settings[prefix + "Enable"] as? NSNumber)?.boolValue == true,
              let host = settings[prefix + "Proxy"] as? String, !host.isEmpty,
              !host.contains(where: { $0.isWhitespace || "/@?#".contains($0) }),
              let port = settings[prefix + "Port"] as? Int, (1...65535).contains(port) else { return nil }
        var url = URLComponents()
        // HTTPS destinations use CONNECT through the system's HTTP proxy endpoint.
        url.scheme = "http"
        url.host = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        url.port = port
        return url.url?.absoluteString
    }
}
