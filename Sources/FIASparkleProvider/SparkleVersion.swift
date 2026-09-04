import Sparkle

// This isolated target keeps FIA's audited Sparkle version resolved without forcing
// applications that disable updates to link or bundle the dynamic framework.
enum SparkleVersion {
    static let provider = SPUStandardUpdaterController.self
}
