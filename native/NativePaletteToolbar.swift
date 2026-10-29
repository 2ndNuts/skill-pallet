import AppKit
import Combine

@MainActor private final class ToolbarWordmark: NSImageView {
    override var mouseDownCanMoveWindow: Bool { true }
}

@MainActor final class NativePaletteToolbar: NSObject, NSToolbarDelegate {
    private static let brandID = NSToolbarItem.Identifier("SkillPallet.Brand")
    private static let controlsID = NSToolbarItem.Identifier("SkillPallet.Controls")
    let toolbar = NSToolbar(identifier: "SkillPallet.UnifiedHeader")
    private let model: PaletteModel
    private let logo = ToolbarWordmark()
    private let refresh = NSButton()
    private let format = NSPopUpButton(frame: .zero, pullsDown: false)
    private let sound = NSButton()
    private let pin = NSButton()
    private let permission = NSButton(title: "許可", target: nil, action: nil)
    private var controls: NSStackView!
    private var updates: AnyCancellable?

    init(model: PaletteModel, window: NSWindow) {
        self.model = model
        super.init()

        if let url = Bundle.main.url(forResource: "Wordmark", withExtension: "png") {
            logo.image = NSImage(contentsOf: url)
            logo.image?.size = NSSize(width: 108, height: 108.0 * 396.0 / 1917.0)
        }
        logo.frame = NSRect(x: 0, y: 0, width: 108, height: 24)
        logo.imageScaling = .scaleProportionallyUpOrDown
        logo.setAccessibilityLabel("Skill Pallet")
        logo.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([logo.widthAnchor.constraint(equalToConstant: 108), logo.heightAnchor.constraint(equalToConstant: 24)])

        configure(refresh, symbol: "arrow.clockwise", label: "Codexにカタログ更新を依頼", action: #selector(refreshCatalog), width: 22)
        configure(sound, symbol: "speaker.slash", label: "操作音の音量", action: #selector(cycleSoundVolume), width: 22)
        configure(pin, symbol: "pin", label: "最前面に固定", action: #selector(togglePin), width: 22)
        pin.setButtonType(.pushOnPushOff)
        configure(permission, symbol: nil, label: "Codexへの入力を有効にする", action: #selector(requestPermission), width: 30)
        format.controlSize = .small
        format.font = .systemFont(ofSize: 11)
        for option in InputFormat.allCases {
            format.addItem(withTitle: option == .slash ? "/" : option == .dollar ? "$" : "参照")
            format.lastItem?.representedObject = option.rawValue
        }
        format.target = self; format.action = #selector(changeFormat)
        format.toolTip = "入力形式"; format.setAccessibilityLabel("入力形式")
        format.translatesAutoresizingMaskIntoConstraints = false
        format.widthAnchor.constraint(equalToConstant: 44).isActive = true

        controls = NSStackView(views: [refresh, format, sound, pin, permission])
        controls.orientation = .horizontal; controls.alignment = .centerY; controls.spacing = 4
        controls.setAccessibilityLabel("パレットの操作")

        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        toolbar.autosavesConfiguration = false
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.toolbarStyle = .unifiedCompact
        window.toolbar = toolbar
        update()
        updates = model.objectWillChange.sink { [weak self] in
            DispatchQueue.main.async { self?.update() }
        }
    }

    private func configure(_ button: NSButton, symbol: String?, label: String, action: Selector, width: CGFloat) {
        button.controlSize = .small; button.bezelStyle = .texturedRounded
        button.isBordered = false
        button.font = .systemFont(ofSize: 10)
        if let symbol {
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
            button.imagePosition = .imageOnly
        }
        button.target = self; button.action = action; button.toolTip = label
        button.contentTintColor = NSColor(srgbRed: 80/255, green: 55/255, blue: 41/255, alpha: 1)
        button.setAccessibilityLabel(label)
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([button.widthAnchor.constraint(equalToConstant: width), button.heightAnchor.constraint(equalToConstant: 24)])
    }

    private func update() {
        refresh.isEnabled = !model.loading && !model.inserting
        format.selectItem(at: InputFormat.allCases.firstIndex(of: model.format) ?? 0)
        let volume = model.soundVolume
        sound.title = ""
        sound.image = NSImage(systemSymbolName: volume.symbol, accessibilityDescription: "操作音の音量")
        sound.toolTip = "音量：\(volume.label)\(volume == .loud ? "（標準より約6dB大きい）" : "")。クリックで\(volume.next.label)へ切り替えます。"
        sound.setAccessibilityLabel("操作音の音量：\(volume.label)")
        sound.setAccessibilityValue(volume.label)
        pin.state = model.pinned ? .on : .off
        pin.image = NSImage(systemSymbolName: model.pinned ? "pin.fill" : "pin", accessibilityDescription: "最前面に固定")
        pin.toolTip = model.pinned ? "最前面への固定を解除" : "最前面に固定"
        pin.setAccessibilityValue(model.pinned ? "ON" : "OFF")
        permission.isHidden = model.trusted
    }

    @objc private func refreshCatalog() { model.requestCatalogUpdate() }
    @objc private func changeFormat() {
        guard let value = format.selectedItem?.representedObject as? String, let selection = InputFormat(rawValue: value) else { return }
        model.selectFormat(selection)
    }
    @objc private func cycleSoundVolume() { model.selectSoundVolume(model.soundVolume.next) }
    @objc private func togglePin() { model.selectPinned(!model.pinned) }
    @objc private func requestPermission() { model.requestPermission() }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [Self.brandID, .flexibleSpace, Self.controlsID]
    }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.isBordered = false
        switch identifier {
        case Self.brandID:
            item.view = logo; item.label = "Skill Pallet"
            item.visibilityPriority = .init(rawValue: 1500)
        case Self.controlsID:
            item.view = controls; item.label = "パレットの操作"
            item.visibilityPriority = .high
        default: return nil
        }
        return item
    }
}
