import Foundation
import Testing
@testable import FIAMacOS

@Suite("Backend proxy environment")
struct BackendEnvironmentTests {
    let proxies: [String: Any] = [
        "HTTPEnable": 1, "HTTPProxy": "127.0.0.1", "HTTPPort": 8123,
        "HTTPSEnable": 1, "HTTPSProxy": "proxy.example.test", "HTTPSPort": 8124,
        "ExceptionsList": ["*.local", "10.0.0.0/8", "<local>"],
    ]

    @Test func productionUsesSystemProxiesWithoutInheritingUnrelatedSecrets() {
        let result = BackendEnvironment.make(development: false,
            parent: ["OPENAI_API_KEY": "private", "PATH": "/custom/bin", "NODE_OPTIONS": "--inspect"],
            temporaryDirectory: "/temporary", systemProxies: proxies)
        #expect(result["HTTP_PROXY"] == "http://127.0.0.1:8123")
        #expect(result["HTTPS_PROXY"] == "http://proxy.example.test:8124")
        #expect(result["NO_PROXY"] == "localhost,127.0.0.1,::1,*.local,10.0.0.0/8")
        #expect(result["no_proxy"] == result["NO_PROXY"])
        #expect(result["PATH"] == "/usr/bin:/bin" && result["TMPDIR"] == "/temporary")
        #expect(result["OPENAI_API_KEY"] == nil && result["NODE_OPTIONS"] == nil)
    }

    @Test func explicitEnvironmentWinsAndAlwaysBypassesLoopback() {
        let parent = ["https_proxy": "http://explicit.test:3128", "no_proxy": "internal.test", "OPENAI_API_KEY": "private"]
        let result = BackendEnvironment.make(development: false, parent: parent, systemProxies: proxies)
        #expect(result["https_proxy"] == parent["https_proxy"])
        #expect(result["HTTPS_PROXY"] == nil && result["HTTP_PROXY"] == nil)
        #expect(result["NO_PROXY"] == "localhost,127.0.0.1,::1,internal.test")
        let disabled = BackendEnvironment.make(development: false, parent: ["ALL_PROXY": ""], systemProxies: proxies)
        #expect(disabled["ALL_PROXY"] == "" && disabled["HTTPS_PROXY"] == nil)
        let upper = BackendEnvironment.make(development: false, parent: ["ALL_PROXY": "http://all.test:80", "NO_PROXY": "*.example.test"], systemProxies: proxies)
        #expect(upper["ALL_PROXY"] == "http://all.test:80")
        #expect(upper["no_proxy"] == "localhost,127.0.0.1,::1,*.example.test")
    }

    @Test func developmentRetainsItsEnvironmentAndGetsSystemProxyFallback() {
        let result = BackendEnvironment.make(development: true, parent: ["CUSTOM": "development", "PATH": "/custom/bin"], systemProxies: proxies)
        #expect(result["CUSTOM"] == "development" && result["PATH"] == "/custom/bin")
        #expect(result["HTTPS_PROXY"] == "http://proxy.example.test:8124")
    }

    @Test func invalidDisabledAndUnsupportedProxySettingsDoNotBecomeURLs() {
        for settings: [String: Any] in [[:], ["HTTPEnable": 0, "HTTPProxy": "proxy.test", "HTTPPort": 80],
            ["HTTPEnable": 1, "HTTPProxy": "https://bad.test/path", "HTTPPort": 80],
            ["HTTPEnable": 1, "HTTPProxy": "proxy.test", "HTTPPort": 65536],
            ["ProxyAutoConfigEnable": 1, "ProxyAutoConfigURLString": "https://proxy.test/pac", "SOCKSEnable": 1, "SOCKSProxy": "localhost", "SOCKSPort": 8080]] {
            let result = BackendEnvironment.make(development: false, parent: [:], systemProxies: settings)
            #expect(result["HTTP_PROXY"] == nil && result["HTTPS_PROXY"] == nil)
        }
        let ipv6 = BackendEnvironment.make(development: false, parent: [:], systemProxies: ["HTTPEnable": 1, "HTTPProxy": "::1", "HTTPPort": 8888])
        #expect(ipv6["HTTP_PROXY"] == "http://[::1]:8888")
    }
}
