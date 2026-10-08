import Foundation
import Testing

@testable import FIA

@Suite("Local application profiles")
struct LocalProfileTests {
    @Test func embeddedRootIsUsedWithoutLauncherAndExplicitOverridesStillWork() throws {
        let json = """
        {"schema":4,"frameworkVersion":"0.16.1","app":{"name":"Example Dev","identifier":"com.example.app","version":"1.0.0","build":1},"bunSHA256":"hash","runtimeId":"runtime","localProfile":{"mode":"development","dataRoot":"/tmp/project/.fia/dev/data","label":"DEV"}}
        """
        let manifest = try JSONDecoder().decode(RuntimeManifest.self, from: Data(json.utf8))
        #expect(try manifest.supportRoot(environment: [:]).path == "/tmp/project/.fia/dev/data")
        #expect(try manifest.supportRoot(environment: ["FIA_DATA_DIRECTORY": "/tmp/fixture"]).path == "/tmp/fixture")
        #expect(manifest.app.identifier == "com.example.app")
        let restored = try JSONDecoder().decode(RuntimeManifest.self, from: JSONEncoder().encode(manifest))
        #expect(restored.localProfile?.mode == "development")
        #expect(try restored.supportRoot(environment: [:]) == manifest.supportRoot(environment: [:]))
        var production = manifest
        production.localProfile = nil
        #expect(try production.supportRoot(environment: [:]).path.hasSuffix("Library/Application Support"))
    }
}
