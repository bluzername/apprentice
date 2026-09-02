import XCTest
@testable import HelperCore

final class GeometryTests: XCTestCase {
    func testVisionRectConvertsToTopLeftPixels() {
        // A box occupying the top-left quarter of a 1000x500 image in Vision space
        // (origin bottom-left) is x 0..0.5, y 0.5..1.0.
        let rect = VisionGeometry.pixelRect(normalizedX: 0, normalizedY: 0.5, normalizedWidth: 0.5, normalizedHeight: 0.5,
                                            imageWidth: 1000, imageHeight: 500)
        XCTAssertEqual(rect, PointRect(x: 0, y: 0, width: 500, height: 250))
    }

    func testVisionRectBottomRight() {
        let rect = VisionGeometry.pixelRect(normalizedX: 0.8, normalizedY: 0.0, normalizedWidth: 0.2, normalizedHeight: 0.1,
                                            imageWidth: 1000, imageHeight: 500)
        XCTAssertEqual(rect, PointRect(x: 800, y: 450, width: 200, height: 50))
    }

    func testPixelToPointUsesOriginAndScale() {
        let point = DisplayGeometry.pixelToPoint(pixelX: 200, pixelY: 100, originX: 50, originY: 25, scale: 2)
        XCTAssertEqual(point, DisplayPoint(x: 150, y: 75))
        let back = DisplayGeometry.pointToPixel(pointX: 150, pointY: 75, originX: 50, originY: 25, scale: 2)
        XCTAssertEqual(back, DisplayPoint(x: 200, y: 100))
    }

    func testZeroScaleFallsBackToOne() {
        XCTAssertEqual(DisplayGeometry.pixelToPoint(pixelX: 10, pixelY: 10, originX: 0, originY: 0, scale: 0),
                       DisplayPoint(x: 10, y: 10))
    }

    func testWithinDisplaysUnion() {
        let displays = [PointRect(x: 0, y: 0, width: 100, height: 100), PointRect(x: 100, y: -50, width: 100, height: 100)]
        XCTAssertTrue(DisplayGeometry.isWithinDisplays(x: 50, y: 50, displays: displays))
        XCTAssertTrue(DisplayGeometry.isWithinDisplays(x: 150, y: -20, displays: displays))
        XCTAssertTrue(DisplayGeometry.isWithinDisplays(x: 100, y: 100, displays: displays))
        XCTAssertFalse(DisplayGeometry.isWithinDisplays(x: 50, y: -20, displays: displays))
        XCTAssertFalse(DisplayGeometry.isWithinDisplays(x: .nan, y: 0, displays: displays))
        XCTAssertFalse(DisplayGeometry.isWithinDisplays(x: 1, y: 1, displays: []))
    }

    func testUnionBounds() {
        let displays = [PointRect(x: 0, y: 0, width: 100, height: 100), PointRect(x: 100, y: -50, width: 100, height: 100)]
        XCTAssertEqual(DisplayGeometry.unionBounds(displays), PointRect(x: 0, y: -50, width: 200, height: 150))
        XCTAssertNil(DisplayGeometry.unionBounds([]))
    }

    func testRectJSON() {
        let json = PointRect(x: 1, y: 2, width: 3, height: 4).toJSON()
        XCTAssertEqual(json["width"], .number(3))
        XCTAssertEqual(JSONLineEncoder.encode(json), #"{"height":4,"width":3,"x":1,"y":2}"#)
    }
}
