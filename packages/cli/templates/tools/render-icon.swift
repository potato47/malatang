import AppKit
import CoreText

// Invoked by `fia icon`. All user input is passed as arguments, never Swift source.
func color(_ hex: String) throws -> CGColor {
    guard hex.count == 7, hex.first == "#", let value = UInt32(hex.dropFirst(), radix: 16) else {
        throw NSError(domain: "fia.icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid color"])
    }
    return CGColor(srgbRed: CGFloat((value >> 16) & 255) / 255,
                   green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
}

func render() throws {
    guard CommandLine.arguments.count == 5 else {
        throw NSError(domain: "fia.icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected text, background, foreground and output directory"])
    }
    let text = CommandLine.arguments[1]
    let background = try color(CommandLine.arguments[2])
    let foreground = try color(CommandLine.arguments[3])
    let directory = URL(fileURLWithPath: CommandLine.arguments[4], isDirectory: true)
    let font = NSFont.systemFont(ofSize: 1024, weight: .bold)
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: font]))
    let path = CGMutablePath()
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
        let count = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: count)
        var positions = [CGPoint](repeating: .zero, count: count)
        CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
        CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
        let attributes = CTRunGetAttributes(run) as NSDictionary
        let runFont = attributes[kCTFontAttributeName] as! CTFont
        for index in 0..<count {
            guard glyphs[index] != 0,
                  let glyph = CTFontCreatePathForGlyph(runFont, glyphs[index], nil) else {
                throw NSError(domain: "fia.icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "No system font can draw '\(text)'; install a font that supports this character"])
            }
            path.addPath(glyph, transform: CGAffineTransform(translationX: positions[index].x, y: positions[index].y))
        }
    }
    let bounds = path.boundingBoxOfPath
    guard !bounds.isEmpty, !bounds.isInfinite else {
        throw NSError(domain: "fia.icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Character has no visible outline"])
    }
    let iconset = directory.appendingPathComponent("icon.iconset", isDirectory: true)
    try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
    func png(_ size: Int) throws -> Data {
        guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                                      bytesPerRow: size * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw NSError(domain: "fia.icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create image context"])
        }
        context.setFillColor(background)
        context.fill(CGRect(x: 0, y: 0, width: size, height: size))
        let scale = CGFloat(size) * 0.6 / max(bounds.width, bounds.height)
        context.translateBy(x: CGFloat(size) / 2 - bounds.midX * scale,
                            y: CGFloat(size) / 2 - bounds.midY * scale)
        context.scaleBy(x: scale, y: scale)
        context.setFillColor(foreground)
        context.addPath(path)
        context.fillPath()
        guard let image = context.makeImage(),
              let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
              let decoded = NSBitmapImageRep(data: data), decoded.pixelsWide == size, decoded.pixelsHigh == size else {
            throw NSError(domain: "fia.icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG"])
        }
        return data
    }
    for points in [16, 32, 128, 256, 512] {
        for factor in [1, 2] {
            let name = "icon_\(points)x\(points)\(factor == 2 ? "@2x" : "").png"
            let data = try png(points * factor)
            try data.write(to: iconset.appendingPathComponent(name))
            if points == 512 && factor == 2 {
                try data.write(to: directory.appendingPathComponent("icon.png"))
            }
        }
    }
}

do {
    try render()
} catch {
    FileHandle.standardError.write(Data("fia icon: \(error.localizedDescription)\n".utf8))
    exit(1)
}
