import Foundation
import Darwin

struct Skill: Codable, Identifiable {
    let id: String
    let name: String
    let summary: String
    let description: String
    let source: String
    let invocation: String
    var genres: [String] = []
    var tags: [String] = []
    var usageKey: String { RecentUsageStore.identity(invocation: invocation, source: source) }
}

struct Catalog: Codable {
    var schemaVersion = 1
    let skills: [Skill]
    var warnings: [String] = []
}

enum CatalogError: LocalizedError {
    case missing, invalid(String)
    var errorDescription: String? {
        switch self {
        case .missing: return "カタログがありません。Codexに作成を依頼できます。"
        case .invalid(let detail): return "カタログを読み込めません。\(detail) 保存済みの一覧は保持しています。"
        }
    }
}

struct CatalogSnapshot {
    let catalog: Catalog
    let data: Data
}

struct CatalogPromptEnvironment {
    let homeDirectory: URL
    let executableURL: URL?

    static var current: CatalogPromptEnvironment {
        CatalogPromptEnvironment(homeDirectory: FileManager.default.homeDirectoryForCurrentUser,
                                 executableURL: Bundle.main.executableURL)
    }

    func quotedPath(_ url: URL) -> String {
        let path = url.standardizedFileURL.path
        let home = homeDirectory.standardizedFileURL.path
        let displayed = path == home ? "~" : path.hasPrefix(home + "/") ? "~" + String(path.dropFirst(home.count)) : path
        let encoder = JSONEncoder(); encoder.outputFormatting = [.withoutEscapingSlashes]
        return String(data: try! encoder.encode(displayed), encoding: .utf8)!
    }
}

