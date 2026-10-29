import AppKit
import SwiftUI
import ApplicationServices
import Combine

enum InputFormat: String, CaseIterable {
    case slash, dollar, reference
    var label: String {
        switch self {
        case .slash: return "/スキル名"
        case .dollar: return "$スキル名（標準）"
        case .reference: return "スキルを指定（参照付き）"
        }
    }
    func command(_ skill: Skill) -> String {
        switch self {
        case .slash: return "/\(skill.invocation) "
        case .dollar: return "$\(skill.invocation) "
        case .reference:
            let path = skill.id.replacingOccurrences(of: ">", with: "%3E").replacingOccurrences(of: "<", with: "%3C")
            return "[$\(skill.name)](<\(path)>) "
        }
    }
}

enum InsertionError: LocalizedError {
    case permission, noApp, noWindow, noComposer, ambiguous, changed, focus, unsupported, clipboard, unconfirmed, busy
    var errorDescription: String? {
        switch self {
        case .permission: return "チャットへ入力するため、アクセシビリティの許可が必要です。"
        case .noApp: return "Codexを開いてから、スキルを選んでください。"
        case .noWindow: return "Codexで入力先のチャットを開いてください。"
        case .noComposer: return "チャットの入力欄が見つかりません。Codexの入力欄を一度クリックしてから、もう一度選んでください。"
        case .ambiguous: return "入力欄を特定できません。Codexのチャット入力欄を一度クリックしてください。"
        case .changed: return "入力先が切り替わりました。もう一度スキルを選んでください。"
        case .focus: return "チャットの入力欄を選択できませんでした。入力欄を一度クリックしてください。"
        case .unsupported: return "この入力欄には追記できません。Codexのチャット入力欄を一度クリックしてください。"
        case .clipboard: return "クリップボードを保護できなかったため、入力を中止しました。もう一度選んでください。"
        case .unconfirmed: return "入力結果を確認できませんでした。Codexの入力欄を確認してください。"
        case .busy: return "追記が完了してから、次のスキルを選んでください。"
        }
    }
}

struct EditorInfo {
    let role: String
    let label: String
    let identifier: String
    let enabled: Bool
    let visible: Bool
    let focused: Bool
    var score: Int {
        guard enabled, visible, role == "AXTextArea" || role == "AXTextField" else { return -1 }
        let text = (label + " " + identifier).lowercased()
        let identifiers = ["prompt-textarea", "composer-input", "prompt-input", "codex-composer"]
        let phrases = ["work with codex", "ask codex", "do anything", "ask chatgpt", "work with chatgpt", "ask anything", "describe your task", "describe your goal", "codex と", "codexと", "chatgpt に", "chatgptに", "何でも", "なんでも", "作業を依頼", "質問して", "フォローアップ", "続けて依頼", "続けて作業", "work モードで作成", "タスクを説明", "目標を説明"]
        var value = identifiers.contains(where: text.contains) ? 200 : 0
        if phrases.contains(where: text.contains) { value += 100 }
        guard value > 0 else { return -1 }
        if focused { value += 40 }
        if role == "AXTextArea" { value += 10 }
        return value
    }
}

struct WebAccessibilityActivation {
    let manual: AXError
    let enhanced: AXError?
    // Chromium may apply this attribute and then return its superclass's
    // notImplemented result. Discovery, not this status, proves readiness.
    var requestedEnhanced: Bool { enhanced == .success || enhanced == .notImplemented }
}

func activateWebAccessibility(write: (String) -> AXError) -> WebAccessibilityActivation {
    let manual = write("AXManualAccessibility")
    return WebAccessibilityActivation(manual: manual,
        enhanced: manual == .success ? nil : write("AXEnhancedUserInterface"))
}

func shouldRetryEditorDiscovery(eligibleCount: Int, attempt: Int, now: Date, deadline: Date) -> Bool {
    // Chromium's enhanced mode can wait two seconds before publishing the
    // web tree. A shorter attempt limit expires before that first activation.
    eligibleCount == 0 && attempt < 30 && now < deadline
}

func chooseEditor(_ values: [EditorInfo]) -> Int? {
    let ranked = values.enumerated().filter { $0.element.score >= 40 }.sorted { $0.element.score > $1.element.score }
    guard let first = ranked.first else { return nil }
    if ranked.count > 1 && ranked[1].element.score == first.element.score { return nil }
    return first.offset
}

// AX exposes the final paragraph terminator of some Chromium contenteditable
// composers even though their caret clamps just before it. Accept exactly that
// one LF discrepancy after requesting the full end; never skip draft characters.
func insertionLocation(text: String, characterCount: Int?, range: CFRange?, end: Int) -> Int? {
    guard end == text.utf16.count, characterCount == nil || characterCount == end else { return nil }
    if text.isEmpty, characterCount == 0, range == nil { return 0 }
    guard let range, range.length == 0, range.location >= 0 else { return nil }
    if range.location == end { return end }
    if end > 0, range.location == end - 1, text.utf16.last == 10 { return range.location }
    return nil
}

enum ComposerInsertionSite: Equatable {
    case draft(Int), emptyDecoration
    var location: Int {
        if case .draft(let value) = self { return value }
        return 0
    }
}

func composerInsertionSite(text: String, characterCount: Int?, range: CFRange?, end: Int,
                           placeholderCandidate: Bool, allowEmptyDecoration: Bool) -> ComposerInsertionSite? {
    // A real end caret always wins, even when a stale decoration matches the
    // draft. Never move the caret into the middle of a potential real draft.
    if let location = insertionLocation(text: text, characterCount: characterCount, range: range, end: end) {
        return .draft(location)
    }
    guard placeholderCandidate, allowEmptyDecoration || characterCount == 0,
          text.utf16.count > 1,
          characterCount == nil || characterCount == 0 || characterCount == text.utf16.count,
          let range, range.location == 0, range.length == 0 else { return nil }
    return .emptyDecoration
}

func insertionPointIsReady(text: String, characterCount: Int?, range: CFRange?, end: Int) -> Bool {
    insertionLocation(text: text, characterCount: characterCount, range: range, end: end) != nil
}

private func insertionIndex(in text: String, utf16Offset: Int) -> String.Index? {
    guard utf16Offset >= 0,
          let offset = text.utf16.index(text.utf16.startIndex, offsetBy: utf16Offset, limitedBy: text.utf16.endIndex) else { return nil }
    return String.Index(offset, within: text)
}

func insertionCommand(_ command: String, before: String, location: Int) -> String? {
    guard let position = insertionIndex(in: before, utf16Offset: location) else { return nil }
    let prefix = before[..<position]
    return (prefix.isEmpty || prefix.last?.isWhitespace == true ? "" : " ") + command
}

func supportsComposerDecorationProfile(_ version: String) -> Bool {
    // Empty-document decoration rules were inspected in these host bundles.
    version == "26.429.30905" || version == "26.1021.31345"
}

func isGeneratedComposerPlaceholder(_ value: String, placeholder: String, decoratedEmptyParagraph: Bool, supportedProfile: Bool) -> Bool {
    guard supportedProfile, decoratedEmptyParagraph else { return false }
    let body = value.hasSuffix("\n") ? String(value.dropLast()) : value
    guard !body.isEmpty else { return false }
    return body == "Codex と一緒に作業を進める" || (!placeholder.isEmpty && body == placeholder)
}

func editableComposerText(_ raw: String, generatedPlaceholder: Bool) -> String {
    generatedPlaceholder ? (raw.hasSuffix("\n") ? "\n" : "") : raw
}

func insertionWasApplied(before: String, after: String, insertion: String, location: Int? = nil,
                         allowsMissingStructuralLF: Bool = false) -> Bool {
    let start = location ?? before.utf16.count
    guard before != after, insertionIndex(in: before, utf16Offset: start) != nil else { return false }
    let original = Array(before.utf16), actual = Array(after.utf16)
    let prefix = Array(original.prefix(start)), suffix = Array(original.dropFirst(start))
    func matches(prefix: [UInt16], suffix: [UInt16], requestedInsertion: [UInt16]? = nil) -> Bool {
        guard actual.count >= prefix.count + suffix.count,
              Array(actual.prefix(prefix.count)) == prefix,
              Array(actual.suffix(suffix.count)) == suffix else { return false }
        let added = Array(actual[prefix.count..<(actual.count - suffix.count)])
        var requested = requestedInsertion ?? Array(insertion.utf16)
        // Only the command's own final separator may be omitted by the editor.
        // Existing leading/trailing draft whitespace is never trimmed for a match.
        if requested.last == 0x20, added.count == requested.count - 1 { requested.removeLast() }
        // A contenteditable may preserve a pasted ASCII space as NBSP. Accept
        // that representation only inside the newly inserted range.
        guard requested.count == added.count else { return false }
        return zip(requested, added).allSatisfy { expected, observed in
            expected == observed || (expected == 0x20 && observed == 0xA0)
        }
    }
    if matches(prefix: prefix, suffix: suffix) { return true }
    // Chromium can expose an empty paragraph's final LF before Paste and omit
    // it afterwards. Only allow that representation change when the requested
    // full-end caret was observed clamping immediately before the sole suffix
    // LF. All existing draft text and user line breaks remain in the prefix.
    guard allowsMissingStructuralLF, suffix == [10] else { return false }
    if matches(prefix: prefix, suffix: []) { return true }
    // In an empty final paragraph Chromium may expose the original LF after
    // our new leading separator instead of after the command. Only that
    // separator crosses the boundary; the draft and command stay exact.
    let requested = Array(insertion.utf16)
    guard !prefix.isEmpty, requested.first == 0x20 else { return false }
    return matches(prefix: prefix, suffix: [], requestedInsertion: [0x20, 10] + requested.dropFirst())
}

