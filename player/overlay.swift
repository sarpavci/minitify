import Cocoa

// The floating mini-player. Every value here comes from the approved
// design's AppKit handoff strip; see docs/design for the source.
enum OverlayMetrics {
    static let panelSize = NSSize(width: 380, height: 76)
    static let cornerRadius: CGFloat = 16
    static let inset: CGFloat = 10
    static let columnGap: CGFloat = 10
    static let artworkSize: CGFloat = 56
    static let artworkRadius: CGFloat = 8

    static let transportSize: CGFloat = 32
    static let transportGap: CGFloat = 4
    static let transportSymbol: CGFloat = 13

    static let secondarySize: CGFloat = 24
    static let secondaryGap: CGFloat = 4
    static let secondarySymbol: CGFloat = 12

    static let clusterGap: CGFloat = 8
    static let dismissSize: CGFloat = 18
    static let dismissSymbol: CGFloat = 9

    // 8pt, then a hairline, then 7.5pt.
    static let dismissLead: CGFloat = 8
    static let hairline: CGFloat = 0.5
    static let dismissTrail: CGFloat = 7.5

    static let titleSize: CGFloat = 13
    static let artistSize: CGFloat = 11
}

/// Borderless, non-activating panel: clicking it must never steal focus
/// from whatever the user is actually working in.
final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    init() {
        super.init(
            contentRect: NSRect(origin: .zero, size: OverlayMetrics.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .floating
        // Follow the user across desktops and sit above full-screen apps.
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        isMovableByWindowBackground = true
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
    }
}

/// A control that reports its presses by name and never takes focus.
final class SymbolButton: NSButton {
    let action_: String
    private let pointSize: CGFloat
    private var hovering = false
    private var trackingAreaRef: NSTrackingArea?

    var isActive = false { didSet { refresh() } }
    var baseAlpha: CGFloat = 1 { didSet { refresh() } }
    var hoverAlpha: CGFloat = 1
    var hoverFill: CGFloat = 0.18
    var tintWhenActive = false

    init(symbol: String, accessibility: String, action: String, size: CGFloat, pointSize: CGFloat) {
        self.action_ = action
        self.pointSize = pointSize
        super.init(frame: NSRect(x: 0, y: 0, width: size, height: size))

        isBordered = false
        bezelStyle = .regularSquare
        imagePosition = .imageOnly
        refusesFirstResponder = true
        wantsLayer = true
        layer?.cornerRadius = 4
        setAccessibilityLabel(accessibility)
        setSymbol(symbol)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func setSymbol(_ name: String) {
        let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .semibold)
        image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(config)
        refresh()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = trackingAreaRef { removeTrackingArea(existing) }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self
        )
        addTrackingArea(area)
        trackingAreaRef = area
    }

    override func mouseEntered(with event: NSEvent) {
        hovering = true
        refresh()
    }

    override func mouseExited(with event: NSEvent) {
        hovering = false
        refresh()
    }

    private func refresh() {
        let tint: NSColor = (tintWhenActive && isActive) ? .systemGreen : .labelColor
        contentTintColor = tint
        alphaValue = hovering ? hoverAlpha : baseAlpha
        layer?.backgroundColor = hovering
            ? NSColor.labelColor.withAlphaComponent(hoverFill).cgColor
            : NSColor.clear.cgColor
    }
}

final class OverlayController {
    private let panel = OverlayPanel()
    private let artwork = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let artistLabel = NSTextField(labelWithString: "")
    private var buttons: [SymbolButton] = []
    private var playPause: SymbolButton!
    private var shuffleButton: SymbolButton!
    private var repeatButton: SymbolButton!
    private var artworkTask: URLSessionDataTask?
    private var artworkURL: String?

    private let onAction: (String) -> Void

    init(onAction: @escaping (String) -> Void) {
        self.onAction = onAction
        build()
        restorePosition()
    }

    var isVisible: Bool { panel.isVisible }

    func show() {
        panel.orderFrontRegardless()
    }

    func hide() {
        savePosition()
        panel.orderOut(nil)
    }

    // MARK: building

