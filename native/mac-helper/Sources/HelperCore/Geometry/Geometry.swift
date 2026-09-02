import Foundation

/// Rectangle in display points, top-left origin. Mirrors RectSchema.
public struct PointRect: Equatable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var maxX: Double { x + width }
    public var maxY: Double { y + height }

    public func contains(x px: Double, y py: Double) -> Bool {
        px >= x && px <= maxX && py >= y && py <= maxY
    }

    public func toJSON() -> JSONValue {
        .object([
            "x": .number(x), "y": .number(y),
            "width": .number(width), "height": .number(height)
        ])
    }
}

public struct DisplayPoint: Equatable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// Conversions between Vision's normalized bottom-left space and pixel space.
public enum VisionGeometry {
    /// Vision bounding boxes are normalized [0,1] with the origin at the
    /// bottom-left of the image. Returns a pixel rect with top-left origin.
    public static func pixelRect(normalizedX: Double, normalizedY: Double,
                                 normalizedWidth: Double, normalizedHeight: Double,
                                 imageWidth: Int, imageHeight: Int) -> PointRect {
        let width = Double(imageWidth)
        let height = Double(imageHeight)
        let topNormalized = normalizedY + normalizedHeight
        return PointRect(
            x: (normalizedX * width).rounded(),
            y: ((1.0 - topNormalized) * height).rounded(),
            width: (normalizedWidth * width).rounded(),
            height: (normalizedHeight * height).rounded()
        )
    }
}

/// Display point <-> pixel mapping and multi-display containment.
public enum DisplayGeometry {
    /// Maps a pixel inside a captured image back to a display point given the
    /// capture origin (display points) and the backing scale factor.
    public static func pixelToPoint(pixelX: Double, pixelY: Double,
                                    originX: Double, originY: Double, scale: Double) -> DisplayPoint {
        let safeScale = scale > 0 ? scale : 1
        return DisplayPoint(x: originX + pixelX / safeScale, y: originY + pixelY / safeScale)
    }

    public static func pointToPixel(pointX: Double, pointY: Double,
                                    originX: Double, originY: Double, scale: Double) -> DisplayPoint {
        let safeScale = scale > 0 ? scale : 1
        return DisplayPoint(x: (pointX - originX) * safeScale, y: (pointY - originY) * safeScale)
    }

    /// True when the point is within the union of the given display rects.
    public static func isWithinDisplays(x: Double, y: Double, displays: [PointRect]) -> Bool {
        guard x.isFinite, y.isFinite else { return false }
        return displays.contains { $0.contains(x: x, y: y) }
    }

    /// Union bounding box of all displays, or nil when there are none.
    public static func unionBounds(_ displays: [PointRect]) -> PointRect? {
        guard let first = displays.first else { return nil }
        var minX = first.x, minY = first.y, maxX = first.maxX, maxY = first.maxY
        for rect in displays.dropFirst() {
            minX = min(minX, rect.x)
            minY = min(minY, rect.y)
            maxX = max(maxX, rect.maxX)
            maxY = max(maxY, rect.maxY)
        }
        return PointRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}
