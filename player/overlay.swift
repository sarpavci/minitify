import Cocoa

/// How much of itself the player is showing. Extended, with the queue,
/// comes later; the cycle is written so adding it is one more case.
enum OverlayMode: String {
    case mini
    case normal
    case extended

    var next: OverlayMode {
        switch self {
        case .mini: return .normal
        case .normal: return .extended
        case .extended: return .mini
        }
    }

    var body: NSSize {
        switch self {
        case .mini: return OverlayMetrics.miniBody
        case .normal: return OverlayMetrics.normalBody
        case .extended: return OverlayMetrics.extendedBody
        }
    }

    /// Mini and normal offer to grow; extended offers to fold away.
    var glyph: String {
        self == .extended
            ? "arrow.down.right.and.arrow.up.left"
            : "arrow.up.left.and.arrow.down.right"
    }

    /// The rich modes keep a gutter on every side; mini only needs the two
    /// the mode button can live in.
    var gutter: NSEdgeInsets {
        let g = OverlayMetrics.gutter
        return self == .mini
            ? NSEdgeInsets(top: 0, left: g, bottom: 0, right: g)
            : NSEdgeInsets(top: g, left: g, bottom: g, right: g)
    }

    var windowSize: NSSize {
        NSSize(width: body.width + gutter.left + gutter.right,
               height: body.height + gutter.top + gutter.bottom)
    }
}

/// Every value comes from the approved design; see docs/design.md, which is
/// the authority if the two ever disagree.
enum OverlayMetrics {
    static let miniBody = NSSize(width: 320, height: 60)
    static let normalBody = NSSize(width: 440, height: 188)
    static let extendedBody = NSSize(width: 440, height: 424)
    static let cornerRadius: CGFloat = 16
    static let hairline: CGFloat = 0.5

    // The transparent margin the detached buttons live in.
    static let gutter: CGFloat = 36
    static let detachedSize: CGFloat = 28
    static let detachedGap: CGFloat = 8
    static let detachedTop: CGFloat = 16

    static let miniInset: CGFloat = 10
    static let richInset: CGFloat = 20
    static let stripHeight: CGFloat = 76

    static let miniArtwork: CGFloat = 40
    static let miniArtworkRadius: CGFloat = 6
    static let richArtwork: CGFloat = 88
    static let richArtworkRadius: CGFloat = 8
    static let artworkGap: CGFloat = 16

    static let miniTitle: CGFloat = 13
    static let miniArtist: CGFloat = 11
    static let richTitle: CGFloat = 24
    static let richArtist: CGFloat = 13
    static let timeSize: CGFloat = 10

    static let transportSize: CGFloat = 32
    static let transportGap: CGFloat = 4
    static let transportSymbol: CGFloat = 13
    static let primarySize: CGFloat = 48
    static let primarySymbol: CGFloat = 18
    static let secondarySize: CGFloat = 24
    static let secondarySymbol: CGFloat = 12
    static let clusterGap: CGFloat = 16

    // The queue: a 32 pt heading over four 48 pt rows, inset like the rest,
    // and a tail so the last row does not sit on the panel's edge.
    static let queueHeight: CGFloat = 236
    static let queueTail: CGFloat = 12
    static let queueHeading: CGFloat = 32
    static let queueRow: CGFloat = 48
    static let queueArtwork: CGFloat = 32
    static let queueArtworkRadius: CGFloat = 4
    // Four rows: the one playing, then three of what follows.
    static let queueRows = 4
    // The hover band reaches past the content on both sides, so the row is
    // wider than the column and pads its contents back into line.
    static let queueRowPadding: CGFloat = 8
    // Rows arrive after the frame has settled, 40 ms apart.
    static let queueRowDuration: TimeInterval = 0.18
    static let queueFirstDelay: TimeInterval = 0.12
    static let queueStagger: TimeInterval = 0.04

    static let trackThickness: CGFloat = 3
    static let thumbSize: CGFloat = 12
    static let volumeWidth: CGFloat = 64

    // 280 ms on the panel curve, with the arriving controls 90 ms behind.
    static let modeDuration: TimeInterval = 0.28
    static let arrivalDelay: TimeInterval = 0.09
    static let revealDuration: TimeInterval = 0.16
}

/// Borderless, non-activating panel: clicking it must never steal focus
/// from whatever the user is actually working in.
final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    init(size: NSSize) {
        super.init(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        backgroundColor = .clear
        isOpaque = false
        // Drag the panel by its body. Without this the window cannot be
        // moved at all, since it has no title bar to grab.
        isMovableByWindowBackground = true
        // The window server builds the shadow from the alpha channel, so it
        // hugs the rounded body and ignores the transparent gutters. A
        // shadow drawn into the window instead would fill those gutters
        // with pixels — grey where there should be nothing, and solid
        // enough to swallow the clicks that are supposed to pass through.
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
    /// Filled green with a dark glyph, for the primary play button.
    var isPrimary = false { didSet { refresh() } }

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
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        trackingAreaRef = area
    }

    override func mouseEntered(with event: NSEvent) { hovering = true; refresh() }
    override func mouseExited(with event: NSEvent) { hovering = false; refresh() }

    private func refresh() {
        if isPrimary {
            layer?.cornerRadius = bounds.width / 2
            layer?.backgroundColor = NSColor.systemGreen
                .withAlphaComponent(hovering ? 1.0 : 0.92).cgColor
            contentTintColor = .black
            alphaValue = baseAlpha
            return
        }
        layer?.cornerRadius = 4
        contentTintColor = (tintWhenActive && isActive) ? .systemGreen : .labelColor
        alphaValue = hovering ? hoverAlpha : baseAlpha
        layer?.backgroundColor = hovering
            ? NSColor.labelColor.withAlphaComponent(hoverFill).cgColor
            : NSColor.clear.cgColor
    }
}

