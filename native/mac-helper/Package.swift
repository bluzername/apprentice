// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "apprentice-helper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "apprentice-helper", targets: ["apprentice-helper"]),
        .library(name: "HelperCore", targets: ["HelperCore"])
    ],
    targets: [
        .target(
            name: "HelperCore",
            path: "Sources/HelperCore"
        ),
        .executableTarget(
            name: "apprentice-helper",
            dependencies: ["HelperCore"],
            path: "Sources/apprentice-helper",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("Vision"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ImageIO"),
                .linkedFramework("Carbon")
            ]
        ),
        .testTarget(
            name: "HelperCoreTests",
            dependencies: ["HelperCore"],
            path: "Tests/HelperCoreTests"
        )
    ],
    swiftLanguageModes: [.v5]
)
