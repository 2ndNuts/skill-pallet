import Foundation
import Darwin

enum UsageStoreError: LocalizedError {
    case invalidData, lock, overflow
    var errorDescription: String? {
        switch self {
        case .invalidData: return "使用履歴を読み込めません。保存済みの履歴は保持しています。"
        case .lock: return "使用履歴の保存先を開けません。"
        case .overflow: return "使用履歴の記録日時が正しくありません。"
        }
    }
}

struct RecentUsageData: Codable {
    var version = 1
    var events: [String: [Int64]] = [:]
}

final class RecentUsageStore {
    static let windowMilliseconds: Int64 = 30 * 24 * 60 * 60 * 1000
    let fileURL: URL
    init(fileURL: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Skill Pallet", isDirectory: true).appendingPathComponent("usage-v1.json")) {
        self.fileURL = fileURL
    }
    static func identity(invocation: String, source: String) -> String { invocation + "\u{001F}" + source }
    static func stage(for count: Int) -> Int {
        if count >= 21 { return 5 }; if count >= 16 { return 4 }; if count >= 11 { return 3 }; if count >= 5 { return 2 }; return 1
    }
    private func milliseconds(_ date: Date) throws -> Int64 {
        let value = date.timeIntervalSince1970 * 1000
        guard value.isFinite, value >= 0, value < 9_007_199_254_740_991 else { throw UsageStoreError.overflow }
        return Int64(value.rounded(.down))
    }
    private func read() throws -> RecentUsageData {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return RecentUsageData() }
        let raw = try Data(contentsOf: fileURL)
        guard let data = try? JSONDecoder().decode(RecentUsageData.self, from: raw), data.version == 1,
              data.events.values.allSatisfy({ $0.allSatisfy { $0 >= 0 && $0 < 9_007_199_254_740_991 } }) else { throw UsageStoreError.invalidData }
        return data
    }
    func counts(at date: Date = Date()) throws -> [String: Int] {
        let now = try milliseconds(date), cutoff = now - Self.windowMilliseconds
        return try read().events.reduce(into: [:]) { result, item in
            let count = item.value.filter { $0 > cutoff && $0 <= now }.count
            if count > 0 { result[item.key] = count }
        }
    }
    @discardableResult func recordSuccess(key: String, at date: Date = Date()) throws -> [String: Int] {
        let now = try milliseconds(date), cutoff = now - Self.windowMilliseconds
        guard !key.isEmpty else { throw UsageStoreError.invalidData }
        let folder = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // Serialize read-modify-write across app instances, then replace the JSON atomically.
        let descriptor = open(fileURL.appendingPathExtension("lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw UsageStoreError.lock }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw UsageStoreError.lock }
        defer { flock(descriptor, LOCK_UN) }
        var data = try read()
        data.events = data.events.compactMapValues { values in
            let recent = values.filter { $0 > cutoff }; return recent.isEmpty ? nil : recent
        }
        data.events[key, default: []].append(now)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(data).write(to: fileURL, options: .atomic)
        return data.events.reduce(into: [:]) { result, item in
            let count = item.value.filter { $0 > cutoff && $0 <= now }.count
            if count > 0 { result[item.key] = count }
        }
    }
}
