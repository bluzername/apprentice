/// Maps raw AX roles to the compact semantic vocabulary used by the risk
/// engine and the model boundary. Unknown roles map to `.unknown`.
public enum SemanticRole: String, Equatable {
    case button
    case textbox
    case secure
    case link
    case menuitem
    case menu
    case menubar
    case checkbox
    case radio
    case combobox
    case popupbutton
    case list
    case listitem
    case table
    case row
    case cell
    case image
    case statictext
    case heading
    case tab
    case slider
    case toolbar
    case window
    case group
    case scrollarea
    case webarea
    case textarea
    case unknown
}

public enum AXRoleMapping {
    private static let roles: [String: SemanticRole] = [
        "AXButton": .button,
        "AXTextField": .textbox,
        "AXSecureTextField": .secure,
        "AXTextArea": .textarea,
        "AXLink": .link,
        "AXMenuItem": .menuitem,
        "AXMenuBarItem": .menuitem,
        "AXMenu": .menu,
        "AXMenuBar": .menubar,
        "AXCheckBox": .checkbox,
        "AXRadioButton": .radio,
        "AXComboBox": .combobox,
        "AXPopUpButton": .popupbutton,
        "AXList": .list,
        "AXOutline": .list,
        "AXStaticText": .statictext,
        "AXHeading": .heading,
        "AXTable": .table,
        "AXRow": .row,
        "AXCell": .cell,
        "AXImage": .image,
        "AXTabGroup": .tab,
        "AXSlider": .slider,
        "AXToolbar": .toolbar,
        "AXWindow": .window,
        "AXSheet": .window,
        "AXGroup": .group,
        "AXScrollArea": .scrollarea,
        "AXWebArea": .webarea
    ]

    public static func semanticRole(forAXRole role: String, subrole: String? = nil) -> SemanticRole {
        if role == "AXTextField", subrole == "AXSecureTextField" { return .secure }
        if role == "AXRow" || role == "AXCell", subrole == "AXOutlineRow" { return .row }
        if role == "AXButton", subrole == "AXToggle" { return .checkbox }
        if role == "AXButton", subrole == "AXMenuButton" { return .popupbutton }
        if role == "AXButton", subrole == "AXCloseButton" || subrole == "AXMinimizeButton" || subrole == "AXZoomButton" {
            return .button
        }
        if role == "AXStaticText", subrole == "AXHeading" { return .heading }
        return roles[role] ?? .unknown
    }

    /// True for roles whose content must never be captured (secure fields).
    public static func isSecure(axRole role: String, subrole: String? = nil) -> Bool {
        semanticRole(forAXRole: role, subrole: subrole) == .secure
    }

    /// True for roles that carry user-entered text; only a length is reported.
    public static func isTextEntry(axRole role: String, subrole: String? = nil) -> Bool {
        switch semanticRole(forAXRole: role, subrole: subrole) {
        case .textbox, .textarea, .combobox, .secure: return true
        default: return false
        }
    }

    /// Roles that a click can activate. Used by the risk engine to decide
    /// whether a coordinate action is "actionable" or merely a focus change.
    public static func isActionable(_ role: SemanticRole) -> Bool {
        switch role {
        case .button, .link, .menuitem, .checkbox, .radio, .combobox, .popupbutton, .tab, .slider:
            return true
        default:
            return false
        }
    }
}
