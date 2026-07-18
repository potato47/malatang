import Foundation
import Testing
@testable import FIAHostCore

@Suite("Web navigation policy")
struct NavigationPolicyTests {
    private let policy = NavigationPolicy(origin: URL(string: "http://127.0.0.1:49152")!)

    @Test func allowsOnlyExactOriginInternally() {
        #expect(policy.decide(
            url: URL(string: "http://127.0.0.1:49152/app"),
            isMainFrame: true,
            isUserActivatedLink: false
        ) == .allow)
        #expect(policy.decide(
            url: URL(string: "http://127.0.0.1:49153/app"),
            isMainFrame: true,
            isUserActivatedLink: false
        ) == .cancel)
    }

    @Test func externalizesOnlyUserActivatedMainFrameLinks() {
        let external = URL(string: "https://example.com/help")!
        #expect(policy.decide(url: external, isMainFrame: true, isUserActivatedLink: true) == .openExternal(external))
        #expect(policy.decide(url: external, isMainFrame: true, isUserActivatedLink: false) == .cancel)
        #expect(policy.decide(url: external, isMainFrame: false, isUserActivatedLink: true) == .cancel)
        #expect(policy.decide(url: URL(string: "file:///tmp/a"), isMainFrame: true, isUserActivatedLink: true) == .cancel)
    }
}

