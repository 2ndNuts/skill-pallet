import AppKit

@MainActor final class PaletteSoundPlayer {
    private static let levels: [String: Float] = ["hover": 0.28, "collision": 0.24, "startup": 0.42, "success": 0.38]
    // JS spaces collision cues by 125ms. Leave delivery jitter a little room;
    // the shared family/voice limits still prevent bursts and mixed sounds.
    private static let intervals: [String: TimeInterval] = ["hover": 0.26, "collision": 0.10, "startup": 0.12, "success": 0.15]
    private var voices: [String: [NSSound]] = [:]
    private var voiceKinds: [ObjectIdentifier: String] = [:]
    private var lastByKind: [String: TimeInterval] = [:]
    private var lastAny: TimeInterval = -.infinity
    private var pendingSuccess: Task<Void, Never>?
    private var pendingSuccessID: UUID?
    var loadedAssetCount: Int { voices.count }

    init(resources: URL? = Bundle.main.resourceURL) {
        guard let audio = resources?.appendingPathComponent("UI/audio", isDirectory: true) else { return }
        for index in 1...4 { load(String(format: "wood-%02d", index), url: audio.appendingPathComponent(String(format: "ui/wood-%02d.wav", index))) }
        for index in 1...3 { load(String(format: "scroll-%02d", index), url: audio.appendingPathComponent(String(format: "ui/scroll-%02d.wav", index))) }
        load("success", url: audio.appendingPathComponent("success-click.wav"))
    }
    private func load(_ key: String, url: URL) {
        let pool = (0..<4).compactMap { _ in NSSound(contentsOf: url, byReference: false) }
        if pool.count == 4 { voices[key] = pool }
    }
    @discardableResult func play(kind: String, take: Int, strength: Double = 1) -> Bool {
        guard let level = Self.levels[kind], let interval = Self.intervals[kind], (0...3).contains(take), strength.isFinite, (0...1).contains(strength) else { return false }
        if pendingSuccess != nil, kind != "success" { return false }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - (lastByKind[kind] ?? -.infinity) >= interval else { return false }
        if kind == "success" { cancelPendingSuccess() }
        if kind == "hover" || kind == "collision" {
            guard now - lastAny >= (kind == "hover" ? 0.2 : 0.11) else { return false }
        }
        let active = voices.values.flatMap { $0 }.filter(\.isPlaying)
        if kind == "success", !active.isEmpty {
            let delay = min(0.45, max(0.02, active.map { $0.duration - $0.currentTime }.max() ?? 0.4)) + 0.015
            let token = UUID(); pendingSuccessID = token
            pendingSuccess = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
                guard !Task.isCancelled, let self, self.pendingSuccessID == token else { return }
                self.pendingSuccess = nil; self.pendingSuccessID = nil
                self.play(kind: kind, take: take)
            }
            return true
        }
        if kind == "collision" || kind == "startup" {
            guard active.count < 2, active.allSatisfy({ voiceKinds[ObjectIdentifier($0)] == kind }) else { return false }
        } else {
            guard active.count < (kind == "startup" ? 2 : 1) else { return false }
        }
        let key = kind == "success" ? "success" : kind == "collision" ? String(format: "scroll-%02d", take % 3 + 1) : String(format: "wood-%02d", take + 1)
        guard let voice = voices[key]?.first(where: { !$0.isPlaying }) else { return false }
        voice.volume = level * (kind == "collision" ? Float(0.45 + 0.55 * strength) : 1)
        guard voice.play() else { return false }
        voiceKinds[ObjectIdentifier(voice)] = kind
        lastByKind[kind] = now; lastAny = now
        return true
    }
    private func cancelPendingSuccess() { pendingSuccess?.cancel(); pendingSuccess = nil; pendingSuccessID = nil }
    func stop() { cancelPendingSuccess(); for pool in voices.values { for voice in pool where voice.isPlaying { voice.stop() } } }
}
