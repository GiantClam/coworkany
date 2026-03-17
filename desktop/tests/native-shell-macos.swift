import AppKit
import ApplicationServices
import Foundation

enum NativeShellError: Error, CustomStringConvertible {
    case accessibilityDenied
    case appLaunchFailed(String)
    case runningAppNotFound
    case appWindowNotFound
    case attributeReadFailed(String)
    case dragDidNotMoveWindow(CGPoint, CGPoint)
    case elementNotFound(String)
    case valueVerificationFailed(String)

    var description: String {
        switch self {
        case .accessibilityDenied:
            return "Accessibility permission is required. Enable Terminal or Codex in System Settings -> Privacy & Security -> Accessibility."
        case .appLaunchFailed(let message):
            return "Failed to launch CoworkAny.app: \(message)"
        case .runningAppNotFound:
            return "CoworkAny process was not found after launch."
        case .appWindowNotFound:
            return "Could not locate the main CoworkAny window through Accessibility APIs."
        case .attributeReadFailed(let attribute):
            return "Failed to read AX attribute: \(attribute)"
        case .dragDidNotMoveWindow(let before, let after):
            return "Window did not move after drag. Before: \(before), after: \(after)"
        case .elementNotFound(let description):
            return "Could not find UI element: \(description)"
        case .valueVerificationFailed(let description):
            return "Could not verify input value: \(description)"
        }
    }
}

struct CliOptions {
    let appPath: String
    let bundleId: String
    let processName: String?
    let inputProbe: String
    let promptAccessibility: Bool
    let noLaunch: Bool
}

func parseArgs() -> CliOptions {
    var appPath = "/Users/beihuang/Documents/github/coworkany/desktop/src-tauri/target/release/bundle/macos/CoworkAny.app"
    var bundleId = "com.coworkany.desktop"
    var processName: String?
    var inputProbe = "sk-native-shell-test"
    var promptAccessibility = false
    var noLaunch = false

    var iterator = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = iterator.next() {
        switch arg {
        case "--app":
            if let value = iterator.next() { appPath = value }
        case "--bundle-id":
            if let value = iterator.next() { bundleId = value }
        case "--process-name":
            if let value = iterator.next() { processName = value }
        case "--input":
            if let value = iterator.next() { inputProbe = value }
        case "--prompt-accessibility":
            promptAccessibility = true
        case "--no-launch":
            noLaunch = true
        default:
            continue
        }
    }

    return CliOptions(
        appPath: appPath,
        bundleId: bundleId,
        processName: processName,
        inputProbe: inputProbe,
        promptAccessibility: promptAccessibility,
        noLaunch: noLaunch
    )
}

func requireAccessibilityTrust(prompt: Bool) throws {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    guard AXIsProcessTrustedWithOptions(options) else {
        throw NativeShellError.accessibilityDenied
    }
}

func runningApps(bundleId: String, processName: String?) -> [NSRunningApplication] {
    if let processName, !processName.isEmpty {
        return NSWorkspace.shared.runningApplications.filter { app in
            app.localizedName == processName
        }
    }

    return NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
}

func terminateExistingApps(bundleId: String, processName: String?) {
    let apps = runningApps(bundleId: bundleId, processName: processName)
    for app in apps {
        _ = app.terminate()
    }

    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline {
        if runningApps(bundleId: bundleId, processName: processName).isEmpty {
            return
        }
        Thread.sleep(forTimeInterval: 0.2)
    }

    for app in runningApps(bundleId: bundleId, processName: processName) {
        _ = app.forceTerminate()
    }
    Thread.sleep(forTimeInterval: 0.5)
}

func launchApp(at appPath: String) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = ["-na", appPath]

    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        throw NativeShellError.appLaunchFailed(error.localizedDescription)
    }

    guard process.terminationStatus == 0 else {
        throw NativeShellError.appLaunchFailed("open exited with status \(process.terminationStatus)")
    }
}

func waitForRunningApp(bundleId: String, processName: String?, timeout: TimeInterval = 15) throws -> NSRunningApplication {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        let apps = runningApps(bundleId: bundleId, processName: processName)
        if let app = apps.sorted(by: { ($0.launchDate ?? .distantPast) < ($1.launchDate ?? .distantPast) }).last {
            return app
        }
        Thread.sleep(forTimeInterval: 0.25)
    }

    throw NativeShellError.runningAppNotFound
}

func copyAttribute(_ element: AXUIElement, _ attribute: CFString) throws -> AnyObject {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute, &value)
    guard error == .success, let resolved = value else {
        throw NativeShellError.attributeReadFailed(attribute as String)
    }
    return resolved
}

func copyOptionalAttribute(_ element: AXUIElement, _ attribute: CFString) -> AnyObject? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute, &value)
    guard error == .success else {
        return nil
    }
    return value
}

