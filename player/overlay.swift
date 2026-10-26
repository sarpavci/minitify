import Cocoa

/// How much of itself the player is showing. Extended, with the queue,
/// comes later; the cycle is written so adding it is one more case.
enum OverlayMode: String {
    case mini
    case normal

    var next: OverlayMode { self == .mini ? .normal : .mini }
    var body: NSSize { self == .mini ? OverlayMetrics.miniBody : OverlayMetrics.normalBody }

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

final class OverlayController {
    private var mode: OverlayMode = .mini
    private let panel: OverlayPanel

    private let root = NSView()
    private let body = NSVisualEffectView()
    private let strip = NSView()

    private let artwork = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let artistLabel = NSTextField(labelWithString: "")
    private let elapsedLabel = NSTextField(labelWithString: "0:00")
    private let durationLabel = NSTextField(labelWithString: "0:00")
    private let seek = BarView()
    private let volume = BarView()
    private let volumeIcon = NSImageView()

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
    private var revealed = false

    private let onAction: (String, Double?) -> Void

    init(onAction: @escaping (String, Double?) -> Void) {
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
        mode = mode.next
        layout(for: mode, animated: true)
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
        case .normal: layoutNormal(in: size)
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

    private func layoutNormal(in size: NSSize) {
        let inset = OverlayMetrics.richInset
        strip.isHidden = false
        for view in [seek, volume, volumeIcon, elapsedLabel, durationLabel] { view.isHidden = false }
        for button in [shuffleButton!, repeatButton!] { button.isHidden = false }

        strip.frame = NSRect(x: 0, y: 0, width: size.width, height: OverlayMetrics.stripHeight)

        let top = OverlayMetrics.stripHeight
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
        let stripMid = OverlayMetrics.stripHeight / 2
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
        centre.addObserver(forName: NSWindow.didMoveNotification,
                           object: panel, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.placeDetached(for: self.mode)
            self.scheduleClamp()
        }
        centre.addObserver(forName: NSWindow.didChangeScreenNotification,
                           object: panel, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.placeDetached(for: self.mode)
            self.scheduleClamp()
        }
    }

    /// There is no "finished dragging" notification, so settle a moment
    /// after the last move rather than fighting the pointer mid-drag.
    private func scheduleClamp() {
        clampWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.clampToScreen()
            self.placeDetached(for: self.mode)
            self.savePosition()
        }
        clampWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
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

    private func clampToScreen() {
        guard let visible = (panel.screen ?? NSScreen.main)?.visibleFrame else { return }
        var frame = panel.frame
        frame.origin.x = min(max(frame.minX, visible.minX), visible.maxX - frame.width)
        frame.origin.y = min(max(frame.minY, visible.minY), visible.maxY - frame.height)
        if frame != panel.frame { panel.setFrame(frame, display: true) }
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