/// One of the circles that live outside the panel, in the window's
/// transparent gutter.
final class CircleButton: NSButton {
    let action_: String
    private var trackingAreaRef: NSTrackingArea?
    private var hovering = false

    init(symbol: String, accessibility: String, action: String) {
        self.action_ = action
        let size = OverlayMetrics.detachedSize
        super.init(frame: NSRect(x: 0, y: 0, width: size, height: size))

        isBordered = false
        bezelStyle = .regularSquare
        imagePosition = .imageOnly
        refusesFirstResponder = true
        wantsLayer = true
        layer?.cornerRadius = size / 2
        setAccessibilityLabel(accessibility)
        setSymbol(symbol)
        refresh()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func setSymbol(_ name: String) {
        let config = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
        image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(config)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = trackingAreaRef { removeTrackingArea(existing) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        trackingAreaRef = area
    }

    override func mouseEntered(with event: NSEvent) { hovering = true; refresh() }
    override func mouseExited(with event: NSEvent) { hovering = false; refresh() }

    private func refresh() {
        let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let base = dark
            ? NSColor(calibratedWhite: 0.22, alpha: 0.93)
            : NSColor(calibratedWhite: 0.87, alpha: 0.93)
        layer?.backgroundColor = (hovering ? NSColor.systemGreen.withAlphaComponent(0.85) : base).cgColor
        contentTintColor = hovering ? .black : .labelColor
        // No layer shadow: it would paint into the gutter around the
        // circle, and the gutter has to stay empty for clicks to fall
        // through it. The window's own shadow already follows this shape.
    }
}

/// A 3 pt track with a 12 pt thumb. Written rather than wrestled out of
/// NSSliderCell because the design pins every dimension and the drag has
/// to report continuously.
final class BarView: NSView {
    var value: Double = 0 { didSet { needsDisplay = true } }
    var onScrub: ((Double) -> Void)?
    var onCommit: ((Double) -> Void)?
    private var dragging = false

    override var isFlipped: Bool { false }

    /// A plain NSView lets a drag through to the window. This one is being
    /// dragged itself, so the panel must stay where it is.
    override var mouseDownCanMoveWindow: Bool { false }

    override func draw(_ dirty: NSRect) {
        let mid = bounds.midY
        let track = NSRect(x: 0, y: mid - OverlayMetrics.trackThickness / 2,
                           width: bounds.width, height: OverlayMetrics.trackThickness)
        let radius = OverlayMetrics.trackThickness / 2

        NSColor.labelColor.withAlphaComponent(0.18).setFill()
        NSBezierPath(roundedRect: track, xRadius: radius, yRadius: radius).fill()

        let filled = NSRect(x: 0, y: track.minY,
                            width: bounds.width * CGFloat(min(max(value, 0), 1)),
                            height: track.height)
        NSColor.systemGreen.setFill()
        NSBezierPath(roundedRect: filled, xRadius: radius, yRadius: radius).fill()

        guard dragging else { return }
        let size = OverlayMetrics.thumbSize
        let thumb = NSRect(x: filled.maxX - size / 2, y: mid - size / 2, width: size, height: size)
        NSColor.white.setFill()
        NSBezierPath(ovalIn: thumb).fill()
    }

    private func fraction(for event: NSEvent) -> Double {
        let x = convert(event.locationInWindow, from: nil).x
        return Double(min(max(x / max(bounds.width, 1), 0), 1))
    }

    override func mouseDown(with event: NSEvent) {
        dragging = true
        value = fraction(for: event)
        onScrub?(value)
    }

    override func mouseDragged(with event: NSEvent) {
        value = fraction(for: event)
        onScrub?(value)
    }

    override func mouseUp(with event: NSEvent) {
        dragging = false
        value = fraction(for: event)
        needsDisplay = true
        onCommit?(value)
    }
}

/// An NSControl swallows the click that would otherwise drag the window —
/// isMovableByWindowBackground only acts when the view under the pointer
/// says it may. Artwork and labels are decoration, so they let it through.
final class DragThroughImageView: NSImageView {
    override var mouseDownCanMoveWindow: Bool { true }
}

final class DragThroughLabel: NSTextField {
    override var mouseDownCanMoveWindow: Bool { true }
}

/// One line of what is coming: artwork, title over artist, duration.
final class QueueRow: NSView {
    private let cover = DragThroughImageView()
    private let title = DragThroughLabel(labelWithString: "")
    private let artist = DragThroughLabel(labelWithString: "")
    private let time = DragThroughLabel(labelWithString: "")
    private let marker = DragThroughImageView()
    private var trackingAreaRef: NSTrackingArea?
    private var hovering = false

    /// The track this row stands for, and what to do about a click on it.
    private(set) var uri: String?
    var onPlay: ((String) -> Void)?
    var isPlaying = false { didSet { restyle() } }

    // A click here starts a track, so it must not drag the panel.
    override var mouseDownCanMoveWindow: Bool { false }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = trackingAreaRef { removeTrackingArea(existing) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self)
        addTrackingArea(area)
        trackingAreaRef = area
    }

    override func mouseEntered(with event: NSEvent) { hovering = true; restyle() }
    override func mouseExited(with event: NSEvent) { hovering = false; restyle() }

    override func mouseUp(with event: NSEvent) {
        guard let uri, !isPlaying, bounds.contains(convert(event.locationInWindow, from: nil))
        else { return }
        onPlay?(uri)
    }

    private func restyle() {
        title.textColor = isPlaying ? .systemGreen : .labelColor
        marker.isHidden = !isPlaying
        layer?.backgroundColor = (hovering && !isPlaying)
            ? NSColor.labelColor.withAlphaComponent(0.06).cgColor
            : NSColor.clear.cgColor
    }

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 6
        cover.wantsLayer = true
        cover.layer?.cornerRadius = OverlayMetrics.queueArtworkRadius
        cover.layer?.masksToBounds = true
        cover.imageScaling = .scaleProportionallyUpOrDown
        addSubview(cover)

        title.font = .systemFont(ofSize: 12, weight: .medium)
        title.textColor = .labelColor
        artist.font = .systemFont(ofSize: 10, weight: .regular)
        artist.textColor = .secondaryLabelColor
        time.font = .monospacedDigitSystemFont(ofSize: 10, weight: .regular)
        time.textColor = .secondaryLabelColor
        time.alignment = .right
        for label in [title, artist, time] {
            label.lineBreakMode = .byTruncatingTail
            label.maximumNumberOfLines = 1
            addSubview(label)
        }

        marker.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Playing")?
            .withSymbolConfiguration(.init(pointSize: 11, weight: .semibold))
        marker.contentTintColor = .systemGreen
        marker.isHidden = true
        addSubview(marker)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layout() {
        super.layout()
        let art = OverlayMetrics.queueArtwork
        let gap: CGFloat = 10
        let timeWidth: CGFloat = 34
        let pad = OverlayMetrics.queueRowPadding
        cover.frame = NSRect(x: pad, y: (bounds.height - art) / 2, width: art, height: art)
        let textX = pad + art + gap
        let textWidth = bounds.width - textX - timeWidth - gap - pad
        title.frame = NSRect(x: textX, y: bounds.midY, width: textWidth, height: 16)
        artist.frame = NSRect(x: textX, y: bounds.midY - 15, width: textWidth, height: 13)
        time.frame = NSRect(x: bounds.width - timeWidth - pad, y: bounds.midY - 6,
                            width: timeWidth, height: 13)
        marker.frame = NSRect(x: cover.frame.maxX - 14, y: cover.frame.minY,
                              width: 14, height: 14)
    }

    private var coverURL: String?
    private var coverTask: URLSessionDataTask?

    func show(name: String, by who: String, lasting ms: Double,
              artwork urlString: String?, uri trackUri: String?) {
        uri = trackUri
        title.stringValue = name
        title.toolTip = name
        artist.stringValue = who
        let total = Int(max(ms, 0) / 1000)
        time.stringValue = String(format: "%d:%02d", total / 60, total % 60)
        loadCover(urlString)
    }

    private func placeholder() {
        cover.image = NSImage(systemSymbolName: "music.note", accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 12, weight: .semibold))
        cover.contentTintColor = .quaternaryLabelColor
        cover.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.06).cgColor
    }

    private func loadCover(_ urlString: String?) {
        guard let urlString, let url = URL(string: urlString) else {
            coverURL = nil
            coverTask?.cancel()
            placeholder()
            return
        }
        // Rows are reused as the queue moves, so the same cover is usually
        // already here.
        guard urlString != coverURL else { return }
        coverURL = urlString
        coverTask?.cancel()
        placeholder()
        coverTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, self.coverURL == urlString else { return }
                self.cover.image = image
                self.cover.contentTintColor = nil
                self.cover.layer?.backgroundColor = NSColor.clear.cgColor
            }
        }
        coverTask?.resume()
    }
}

