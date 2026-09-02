import CoreGraphics
import Foundation
import ImageIO

/// PNG encode/decode through ImageIO. No AppKit image types cross the wire.
enum ImageCodec {
    private static let pngType = "public.png" as CFString

    static func encodePNG(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, pngType, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }

    static func decode(base64: String) -> CGImage? {
        guard let data = Data(base64Encoded: base64, options: [.ignoreUnknownCharacters]) else { return nil }
        return decode(data)
    }

    static func decode(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }
}