final class TemporaryPaste {
    private let board: NSPasteboard
    private let saved: [[NSPasteboard.PasteboardType: Data]]
    private let marker = NSPasteboard.PasteboardType("com.kaido.skillpalette.temporaryPaste")
    private let token = UUID().uuidString
    private var ownedChangeCount: Int?

    init(text: String, board: NSPasteboard = .general) throws {
        self.board = board
        let initialCount = board.changeCount
        var snapshot: [[NSPasteboard.PasteboardType: Data]] = []
        let existingItems = board.pasteboardItems ?? []
        guard !existingItems.isEmpty || (board.types ?? []).isEmpty else { throw InsertionError.clipboard }
        for item in existingItems {
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                guard let data = item.data(forType: type) else { throw InsertionError.clipboard }
                values[type] = data
            }
            snapshot.append(values)
        }
        saved = snapshot
        guard board.changeCount == initialCount else { throw InsertionError.clipboard }
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        item.setString(token, forType: marker)
        item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
        let clearedCount = board.clearContents()
        guard board.writeObjects([item]) else {
            if board.changeCount == clearedCount, (board.types ?? []).isEmpty { restoreSavedItems() }
            throw InsertionError.clipboard
        }
        ownedChangeCount = board.changeCount
    }

    func restore() {
        guard let count = ownedChangeCount else { return }
        ownedChangeCount = nil
        // A copy made by the user while pasting takes precedence.
        guard board.changeCount == count, board.string(forType: marker) == token else { return }
        restoreSavedItems()
    }
    private func restoreSavedItems() {
        let items = saved.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
        }
        board.clearContents()
        if !items.isEmpty { board.writeObjects(items) }
    }
}

protocol SkillInserting: AnyObject {
    func insert(_ text: String, targetReady: @escaping () -> Void, completion: @escaping (Result<Void, Error>) -> Void)
    func restoreClipboard()
}