final class OverlayController {
    private var mode: OverlayMode = .mini
    private let panel: OverlayPanel

    private let root = NSView()
    private let body = NSVisualEffectView()
    private let strip = NSView()
    private let queue = NSView()
    private let queueHeading = DragThroughLabel(labelWithString: "UP NEXT")
    private let emptyIcon = DragThroughImageView()
    private let emptyTitle = DragThroughLabel(labelWithString: "")
    private let emptyDetail = DragThroughLabel(labelWithString: "")
    private var queueRows: [QueueRow] = []
    private var upcoming: [[String: Any]] = []

    private let artwork = DragThroughImageView()
    private let titleLabel = DragThroughLabel(labelWithString: "")
    private let artistLabel = DragThroughLabel(labelWithString: "")
    private let elapsedLabel = DragThroughLabel(labelWithString: "0:00")
    private let durationLabel = DragThroughLabel(labelWithString: "0:00")
    private let seek = BarView()
    private let volume = BarView()
    private let volumeIcon = DragThroughImageView()

    private var playPause: SymbolButton!
    private var previousButton: SymbolButton!
    private var nextButton: SymbolButton!
    private var shuffleButton: SymbolButton!
    private var repeatButton: SymbolButton!
    private var modeButton: CircleButton!
    private var closeButton: CircleButton!