func getWindowElement(for app: NSRunningApplication, timeout: TimeInterval = 15) throws -> AXUIElement {
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    let deadline = Date().addingTimeInterval(timeout)

    while Date() < deadline {
        if let windows = copyOptionalAttribute(appElement, kAXWindowsAttribute as CFString) as? [AXUIElement] {
            if let window = windows.first {
                return window
            }
        }
        Thread.sleep(forTimeInterval: 0.25)
    }

    throw NativeShellError.appWindowNotFound
}

func readCGPoint(from element: AXUIElement, attribute: CFString) throws -> CGPoint {
    let raw = try copyAttribute(element, attribute)
    guard CFGetTypeID(raw) == AXValueGetTypeID() else {
        throw NativeShellError.attributeReadFailed(attribute as String)
    }

    let axValue = raw as! AXValue
    guard AXValueGetType(axValue) == .cgPoint else {
        throw NativeShellError.attributeReadFailed(attribute as String)
    }

    var point = CGPoint.zero
    guard AXValueGetValue(axValue, .cgPoint, &point) else {
        throw NativeShellError.attributeReadFailed(attribute as String)
    }
    return point
}

func readCGSize(from element: AXUIElement, attribute: CFString) throws -> CGSize {
    let raw = try copyAttribute(element, attribute)
    guard CFGetTypeID(raw) == AXValueGetTypeID() else {
        throw NativeShellError.attributeReadFailed(attribute as String)
    }

    let axValue = raw as! AXValue
    guard AXValueGetType(axValue) == .cgSize else {
        throw NativeShellError.attributeReadFailed(attribute as String)
    }

    var size = CGSize.zero
    guard AXValueGetValue(axValue, .cgSize, &size) else {
        throw NativeShellError.attributeReadFailed(attribute as String)
    }
    return size
}

func postMouseEvent(type: CGEventType, point: CGPoint, mouseButton: CGMouseButton = .left) {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: mouseButton) else {
        return
    }
    event.post(tap: .cghidEventTap)
}

func postKeyEvent(keyCode: CGKeyCode, keyDown: Bool) {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: keyDown) else {
        return
    }
    event.post(tap: .cghidEventTap)
}

func postTextEvent(_ text: String, keyDown: Bool) {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: keyDown) else {
        return
    }
    let utf16 = Array(text.utf16)
    event.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
    event.post(tap: .cghidEventTap)
}

func axPointToEventPoint(_ point: CGPoint) -> CGPoint {
    guard let screen = NSScreen.screens.first else {
        return point
    }

    let screenFrame = screen.frame
    return CGPoint(x: point.x, y: screenFrame.maxY - point.y)
}

func dragWindow(window: AXUIElement) throws -> (before: CGPoint, after: CGPoint) {
    let before = try readCGPoint(from: window, attribute: kAXPositionAttribute as CFString)
    let size = try readCGSize(from: window, attribute: kAXSizeAttribute as CFString)

    let startAX = CGPoint(x: before.x + min(140, max(70, size.width * 0.18)), y: before.y + 22)
    let endAX = CGPoint(x: startAX.x + 120, y: startAX.y + 72)
    let start = axPointToEventPoint(startAX)
    let end = axPointToEventPoint(endAX)

    postMouseEvent(type: .mouseMoved, point: start)
    Thread.sleep(forTimeInterval: 0.1)
    postMouseEvent(type: .leftMouseDown, point: start)

    let steps = 12
    for step in 1...steps {
        let progress = CGFloat(step) / CGFloat(steps)
        let point = CGPoint(
            x: start.x + ((end.x - start.x) * progress),
            y: start.y + ((end.y - start.y) * progress)
        )
        postMouseEvent(type: .leftMouseDragged, point: point)
        Thread.sleep(forTimeInterval: 0.025)
    }

    postMouseEvent(type: .leftMouseUp, point: end)
    Thread.sleep(forTimeInterval: 0.45)

    let after = try readCGPoint(from: window, attribute: kAXPositionAttribute as CFString)
    let movedEnough = abs(after.x - before.x) > 30 || abs(after.y - before.y) > 30
    guard movedEnough else {
        throw NativeShellError.dragDidNotMoveWindow(before, after)
    }

    return (before, after)
}

func hasNativeWindowControls(_ window: AXUIElement) -> Bool {
    for attr in [kAXCloseButtonAttribute, kAXMinimizeButtonAttribute, kAXZoomButtonAttribute] {
        if copyOptionalAttribute(window, attr as CFString) == nil {
            return false
        }
    }
    return true
}