final class CodexInserter: SkillInserting {
    private var lastCodexPID: pid_t?
    private var activationObserver: NSObjectProtocol?
    private var pendingPaste: TemporaryPaste?
    private var diagnosticEvents: [String] = []
    private var diagnosticStart = ProcessInfo.processInfo.systemUptime
    private var supportsPlaceholderDecoration = false
    private var enhancedAccessibilityLaunches: [pid_t: Date] = [:]
    private func record(_ stage: String, _ details: String = "") {
        let elapsed = Int(((ProcessInfo.processInfo.systemUptime - diagnosticStart) * 1000).rounded())
        let event = details.isEmpty ? stage : "\(stage): \(details)"
        diagnosticEvents.append("\(event) elapsedMs=\(elapsed)")
        UserDefaults.standard.set(diagnosticEvents, forKey: "lastInsertionDiagnostics")
    }
    func restoreClipboard() { pendingPaste?.restore(); pendingPaste = nil }
    init() {
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
               app.bundleIdentifier == "com.openai.codex" { self?.lastCodexPID = app.processIdentifier }
        }
    }
    deinit {
        if let activationObserver { NSWorkspace.shared.notificationCenter.removeObserver(activationObserver) }
    }
    private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value
    }
    private func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
        guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }
    private func string(_ element: AXUIElement, _ name: String) -> String {
        attribute(element, name) as? String ?? ""
    }
    private func hasPlaceholderDecoration(_ editor: AXUIElement) -> Bool {
        // These inspected decorators are created only for an empty paragraph.
        // AX may insert a paragraph wrapper, so inspect two bounded levels.
        var nodes: [(AXUIElement, Int)] = [(editor, 0)], examined = 0
        while let (node, depth) = nodes.popLast(), examined < 16 {
            examined += 1
            let classes = (attribute(node, "AXDOMClassList") as? [String])
                ?? string(node, "AXDOMClassList").split(whereSeparator: \.isWhitespace).map(String.init)
            if depth > 0, classes.contains("placeholder") || classes.contains("prosemirror-placeholder") { return true }
            if depth < 2, let children = attribute(node, kAXChildrenAttribute) as? [AXUIElement] {
                nodes.append(contentsOf: children.prefix(8).reversed().map { ($0, depth + 1) })
            }
        }
        return false
    }
    private func textState(_ element: AXUIElement) -> (text: String, count: Int?, placeholderCandidate: Bool, placeholderDecoration: Bool)? {
        let value = attribute(element, kAXValueAttribute) as? String
        let count = (attribute(element, kAXNumberOfCharactersAttribute) as? NSNumber)?.intValue
        if let value {
            var placeholder = supportsPlaceholderDecoration ? string(element, "AXPlaceholderValue") : ""
            if placeholder.isEmpty && supportsPlaceholderDecoration { placeholder = string(element, kAXDescriptionAttribute) }
            let candidate = isGeneratedComposerPlaceholder(value, placeholder: placeholder,
                decoratedEmptyParagraph: true, supportedProfile: supportsPlaceholderDecoration)
            let decorated = candidate && hasPlaceholderDecoration(element)
            return (value, count, candidate && decorated, decorated)
        }
        if count == 0 { return ("", count, false, false) }
        return nil
    }
    private func flag(_ element: AXUIElement, _ name: String, fallback: Bool) -> Bool {
        attribute(element, name) as? Bool ?? fallback
    }
    private func size(_ element: AXUIElement) -> CGSize {
        guard let value = attribute(element, kAXSizeAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return .zero }
        var result = CGSize.zero
        AXValueGetValue(value as! AXValue, .cgSize, &result)
        return result
    }
    private func selectedRange(_ element: AXUIElement) -> CFRange? {
        guard let value = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var range = CFRange()
        guard AXValueGetValue(value as! AXValue, .cfRange, &range) else { return nil }
        return range
    }
    private func info(_ element: AXUIElement) -> EditorInfo {
        let label = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, "AXPlaceholderValue"].map { string(element, $0) }.joined(separator: " ")
        let identifier = string(element, kAXIdentifierAttribute) + " " + string(element, "AXDOMIdentifier")
        let dimensions = size(element)
        return EditorInfo(role: string(element, kAXRoleAttribute), label: label, identifier: identifier,
            enabled: flag(element, kAXEnabledAttribute, fallback: true) && !flag(element, "AXReadOnly", fallback: false),
            visible: dimensions.width > 40 && dimensions.height > 10 && !flag(element, "AXHidden", fallback: false),
            focused: flag(element, kAXFocusedAttribute, fallback: false))
    }
    private func findEditors(in root: AXUIElement, application: AXUIElement, deadline: Date) -> [(AXUIElement, EditorInfo)] {
        // The currently focused, named composer is independent of chat length.
        if let focused = elementAttribute(application, kAXFocusedUIElementAttribute),
           let focusedWindow = elementAttribute(focused, kAXWindowAttribute), CFEqual(focusedWindow, root) {
            let metadata = info(focused)
            record("focused-editor", "role=\(metadata.role) score=\(metadata.score) visible=\(metadata.visible) enabled=\(metadata.enabled)")
            if metadata.score >= 100 { return [(focused, metadata)] }
        }
        var stack: [(AXUIElement, Int)] = [(root, 0)]
        var examined = 0
        var result: [(AXUIElement, EditorInfo)] = []
        while let (element, depth) = stack.popLast(), examined < 6000, Date() < deadline {
            examined += 1
            let role = string(element, kAXRoleAttribute)
            if role == kAXTextAreaRole || role == kAXTextFieldRole {
                result.append((element, info(element)))
            }
            if depth < 40, role != kAXStaticTextRole, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
                // Visit trailing controls before the potentially very long log.
                stack.append(contentsOf: children.map { ($0, depth + 1) })
            }
        }
        record("lookup-tree", "examined=\(examined) textEditors=\(result.count) deadline=\(Date() >= deadline) nodeLimit=\(examined >= 6000)")
        for metadata in result.prefix(8).map({ $0.1 }) {
            record("candidate", "role=\(metadata.role) score=\(metadata.score) visible=\(metadata.visible) enabled=\(metadata.enabled) focused=\(metadata.focused)")
        }
        return result
    }
    func insert(_ text: String, targetReady: @escaping () -> Void = {}, completion: @escaping (Result<Void, Error>) -> Void) {
        diagnosticStart = ProcessInfo.processInfo.systemUptime
        diagnosticEvents = []
        record("begin", "trusted=\(AXIsProcessTrusted())")
        guard AXIsProcessTrusted() else { completion(.failure(InsertionError.permission)); return }
        let running = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == "com.openai.codex" && !$0.isTerminated }
        guard let target = running.first(where: { $0.isActive })
            ?? running.first(where: { $0.processIdentifier == lastCodexPID })
            ?? (running.count == 1 ? running.first : nil) else {
            completion(.failure(InsertionError.noApp)); return
        }
        lastCodexPID = target.processIdentifier
        // CSS .placeholder:after and the empty-document decoration were
        // inspected in this installed version. Unknown versions stay strict.
        let targetVersion = target.bundleURL.flatMap { Bundle(url: $0)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String } ?? "unknown"
        supportsPlaceholderDecoration = supportsComposerDecorationProfile(targetVersion)
        record("target", "version=\(targetVersion)")
        let application = AXUIElementCreateApplication(target.processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.25)
        let launch = target.launchDate ?? .distantPast
        if enhancedAccessibilityLaunches[target.processIdentifier] == launch {
            record("accessibility", "enhanced=alreadyRequested")
        } else {
            let activation = activateWebAccessibility { name in
                AXUIElementSetAttributeValue(application, name as CFString, kCFBooleanTrue)
            }
            record("accessibility", "manualAXError=\(activation.manual.rawValue)")
            if let enhanced = activation.enhanced {
                record("accessibility-enhanced", "AXError=\(enhanced.rawValue)")
                if activation.requestedEnhanced { enhancedAccessibilityLaunches[target.processIdentifier] = launch }
            }
        }
        let previousWindow = elementAttribute(application, kAXFocusedWindowAttribute)
            ?? elementAttribute(application, kAXMainWindowAttribute)
        // The lookup occurs on each user click, so no thread ID is retained.
        if !target.isActive { target.activate(options: []) }
        DispatchQueue.main.async { [self] in
            prepareWhenActive(text, application: application, expectedWindow: previousWindow, pid: target.processIdentifier,
                activationDeadline: ProcessInfo.processInfo.systemUptime + 0.75, targetReady: targetReady, completion: completion)
        }
    }
    private func prepareWhenActive(_ text: String, application: AXUIElement, expectedWindow: AXUIElement?, pid: pid_t,
                                   activationDeadline: TimeInterval, targetReady: @escaping () -> Void,
                                   completion: @escaping (Result<Void, Error>) -> Void) {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
            guard ProcessInfo.processInfo.systemUptime < activationDeadline else {
                record("activation-failed")
                completion(.failure(InsertionError.focus)); return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.008) { [self] in
                prepareWhenActive(text, application: application, expectedWindow: expectedWindow, pid: pid,
                    activationDeadline: activationDeadline, targetReady: targetReady, completion: completion)
            }
            return
        }
        record("activation-ready")
        targetReady()
        prepareInsertion(text, application: application, expectedWindow: expectedWindow, pid: pid,
            deadline: Date().addingTimeInterval(6), completion: completion)
    }
    private func prepareInsertion(_ text: String, application: AXUIElement, expectedWindow: AXUIElement?, pid: pid_t,
                                  deadline: Date, attempt: Int = 0, completion: @escaping (Result<Void, Error>) -> Void) {
            record("lookup", "attempt=\(attempt)")
            guard let window = elementAttribute(application, kAXFocusedWindowAttribute) else {
                record("lookup-failed", "noWindow")
                completion(.failure(InsertionError.noWindow)); return
            }
            if let expectedWindow, !CFEqual(expectedWindow, window) {
                record("lookup-failed", "windowChanged")
                completion(.failure(InsertionError.changed)); return
            }
            let candidates = findEditors(in: window, application: application, deadline: deadline)
            guard let chosen = chooseEditor(candidates.map { $0.1 }) else {
                let eligible = candidates.filter { $0.1.score >= 40 }.count
                if shouldRetryEditorDiscovery(eligibleCount: eligible, attempt: attempt, now: Date(), deadline: deadline) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [self] in
                        prepareInsertion(text, application: application, expectedWindow: window, pid: pid,
                            deadline: deadline, attempt: attempt + 1, completion: completion)
                    }
                } else {
                    record("lookup-failed", eligible > 1 ? "ambiguous" : "noComposer")
                    completion(.failure(eligible > 1 ? InsertionError.ambiguous : InsertionError.noComposer))
                }
                return
            }
            let editor = candidates[chosen].0
            record("editor", "role=\(candidates[chosen].1.role)")
            guard let latestWindow = elementAttribute(application, kAXFocusedWindowAttribute), CFEqual(latestWindow, window) else {
                completion(.failure(InsertionError.changed)); return
            }
            let focusResult = AXUIElementSetAttributeValue(editor, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            record("focus", "AXError=\(focusResult.rawValue)")
            guard focusResult == .success else {
                completion(.failure(InsertionError.focus)); return
            }
            // Move an empty selection to the end; never replace a draft or its
            // rich mentions. Neither Return nor a send action is generated.
            guard let state = textState(editor) else {
                record("text-unavailable", "characters=\((attribute(editor, kAXNumberOfCharactersAttribute) as? NSNumber)?.intValue ?? -1)")
                completion(.failure(InsertionError.unsupported)); return
            }
            let oldValue = state.text
            let length = state.count ?? oldValue.utf16.count
            record("text", "utf16=\(oldValue.utf16.count) characters=\(state.count ?? -1) blank=\(oldValue.allSatisfy(\.isWhitespace)) finalLF=\(oldValue.utf16.last == 10) placeholderCandidate=\(state.placeholderCandidate) placeholderProfile=\(supportsPlaceholderDecoration) placeholderDecoration=\(state.placeholderDecoration)")
            var range = CFRange(location: length, length: 0)
            guard let selection = AXValueCreate(.cfRange, &range) else {
                completion(.failure(InsertionError.unsupported)); return
            }
            let selectionResult = AXUIElementSetAttributeValue(editor, kAXSelectedTextRangeAttribute as CFString, selection)
            record("select-end", "AXError=\(selectionResult.rawValue)")
            guard selectionResult == .success || oldValue.allSatisfy(\.isWhitespace) else {
                completion(.failure(InsertionError.unsupported)); return
            }
            let readinessDeadline = ProcessInfo.processInfo.systemUptime + 0.48
            DispatchQueue.main.async { [self] in
                pasteWhenReady(editor, application: application, window: window, pid: pid,
                    before: oldValue, placeholderCandidate: state.placeholderCandidate, command: text, end: length,
                    readinessDeadline: readinessDeadline, completion: completion)
            }
    }
    private func pasteWhenReady(_ editor: AXUIElement, application: AXUIElement, window: AXUIElement, pid: pid_t,
                                before: String, placeholderCandidate: Bool, command: String, end: Int,
                                readinessDeadline: TimeInterval, attempt: Int = 0,
                                completion: @escaping (Result<Void, Error>) -> Void) {
        // Chromium applies AX focus and selection asynchronously. Confirm both
        // before issuing one ordinary Paste command, never a text replacement.
        guard let latestWindow = elementAttribute(application, kAXFocusedWindowAttribute), CFEqual(latestWindow, window) else {
            completion(.failure(InsertionError.changed)); return
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
            completion(.failure(InsertionError.focus)); return
        }
        let focusReady = elementAttribute(application, kAXFocusedUIElementAttribute).map { CFEqual($0, editor) } ?? false
        guard let state = textState(editor), state.text == before, state.placeholderCandidate == placeholderCandidate else {
            record("draft-changed")
            completion(.failure(InsertionError.changed)); return
        }
        let range = selectedRange(editor)
        record("caret", "location=\(range?.location ?? -1) length=\(range?.length ?? -1) expected=\(end) focused=\(focusReady) attempt=\(attempt)")
        let site = composerInsertionSite(text: before, characterCount: state.count, range: range, end: end,
            placeholderCandidate: placeholderCandidate,
            allowEmptyDecoration: ProcessInfo.processInfo.systemUptime >= readinessDeadline)
        guard focusReady, let site else {
            if ProcessInfo.processInfo.systemUptime < readinessDeadline {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.008) { [self] in
                    pasteWhenReady(editor, application: application, window: window, pid: pid, before: before,
                        placeholderCandidate: placeholderCandidate, command: command, end: end,
                        readinessDeadline: readinessDeadline, attempt: attempt + 1, completion: completion)
                }
            } else { completion(.failure(focusReady ? InsertionError.unsupported : InsertionError.focus)) }
            return
        }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false) else {
            completion(.failure(InsertionError.unsupported)); return
        }
        let usesEmptyDecoration = site == .emptyDecoration
        let location = site.location
        let logicalBefore = editableComposerText(before, generatedPlaceholder: usesEmptyDecoration)
        let logicalLocation = location
        let allowsMissingStructuralLF = (usesEmptyDecoration || location == end - 1) && logicalBefore.utf16.last == 10
        guard let insertion = insertionCommand(command, before: logicalBefore, location: logicalLocation) else {
            completion(.failure(InsertionError.unsupported)); return
        }
        record("append-location", "location=\(location) structuralLF=\(location == end - 1) logicalUTF16=\(logicalBefore.utf16.count) emptyDecoration=\(usesEmptyDecoration)")
        do { pendingPaste = try TemporaryPaste(text: insertion) }
        catch { completion(.failure(error)); return }
        // Materializing promised clipboard data may take time. Recheck the
        // destination after that work, immediately before dispatching Paste.
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
              let currentWindow = elementAttribute(application, kAXFocusedWindowAttribute), CFEqual(currentWindow, window),
              let currentEditor = elementAttribute(application, kAXFocusedUIElementAttribute), CFEqual(currentEditor, editor),
              let currentState = textState(editor), currentState.text == before, currentState.placeholderCandidate == placeholderCandidate,
              composerInsertionSite(text: before, characterCount: currentState.count, range: selectedRange(editor), end: end,
                  placeholderCandidate: placeholderCandidate, allowEmptyDecoration: usesEmptyDecoration) == site else {
            record("destination-changed")
            restoreClipboard()
            completion(.failure(InsertionError.changed)); return
        }
        down.flags = .maskCommand; up.flags = .maskCommand
        down.postToPid(pid); up.postToPid(pid)
        record("paste-posted")
        // Paste is posted only to the verified process. No Return or Send.
        verify(editor, before: logicalBefore, insertion: insertion, location: logicalLocation,
            allowsMissingStructuralLF: allowsMissingStructuralLF,
            deadline: ProcessInfo.processInfo.systemUptime + 1.5) { [self] result in
            restoreClipboard()
            completion(result)
        }
    }
    private func verify(_ editor: AXUIElement, before: String, insertion: String, location: Int,
                        allowsMissingStructuralLF: Bool, deadline: TimeInterval, attempt: Int = 0,
                        completion: @escaping (Result<Void, Error>) -> Void) {
        let delay = min(0.05, 0.008 * pow(2, Double(min(attempt, 3))))
        DispatchQueue.main.asyncAfter(deadline: .now() + min(delay, max(0, deadline - ProcessInfo.processInfo.systemUptime))) { [self] in
            let state = textState(editor)
            let value = state?.text ?? ""
            let applied = state != nil && state?.placeholderCandidate == false && insertionWasApplied(before: before, after: value,
                insertion: insertion, location: location, allowsMissingStructuralLF: allowsMissingStructuralLF)
            record("verify", "utf16=\(value.utf16.count) expectedUTF16=\(before.utf16.count + insertion.utf16.count) finalLF=\(value.utf16.last == 10) structuralLF=\(allowsMissingStructuralLF) nonbreakingSpaces=\(value.utf16.filter { $0 == 0xA0 }.count) generatedPlaceholder=\(state?.placeholderCandidate ?? false) applied=\(applied) attempt=\(attempt)")
            if applied { completion(.success(())) }
            else if ProcessInfo.processInfo.systemUptime < deadline {
                verify(editor, before: before, insertion: insertion, location: location,
                    allowsMissingStructuralLF: allowsMissingStructuralLF, deadline: deadline, attempt: attempt + 1, completion: completion)
            }
            else { completion(.failure(InsertionError.unconfirmed)) }
        }
    }
}

