import CoreGraphics
import Foundation
import HelperCore
import Vision

/// ocrImage: local text recognition with Vision. Blocks are returned in image
/// pixel coordinates with a top-left origin.
enum VisionOCR {
    private static let maxBlockText = 512

    static func recognize(params: [String: JSONValue]) -> Result<JSONValue, HelperError> {
        guard let base64 = params["pngBase64"]?.stringValue, !base64.isEmpty else {
            return .failure(HelperError(.invalidRequest, "pngBase64 is required"))
        }
        guard let image = ImageCodec.decode(base64: base64) else {
            return .failure(HelperError(.ocrFailed, "could not decode PNG image"))
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return .failure(HelperError(.ocrFailed, "Vision request failed: \(error.localizedDescription)"))
        }
        let observations = request.results ?? []
        let blocks: [JSONValue] = observations.compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            let rect = VisionGeometry.pixelRect(
                normalizedX: box.origin.x, normalizedY: box.origin.y,
                normalizedWidth: box.width, normalizedHeight: box.height,
                imageWidth: image.width, imageHeight: image.height)
            return .object([
                "text": .string(String(candidate.string.prefix(maxBlockText))),
                "x": .number(rect.x),
                "y": .number(rect.y),
                "width": .number(rect.width),
                "height": .number(rect.height),
                "confidence": .number(min(1, max(0, Double(candidate.confidence))))
            ])
        }
        return .success(.object([
            "width": .int(image.width),
            "height": .int(image.height),
            "blocks": .array(blocks)
        ]))
    }
}
