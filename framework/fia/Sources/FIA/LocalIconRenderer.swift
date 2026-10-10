import AppKit

/// Adds a visible channel band to the original application icon; no source asset is modified.
@MainActor
func renderBadgedIcon(arguments: [String]) throws {
    guard arguments.count == 3, ["DEV", "PREV"].contains(arguments[1]) else {
        throw UpdateError("Expected source icon, DEV/PREV and output directory")
    }
    let source = arguments[0].isEmpty ? nil : NSImage(contentsOfFile: arguments[0])
    if !arguments[0].isEmpty && source == nil { throw UpdateError("Could not read application icon") }
    let label = arguments[1]
    let directory = URL(fileURLWithPath: arguments[2], isDirectory: true)
    let iconset = directory.appending(path: "icon.iconset")
    try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
    for points in [16, 32, 128, 256, 512] {
        for factor in [1, 2] {
            let size = points * factor
            guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: size * 4, bitsPerPixel: 32),
                let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
                throw UpdateError("Could not create local icon")
            }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = context
            let side = CGFloat(size)
            let rect = NSRect(x: 0, y: 0, width: side, height: side)
            NSColor.clear.setFill()
            rect.fill(using: .copy)
            if let source { source.draw(in: rect) }
            else {
                NSColor.darkGray.setFill()
                NSBezierPath(roundedRect: rect.insetBy(dx: side * 0.06, dy: side * 0.06),
                    xRadius: side * 0.2, yRadius: side * 0.2).fill()
            }
            // A broad band remains visible when macOS reduces the icon to Dock size.
            let band = NSRect(x: side * 0.05, y: side * 0.05, width: side * 0.9, height: side * 0.34)
            let color = label == "DEV"
                ? NSColor(srgbRed: 1, green: 0.65, blue: 0.08, alpha: 1)
                : NSColor(srgbRed: 0.15, green: 0.75, blue: 0.95, alpha: 1)
            color.setFill()
            NSBezierPath(roundedRect: band, xRadius: side * 0.07, yRadius: side * 0.07).fill()
            let attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedSystemFont(ofSize: side * (label == "DEV" ? 0.26 : 0.22), weight: .heavy),
                .foregroundColor: NSColor.black,
            ]
            let text = NSAttributedString(string: label, attributes: attributes)
            let textSize = text.size()
            text.draw(at: NSPoint(x: band.midX - textSize.width / 2, y: band.midY - textSize.height / 2))
            NSGraphicsContext.restoreGraphicsState()
            guard let png = bitmap.representation(using: .png, properties: [:]) else {
                throw UpdateError("Could not encode local icon")
            }
            try png.write(to: iconset.appending(path: "icon_\(points)x\(points)\(factor == 2 ? "@2x" : "").png"))
            if size == 1024 { try png.write(to: directory.appending(path: "icon.png")) }
        }
    }
}