@MainActor final class PaletteModel: ObservableObject {
    @Published var skills: [Skill] = []
    @Published var query = ""
    @Published var onlyFavorites = false
    @Published var loading = false
    @Published var inserting = false
    @Published var trusted = AXIsProcessTrusted()
    @Published var status = "選んだスキルを、Codexの現在のチャットへ追記します。"
    @Published var error = false
    @Published var favorites: Set<String>
    @Published var format: InputFormat
    @Published var usageCounts: [String: Int] = [:]
    @Published var usageError = ""
    @Published var soundVolume: PaletteSoundVolume
    var soundEnabled: Bool { soundVolume != .off }
    @Published var pinned: Bool
    @Published var catalogMissing = false
    @Published var catalogError = ""
    @Published private(set) var arrivalSequence = 0
    private let preferences: UserDefaults
    private let inserter: SkillInserting
    private let usageStore: RecentUsageStore
    private var favoriteIdentities: Set<String>
    private var legacyFavoriteIDs: Set<String>
    let catalogStore: CatalogStore
    weak var panel: NSPanel?
    private var timer: Timer?
    private var catalogWatcher: CatalogWatcher?
    private var appliedCatalogData: Data?
    init(inserter: SkillInserting = CodexInserter(), usageStore: RecentUsageStore = RecentUsageStore(),
         catalogStore: CatalogStore = CatalogStore(), refreshOnLaunch: Bool = true, monitorCatalog: Bool = true,
         preferences: UserDefaults = .standard) {
        self.inserter = inserter; self.usageStore = usageStore
        self.preferences = preferences; self.catalogStore = catalogStore
        pinned = preferences.object(forKey: "alwaysOnTop") as? Bool ?? true
        let savedFavoriteIDs = preferences.stringArray(forKey: "favorites") ?? []
        favorites = Set(savedFavoriteIDs)
        let savedFavoriteIdentities = preferences.stringArray(forKey: "favoriteIdentitiesV1")
        favoriteIdentities = Set(savedFavoriteIdentities ?? [])
        legacyFavoriteIDs = Set(preferences.stringArray(forKey: "legacyFavoriteIDsV1") ?? (savedFavoriteIdentities == nil ? savedFavoriteIDs : []))
        format = InputFormat(rawValue: preferences.string(forKey: "inputFormat") ?? "") ?? .slash
        soundVolume = PaletteSoundVolume.load(from: preferences)
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let value = AXIsProcessTrusted()
                if self.trusted != value { self.trusted = value }
                self.reloadUsage()
                if refreshOnLaunch && monitorCatalog && self.catalogWatcher == nil {
                    self.refresh(announce: false); self.watchCatalog()
                }
            }
        }
        reloadUsage()
        if refreshOnLaunch {
            refresh(announce: false)
            if monitorCatalog { watchCatalog() }
        }
    }
    func reloadUsage() {
        do {
            let counts = try usageStore.counts()
            if usageCounts != counts { usageCounts = counts }
            if !usageError.isEmpty { usageError = "" }
        } catch {
            let message = error.localizedDescription
            if usageError != message { usageError = message }
        }
    }
    func selectSound(_ enabled: Bool) {
        selectSoundVolume(enabled ? (soundEnabled ? soundVolume : .standard) : .off)
    }
    func selectSoundVolume(_ volume: PaletteSoundVolume) {
        soundVolume = volume
        preferences.set(volume.rawValue, forKey: PaletteSoundVolume.preferenceKey)
        preferences.set(soundEnabled, forKey: "successSound")
    }
    func selectPinned(_ enabled: Bool) {
        pinned = enabled
        preferences.set(enabled, forKey: "alwaysOnTop")
        panel?.level = enabled || (inserting && panel?.isVisible == true) ? .floating : .normal
    }
    var filtered: [Skill] {
        let words = query.folding(options: [.caseInsensitive, .widthInsensitive], locale: .current).split(whereSeparator: \.isWhitespace).map(String.init)
        return skills.filter { skill in
            if onlyFavorites && !favorites.contains(skill.id) { return false }
            let haystack = "\(skill.name) \(skill.summary) \(skill.description) \(skill.source)".folding(options: [.caseInsensitive, .widthInsensitive], locale: .current)
            return words.allSatisfy(haystack.contains)
        }
    }
    func duplicate(_ skill: Skill) -> Bool { skills.filter { $0.name == skill.name }.count > 1 }
    func toggleFavorite(_ skill: Skill) {
        if favorites.contains(skill.id) { favorites.remove(skill.id); favoriteIdentities.remove(skill.usageKey) }
        else { favorites.insert(skill.id); favoriteIdentities.insert(skill.usageKey) }
        legacyFavoriteIDs.remove(skill.id)
        saveFavorites()
    }
    private func saveFavorites() {
        preferences.set(Array(favorites), forKey: "favorites")
        preferences.set(Array(favoriteIdentities), forKey: "favoriteIdentitiesV1")
        preferences.set(Array(legacyFavoriteIDs), forKey: "legacyFavoriteIDsV1")
    }
    private func restoreFavorites(for newSkills: [Skill]) {
        for skill in newSkills where legacyFavoriteIDs.contains(skill.id) {
            favoriteIdentities.insert(skill.usageKey); legacyFavoriteIDs.remove(skill.id)
        }
        favorites = Set(newSkills.filter { favoriteIdentities.contains($0.usageKey) }.map(\.id))
        saveFavorites()
    }
    func selectFormat(_ value: InputFormat) {
        format = value; preferences.set(value.rawValue, forKey: "inputFormat")
    }
    func requestPermission() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        trusted = AXIsProcessTrustedWithOptions(options)
        if !trusted, let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") { NSWorkspace.shared.open(url) }
    }
    func insert(_ skill: Skill, completion: ((Result<Void, Error>) -> Void)? = nil) {
        paste(format.command(skill), completion: { [weak self] result in
            guard let self else { completion?(result); return }
            if case .success = result {
                do {
                    self.usageCounts = try self.usageStore.recordSuccess(key: skill.usageKey)
                    self.usageError = ""
                    self.status = "\(skill.name) を入力欄に追加しました。"
                } catch {
                    self.usageError = error.localizedDescription
                    self.status = "追記は完了しましたが、使用回数を保存できませんでした。"
                    self.error = true
                }
            }
            completion?(result)
        })
    }
    func requestCatalogUpdate(completion: ((Result<Void, Error>) -> Void)? = nil) {
        guard !inserting else { completion?(.failure(InsertionError.busy)); return }
        paste(catalogStore.updatePrompt(), completion: { [weak self] result in
            // Paste restores the palette's front order before this callback.
            // Play here so an unpinned palette does not miss the arrival while
            // the destination app temporarily takes the foreground.
            self?.arrivalSequence += 1
            if case .success = result {
                self?.status = "カタログ更新の依頼を入力欄に追加しました。内容を確認して送信してください。"
            }
            completion?(result)
        })
    }
    func prepareWindowPresentation(wasVisible: Bool, wasMiniaturized: Bool, wasHidden: Bool) {
        if !wasVisible || wasMiniaturized || wasHidden { arrivalSequence += 1 }
    }
    private func paste(_ text: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard !inserting else { completion(.failure(InsertionError.busy)); return }
        inserting = true; error = false
        let insertionPanel = panel
        let keepPanelVisible = insertionPanel?.isVisible == true
        // A normal-level panel is covered when the destination is activated,
        // even with hidesOnDeactivate=false. Keep it above that activation for
        // this insertion only; the saved pin preference is never changed.
        if keepPanelVisible {
            insertionPanel?.level = .floating
            insertionPanel?.orderFrontRegardless()
        }
        // Release the nonactivating panel's stolen keyboard focus, including
        // the search field, without hiding the palette. CodexInserter activates
        // and verifies the actual destination before posting Paste.
        panel?.makeFirstResponder(nil)
        panel?.resignKey()
        inserter.insert(text, targetReady: {
            // Activation can reorder a normal panel asynchronously. Reassert
            // its position once the destination is active, without taking key
            // focus away from the verified input application.
            if keepPanelVisible && insertionPanel?.isVisible == true { insertionPanel?.orderFrontRegardless() }
        }) { [weak self] result in
            guard let self else { return }
            self.inserting = false
            switch result {
            case .success: break
            case .failure(let failure): self.status = failure.localizedDescription; self.error = true
            }
            self.trusted = AXIsProcessTrusted()
            if keepPanelVisible {
                insertionPanel?.level = self.pinned ? .floating : .normal
                if insertionPanel?.isVisible == true { insertionPanel?.orderFrontRegardless() }
            }
            completion(result)
        }
    }
    func restoreClipboard() { inserter.restoreClipboard() }
    private func watchCatalog() {
        guard catalogWatcher == nil else { return }
        catalogWatcher = try? CatalogWatcher(directory: catalogStore.fileURL.deletingLastPathComponent()) { [weak self] in
            self?.refresh(announce: false)
        }
    }
    func copyCatalogPrompt() {
        let board = NSPasteboard.general
        board.clearContents()
        if board.setString(catalogStore.updatePrompt(), forType: .string) {
            status = "カタログ更新の依頼をコピーしました。Codexに貼り付けて送信してください。"; error = false
        } else { status = "更新の依頼をコピーできませんでした。"; error = true }
    }
    func revealCatalog() {
        do {
            try catalogStore.prepareDirectory()
            if FileManager.default.fileExists(atPath: catalogStore.fileURL.path) {
                NSWorkspace.shared.activateFileViewerSelecting([catalogStore.fileURL])
            } else { NSWorkspace.shared.open(catalogStore.fileURL.deletingLastPathComponent()) }
        } catch { status = "カタログの保存先を開けませんでした。"; self.error = true }
    }
    func refresh(announce: Bool = true) {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            try catalogStore.prepareDirectory()
            let snapshot = try catalogStore.read()
            let changed = snapshot.data != appliedCatalogData, recovered = !catalogError.isEmpty || catalogMissing
            let hadCatalog = appliedCatalogData != nil
            guard changed || announce || recovered else { return }
            restoreFavorites(for: snapshot.catalog.skills)
            skills = snapshot.catalog.skills; appliedCatalogData = snapshot.data
            catalogMissing = false; catalogError = ""
            try catalogStore.saveLastValid(snapshot)
            if announce || recovered || (changed && hadCatalog) {
                status = "カタログを読み込みました（\(skills.count)スキル）。"; error = false
                if !snapshot.catalog.warnings.isEmpty {
                    status += " " + snapshot.catalog.warnings.prefix(3).joined(separator: "・")
                }
            }
        } catch {
            if appliedCatalogData == nil, let cached = try? catalogStore.readLastValid() {
                restoreFavorites(for: cached.catalog.skills)
                skills = cached.catalog.skills; appliedCatalogData = cached.data
            }
            catalogMissing = (error as? CatalogError).map { if case .missing = $0 { return true }; return false } ?? false
            catalogError = error.localizedDescription
            status = catalogError; self.error = !catalogMissing
        }
    }
}

