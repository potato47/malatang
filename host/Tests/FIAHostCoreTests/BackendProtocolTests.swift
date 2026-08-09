import FIAHostCore
import Foundation
import Testing

@Suite("Backend stdio protocol")
struct BackendProtocolTests {
    @Test func decodesFragmentedJSONLines() throws {
        var decoder = BackendStdoutDecoder()
        #expect(try decoder.append(Data(#"{"v":1,"type":"rea"#.utf8)).isEmpty)
        let frames = try decoder.append(Data("dy\",\"port\":49152,\"origin\":\"http://127.0.0.1:49152\"}\n{\"v\":1,\"type\":\"request\",\"id\":1,\"method\":\"application.getState\",\"params\":{}}\n".utf8))
        #expect(frames.count == 2)
        #expect(frames[0]["type"] as? String == "ready")
        #expect(frames[1]["id"] as? Int == 1)
    }

    @Test func rejectsLogsWrongVersionsAndOversizedFrames() throws {
        var log = BackendStdoutDecoder()
        #expect(throws: BackendProtocolError.self) { try log.append(Data("application log\n".utf8)) }
        var version = BackendStdoutDecoder()
        #expect(throws: BackendProtocolError.self) { try version.append(Data("{\"v\":2,\"type\":\"ready\"}\n".utf8)) }
        var oversized = BackendStdoutDecoder()
        #expect(throws: BackendProtocolError.self) {
            try oversized.append(Data(repeating: 0x20, count: FIAMaximumStdioFrameBytes + 1))
        }
    }
}
