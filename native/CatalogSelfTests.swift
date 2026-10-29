import AppKit

@MainActor func catalogSelfTest() {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("skill-pallet-catalog-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = CatalogStore(fileURL: directory.appendingPathComponent("catalog.json"))
    let suite = "SkillPallet.CatalogTest.\(UUID().uuidString)"
    let preferences = UserDefaults(suiteName: suite)!
    defer { preferences.removePersistentDomain(forName: suite) }
    let usage = RecentUsageStore(fileURL: directory.appendingPathComponent("usage.json"))
    let first = Skill(id: "/tmp/catalog-a/SKILL.md", name: "wood-a", summary: "音と映像を整える。", description: "Sound and video.", source: "ローカル", invocation: "wood-a", genres: ["audio", "video"], tags: ["木", "音", "映像"])
    let second = Skill(id: "/tmp/catalog-b/SKILL.md", name: "wood-b", summary: "画像を整える。", description: "Images.", source: "ローカル", invocation: "wood-b", genres: ["image"], tags: ["写真"])
    let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    func write(_ skills: [Skill]) {
        try! encoder.encode(Catalog(skills: skills)).write(to: store.fileURL, options: .atomic)
    }
    func invalid(_ data: Data) {
        do { _ = try CatalogStore.decode(data); preconditionFailure("Invalid catalog was accepted") }
        catch {}
    }
    final class PasteProbe: SkillInserting {
        var texts: [String] = []
        var pending: ((Result<Void, Error>) -> Void)?
        var delay = false
        var result: Result<Void, Error> = .success(())
        func insert(_ text: String, targetReady: @escaping () -> Void, completion: @escaping (Result<Void, Error>) -> Void) {
            targetReady()
            texts.append(text)
            if delay { pending = completion } else { completion(result) }
        }
        func restoreClipboard() {}
    }
    let paste = PasteProbe()
    let model = PaletteModel(inserter: paste, usageStore: usage, catalogStore: store, monitorCatalog: false, preferences: preferences)
    precondition(model.skills.isEmpty && model.catalogMissing)
    precondition(!FileManager.default.fileExists(atPath: store.fileURL.path), "Fresh installs must not invent or bundle a personal catalog")
    let prompt = store.updatePrompt()
    let encodedPath = CatalogPromptEnvironment.current.quotedPath(store.fileURL)
    precondition(prompt.contains(encodedPath) && prompt.contains("schemaVersion") && prompt.contains("genres") && prompt.contains("tags"))
    precondition(!prompt.contains("\\/"), "Paths in prompts must use normal slashes")
    let homeA = URL(fileURLWithPath: "/Users/catalog-test-a", isDirectory: true)
    let homeB = URL(fileURLWithPath: "/Users/catalog-test-b", isDirectory: true)
    let appA = homeA.appendingPathComponent("Applications/Skill Pallet.app/Contents/MacOS/SkillPalette")
    let appB = URL(fileURLWithPath: "/Applications/Skill Pallet.app/Contents/MacOS/SkillPalette")
    let environmentA = CatalogPromptEnvironment(homeDirectory: homeA, executableURL: appA)
    let environmentB = CatalogPromptEnvironment(homeDirectory: homeB, executableURL: appB)
    let catalogA = CatalogStore(fileURL: homeA.appendingPathComponent("Library/Application Support/Skill Pallet/catalog.json"))
    let catalogB = CatalogStore(fileURL: homeB.appendingPathComponent("Library/Application Support/Skill Pallet/catalog.json"))
    let promptA = catalogA.updatePrompt(environment: environmentA), promptB = catalogB.updatePrompt(environment: environmentB)
    precondition(catalogA.fileURL != catalogB.fileURL)
    precondition(promptA.contains("\"~/Library/Application Support/Skill Pallet/catalog.json\""))
    precondition(promptB.contains("\"~/Library/Application Support/Skill Pallet/catalog.json\""))
    precondition(promptA.contains("\"~/Applications/Skill Pallet.app/Contents/MacOS/SkillPalette\""))
    precondition(promptB.contains("\"/Applications/Skill Pallet.app/Contents/MacOS/SkillPalette\""))
    precondition(!promptA.contains(homeA.path) && !promptB.contains(homeB.path))
    let outsideHome = URL(fileURLWithPath: homeA.path + "-other/catalog.json")
    precondition(environmentA.quotedPath(outsideHome).hasPrefix("\"/Users/"), "Only a complete home-directory boundary may be abbreviated")
    let unusualPath = homeA.appendingPathComponent("Documents/日本語 \"quoted\" \\ folder/catalog.json")
    let quotedUnusual = environmentA.quotedPath(unusualPath)
    let decodedUnusual = try! JSONDecoder().decode(String.self, from: Data(quotedUnusual.utf8))
    precondition(decodedUnusual == "~" + String(unusualPath.path.dropFirst(homeA.path.count)))
    precondition(!quotedUnusual.contains("\\/"))
    precondition(prompt.contains("アトミック") && prompt.contains("バックアップ") && prompt.contains("invocationとsourceは維持"))
    model.requestCatalogUpdate()
    precondition(paste.texts == [prompt] && !model.inserting && !model.error)
    precondition(model.status.contains("送信してください"))
    precondition(!FileManager.default.fileExists(atPath: usage.fileURL.path), "Updating a catalog is not a skill use")
    paste.delay = true
    model.requestCatalogUpdate(); model.requestCatalogUpdate()
    precondition(paste.texts.count == 2 && model.inserting)
    paste.pending?(.failure(InsertionError.noApp)); paste.pending = nil
    precondition(!model.inserting && model.error)
    precondition(!FileManager.default.fileExists(atPath: usage.fileURL.path))
    paste.delay = false

    write([first, second]); model.refresh()
    precondition(model.skills.count == 2 && !model.catalogMissing && model.catalogError.isEmpty)
    precondition(model.skills[0].genres == ["audio", "video"] && model.skills[0].tags.contains("木"))
    let good = try! Data(contentsOf: store.fileURL)
    precondition((try! Data(contentsOf: store.lastValidURL)) == good)
    model.toggleFavorite(first); model.insert(first)
    precondition(model.favorites.contains(first.id) && model.usageCounts[first.usageKey] == 1)
    let usageBefore = try! Data(contentsOf: usage.fileURL)
    try! Data("{\"skills\":[".utf8).write(to: store.fileURL, options: .atomic)
    model.refresh()
    precondition(model.error && !model.catalogError.isEmpty && model.skills.count == 2)
    precondition((try! Data(contentsOf: store.lastValidURL)) == good, "Invalid JSON must not replace the last valid catalog")
    precondition((try! Data(contentsOf: store.fileURL)) != good, "The app must not silently overwrite the editor's file")
    let recovered = PaletteModel(inserter: paste, usageStore: usage, catalogStore: store, monitorCatalog: false, preferences: preferences)
    precondition(recovered.skills.count == 2 && recovered.error && recovered.favorites.contains(first.id))
    precondition(recovered.usageCounts[first.usageKey] == 1)

    let moved = Skill(id: "/tmp/new-plugin-version/SKILL.md", name: first.name, summary: first.summary, description: first.description,
                      source: first.source, invocation: first.invocation, genres: ["image", "video"], tags: ["横断", "新しいタグ"])
    write([moved, second]); model.refresh()
    precondition(model.catalogError.isEmpty && !model.error && model.skills[0].tags.contains("新しいタグ"))
    precondition(model.favorites.contains(moved.id) && !model.favorites.contains(first.id))
    precondition(model.usageCounts[moved.usageKey] == 1 && (try! Data(contentsOf: usage.fileURL)) == usageBefore)
    let reopened = PaletteModel(inserter: paste, usageStore: usage, catalogStore: store, monitorCatalog: false, preferences: preferences)
    precondition(reopened.favorites.contains(moved.id) && reopened.usageCounts[moved.usageKey] == 1)
    reopened.toggleFavorite(moved)
    let unfavorited = PaletteModel(inserter: paste, usageStore: usage, catalogStore: store, monitorCatalog: false, preferences: preferences)
    precondition(!unfavorited.favorites.contains(moved.id), "A removed favorite must not return through legacy migration")
    let legacyName = suite + ".legacy", legacyPreferences = UserDefaults(suiteName: legacyName)!
    defer { legacyPreferences.removePersistentDomain(forName: legacyName) }
    legacyPreferences.set([second.id], forKey: "favorites")
    let legacyModel = PaletteModel(inserter: paste, usageStore: usage, catalogStore: store, monitorCatalog: false, preferences: legacyPreferences)
    precondition(legacyModel.favorites.contains(second.id))
    precondition(legacyPreferences.stringArray(forKey: "favoriteIdentitiesV1") == [second.usageKey])

    invalid(try! encoder.encode(Catalog(schemaVersion: 2, skills: [first])))
    invalid(try! encoder.encode(Catalog(skills: [first, first])))
    let duplicateIdentity = Skill(id: "/tmp/another-location/SKILL.md", name: first.name, summary: first.summary, description: first.description,
                                  source: first.source, invocation: first.invocation, genres: first.genres, tags: first.tags)
    invalid(try! encoder.encode(Catalog(skills: [first, duplicateIdentity])))
    let unknownGenre = Skill(id: first.id, name: first.name, summary: first.summary, description: first.description,
                             source: first.source, invocation: first.invocation, genres: ["unknown"], tags: [])
    invalid(try! encoder.encode(Catalog(skills: [unknownGenre])))
    let multilineCommand = Skill(id: first.id, name: first.name, summary: first.summary, description: first.description,
                                 source: first.source, invocation: "wood-a\nsecond", genres: first.genres, tags: [])
    invalid(try! encoder.encode(Catalog(skills: [multilineCommand])))
    invalid(Data(repeating: 0, count: CatalogStore.maximumBytes + 1))

    let watched = PaletteModel(inserter: paste, usageStore: usage, catalogStore: store, preferences: preferences)
    write([second])
    let deadline = Date().addingTimeInterval(3)
    while watched.skills.count != 1 && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.03))
    }
    precondition(watched.skills.count == 1 && watched.skills.first?.id == second.id, "Atomic catalog replacement must refresh without a restart")
    precondition((try! Data(contentsOf: usage.fileURL)) == usageBefore)
    if Bundle.main.bundleIdentifier == "com.kaido.skillpalette" {
        for (name, ext) in [("catalog", "json"), ("catalog", "py"), ("sources", "json"), ("summaries", "json")] {
            precondition(Bundle.main.url(forResource: name, withExtension: ext) == nil, "Personal catalog resources must stay outside the app")
        }
        precondition(Bundle.main.resourceURL.map { !FileManager.default.fileExists(atPath: $0.appendingPathComponent("UI/grid/skills-data.js").path) } == true)
    }
    print("PASS: external catalogs validate, recover after restart and reload after atomic replacement")
    print("PASS: catalog prompts use the paste service without counting skill use or double-pasting while busy")
    print("PASS: tags and cross-genre metadata reload; usage and favorites survive skill path changes and restart")
    print("PASS: prompt paths follow the runtime home and application location; normal slashes and quoted paths round-trip")
}