    private var artworkTask: URLSessionDataTask?
    private var artworkURL: String?
    private var durationMs: Double = 0
    private var scrubbing = false
    private var hoverMonitor: Any?
    private var clampWork: DispatchWorkItem?
    private var clamping = false
    private var revealed = false

    private let onAction: (String, Any?) -> Void

    init(onAction: @escaping (String, Any?) -> Void) {
        self.onAction = onAction
        panel = OverlayPanel(size: OverlayMode.mini.windowSize)
        build()
        layout(for: .mini, animated: false)
        restorePosition()
        watchPointer()
        watchMovement()
    }

    var isVisible: Bool { panel.isVisible }

    func show() { panel.orderFrontRegardless() }

    func hide() {
        savePosition()
        panel.orderOut(nil)
    }

    // MARK: building

    private func build() {
        root.frame = NSRect(origin: .zero, size: OverlayMode.mini.windowSize)
        root.autoresizingMask = [.width, .height]
        panel.contentView = root

        body.material = .hudWindow
        body.blendingMode = .behindWindow
        body.state = .active
        body.wantsLayer = true
        body.layer?.cornerRadius = OverlayMetrics.cornerRadius
        // Clipped, so the material actually takes the corner radius. The
        // shadow is the window's job, not this layer's.
        body.layer?.masksToBounds = true
        body.layer?.borderWidth = OverlayMetrics.hairline
        body.layer?.borderColor = NSColor.white.withAlphaComponent(0.23).cgColor
        root.addSubview(body)

        strip.wantsLayer = true
        strip.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.16).cgColor
        body.addSubview(strip)

        queue.wantsLayer = true
        body.addSubview(queue)

        queueHeading.font = .systemFont(ofSize: 10, weight: .semibold)
        queueHeading.textColor = .secondaryLabelColor
        queue.addSubview(queueHeading)

        emptyIcon.contentTintColor = .quaternaryLabelColor
        emptyTitle.font = .systemFont(ofSize: 13, weight: .medium)
        emptyTitle.textColor = .secondaryLabelColor
        emptyTitle.alignment = .center
        emptyDetail.font = .systemFont(ofSize: 11, weight: .regular)
        emptyDetail.textColor = .tertiaryLabelColor
        emptyDetail.alignment = .center
        emptyDetail.maximumNumberOfLines = 1
        for view in [emptyIcon as NSView, emptyTitle, emptyDetail] { queue.addSubview(view) }

        queueRows = (0..<OverlayMetrics.queueRows).map { _ in
            let row = QueueRow()
            row.onPlay = { [weak self] uri in self?.onAction("jump", uri) }
            queue.addSubview(row)
            return row
        }

        artwork.wantsLayer = true
        artwork.layer?.masksToBounds = true
        artwork.imageScaling = .scaleProportionallyUpOrDown
        showArtworkPlaceholder()
        body.addSubview(artwork)

        titleLabel.textColor = .labelColor
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.maximumNumberOfLines = 1
        artistLabel.textColor = .secondaryLabelColor
        artistLabel.lineBreakMode = .byTruncatingTail
        artistLabel.maximumNumberOfLines = 1
        body.addSubview(titleLabel)
        body.addSubview(artistLabel)

        for label in [elapsedLabel, durationLabel] {
            label.font = .monospacedDigitSystemFont(ofSize: OverlayMetrics.timeSize, weight: .regular)
            label.textColor = .secondaryLabelColor
            body.addSubview(label)
        }
        durationLabel.alignment = .right

        seek.onScrub = { [weak self] _ in self?.scrubbing = true }
        seek.onCommit = { [weak self] fraction in
            guard let self else { return }
            self.scrubbing = false
            guard self.durationMs > 0 else { return }
            self.onAction("seek", fraction * self.durationMs)
        }
        body.addSubview(seek)

