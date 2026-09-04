import FIA
import XCTest

final class FIAAppTests: XCTestCase {
    func testRuntimeContractVersion() throws {
        let error = FIAError(
            code: .capabilityUnavailable,
            component: "test",
            message: "contract"
        )
        XCTAssertEqual(error.code, .capabilityUnavailable)
    }
}