struct SkillTile: View {
    let skill: Skill
    @ObservedObject var model: PaletteModel
    @State private var hovered = false
    var body: some View {
        HStack(spacing: 0) {
            Button { model.insert(skill) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(skill.name).font(.system(size: 12, weight: .medium)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    if model.duplicate(skill) { Text(skill.source).font(.system(size: 10)).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, minHeight: 33, alignment: .leading).padding(.leading, 10).padding(.vertical, 7).contentShape(Rectangle())
            }.buttonStyle(.plain).disabled(model.inserting).help(skill.summary)
                .accessibilityLabel(skill.name).accessibilityHint(skill.summary)
            Button { model.toggleFavorite(skill) } label: {
                Image(systemName: model.favorites.contains(skill.id) ? "star.fill" : "star")
                    .font(.system(size: 11)).foregroundStyle(model.favorites.contains(skill.id) ? Color.accentColor : Color.secondary.opacity(0.6))
                    .frame(width: 29, height: 40).contentShape(Rectangle())
            }.buttonStyle(.plain).help("お気に入り")
                .accessibilityLabel("\(skill.name)をお気に入り\(model.favorites.contains(skill.id) ? "から外す" : "に追加")")
        }
        .background(hovered ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.07) : Color(nsColor: .controlBackgroundColor).opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.09)))
        .onHover { hovered = $0 }
    }
}

struct PaletteView: View {
    @ObservedObject var model: PaletteModel
    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("スキル").font(.system(size: 19, weight: .semibold))
                    Text(model.query.isEmpty && !model.onlyFavorites ? "\(model.skills.count)" : "\(model.filtered.count) / \(model.skills.count)").font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary)
                    Spacer()
                    if model.loading { ProgressView().controlSize(.mini) }
                    Button { model.requestCatalogUpdate() } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.plain).help("Codexにカタログ更新を依頼").disabled(model.loading || model.inserting).accessibilityLabel("Codexにカタログ更新を依頼")
                }
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("スキル名や用途で検索", text: $model.query).textFieldStyle(.plain).font(.system(size: 13)).accessibilityLabel("スキル名や用途で検索")
                    if !model.query.isEmpty { Button { model.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.buttonStyle(.plain).accessibilityLabel("検索をクリア") }
                }.padding(9).background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 7)).overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Color.primary.opacity(0.12)))
                HStack(spacing: 5) {
                    Button { model.onlyFavorites = false } label: { Text("すべて").padding(.horizontal, 9).padding(.vertical, 5).background(!model.onlyFavorites ? Color.primary.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 5)) }.buttonStyle(.plain)
                    Button { model.onlyFavorites = true } label: { Text("★ お気に入り").padding(.horizontal, 9).padding(.vertical, 5).background(model.onlyFavorites ? Color.primary.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 5)) }.buttonStyle(.plain)
                    Spacer(minLength: 0)
                    Menu {
                        ForEach(InputFormat.allCases, id: \.rawValue) { value in
                            Button { model.selectFormat(value) } label: { if model.format == value { Label(value.label, systemImage: "checkmark") } else { Text(value.label) } }
                        }
                    } label: { Text(model.format == .slash ? "/" : model.format == .dollar ? "$" : "参照").font(.system(size: 12, design: .monospaced)).frame(minWidth: 20) }.menuStyle(.borderlessButton).fixedSize().help("入力形式")
                }.font(.system(size: 11)).foregroundStyle(.secondary)
            }.padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 12)
            Divider()
            ScrollView {
                if model.filtered.isEmpty {
                    Text(model.catalogMissing ? "上の更新ボタンからCodexにカタログの作成を依頼できます。" : model.onlyFavorites && model.favorites.isEmpty ? "★を付けたスキルが、ここに並びます。" : "一致するスキルがありません。")
                        .font(.system(size: 12)).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 40)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 166), spacing: 6, alignment: .top)], alignment: .leading, spacing: 6) {
                        ForEach(model.filtered) { skill in SkillTile(skill: skill, model: model) }
                    }.padding(12)
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                if !model.trusted {
                    HStack(alignment: .center, spacing: 10) {
                        Text("チャットへ入力するには、Macの許可が必要です。").font(.system(size: 11)).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Button("入力を有効にする") { model.requestPermission() }.controlSize(.small)
                    }
                }
                Text(model.status).font(.system(size: 10.5)).foregroundStyle(model.error ? Color.red : Color.secondary).fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
        }.frame(minWidth: 320, minHeight: 360).background(.regularMaterial)
    }
}

