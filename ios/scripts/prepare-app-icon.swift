import Foundation
import CoreGraphics
import ImageIO

// Package the dedicated MB artwork without changing the website's branding.
// Flatten onto opaque black and resize to Apple's 1024-pixel icon slot.
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = root.appendingPathComponent("Branding/mb-app-icon.png").standardized
let outputURL = root.appendingPathComponent("Mooberball/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: 1024, height: 1024,
                              bitsPerComponent: 8, bytesPerRow: 4096,
                              space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("Could not read the logo or create the icon canvas.")
}
context.setFillColor(CGColor(gray: 0, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.interpolationQuality = .high
context.draw(image, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(),
                                        withIntermediateDirectories: true)
guard let rendered = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, "public.png" as CFString, 1, nil) else {
    fatalError("Could not create the app icon.")
}
CGImageDestinationAddImage(destination, rendered, nil)
guard CGImageDestinationFinalize(destination),
      let checkSource = CGImageSourceCreateWithURL(outputURL as CFURL, nil),
      let check = CGImageSourceCreateImageAtIndex(checkSource, 0, nil),
      check.width == 1024, check.height == 1024,
      [.none, .noneSkipFirst, .noneSkipLast].contains(check.alphaInfo) else {
    fatalError("App icon failed size/opacity validation.")
}
print("Prepared opaque 1024 × 1024 Mooberball app icon.")