        volumeIcon.image = NSImage(systemSymbolName: "speaker.wave.2.fill", accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 11, weight: .semibold))
        volumeIcon.contentTintColor = .secondaryLabelColor
        body.addSubview(volumeIcon)

        volume.value = 1
        volume.onCommit = { [weak self] fraction in self?.onAction("vol", fraction * 100) }
        body.addSubview(volume)

        previousButton = makeButton("backward.fill", "Previous track", "previous",
                                    OverlayMetrics.transportSize, OverlayMetrics.transportSymbol)
        playPause = makeButton("pause.fill", "Play or pause", "toggle",
                               OverlayMetrics.transportSize, OverlayMetrics.transportSymbol)
        nextButton = makeButton("forward.fill", "Next track", "next",
                                OverlayMetrics.transportSize, OverlayMetrics.transportSymbol)
        shuffleButton = makeButton("shuffle", "Shuffle", "shuffle",
                                   OverlayMetrics.secondarySize, OverlayMetrics.secondarySymbol)
        repeatButton = makeButton("repeat", "Repeat", "repeat",
                                  OverlayMetrics.secondarySize, OverlayMetrics.secondarySymbol)
        shuffleButton.tintWhenActive = true
        repeatButton.tintWhenActive = true
        for button in [shuffleButton!, repeatButton!] { button.baseAlpha = 0.75 }

        modeButton = CircleButton(symbol: "arrow.up.left.and.arrow.down.right",
                                  accessibility: "Switch mode", action: "mode")
        closeButton = CircleButton(symbol: "xmark", accessibility: "Hide overlay", action: "close")
        for circle in [modeButton!, closeButton!] {
            circle.target = self
            circle.action = #selector(circleTapped(_:))
            circle.alphaValue = 0
            root.addSubview(circle)
        }
    }

    private func makeButton(_ symbol: String, _ label: String, _ action: String,
                            _ size: CGFloat, _ pointSize: CGFloat) -> SymbolButton {
        let button = SymbolButton(symbol: symbol, accessibility: label, action: action,
                                  size: size, pointSize: pointSize)
        button.target = self
        button.action = #selector(buttonTapped(_:))
        body.addSubview(button)
        return button
    }

    @objc private func buttonTapped(_ sender: SymbolButton) { onAction(sender.action_, nil) }

    @objc private func circleTapped(_ sender: CircleButton) {
        if sender.action_ == "mode" { switchMode() } else { onAction(sender.action_, nil) }
    }

    // MARK: modes

    private func switchMode() {
        let previous = mode
        mode = mode.next
        layout(for: mode, animated: true)
        if mode == .extended && previous != .extended { revealQueueRows() }
    }

    private var reduceMotion: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    private func layout(for mode: OverlayMode, animated: Bool) {
        let size = mode.windowSize
        // Keep the panel's top-left corner where it was, so the window
        // grows downward rather than jumping.
        var frame = panel.frame
        frame.origin.y += frame.height - size.height
        frame.size = size

        let apply = {
            self.root.frame = NSRect(origin: .zero, size: size)
            self.placeBody(for: mode)
            self.placeDetached(for: mode)
        }

        if animated && !reduceMotion {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = OverlayMetrics.modeDuration
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.32, 0.72, 0, 1)
                context.allowsImplicitAnimation = true
                panel.setFrame(frame, display: true, animate: false)
                apply()
            }
        } else {
            panel.setFrame(frame, display: true, animate: false)
            apply()
        }
        clampToScreen()
    }

    private func placeBody(for mode: OverlayMode) {
        let gutter = mode.gutter
        let size = mode.body
        body.frame = NSRect(x: gutter.left, y: gutter.bottom, width: size.width, height: size.height)
        // The window shadow is rebuilt from the new alpha mask; telling the
        // server the shape changed is what makes it follow the resize.
        panel.invalidateShadow()

        switch mode {
        case .mini: layoutMini(in: size)
        case .normal: layoutNormal(in: size, above: 0)
        case .extended: layoutNormal(in: size, above: OverlayMetrics.queueHeight)
        }
        layoutQueue(in: size, visible: mode == .extended)
        modeButton.setSymbol(mode.glyph)
    }

    /// The queue sits under the strip, so the panel grows downward and the
    /// controls above it never move.
    private func layoutQueue(in size: NSSize, visible: Bool) {
        queue.isHidden = !visible
        guard visible else { return }

        let inset = OverlayMetrics.richInset
        queue.frame = NSRect(x: 0, y: 0, width: size.width, height: OverlayMetrics.queueHeight)

        // Spotify's order: what is playing, then the heading, then what
        // follows. The first row is the current track and is marked.
        let width = size.width - inset * 2
        let rowHeight = OverlayMetrics.queueRow
        // Rows start a padding earlier and run a padding longer, so their
        // contents land on the same column as everything above them.
        let pad = OverlayMetrics.queueRowPadding
        let rowX = inset - pad
        let rowWidth = width + pad * 2

        let playingY = OverlayMetrics.queueHeight - rowHeight
        queueRows[0].frame = NSRect(x: rowX, y: playingY, width: rowWidth, height: rowHeight)

        let headingY = playingY - OverlayMetrics.queueHeading
        queueHeading.frame = NSRect(x: inset, y: headingY + 9, width: width, height: 14)

        for (index, row) in queueRows.enumerated().dropFirst() {
            let y = headingY - CGFloat(index) * rowHeight
            row.frame = NSRect(x: rowX, y: y, width: rowWidth, height: rowHeight)
        }
    }

    private func layoutMini(in size: NSSize) {
        let inset = OverlayMetrics.miniInset
        strip.isHidden = true
        for view in [seek, volume, volumeIcon, elapsedLabel, durationLabel] { view.isHidden = true }
        for button in [shuffleButton!, repeatButton!] { button.isHidden = true }

        let art = OverlayMetrics.miniArtwork
        artwork.frame = NSRect(x: inset, y: (size.height - art) / 2, width: art, height: art)
        artwork.layer?.cornerRadius = OverlayMetrics.miniArtworkRadius

        let transportWidth = OverlayMetrics.transportSize * 3 + OverlayMetrics.transportGap * 2
        let textX = inset + art + OverlayMetrics.miniInset
        let textWidth = size.width - textX - transportWidth - inset - 8

        titleLabel.font = .systemFont(ofSize: OverlayMetrics.miniTitle, weight: .semibold)
        artistLabel.font = .systemFont(ofSize: OverlayMetrics.miniArtist, weight: .regular)
        titleLabel.frame = NSRect(x: textX, y: size.height / 2, width: textWidth, height: 17)
        artistLabel.frame = NSRect(x: textX, y: size.height / 2 - 16, width: textWidth, height: 14)

        playPause.isPrimary = false
        var x = size.width - inset - transportWidth
        let y = (size.height - OverlayMetrics.transportSize) / 2
        for button in [previousButton!, playPause!, nextButton!] {
            button.setFrameSize(NSSize(width: OverlayMetrics.transportSize,
                                       height: OverlayMetrics.transportSize))
            button.setFrameOrigin(NSPoint(x: x, y: y))
            x += OverlayMetrics.transportSize + OverlayMetrics.transportGap
        }
    }

    /// `above` is how much the queue is taking from the bottom. The player
    /// itself is laid out the same either way, just higher up.
    private func layoutNormal(in size: NSSize, above: CGFloat) {
        let inset = OverlayMetrics.richInset
        strip.isHidden = false
        for view in [seek, volume, volumeIcon, elapsedLabel, durationLabel] { view.isHidden = false }
        for button in [shuffleButton!, repeatButton!] { button.isHidden = false }

        strip.frame = NSRect(x: 0, y: above, width: size.width, height: OverlayMetrics.stripHeight)

        let top = above + OverlayMetrics.stripHeight
        let topHeight = size.height - top
        let art = OverlayMetrics.richArtwork
        // Computed, never read back: this runs inside an animation group
        // with implicit animation on, so artwork.frame would still report
        // where the artwork is coming from rather than where it is going.
        let artBottom = top + (topHeight - art) / 2
        let artTop = artBottom + art
        artwork.frame = NSRect(x: inset, y: artBottom, width: art, height: art)
        artwork.layer?.cornerRadius = OverlayMetrics.richArtworkRadius

        let columnX = inset + art + OverlayMetrics.artworkGap
        let columnWidth = size.width - columnX - inset

        titleLabel.font = .systemFont(ofSize: OverlayMetrics.richTitle, weight: .semibold)
        artistLabel.font = .systemFont(ofSize: OverlayMetrics.richArtist, weight: .regular)
        // The column is centred against the artwork rather than against the
        // section, so the two read as one block however tall the text is.
        titleLabel.frame = NSRect(x: columnX, y: artTop - 32, width: columnWidth, height: 30)
        artistLabel.frame = NSRect(x: columnX, y: artTop - 52, width: columnWidth, height: 17)

        let timeWidth: CGFloat = 32
        let seekHeight: CGFloat = 20
        let seekY = artBottom
        seek.frame = NSRect(x: columnX + timeWidth + 8, y: seekY,
                            width: columnWidth - (timeWidth + 8) * 2, height: seekHeight)
        let timeY = seekY + seekHeight / 2 - 6.5
        elapsedLabel.frame = NSRect(x: columnX, y: timeY, width: timeWidth, height: 13)
        durationLabel.frame = NSRect(x: columnX + columnWidth - timeWidth, y: timeY,
                                     width: timeWidth, height: 13)

        // Bottom strip: transport, then the toggles, with volume trailing.
        playPause.isPrimary = true
        let primary = OverlayMetrics.primarySize
        let stripMid = above + OverlayMetrics.stripHeight / 2
        var x = inset
        previousButton.setFrameSize(NSSize(width: OverlayMetrics.transportSize,
                                           height: OverlayMetrics.transportSize))
        previousButton.setFrameOrigin(NSPoint(x: x, y: stripMid - OverlayMetrics.transportSize / 2))
        x += OverlayMetrics.transportSize + OverlayMetrics.transportGap

        playPause.setFrameSize(NSSize(width: primary, height: primary))
        playPause.setFrameOrigin(NSPoint(x: x, y: stripMid - primary / 2))
        playPause.setSymbol(currentPlaySymbol)
        x += primary + OverlayMetrics.transportGap

        nextButton.setFrameSize(NSSize(width: OverlayMetrics.transportSize,
                                       height: OverlayMetrics.transportSize))
        nextButton.setFrameOrigin(NSPoint(x: x, y: stripMid - OverlayMetrics.transportSize / 2))
        x += OverlayMetrics.transportSize + OverlayMetrics.clusterGap

        for button in [shuffleButton!, repeatButton!] {
            button.setFrameOrigin(NSPoint(x: x, y: stripMid - OverlayMetrics.secondarySize / 2))
            x += OverlayMetrics.secondarySize + OverlayMetrics.transportGap
        }

        let volumeWidth = OverlayMetrics.volumeWidth
        let volumeX = size.width - inset - volumeWidth
        volume.frame = NSRect(x: volumeX, y: stripMid - 10, width: volumeWidth, height: 20)
        volumeIcon.frame = NSRect(x: volumeX - 22, y: stripMid - 8, width: 16, height: 16)
    }

    private var currentPlaySymbol = "pause.fill"

    // MARK: the detached circles

    private func placeDetached(for mode: OverlayMode) {
        let gutter = mode.gutter
        let bodyRect = NSRect(x: gutter.left, y: gutter.bottom,
                              width: mode.body.width, height: mode.body.height)
        let size = OverlayMetrics.detachedSize
        let gap = OverlayMetrics.detachedGap

        // The mode circle takes the side of the panel that still has room:
        // past the screen's midline it swaps rather than travels.
        //
        // Measured from the body, not the window. The window grows to the
        // right when the mode changes, so its centre can cross the midline
        // on a resize alone and flip a button the user never moved.
        let centre = bodyCentreOnScreen(bodyRect)
        let onRight = centre.x < screenMidX()
        modeButton.setFrameOrigin(NSPoint(
            x: onRight ? bodyRect.maxX + gap : bodyRect.minX - gap - size,
            y: bodyRect.maxY - OverlayMetrics.detachedTop - size))

        // Close only exists where there is a gutter to hold it.
        closeButton.isHidden = mode == .mini
        let panelIsHigh = centre.y > screenMidY()
        closeButton.setFrameOrigin(NSPoint(
            x: bodyRect.maxX - size,
            y: panelIsHigh ? bodyRect.minY - gap - size : bodyRect.maxY + gap))
    }

    private func bodyCentreOnScreen(_ bodyRect: NSRect) -> NSPoint {
        let origin = panel.frame.origin
        return NSPoint(x: origin.x + bodyRect.midX, y: origin.y + bodyRect.midY)
    }

    private func screenMidX() -> CGFloat { (panel.screen ?? NSScreen.main)?.visibleFrame.midX ?? 0 }
    private func screenMidY() -> CGFloat { (panel.screen ?? NSScreen.main)?.visibleFrame.midY ?? 0 }

    /// The panel is dragged by its background, which the window server
    /// handles without this code seeing a thing. Nothing would notice the
    /// move, so the circles would stay on whichever side they were built
    /// on and walk off the screen edge with the panel.
    private func watchMovement() {
        let centre = NotificationCenter.default
        let moved: (Notification) -> Void = { [weak self] _ in
            guard let self else { return }
            // Clamp as it happens, not afterwards: the panel should stop at
            // the edge under the pointer rather than be dragged off and
            // snapped back a moment later.
            self.clampToScreen()
            self.placeDetached(for: self.mode)
            self.scheduleSave()
        }
        centre.addObserver(forName: NSWindow.didMoveNotification,
                           object: panel, queue: .main, using: moved)
        centre.addObserver(forName: NSWindow.didChangeScreenNotification,
                           object: panel, queue: .main, using: moved)
    }

    /// There is no "finished dragging" notification, so the position is
    /// written once the moves stop rather than on every frame of a drag.
    private func scheduleSave() {
        clampWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.savePosition() }
        clampWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    /// One region, not three: the panel, the gutters and the circles are a
    /// single hover target, so crossing the empty gap never hides them.
    private func watchPointer() {
        let handler: (NSEvent?) -> Void = { [weak self] _ in self?.updateReveal() }
        hoverMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved], handler: { handler($0) })
        NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved]) { event in handler(event); return event }
    }

    private func updateReveal() {
        guard panel.isVisible else { return }
        let inside = panel.frame.insetBy(dx: -4, dy: -4).contains(NSEvent.mouseLocation)
        guard inside != revealed else { return }
        revealed = inside

        let show = inside
        if reduceMotion {
            modeButton.alphaValue = show ? 1 : 0
            closeButton.alphaValue = show ? 1 : 0
            return
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = OverlayMetrics.revealDuration
            context.timingFunction = CAMediaTimingFunction(
                controlPoints: show ? 0 : 0.4, show ? 0 : 0, show ? 0.2 : 1, 1)
            modeButton.animator().alphaValue = show ? 1 : 0
            closeButton.animator().alphaValue = show ? 1 : 0
        }
    }

    // MARK: state

    func apply(_ message: [String: Any]) {
        let playing = message["playing"] as? Bool ?? false
        titleLabel.stringValue = message["title"] as? String ?? ""
        artistLabel.stringValue = message["artist"] as? String ?? ""
        titleLabel.toolTip = titleLabel.stringValue
        currentPlaySymbol = playing ? "pause.fill" : "play.fill"
        playPause.setSymbol(currentPlaySymbol)

        artwork.alphaValue = playing ? 1.0 : 0.70
        titleLabel.alphaValue = playing ? 1.0 : 0.78
        artistLabel.alphaValue = playing ? 1.0 : 0.78

        shuffleButton.isActive = message["shuffle"] as? Bool ?? false
        let repeatMode = message["repeat"] as? String ?? "off"
        repeatButton.isActive = repeatMode != "off"
        repeatButton.setSymbol(repeatMode == "track" ? "repeat.1" : "repeat")

        durationMs = message["durationMs"] as? Double ?? 0
        let positionMs = message["positionMs"] as? Double ?? 0
        if !scrubbing {
            seek.value = durationMs > 0 ? positionMs / durationMs : 0
        }
        elapsedLabel.stringValue = clock(positionMs)
        durationLabel.stringValue = clock(durationMs)

        loadArtwork(message["artworkUrl"] as? String)

        upcoming = message["queue"] as? [[String: Any]] ?? []
        fillQueue()
    }

    private func fillQueue() {
        // Two different emptinesses, and they do not mean the same thing:
        // nothing is playing at all, or something is and nothing follows.
        let silent = titleLabel.stringValue.isEmpty

        let playing = queueRows[0]
        playing.isHidden = silent
        queueHeading.isHidden = silent
        if !silent {
            playing.isPlaying = true
            playing.show(name: titleLabel.stringValue,
                         by: artistLabel.stringValue,
                         lasting: durationMs,
                         artwork: artworkURL,
                         uri: nil)
            playing.needsLayout = true
        }

        for (index, row) in queueRows.enumerated().dropFirst() {
            let position = index - 1
            guard !silent, position < upcoming.count else {
                row.isHidden = true
                continue
            }
            let track = upcoming[position]
            row.isHidden = false
            row.isPlaying = false
            row.show(name: track["name"] as? String ?? "",
                     by: track["artist"] as? String ?? "",
                     lasting: track["durationMs"] as? Double ?? 0,
                     artwork: track["artworkUrl"] as? String,
                     uri: track["uri"] as? String)
            row.needsLayout = true
        }

        showEmptyState(silent: silent)
    }

    /// Fills the space the rows would have taken with something that says
    /// why they are not there.
    private func showEmptyState(silent: Bool) {
        let nothingFollows = upcoming.isEmpty
        let show = silent || nothingFollows
        for view in [emptyIcon as NSView, emptyTitle, emptyDetail] { view.isHidden = !show }
        guard show else { return }

        let symbol = silent ? "music.note" : "text.line.last.and.arrowtriangle.forward"
        emptyIcon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 22, weight: .regular))
        emptyTitle.stringValue = silent ? "Nothing playing" : "Nothing up next"
        emptyDetail.stringValue = silent
            ? "Run minitify to pick something"
            : "The rest of this context will appear here"

        // Centred in whatever is left: the whole queue when silent, the
        // space under the heading when it is only the queue that is empty.
        let top = silent
            ? OverlayMetrics.queueHeight
            : OverlayMetrics.queueHeight - OverlayMetrics.queueRow - OverlayMetrics.queueHeading
        let area = NSRect(x: 0, y: OverlayMetrics.queueTail,
                          width: queue.bounds.width,
                          height: top - OverlayMetrics.queueTail)
        let block: CGFloat = 22 + 6 + 17 + 2 + 14
        var y = area.midY + block / 2 - 22
        emptyIcon.frame = NSRect(x: area.midX - 11, y: y, width: 22, height: 22)
        y -= 6 + 17
        emptyTitle.frame = NSRect(x: area.minX, y: y, width: area.width, height: 17)
        y -= 2 + 14
        emptyDetail.frame = NSRect(x: area.minX, y: y, width: area.width, height: 14)
    }

    /// The frame has already settled by the time these run, so the rows
    /// arrive into a panel that has stopped moving.
    private func revealQueueRows() {
        guard !reduceMotion else {
            for row in queueRows { row.alphaValue = 1 }
            return
        }
        for (index, row) in queueRows.enumerated() where !row.isHidden {
            row.alphaValue = 0
            let delay = OverlayMetrics.queueFirstDelay
                + Double(index) * OverlayMetrics.queueStagger
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = OverlayMetrics.queueRowDuration
                    context.timingFunction = CAMediaTimingFunction(controlPoints: 0, 0, 0.2, 1)
                    row.animator().alphaValue = 1
                }
            }
        }
    }

    private func clock(_ ms: Double) -> String {
        guard ms.isFinite, ms >= 0 else { return "0:00" }
        let total = Int(ms / 1000)
        return String(format: "%d:%02d", total / 60, total % 60)
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
        guard urlString != artworkURL else { return }
        artworkURL = urlString
        artworkTask?.cancel()
        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, self.artworkURL == urlString else { return }
                self.artwork.image = image
                self.artwork.contentTintColor = nil
                self.artwork.layer?.backgroundColor = NSColor.clear.cgColor
            }
        }
        artworkTask?.resume()
    }

    // MARK: position

    /// The whole window, gutters included — otherwise the circles are the
    /// first thing off the edge, which is exactly where they are needed.
    private func clampToScreen() {
        guard !clamping, let visible = (panel.screen ?? NSScreen.main)?.visibleFrame else { return }
        var frame = panel.frame
        frame.origin.x = min(max(frame.minX, visible.minX), visible.maxX - frame.width)
        frame.origin.y = min(max(frame.minY, visible.minY), visible.maxY - frame.height)
        guard frame != panel.frame else { return }

        // setFrame posts didMove, which lands us back in here.
        clamping = true
        panel.setFrame(frame, display: true)
        clamping = false
    }

    private func savePosition() {
        let origin = panel.frame.origin
        UserDefaults.standard.set(["x": origin.x, "y": origin.y, "mode": mode.rawValue],
                                  forKey: "overlayFrame")
    }

    private func restorePosition() {
        guard let saved = UserDefaults.standard.dictionary(forKey: "overlayFrame") else {
            centreOnScreen()
            return
        }
        if let raw = saved["mode"] as? String, let restored = OverlayMode(rawValue: raw) {
            mode = restored
            layout(for: restored, animated: false)
        }
        if let x = saved["x"] as? CGFloat, let y = saved["y"] as? CGFloat {
            panel.setFrameOrigin(NSPoint(x: x, y: y))
        }
        clampToScreen()
        placeDetached(for: mode)
    }

    private func centreOnScreen() {
        guard let visible = NSScreen.main?.visibleFrame else { return }
        panel.setFrameOrigin(NSPoint(x: visible.midX - panel.frame.width / 2,
                                     y: visible.minY + 120))
    }

    func persistPosition() { savePosition() }
}