final class PalettePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panel: PalettePanel!
    private var item: NSStatusItem!
    private var model: PaletteModel!
    private var webContent: NativePaletteContent?
    private var nativeToolbar: NativePaletteToolbar?
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem(); let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "Skill Palletを終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu; mainMenu.addItem(applicationItem)
        let editItem = NSMenuItem(); let editMenu = NSMenu(title: "編集")
        editMenu.addItem(withTitle: "取り消す", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "カット", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "コピー", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "ペースト", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "すべて選択", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(.separator())
        let findItem = editMenu.addItem(withTitle: "スキルを検索", action: #selector(focusSearch), keyEquivalent: "f")
        findItem.target = self
        editItem.submenu = editMenu; mainMenu.addItem(editItem)
        let catalogItem = NSMenuItem(); let catalogMenu = NSMenu(title: "カタログ")
        catalogMenu.addItem(withTitle: "Codexにカタログ更新を依頼", action: #selector(updateCatalog), keyEquivalent: "")
        catalogMenu.addItem(withTitle: "更新用の依頼をコピー", action: #selector(copyCatalogPrompt), keyEquivalent: "")
        catalogMenu.addItem(.separator())
        catalogMenu.addItem(withTitle: "カタログを再読み込み", action: #selector(refresh), keyEquivalent: "r")
        catalogMenu.addItem(withTitle: "カタログの保存場所を開く", action: #selector(revealCatalog), keyEquivalent: "")
        catalogMenu.items.forEach { $0.target = self }
        catalogItem.submenu = catalogMenu; mainMenu.addItem(catalogItem); NSApp.mainMenu = mainMenu
        model = PaletteModel()
        panel = PalettePanel(contentRect: NSRect(x: 0, y: 0, width: 460, height: 665), styleMask: [.titled, .closable, .resizable, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Skill Pallet"; panel.titlebarAppearsTransparent = true
        panel.backgroundColor = NSColor(srgbRed: 225/255, green: 190/255, blue: 127/255, alpha: 1)
        panel.level = model.pinned ? .floating : .normal; panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false
        // Chip arrivals are animated inside the content. Do not also animate
        // the native frame when ordering the palette between applications.
        panel.animationBehavior = .none
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.becomesKeyOnlyIfNeeded = true
        model.panel = panel
        panel.isMovableByWindowBackground = false
        panel.contentMinSize = NSSize(width: 360, height: 520)
        if let content = NativePaletteContent(model: model) {
            webContent = content; panel.contentView = content.webView
            content.observeWindowMotion(in: panel)
            nativeToolbar = NativePaletteToolbar(model: model, window: panel)
        } else {
            panel.contentView = NSHostingView(rootView: PaletteView(model: model))
        }
        panel.setFrameAutosaveName("SkillPaletteWindow")
        if !panel.setFrameUsingName("SkillPaletteWindow"), let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: frame.maxX - 440, y: frame.midY - 320))
        }
        // Refit the saved window once when the two old header rows become one.
        if nativeToolbar != nil, !UserDefaults.standard.bool(forKey: "unifiedHeaderFrameV1") {
            let width = panel.contentView?.bounds.width ?? 460
            panel.setContentSize(NSSize(width: width, height: ceil(665 * min(1, width / 460))))
            panel.saveFrame(usingName: "SkillPaletteWindow")
            UserDefaults.standard.set(true, forKey: "unifiedHeaderFrameV1")
        }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let statusIcon = NSImage(named: "StatusIcon")
        statusIcon?.isTemplate = true
        item.button?.image = statusIcon ?? NSImage(systemSymbolName: "square.grid.2x2", accessibilityDescription: "Skill Pallet")
        item.button?.target = self; item.button?.action = #selector(toggle)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        show()
    }
    @objc func toggle() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "パレットを表示", action: #selector(show), keyEquivalent: "")
            menu.addItem(withTitle: "Codexにカタログ更新を依頼", action: #selector(updateCatalog), keyEquivalent: "")
            menu.addItem(withTitle: "更新用の依頼をコピー", action: #selector(copyCatalogPrompt), keyEquivalent: "")
            menu.addItem(withTitle: "カタログを再読み込み", action: #selector(refresh), keyEquivalent: "")
            menu.addItem(withTitle: "カタログの保存場所を開く", action: #selector(revealCatalog), keyEquivalent: "")
            menu.addItem(.separator())
            menu.addItem(withTitle: "終了", action: #selector(quit), keyEquivalent: "q")
            menu.items.forEach { $0.target = self }
            item.menu = menu; item.button?.performClick(nil); item.menu = nil
        } else if panel.isVisible { panel.orderOut(nil) } else { show() }
    }
    @objc func show() {
        guard let panel else { return }
        model.prepareWindowPresentation(wasVisible: panel.isVisible, wasMiniaturized: panel.isMiniaturized, wasHidden: NSApp.isHidden)
        NSApp.unhide(nil)
        if panel.isMiniaturized { panel.deminiaturize(nil) }
        // A saved position may belong to a disconnected display. Keep the
        // entire palette within an available screen before showing it.
        let frame = panel.frame
        let screen = NSScreen.screens.max { lhs, rhs in
            let left = lhs.visibleFrame.intersection(frame)
            let right = rhs.visibleFrame.intersection(frame)
            return max(0, left.width) * max(0, left.height) < max(0, right.width) * max(0, right.height)
        } ?? NSScreen.main
        if let screen {
            let area = screen.visibleFrame
            let width = min(frame.width, area.width)
            let height = min(frame.height, area.height)
            let x = min(max(frame.minX, area.minX), area.maxX - width)
            let y = min(max(frame.minY, area.minY), area.maxY - height)
            panel.setFrame(NSRect(x: x, y: y, width: width, height: height), display: false)
        }
        NSApp.activate()
        panel.makeKeyAndOrderFront(nil)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        show()
        return true
    }
    @objc func refresh() { model.refresh() }
    @objc func updateCatalog() { model.requestCatalogUpdate() }
    @objc func copyCatalogPrompt() { model.copyCatalogPrompt() }
    @objc func revealCatalog() { model.revealCatalog() }
    @objc func focusSearch() { show(); webContent?.focusSearch() }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { model?.restoreClipboard() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

private final class InsertionVisibilityProbePanel: NSPanel {
    var hideCalls = 0, showCalls = 0, keyReleases = 0, focusReleases = 0
    var shown = true
    override var isVisible: Bool { shown }
    override func orderOut(_ sender: Any?) { hideCalls += 1 }
    override func orderFrontRegardless() { showCalls += 1 }
    override func resignKey() { keyReleases += 1 }
    override func makeFirstResponder(_ responder: NSResponder?) -> Bool { focusReleases += 1; return true }
}

func selfTest() {
    let good = EditorInfo(role: "AXTextArea", label: "Work with Codex", identifier: "", enabled: true, visible: true, focused: false)
    let search = EditorInfo(role: "AXTextField", label: "Search chats", identifier: "", enabled: true, visible: true, focused: false)
    let editor = EditorInfo(role: "AXTextArea", label: "main.swift", identifier: "", enabled: true, visible: true, focused: false)
    precondition(chooseEditor([search, good, editor]) == 1)
    precondition(chooseEditor([good, good]) == nil)
    precondition(chooseEditor([search, editor]) == nil)
    let focused = EditorInfo(role: "AXTextArea", label: "", identifier: "", enabled: true, visible: true, focused: true)
    precondition(chooseEditor([focused]) == nil)
    let disabled = EditorInfo(role: "AXTextArea", label: "Work with Codex", identifier: "", enabled: false, visible: true, focused: true)
    precondition(chooseEditor([disabled]) == nil)
    var activationCalls: [String] = []
    let manualActivation = activateWebAccessibility { name in activationCalls.append(name); return .success }
    precondition(manualActivation.manual == .success && manualActivation.enhanced == nil)
    precondition(activationCalls == ["AXManualAccessibility"])
    activationCalls = []
    let enhancedActivation = activateWebAccessibility { name in
        activationCalls.append(name)
        return name == "AXManualAccessibility" ? .attributeUnsupported : .success
    }
    precondition(enhancedActivation.manual == .attributeUnsupported && enhancedActivation.enhanced == .success)
    precondition(enhancedActivation.requestedEnhanced)
    precondition(activationCalls == ["AXManualAccessibility", "AXEnhancedUserInterface"])
    let appliedThenNotImplemented = activateWebAccessibility { name in
        name == "AXManualAccessibility" ? .attributeUnsupported : .notImplemented
    }
    precondition(appliedThenNotImplemented.requestedEnhanced)
    let rejectedActivation = activateWebAccessibility { _ in .attributeUnsupported }
    precondition(rejectedActivation.manual == .attributeUnsupported && rejectedActivation.enhanced == .attributeUnsupported)
    precondition(!rejectedActivation.requestedEnhanced)
    let lookupNow = Date(timeIntervalSince1970: 100), lookupDeadline = Date(timeIntervalSince1970: 106)
    precondition(shouldRetryEditorDiscovery(eligibleCount: 0, attempt: 0, now: lookupNow, deadline: lookupDeadline))
    precondition(shouldRetryEditorDiscovery(eligibleCount: 0, attempt: 15, now: lookupNow.addingTimeInterval(2.3), deadline: lookupDeadline))
    precondition(!shouldRetryEditorDiscovery(eligibleCount: 2, attempt: 0, now: lookupNow, deadline: lookupDeadline))
    precondition(!shouldRetryEditorDiscovery(eligibleCount: 0, attempt: 30, now: lookupNow, deadline: lookupDeadline))
    precondition(!shouldRetryEditorDiscovery(eligibleCount: 0, attempt: 1, now: lookupDeadline, deadline: lookupDeadline))
    let skill = Skill(id: "/tmp/a b/SKILL.md", name: "demo", summary: "", description: "", source: "", invocation: "tools:demo")
    precondition(InputFormat.slash.command(skill) == "/tools:demo ")
    precondition(InputFormat.dollar.command(skill) == "$tools:demo ")
    precondition(InputFormat.reference.command(skill) == "[$demo](</tmp/a b/SKILL.md>) ")
    precondition(insertionWasApplied(before: "draft 日本語", after: "draft 日本語 /demo ", insertion: " /demo "))
    precondition(insertionWasApplied(before: "", after: "/demo", insertion: "/demo "))
    precondition(!insertionWasApplied(before: "draft", after: "/demo ", insertion: " /demo "))
    precondition(!insertionWasApplied(before: "draft", after: "draft", insertion: " /demo "))
    precondition(insertionWasApplied(before: "draft\n", after: "draft\u{A0}$demo\u{A0}\n", insertion: " $demo ", location: 5))
    precondition(insertionWasApplied(before: "a\u{A0}b\n", after: "a\u{A0}b\u{A0}$demo\u{A0}\n", insertion: " $demo ", location: 3))
    precondition(!insertionWasApplied(before: "a b\n", after: "a\u{A0}b\u{A0}$demo\u{A0}\n", insertion: " $demo ", location: 3))
    precondition(!insertionWasApplied(before: "draft\n", after: "draft\u{A0}$other\u{A0}\n", insertion: " $demo ", location: 5))
    precondition(!insertionWasApplied(before: "draft\n", after: "draft\u{A0}$demo\u{A0}extra\n", insertion: " $demo ", location: 5))
    precondition(!insertionWasApplied(before: "draft\n", after: "draft\u{A0}$demo\u{A0}", insertion: " $demo ", location: 5))
    precondition(!insertionWasApplied(before: " draft\n", after: "draft $demo \n", insertion: " $demo ", location: 6))
    precondition(!insertionWasApplied(before: "draft\n", after: "draft $demo ", insertion: " $demo ", location: 5))
    precondition(insertionWasApplied(before: "\n", after: "$demo\n", insertion: "$demo ", location: 0))
    let placeholderValue = "Codex と一緒に作業を進める\n"
    precondition(placeholderValue.utf16.count == 17)
    precondition(supportsComposerDecorationProfile("26.1021.31345"))
    precondition(supportsComposerDecorationProfile("26.429.30905"))
    precondition(!supportsComposerDecorationProfile("unknown"))
    // A matching but stale decoration cannot override a real end caret.
    precondition(composerInsertionSite(text: placeholderValue, characterCount: 17,
        range: CFRange(location: 16, length: 0), end: 17, placeholderCandidate: true, allowEmptyDecoration: false) == .draft(16))
    precondition(composerInsertionSite(text: placeholderValue, characterCount: 17,
        range: CFRange(location: 0, length: 0), end: 17, placeholderCandidate: true, allowEmptyDecoration: false) == nil)
    precondition(composerInsertionSite(text: placeholderValue, characterCount: 17,
        range: CFRange(location: 0, length: 0), end: 17, placeholderCandidate: true, allowEmptyDecoration: true) == .emptyDecoration)
    precondition(composerInsertionSite(text: placeholderValue, characterCount: 17,
        range: CFRange(location: 1, length: 0), end: 17, placeholderCandidate: true, allowEmptyDecoration: true) == nil)
    precondition(composerInsertionSite(text: placeholderValue, characterCount: 17,
        range: CFRange(location: 0, length: 1), end: 17, placeholderCandidate: true, allowEmptyDecoration: true) == nil)
    precondition(composerInsertionSite(text: placeholderValue, characterCount: 18,
        range: CFRange(location: 0, length: 0), end: 17, placeholderCandidate: true, allowEmptyDecoration: true) == nil)
    precondition(composerInsertionSite(text: placeholderValue, characterCount: 17,
        range: CFRange(location: 0, length: 0), end: 17, placeholderCandidate: false, allowEmptyDecoration: true) == nil)
    precondition(isGeneratedComposerPlaceholder(placeholderValue, placeholder: "", decoratedEmptyParagraph: true, supportedProfile: true))
    precondition(!isGeneratedComposerPlaceholder(placeholderValue, placeholder: "", decoratedEmptyParagraph: false, supportedProfile: true))
    precondition(!isGeneratedComposerPlaceholder(placeholderValue, placeholder: "", decoratedEmptyParagraph: true, supportedProfile: false))
    precondition(!isGeneratedComposerPlaceholder("本当の下書き\n", placeholder: "", decoratedEmptyParagraph: true, supportedProfile: true))
    let blankParagraph = editableComposerText(placeholderValue, generatedPlaceholder: true)
    precondition(blankParagraph == "\n")
    precondition(insertionCommand("$demo ", before: blankParagraph, location: 0) == "$demo ")
    precondition(insertionWasApplied(before: blankParagraph, after: "$demo \n", insertion: "$demo ", location: 0))
    precondition(editableComposerText(placeholderValue, generatedPlaceholder: false) == placeholderValue)
    precondition(!insertionWasApplied(before: placeholderValue, after: "$demo \n", insertion: " $demo ", location: 16))
    precondition(insertionPointIsReady(text: "", characterCount: 0, range: nil, end: 0))
    precondition(insertionPointIsReady(text: "\n", characterCount: 1, range: CFRange(location: 0, length: 0), end: 1))
    precondition(!insertionPointIsReady(text: "draft", characterCount: 5, range: nil, end: 5))
    precondition(!insertionPointIsReady(text: "draft", characterCount: 5, range: CFRange(location: 0, length: 0), end: 5))
    precondition(!insertionPointIsReady(text: "draft", characterCount: 5, range: CFRange(location: 0, length: 5), end: 5))
    // The reported failure: Chromium includes one final paragraph LF in its
    // AX value, then clamps a requested full-end caret just before that LF.
    let paragraph = "下書きテスト\n"
    let end = paragraph.utf16.count
    precondition(insertionLocation(text: paragraph, characterCount: end, range: CFRange(location: end - 1, length: 0), end: end) == end - 1)
    let command = insertionCommand("/demo ", before: paragraph, location: end - 1)!
    precondition(command == " /demo ")
    precondition(insertionWasApplied(before: paragraph, after: "下書きテスト /demo \n", insertion: command, location: end - 1))
    precondition(!insertionWasApplied(before: paragraph, after: "/demo \n", insertion: command, location: end - 1))
    // A real trailing user line break stays in place before the structural LF.
    precondition(insertionCommand("/demo ", before: "下書き\n\n", location: 4) == "/demo ")
    precondition(insertionWasApplied(before: "下書き\n\n", after: "下書き\n/demo \n", insertion: "/demo ", location: 4))
    precondition(insertionWasApplied(before: "\n", after: "/demo \n", insertion: "/demo ", location: 0))
    // Regression: the user-triggered paste reported before=1, insertion=49,
    // after=49. The empty paragraph's AX terminator may disappear after Paste.
    let longCommand = "/" + String(repeating: "a", count: 47) + " "
    precondition(longCommand.utf16.count == 49)
    precondition(!insertionWasApplied(before: "\n", after: longCommand, insertion: longCommand, location: 0))
    precondition(insertionWasApplied(before: "\n", after: longCommand, insertion: longCommand, location: 0, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "\n", after: "/demo", insertion: "/demo ", location: 0, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "\n", after: "/demo\u{A0}", insertion: "/demo ", location: 0, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "draft\n", after: "draft /demo ", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "draft\n", after: "draft \n/demo ", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "draft\n", after: "draft\u{A0}\n/demo ", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "draft\n", after: "draft \n/demo", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "draft\n", after: "draft\n /demo ", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "draft\n", after: "draft\n\n /demo ", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "draft\n", after: "draft\n /other ", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "\n", after: "\n/demo ", insertion: "/demo ", location: 0, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "draft\n", after: "draft\u{A0}/demo\u{A0}", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "下書き\n\n", after: "下書き\n/demo ", insertion: "/demo ", location: 4, allowsMissingStructuralLF: true))
    precondition(insertionWasApplied(before: "😀\n", after: "😀 /demo ", insertion: " /demo ", location: 2, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "\n", after: "", insertion: "/demo ", location: 0, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "\n", after: "/other ", insertion: "/demo ", location: 0, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "\n", after: "/demo extra", insertion: "/demo ", location: 0, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "\n", after: "/demo \n\n", insertion: "/demo ", location: 0, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: " draft\n", after: "draft /demo ", insertion: " /demo ", location: 6, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "draft\n", after: "drift /demo ", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "draft\n\n", after: "draft/demo ", insertion: "/demo ", location: 6, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "a b\n", after: "a\u{A0}b /demo ", insertion: " /demo ", location: 3, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "draft\n", after: "draft /demo ", insertion: " /demo ", location: 6, allowsMissingStructuralLF: true))
    precondition(!insertionWasApplied(before: "draft\nX", after: "draft /demo ", insertion: " /demo ", location: 5, allowsMissingStructuralLF: true))
    precondition(!insertionPointIsReady(text: "draftX", characterCount: 6, range: CFRange(location: 5, length: 0), end: 6))
    precondition(!insertionPointIsReady(text: "draft\n", characterCount: 6, range: CFRange(location: 4, length: 0), end: 6))
    precondition(!insertionPointIsReady(text: "draft\n", characterCount: 6, range: CFRange(location: 5, length: 1), end: 6))
    precondition(!insertionPointIsReady(text: "draft\n", characterCount: 7, range: CFRange(location: 5, length: 0), end: 7))
    precondition(insertionCommand("/demo ", before: "😀\n", location: 2) == " /demo ")
    precondition(insertionCommand("/demo ", before: "😀\n", location: 1) == nil)
    let board = NSPasteboard.withUniqueName()
    defer { board.releaseGlobally() }
    let first = NSPasteboardItem(), second = NSPasteboardItem()
    first.setString("original 日本語", forType: .string)
    first.setString("<b>original</b>", forType: .html)
    let binaryType = NSPasteboard.PasteboardType("com.kaido.skillpalette.test-data")
    second.setData(Data([0, 1, 2, 255]), forType: binaryType)
    board.writeObjects([first, second])
    do {
        let temporary = try TemporaryPaste(text: "/demo ", board: board)
        precondition(board.string(forType: .string) == "/demo ")
        temporary.restore()
        precondition(board.pasteboardItems?.count == 2)
        precondition(board.pasteboardItems?[0].string(forType: .string) == "original 日本語")
        precondition(board.pasteboardItems?[0].string(forType: .html) == "<b>original</b>")
        precondition(board.pasteboardItems?[1].data(forType: binaryType) == Data([0, 1, 2, 255]))
        let next = try TemporaryPaste(text: "/second ", board: board)
        board.clearContents(); board.setString("a newer copy", forType: .string)
        next.restore()
        precondition(board.string(forType: .string) == "a newer copy")
    } catch { preconditionFailure("Clipboard preservation failed: \(error)") }
    MainActor.assumeIsolated {
        if Bundle.main.bundleIdentifier == "com.kaido.skillpalette" {
            precondition(PaletteSoundPlayer().loadedAssetCount == 8, "Packaged UI audio must decode before release")
        }
        final class TestInserter: SkillInserting {
            var result: Result<Void, Error> = .success(())
            var pending: ((Result<Void, Error>) -> Void)?
            var delayed = false
            var calls = 0
            func insert(_ text: String, targetReady: @escaping () -> Void, completion: @escaping (Result<Void, Error>) -> Void) {
                calls += 1
                targetReady()
                if delayed { pending = completion } else { completion(result) }
            }
            func restoreClipboard() {}
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("skill-pallet-model-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = RecentUsageStore(fileURL: folder.appendingPathComponent("usage.json")), service = TestInserter()
        let volumeSuiteName = "SkillPallet.SoundTest.\(UUID().uuidString)", volumePreferences = UserDefaults(suiteName: volumeSuiteName)!
        defer { volumePreferences.removePersistentDomain(forName: volumeSuiteName) }
        precondition(PaletteSoundVolume.load(from: volumePreferences) == .off)
        volumePreferences.set(true, forKey: "successSound")
        let volumeModel = PaletteModel(inserter: service, usageStore: store, refreshOnLaunch: false, preferences: volumePreferences)
        precondition(volumeModel.soundVolume == .standard && volumeModel.soundEnabled)
        volumeModel.selectSoundVolume(.loud)
        let restoredVolume = PaletteModel(inserter: service, usageStore: store, refreshOnLaunch: false, preferences: volumePreferences)
        precondition(restoredVolume.soundVolume == .loud && restoredVolume.soundEnabled)
        precondition(volumePreferences.integer(forKey: PaletteSoundVolume.preferenceKey) == 2)
        restoredVolume.selectSound(true); precondition(restoredVolume.soundVolume == .loud)
        restoredVolume.selectSound(false)
        precondition(!restoredVolume.soundEnabled && PaletteSoundVolume.load(from: volumePreferences) == .off)
        volumePreferences.set(99, forKey: PaletteSoundVolume.preferenceKey)
        precondition(PaletteSoundVolume.load(from: volumePreferences) == .off)
        precondition(PaletteSoundVolume.off.next == .standard && PaletteSoundVolume.standard.next == .loud && PaletteSoundVolume.loud.next == .off)
        for kind in ["hover", "collision", "startup", "success"] {
            let standard = PaletteSoundPlayer.playbackLevel(kind: kind, volume: .standard, strength: 0.3)!
            let loud = PaletteSoundPlayer.playbackLevel(kind: kind, volume: .loud, strength: 0.3)!
            precondition(abs(loud - standard * 2) < 0.00001 && loud <= 1)
            precondition(PaletteSoundPlayer.playbackLevel(kind: kind, volume: .off) == 0)
        }
        let model = PaletteModel(inserter: service, usageStore: store, refreshOnLaunch: false)
        model.insert(skill)
        precondition(model.usageCounts[skill.usageKey] == 1)
        service.result = .failure(InsertionError.noApp); model.insert(skill)
        precondition(model.usageCounts[skill.usageKey] == 1)
        service.delayed = true; model.insert(skill); model.insert(skill)
        precondition(service.calls == 3)
        service.pending?(.success(())); service.pending = nil
        precondition(model.usageCounts[skill.usageKey] == 2)
        let reloaded = try! RecentUsageStore(fileURL: store.fileURL).counts()
        precondition(reloaded[skill.usageKey] == 2)
        let suiteName = "SkillPallet.PinTest.\(UUID().uuidString)", preferences = UserDefaults(suiteName: suiteName)!
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let pinModel = PaletteModel(inserter: service, usageStore: store, refreshOnLaunch: false, preferences: preferences)
        precondition(pinModel.pinned)
        _ = NSApplication.shared
        let testPanel = PalettePanel(contentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: .titled, backing: .buffered, defer: false)
        pinModel.panel = testPanel
        pinModel.selectPinned(false); precondition(testPanel.level == .normal)
        let reopened = PaletteModel(inserter: service, usageStore: store, refreshOnLaunch: false, preferences: preferences)
        precondition(!reopened.pinned)
        pinModel.selectPinned(true); precondition(testPanel.level == .floating)
        // Exercise the actual insertion model without displaying a GUI or
        // sending any key. A delayed failure and success both keep the palette
        // visible, release search focus, and restore its saved window level.
        let visiblePanel = InsertionVisibilityProbePanel(contentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: [.titled, .nonactivatingPanel], backing: .buffered, defer: false)
        pinModel.panel = visiblePanel; pinModel.selectPinned(false)
        let oldCount = pinModel.usageCounts[skill.usageKey] ?? 0
        pinModel.insert(skill)
        precondition(pinModel.inserting && visiblePanel.hideCalls == 0)
        precondition(visiblePanel.level == .floating && !pinModel.pinned)
        precondition(!preferences.bool(forKey: "alwaysOnTop"))
        precondition(visiblePanel.keyReleases == 1 && visiblePanel.focusReleases == 1)
        service.pending?(.failure(InsertionError.unsupported)); service.pending = nil
        precondition(!pinModel.inserting && pinModel.error && visiblePanel.showCalls == 3)
        precondition(visiblePanel.level == .normal && visiblePanel.hideCalls == 0)
        precondition((pinModel.usageCounts[skill.usageKey] ?? 0) == oldCount)
        pinModel.insert(skill)
        pinModel.selectPinned(true); pinModel.selectPinned(false)
        precondition(visiblePanel.level == .floating && !pinModel.pinned)
        service.pending?(.success(())); service.pending = nil
        precondition(!pinModel.inserting && visiblePanel.showCalls == 6 && visiblePanel.hideCalls == 0)
        precondition(visiblePanel.level == .normal && !pinModel.pinned)

        // Closing the panel deliberately during a pending insertion must not
        // reopen it when the reply arrives. Its temporary level is released.
        pinModel.insert(skill)
        visiblePanel.shown = false
        service.pending?(.failure(InsertionError.changed)); service.pending = nil
        precondition(visiblePanel.showCalls == 8 && visiblePanel.level == .normal)
        visiblePanel.shown = true
        pinModel.selectPinned(true); pinModel.insert(skill)
        service.pending?(.success(())); service.pending = nil
        precondition(visiblePanel.level == .floating && pinModel.pinned)

        // The corrected verification result must reach the normal success UI
        // and persist exactly one use. No real application receives this input.
        let verifiedService = TestInserter()
        let verifiedCommand = InputFormat.slash.command(skill)
        let verifiedLocation = insertionLocation(text: "\n", characterCount: 1,
            range: CFRange(location: 0, length: 0), end: 1)!
        let verified = insertionWasApplied(before: "\n", after: verifiedCommand, insertion: verifiedCommand,
            location: verifiedLocation, allowsMissingStructuralLF: verifiedLocation == 0)
        verifiedService.result = verified ? .success(()) : .failure(InsertionError.unconfirmed)
        let verifiedStore = RecentUsageStore(fileURL: folder.appendingPathComponent("verified-usage.json"))
        let verifiedModel = PaletteModel(inserter: verifiedService, usageStore: verifiedStore,
            refreshOnLaunch: false, preferences: preferences)
        verifiedModel.insert(skill)
        precondition(!verifiedModel.error && !verifiedModel.inserting)
        precondition(verifiedModel.status == "demo を入力欄に追加しました。")
        precondition(verifiedModel.usageCounts[skill.usageKey] == 1 && verifiedService.calls == 1)
        precondition(try! RecentUsageStore(fileURL: verifiedStore.fileURL).counts()[skill.usageKey] == 1)

        // Presentation sequences are independent of usage and the paste reply.
        // Use a fake destination: this test never interacts with Codex.
        let replayService = TestInserter()
        let replayModel = PaletteModel(inserter: replayService, usageStore: store, refreshOnLaunch: false, preferences: preferences)
        precondition(replayModel.arrivalSequence == 0)
        replayModel.prepareWindowPresentation(wasVisible: false, wasMiniaturized: false, wasHidden: false)
        precondition(replayModel.arrivalSequence == 1) // launch / closed window
        replayModel.prepareWindowPresentation(wasVisible: true, wasMiniaturized: false, wasHidden: false)
        precondition(replayModel.arrivalSequence == 1) // focus an already-visible window
        replayModel.prepareWindowPresentation(wasVisible: true, wasMiniaturized: true, wasHidden: false)
        replayModel.prepareWindowPresentation(wasVisible: true, wasMiniaturized: false, wasHidden: true)
        precondition(replayModel.arrivalSequence == 3)
        replayService.delayed = true
        let replayCounts = replayModel.usageCounts
        replayModel.requestCatalogUpdate()
        precondition(replayModel.arrivalSequence == 3 && replayModel.inserting)
        var busyRejected = false
        replayModel.requestCatalogUpdate { result in if case .failure = result { busyRejected = true } }
        precondition(busyRejected && replayService.calls == 1 && replayModel.arrivalSequence == 3)
        replayService.pending?(.success(())); replayService.pending = nil
        precondition(!replayModel.inserting && replayModel.arrivalSequence == 4 && replayModel.usageCounts == replayCounts)
        replayModel.selectPinned(true); replayModel.selectSound(false); replayModel.reloadUsage()
        precondition(replayModel.arrivalSequence == 4)
        replayModel.prepareWindowPresentation(wasVisible: false, wasMiniaturized: false, wasHidden: false)
        precondition(replayModel.arrivalSequence == 5)
    }
    print("PASS: composer selection, invocation formats, draft-preserving verification, multi-item clipboard restoration, newer-copy preservation")
    print("PASS: web accessibility falls back from unsupported Electron attribute to Chromium enhanced mode; lookup tolerates delayed activation and remains bounded")
    print("PASS: successful insertions persist once; failures and busy clicks do not increment; recreated store restores usage")
    print("PASS: audio migrates legacy ON/OFF, saves three volume levels, restores loud after restart and doubles gain without changing impact strength")
    print("PASS: pin switches real window levels and persists across model recreation")
    print("PASS: structural final LF append preserves draft, line breaks, Unicode and verification; non-end/selected/mismatched ranges are rejected")
    print("PASS: verified caret permits omitted AX paragraph LF after Paste; existing draft, user line breaks and exact command remain required; success UI and usage persist once")
    print("PASS: insertion holds visible panel above target activation, restores saved pin level on success/failure, and never reopens a panel closed during insertion")
    print("PASS: launch, reopen and completed catalog request replay arrivals once; focus, busy clicks, pin, mute and usage do not replay")
}

if CommandLine.arguments.contains("--self-test") {
    selfTest()
    windowMotionSelfTest()
    MainActor.assumeIsolated { catalogSelfTest() }
} else if let index = CommandLine.arguments.firstIndex(of: "--validate-catalog") {
    do {
        guard CommandLine.arguments.indices.contains(index + 1) else { throw CatalogError.invalid("検証するファイルのパスが必要です。") }
        let snapshot = try CatalogStore.read(URL(fileURLWithPath: CommandLine.arguments[index + 1]))
        print("PASS: catalog schemaVersion=1 skills=\(snapshot.catalog.skills.count)")
    } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8)); exit(1)
    }
} else if CommandLine.arguments.contains("--catalog-prompt") {
    print(CatalogStore().updatePrompt())
} else {
    MainActor.assumeIsolated {
        let delegate = AppDelegate()
        let app = NSApplication.shared
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
