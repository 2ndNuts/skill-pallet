import AppKit
import WebKit
import Combine
import os

@MainActor final class NativePaletteContent: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    let webView: WKWebView
    private let model: PaletteModel
    private let entry: URL
    private var updates: AnyCancellable?
    private var soundUpdates: AnyCancellable?
    private var isReady = false
    private let sounds = PaletteSoundPlayer()
    private var hasBootstrapped = false
    private var playArrival = true
    private var windowMotion: WindowMotionRelay?
    private var pendingMotion: WindowMotionPacket?
    private var motionRequest: UUID?
    private let motionLog = Logger(subsystem: "com.kaido.skillpalette", category: "WindowMotion")

    init?(model: PaletteModel) {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("UI", isDirectory: true),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("interactive/index.html").path) else { return nil }
        self.model = model
        entry = root.appendingPathComponent("interactive/index.html").standardizedFileURL
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "skillPallet")
        webView.navigationDelegate = self
        updates = model.objectWillChange.sink { [weak self] in
            DispatchQueue.main.async { self?.sendState() }
        }
        soundUpdates = model.$soundEnabled.removeDuplicates().sink { [weak self] enabled in
            if !enabled { self?.sounds.stop() }
        }
        webView.loadFileURL(entry, allowingReadAccessTo: root)
    }

    func focusSearch() {
        webView.window?.makeFirstResponder(webView)
        webView.callAsyncJavaScript("const field = document.querySelector('#search'); field.focus(); field.select();", arguments: [:], in: nil, in: .page) { _ in }
    }

    func observeWindowMotion(in window: NSWindow) {
        windowMotion = WindowMotionRelay(window: window) { [weak self] packet in
            guard let self, self.isReady else { return }
            self.pendingMotion = packet
            self.sendWindowMotion()
        }
    }
    private func sendWindowMotion() {
        guard isReady, motionRequest == nil, let packet = pendingMotion else { return }
        pendingMotion = nil
        guard webView.window?.isVisible == true, Date().timeIntervalSince1970 - packet.issuedAt <= 0.12 else { return }
        let request = UUID(); motionRequest = request
        // A separate, coalesced channel avoids serializing the whole catalog
        // sixty times a second. Only the latest velocity waits for WebKit.
        webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('skill-pallet-window-motion', {detail: motion}));",
                                    arguments: ["motion": packet.payload], in: nil, in: .page) { [weak self] _ in
            guard let self, self.motionRequest == request else { return }
            self.motionRequest = nil
            let age = (Date().timeIntervalSince1970 - packet.issuedAt) * 1000
            self.motionLog.debug("delivered sample=\(packet.sample, privacy: .public) ageMs=\(age, privacy: .public)")
            self.sendWindowMotion()
        }
    }

    private func snapshot() -> [String: Any] {
        ["skills": model.skills.map { ["id": $0.id, "name": $0.name, "summary": $0.summary, "description": $0.description, "source": $0.source, "invocation": $0.invocation, "genres": $0.genres, "tags": $0.tags] as [String: Any] },
         "usage": ["windowDays": 30, "counts": model.usageCounts], "usageError": model.usageError,
         "favorites": Array(model.favorites), "format": model.format.rawValue, "sound": model.soundEnabled, "pinned": model.pinned,
         "trusted": model.trusted, "inserting": model.inserting, "status": model.status, "error": model.error, "loading": model.loading,
         "catalogMissing": model.catalogMissing, "catalogError": model.catalogError, "playArrival": playArrival, "arrivalSequence": model.arrivalSequence]
    }
    private func sendState() {
        guard isReady else { return }
        if !model.soundEnabled { sounds.stop() }
        webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('skill-pallet-state', {detail: state}));", arguments: ["state": snapshot()], in: nil, in: .page) { _ in }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.standardizedFileURL == entry,
              webView.url?.standardizedFileURL == entry,
              let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, "この画面からは操作できません。"); return
        }
        let reply: (Bool, String?) -> Void = { [weak self] ok, error in
            guard let self else { replyHandler(nil, "アプリを開き直してください。"); return }
            replyHandler(["ok": ok, "message": error ?? "", "state": self.snapshot()], nil)
        }
        switch action {
        case "soundCue":
            guard model.soundEnabled, let kind = body["kind"] as? String, let take = body["take"] as? Int else {
                replyHandler(["played": false], nil); return
            }
            let strength = body["strength"] as? Double ?? 1
            replyHandler(["played": sounds.play(kind: kind, take: take, strength: strength)], nil)
        case "bootstrap":
            playArrival = !hasBootstrapped; hasBootstrapped = true
            isReady = true; model.reloadUsage(); reply(true, nil)
        case "invoke", "favorite":
            guard let key = body["key"] as? String, let skill = model.skills.first(where: { $0.usageKey == key }) else {
                reply(false, "スキルが見つかりません。一覧を更新してください。"); return
            }
            if action == "favorite" { model.toggleFavorite(skill); reply(true, nil) }
            else { model.insert(skill) { result in
                switch result { case .success: reply(true, nil); case .failure(let error): reply(false, error.localizedDescription) }
            } }
        case "format":
            guard let value = body["value"] as? String, let format = InputFormat(rawValue: value) else { reply(false, "入力形式が正しくありません。"); return }
            model.selectFormat(format); reply(true, nil)
        case "sound":
            guard let value = body["value"] as? Bool else { reply(false, "音の設定が正しくありません。"); return }
            if !value { sounds.stop() }
            model.selectSound(value); reply(true, nil)
        case "pin":
            guard let value = body["value"] as? Bool else { reply(false, "最前面の設定が正しくありません。"); return }
            model.selectPinned(value); reply(true, nil)
        case "updateCatalog": model.requestCatalogUpdate { result in
            switch result { case .success: reply(true, nil); case .failure(let error): reply(false, error.localizedDescription) }
        }
        case "refresh": model.refresh(); reply(true, nil)
        case "permission": model.requestPermission(); reply(true, nil)
        default: reply(false, "この操作には対応していません。")
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Only the packaged application page can access native insertion or saved counts.
        decisionHandler(navigationAction.request.url?.standardizedFileURL == entry ? .allow : .cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        isReady = false
        windowMotion?.stop(); pendingMotion = nil; motionRequest = nil
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("UI", isDirectory: true) else { return }
        webView.loadFileURL(entry, allowingReadAccessTo: root)
    }
}