    private func build() {
        let container = NSVisualEffectView(frame: NSRect(origin: .zero, size: OverlayMetrics.panelSize))
        container.material = .hudWindow
        container.blendingMode = .behindWindow
        container.state = .active
        container.wantsLayer = true
        container.layer?.cornerRadius = OverlayMetrics.cornerRadius
        container.layer?.masksToBounds = true
        container.layer?.borderWidth = OverlayMetrics.hairline
        container.layer?.borderColor = NSColor.white.withAlphaComponent(0.4).cgColor

        artwork.frame = NSRect(
            x: OverlayMetrics.inset,
            y: (OverlayMetrics.panelSize.height - OverlayMetrics.artworkSize) / 2,
            width: OverlayMetrics.artworkSize,
            height: OverlayMetrics.artworkSize
        )
        artwork.wantsLayer = true
        artwork.layer?.cornerRadius = OverlayMetrics.artworkRadius
        artwork.layer?.masksToBounds = true
        artwork.imageScaling = .scaleProportionallyUpOrDown
        showArtworkPlaceholder()
        container.addSubview(artwork)

        titleLabel.font = .systemFont(ofSize: OverlayMetrics.titleSize, weight: .semibold)
        titleLabel.textColor = .labelColor
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.maximumNumberOfLines = 1

        artistLabel.font = .systemFont(ofSize: OverlayMetrics.artistSize, weight: .regular)
        artistLabel.textColor = .secondaryLabelColor
        artistLabel.lineBreakMode = .byTruncatingTail
        artistLabel.maximumNumberOfLines = 1

        container.addSubview(titleLabel)
        container.addSubview(artistLabel)

        shuffleButton = makeButton("shuffle", "Shuffle", "shuffle",
                                   OverlayMetrics.secondarySize, OverlayMetrics.secondarySymbol)
        shuffleButton.tintWhenActive = true
        shuffleButton.baseAlpha = 0.85
        shuffleButton.hoverAlpha = 1

        repeatButton = makeButton("repeat", "Repeat", "repeat",
                                  OverlayMetrics.secondarySize, OverlayMetrics.secondarySymbol)
        repeatButton.tintWhenActive = true
        repeatButton.baseAlpha = 0.85
        repeatButton.hoverAlpha = 1

        let previous = makeButton("backward.fill", "Previous track", "previous",
                                  OverlayMetrics.transportSize, OverlayMetrics.transportSymbol)
        playPause = makeButton("pause.fill", "Play or pause", "toggle",
                               OverlayMetrics.transportSize, OverlayMetrics.transportSymbol)
        playPause.hoverFill = 0.25
        let next = makeButton("forward.fill", "Next track", "next",
                              OverlayMetrics.transportSize, OverlayMetrics.transportSymbol)

        let dismiss = makeButton("xmark", "Hide overlay", "close",
                                 OverlayMetrics.dismissSize, OverlayMetrics.dismissSymbol)
        dismiss.baseAlpha = 0.42
        dismiss.hoverAlpha = 0.80
        dismiss.hoverFill = 0.08
        dismiss.toolTip = "Hide overlay"

        let hairline = NSView()
        hairline.wantsLayer = true
        hairline.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.18).cgColor

        // Laid out from the trailing edge inwards, so the text column takes
        // whatever is left.
        var x = OverlayMetrics.panelSize.width - OverlayMetrics.inset - OverlayMetrics.dismissSize
        place(dismiss, at: x, size: OverlayMetrics.dismissSize, in: container)

        x -= OverlayMetrics.dismissTrail + OverlayMetrics.hairline
        hairline.frame = NSRect(x: x, y: 20, width: OverlayMetrics.hairline, height: 36)
        container.addSubview(hairline)

        x -= OverlayMetrics.dismissLead + OverlayMetrics.secondarySize
        place(repeatButton, at: x, size: OverlayMetrics.secondarySize, in: container)

        x -= OverlayMetrics.secondaryGap + OverlayMetrics.secondarySize
        place(shuffleButton, at: x, size: OverlayMetrics.secondarySize, in: container)

        x -= OverlayMetrics.clusterGap + OverlayMetrics.transportSize
        place(next, at: x, size: OverlayMetrics.transportSize, in: container)

        x -= OverlayMetrics.transportGap + OverlayMetrics.transportSize
        place(playPause, at: x, size: OverlayMetrics.transportSize, in: container)