func collectDescendants(from root: AXUIElement, limit: Int = 800) -> [AXUIElement] {
    var queue = [root]
    var result = [AXUIElement]()
    var index = 0

    while index < queue.count, result.count < limit {
        let element = queue[index]
        index += 1
        result.append(element)

        if let children = copyOptionalAttribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
            queue.append(contentsOf: children)
        }
    }

    return result
}

func readStringAttribute(_ element: AXUIElement, _ attribute: CFString) -> String? {
    copyOptionalAttribute(element, attribute) as? String
}

func findElement(in root: AXUIElement, where predicate: (AXUIElement) -> Bool) -> AXUIElement? {
    for element in collectDescendants(from: root) {
        if predicate(element) {
            return element
        }
    }
    return nil
}

func pressGetStartedIfPresent(in window: AXUIElement) {
    guard let button = findElement(in: window, where: { element in
        let role = readStringAttribute(element, kAXRoleAttribute as CFString) ?? ""
        let title = (readStringAttribute(element, kAXTitleAttribute as CFString) ?? "").lowercased()
        return role == kAXButtonRole as String && title.contains("get started")
    }) else {
        return
    }

    AXUIElementPerformAction(button, kAXPressAction as CFString)
    Thread.sleep(forTimeInterval: 0.6)
}

func findEditableField(in window: AXUIElement, timeout: TimeInterval = 12) throws -> AXUIElement {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if let field = findElement(in: window, where: { element in
            let role = readStringAttribute(element, kAXRoleAttribute as CFString) ?? ""
            return role == kAXTextFieldRole as String || role == "AXSecureTextField"
        }) {
            return field
        }
        Thread.sleep(forTimeInterval: 0.25)
    }

    throw NativeShellError.elementNotFound("editable text field")
}

func setFocused(_ element: AXUIElement) {
    AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
}

func writeValue(_ value: String, into element: AXUIElement) throws {
    setFocused(element)
    let status = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
    guard status == .success else {
        throw NativeShellError.valueVerificationFailed("AXValue set returned \(status.rawValue)")
    }

    Thread.sleep(forTimeInterval: 0.2)

    if let currentValue = readStringAttribute(element, kAXValueAttribute as CFString), currentValue == value {
        return
    }

    if let currentValue = readStringAttribute(element, kAXValueAttribute as CFString), currentValue.count == value.count {
        return
    }

    throw NativeShellError.valueVerificationFailed("value attribute did not reflect the typed content")
}

func pressReturnKey() {
    postKeyEvent(keyCode: 36, keyDown: true)
    Thread.sleep(forTimeInterval: 0.03)
    postKeyEvent(keyCode: 36, keyDown: false)
}

func waitForClearedValue(on element: AXUIElement, timeout: TimeInterval = 12) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        let currentValue = readStringAttribute(element, kAXValueAttribute as CFString) ?? ""
        if currentValue.isEmpty {
            return true
        }
        Thread.sleep(forTimeInterval: 0.2)
    }
    return false
}

func typeText(_ text: String, into element: AXUIElement) {
    setFocused(element)
    for character in text {
        let chunk = String(character)
        postTextEvent(chunk, keyDown: true)
        Thread.sleep(forTimeInterval: 0.02)
        postTextEvent(chunk, keyDown: false)
        Thread.sleep(forTimeInterval: 0.03)
    }
}

func main() throws {
    let options = parseArgs()
    try requireAccessibilityTrust(prompt: options.promptAccessibility)
    if !options.noLaunch {
        terminateExistingApps(bundleId: options.bundleId, processName: options.processName)
        try launchApp(at: options.appPath)
    }

    let app = try waitForRunningApp(bundleId: options.bundleId, processName: options.processName)
    app.activate()
    Thread.sleep(forTimeInterval: 1.0)

    let window = try getWindowElement(for: app)
    if hasNativeWindowControls(window) {
        print("Drag passed: native macOS title bar detected")
    } else {
        let dragResult = try dragWindow(window: window)
        print("Drag passed: before=\(dragResult.before) after=\(dragResult.after)")
    }

    pressGetStartedIfPresent(in: window)
    let field = try findEditableField(in: window)
    try writeValue(options.inputProbe, into: field)
    print("Input passed: wrote \(options.inputProbe.count) chars")

    let role = readStringAttribute(field, kAXRoleAttribute as CFString) ?? ""
    if role != "AXSecureTextField" {
        _ = AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, "" as CFTypeRef)
        Thread.sleep(forTimeInterval: 0.1)
        typeText("hi", into: field)
        Thread.sleep(forTimeInterval: 0.2)
        pressReturnKey()
        guard waitForClearedValue(on: field) else {
            throw NativeShellError.valueVerificationFailed("chat input did not clear after submit")
        }
        print("Send passed: chat input cleared after submit")
    }
}

do {
    try main()
    exit(0)
} catch {
    fputs("[native-shell-macos] \(error)\n", stderr)
    exit(1)
}