final class CatalogStore {
    static let maximumBytes = 8 * 1024 * 1024
    static let genreNames = ["audio", "video", "image", "ui", "words", "data", "organize"]
    static var defaultURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Skill Pallet", isDirectory: true).appendingPathComponent("catalog.json")
    }
    let fileURL: URL
    var lastValidURL: URL { fileURL.deletingLastPathComponent().appendingPathComponent(".catalog-last-valid.json") }

    init(fileURL: URL = CatalogStore.defaultURL) { self.fileURL = fileURL }

    func prepareDirectory() throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
    }

    static func decode(_ data: Data) throws -> Catalog {
        guard data.count <= maximumBytes else { throw CatalogError.invalid("ファイルは8MB以内にしてください。") }
        let catalog: Catalog
        do { catalog = try JSONDecoder().decode(Catalog.self, from: data) }
        catch { throw CatalogError.invalid("JSONの形式と必須項目を確認してください。") }
        guard catalog.schemaVersion == 1 else { throw CatalogError.invalid("schemaVersionは1にしてください。") }
        guard catalog.skills.count <= 10_000, catalog.warnings.count <= 50 else { throw CatalogError.invalid("項目数が多すぎます。") }
        var ids = Set<String>(), identities = Set<String>()
        func singleLine(_ value: String, limit: Int, required: Bool = true) -> Bool {
            value.count <= limit && (!required || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                && value.rangeOfCharacter(from: .controlCharacters) == nil
        }
        for skill in catalog.skills {
            guard singleLine(skill.id, limit: 8192), (skill.id as NSString).isAbsolutePath,
                  URL(fileURLWithPath: skill.id).lastPathComponent == "SKILL.md",
                  singleLine(skill.name, limit: 160), singleLine(skill.source, limit: 160),
                  singleLine(skill.summary, limit: 500), singleLine(skill.invocation, limit: 256),
                  skill.invocation.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
                  !skill.invocation.hasPrefix("/"), !skill.invocation.hasPrefix("$"),
                  skill.description.count <= 16_384, !skill.description.contains("\0") else {
                throw CatalogError.invalid("スキルの名前・概要・提供元・パス・指定名を確認してください。")
            }
            guard !skill.genres.isEmpty, skill.genres.allSatisfy(Self.genreNames.contains),
                  skill.tags.count <= 32, skill.tags.allSatisfy({ singleLine($0, limit: 80) }) else {
                throw CatalogError.invalid("ジャンルと検索タグを確認してください。")
            }
            guard ids.insert(skill.id).inserted, identities.insert(skill.usageKey).inserted else {
                throw CatalogError.invalid("同じパス、または同じ指定名と提供元の組み合わせが重複しています。")
            }
        }
        guard catalog.warnings.allSatisfy({ singleLine($0, limit: 1000) }) else {
            throw CatalogError.invalid("warningsの各項目は1000文字以内にしてください。")
        }
        return catalog
    }

    static func read(_ url: URL) throws -> CatalogSnapshot {
        guard FileManager.default.fileExists(atPath: url.path) else { throw CatalogError.missing }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, let size = values.fileSize, size <= maximumBytes else {
            throw CatalogError.invalid("8MB以内のJSONファイルを指定してください。")
        }
        let data = try Data(contentsOf: url, options: .uncached)
        return CatalogSnapshot(catalog: try decode(data), data: data)
    }
    func read() throws -> CatalogSnapshot { try Self.read(fileURL) }
    func readLastValid() throws -> CatalogSnapshot { try Self.read(lastValidURL) }
    func saveLastValid(_ snapshot: CatalogSnapshot) throws {
        if (try? Data(contentsOf: lastValidURL)) == snapshot.data { return }
        try prepareDirectory()
        try snapshot.data.write(to: lastValidURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: lastValidURL.path)
    }

    func updatePrompt(environment: CatalogPromptEnvironment = .current) -> String {
        let validation = environment.executableURL.map { """

        起動中のSkill Palletに付属する検証コマンドも使えます。実行ファイルの場所は、このアプリの起動場所から取得しています。
        \(environment.quotedPath($0))
        引数は `--validate-catalog` と候補JSONの絶対パスです。この検証起動は画面を開かず、ファイルを変更しません。
        """ } ?? ""
        return """
        Skill Palletのスキルカタログを更新してください。

        このMacでSkill Palletが読み込むカタログの保存先です。
        \(environment.quotedPath(fileURL))
        パスの先頭が `~/` の場合は、このMacの実行ユーザーのホームディレクトリへ展開して読み書きしてください。

        このチャットで利用可能と提示されているスキルを基準に、このMacで参照できるものを整理してください。必要に応じてSKILL.mdのメタデータを読み、無効なスキルや接続されていないプラグインのキャッシュを混ぜないでください。スキル本文の手順を実行する作業ではありません。

        既存カタログがあれば先に読み、同じスキルのinvocationとsourceは維持してください。日本語の概要と検索タグを活かし、追加・削除・変更を反映します。同名でも提供元が違うスキルは別項目にします。

        JSONの最上位は {"schemaVersion":1,"skills":[],"warnings":[]} です。skillsの各項目に、以下をすべて保存してください。
        - id: 実在するSKILL.mdの絶対パス。
        - name: 画面に表示する実際のスキル名。
        - invocation: Codexで指定する正確な名前。プラグイン名などの接頭辞を含め、先頭の / や $ と空白は付けません。
        - summary: 用途が分かる日本語の1行概要。目安は30〜60文字。
        - description: 元の説明文。
        - source: 提供元の表示名。ローカルスキルは「ローカル」。
        - genres: audio（音）、video（映像）、image（画像）、ui（UI・Web）、words（調査・文章）、data（資料・データ）、organize（整理・連携）から選ぶ文字列の配列。複数選択でき、画像と映像にまたがるものは両方を含めます。少なくとも1つ必要です。
        - tags: 用途や同義語で検索できる短い日本語・英語の文字列の配列。32個以内。タグ自体はチップに表示されません。

        idと、invocation・sourceの組み合わせは、それぞれ重複させないでください。確認できないものは推測して追加せず、warningsに理由を記載してください。

        文字数の上限は、名前と提供元が各160、invocationが256、概要が500、説明が16,384、パスが8,192、タグが各80です。ファイルは8MB・10,000スキル以内、warningsは50件以内・各1,000文字以内です。既存スキルの並び順を保ち、新しいスキルは末尾へ追加してください。

        同じフォルダの一時ファイルへJSONを作成し、構文・必須項目・重複を検証してください。既存ファイルがあれば日時付きの別名でバックアップし、検証が通ってから保存先をアトミックに置き換えてください。アプリ本体、使用履歴、設定、.catalog-last-valid.jsonは変更しません。\(validation)

        保存後は、追加・削除・変更の件数と、確認できなかった点を簡潔に報告してください。Skill Palletはファイルの変更を検知して一覧を読み直します。
        """
    }
}

@MainActor final class CatalogWatcher {
    private let source: DispatchSourceFileSystemObject
    private var pending: DispatchWorkItem?
    private let changed: () -> Void
    init(directory: URL, changed: @escaping () -> Void) throws {
        let descriptor = open(directory.path, O_EVTONLY)
        guard descriptor >= 0 else { throw CatalogError.invalid("保存先フォルダを開けません。") }
        self.changed = changed
        source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor, eventMask: [.write, .rename, .delete], queue: .main)
        source.setCancelHandler { close(descriptor) }
        source.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.schedule() }
        }
        source.resume()
    }
    private func schedule() {
        pending?.cancel()
        let work = DispatchWorkItem { [weak self] in MainActor.assumeIsolated { self?.changed() } }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }
    deinit { pending?.cancel(); source.cancel() }
}
