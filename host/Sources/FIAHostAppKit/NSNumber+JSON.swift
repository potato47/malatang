import CoreFoundation
import Foundation

extension NSNumber {
    var isJSONBoolean: Bool { CFGetTypeID(self) == CFBooleanGetTypeID() }
}