        x -= OverlayMetrics.transportGap + OverlayMetrics.transportSize
        place(previous, at: x, size: OverlayMetrics.transportSize, in: container)

        let textLeft = OverlayMetrics.inset + OverlayMetrics.artworkSize + OverlayMetrics.columnGap
        let textWidth = max(40, x - OverlayMetrics.clusterGap - textLeft)
        titleLabel.frame = NSRect(x: textLeft, y: 38, width: textWidth, height: 19.5)
        artistLabel.frame = NSRect(x: textLeft, y: 20, width: textWidth, height: 16.5)

        panel.contentView = container
    }

    private func place(_ button: SymbolButton, at x: CGFloat, size: CGFloat, in parent: NSView) {
        button.frame = NSRect(
            x: x,
            y: (OverlayMetrics.panelSize.height - size) / 2,
            width: size,
            height: size
        )
        parent.addSubview(button)
    }

    private func makeButton(_ symbol: String, _ label: String, _ action: String,
                            _ size: CGFloat, _ pointSize: CGFloat) -> SymbolButton {
        let button = SymbolButton(symbol: symbol, accessibility: label,
                                  action: action, size: size, pointSize: pointSize)
        button.target = self
        button.action = #selector(buttonPressed(_:))
        buttons.append(button)
        return button
    }

    @objc private func buttonPressed(_ sender: SymbolButton) {
        onAction(sender.action_)
    }

    // MARK: state

    func apply(_ message: [String: Any]) {
        let playing = message["playing"] as? Bool ?? false
        titleLabel.stringValue = message["title"] as? String ?? ""
        artistLabel.stringValue = message["artist"] as? String ?? ""
        titleLabel.toolTip = titleLabel.stringValue
        playPause.setSymbol(playing ? "pause.fill" : "play.fill")

        // Paused dims the artwork and metadata rather than changing layout.
        artwork.alphaValue = playing ? 1.0 : 0.70
        titleLabel.alphaValue = playing ? 1.0 : 0.78
        artistLabel.alphaValue = playing ? 1.0 : 0.78

        shuffleButton.isActive = message["shuffle"] as? Bool ?? false

        let repeatMode = message["repeat"] as? String ?? "off"
        repeatButton.isActive = repeatMode != "off"
        repeatButton.setSymbol(repeatMode == "track" ? "repeat.1" : "repeat")

        loadArtwork(message["artworkUrl"] as? String)
    }

    private func showArtworkPlaceholder() {
        let config = NSImage.SymbolConfiguration(pointSize: 20, weight: .semibold)
        artwork.image = NSImage(systemSymbolName: "music.note", accessibilityDescription: nil)?
            .withSymbolConfiguration(config)
        artwork.contentTintColor = .quaternaryLabelColor
        artwork.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.06).cgColor
    }

    private func loadArtwork(_ urlString: String?) {
        guard let urlString, let url = URL(string: urlString) else {
            artworkURL = nil
            showArtworkPlaceholder()
            return
        }
        guard urlString != artworkURL else { return }   // same cover, no refetch
        artworkURL = urlString

        artworkTask?.cancel()
        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data, let image = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                guard self.artworkURL == urlString else { return }   // a newer track won
                self.artwork.contentTintColor = nil
                self.artwork.layer?.backgroundColor = NSColor.clear.cgColor
                self.artwork.image = image
            }
        }
        artworkTask?.resume()
    }

    // MARK: position

    private static let positionKey = "overlayOrigin"

    private func savePosition() {
        let origin = panel.frame.origin
        UserDefaults.standard.set(
            ["x": origin.x, "y": origin.y],
            forKey: Self.positionKey
        )
    }

    private func restorePosition() {
        if let saved = UserDefaults.standard.dictionary(forKey: Self.positionKey),
           let x = saved["x"] as? CGFloat, let y = saved["y"] as? CGFloat {
            panel.setFrameOrigin(NSPoint(x: x, y: y))
            return
        }
        // First run: bottom-centre of the main screen, clear of the Dock.
        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(
                x: frame.midX - OverlayMetrics.panelSize.width / 2,
                y: frame.minY + 24
            ))
        }
    }

    func persistPosition() {
        guard panel.isVisible else { return }
        savePosition()
    }
}
