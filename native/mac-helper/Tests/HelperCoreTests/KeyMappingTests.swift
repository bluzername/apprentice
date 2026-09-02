import XCTest
@testable import HelperCore

final class KeyMappingTests: XCTestCase {
    func testEveryKeyNameHasAKeyCode() {
        XCTAssertEqual(KeyNames.all.count, 75)
        for name in KeyNames.all {
            XCTAssertNotNil(KeyCodeMap.keyCode(for: name), "missing key code for \(name)")
        }
    }

    func testWellKnownKeyCodes() {
        XCTAssertEqual(KeyCodeMap.keyCode(for: "enter"), 36)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "return"), 36)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "escape"), 53)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "esc"), 53)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "a"), 0)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "space"), 49)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "backspace"), 51)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "delete"), 117)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "f12"), 111)
        XCTAssertEqual(KeyCodeMap.keyCode(for: "\\"), 42)
    }

    func testUnknownKeyHasNoCode() {
        XCTAssertNil(KeyCodeMap.keyCode(for: "enter\n"))
        XCTAssertNil(KeyCodeMap.keyCode(for: "A"))
        XCTAssertNil(KeyCodeMap.keyCode(for: "capslock"))
        XCTAssertFalse(KeyNames.isKnownKey("meta"))
    }

    func testReverseMappingPrefersCanonicalNames() {
        XCTAssertEqual(KeyCodeMap.keyName(for: 36), "enter")
        XCTAssertEqual(KeyCodeMap.keyName(for: 53), "escape")
        XCTAssertEqual(KeyCodeMap.keyName(for: 51), "backspace")
        XCTAssertEqual(KeyCodeMap.keyName(for: 35), "p")
        XCTAssertNil(KeyCodeMap.keyName(for: 200))
    }

    func testEveryModifierNameMaps() {
        for name in KeyNames.modifiers {
            XCTAssertNotNil(ModifierKey.from(name: name), "missing modifier \(name)")
        }
        XCTAssertEqual(ModifierKey.from(name: "cmd"), .command)
        XCTAssertEqual(ModifierKey.from(name: "option"), .option)
        XCTAssertEqual(ModifierKey.from(name: "control"), .control)
        XCTAssertNil(ModifierKey.from(name: "super"))
    }

    func testModifierFlagsMatchCGEventFlags() {
        XCTAssertEqual(ModifierKey.command.flagBit, 0x100000)
        XCTAssertEqual(ModifierKey.shift.flagBit, 0x20000)
        XCTAssertEqual(ModifierKey.option.flagBit, 0x80000)
        XCTAssertEqual(ModifierKey.control.flagBit, 0x40000)
        XCTAssertEqual(ModifierKey.flags(for: [.command, .shift]), 0x120000)
    }

    func testShortcutFormatterEmitsChordOnly() {
        let flags = ModifierKey.flags(for: [.command, .shift]) | 0x100 // device-dependent noise bit
        XCTAssertEqual(ShortcutFormatter.keys(flags: flags, keyCode: 35), ["cmd", "shift", "p"])
        XCTAssertEqual(ShortcutFormatter.keys(flags: ModifierKey.control.flagBit, keyCode: 8), ["ctrl", "c"])
        XCTAssertEqual(ShortcutFormatter.keys(flags: ModifierKey.option.flagBit, keyCode: 250), ["alt", "key250"])
    }

    func testShortcutFormatterIgnoresPlainAndShiftOnlyKeystrokes() {
        XCTAssertNil(ShortcutFormatter.keys(flags: 0, keyCode: 0))
        XCTAssertNil(ShortcutFormatter.keys(flags: ModifierKey.shift.flagBit, keyCode: 0))
    }
}
