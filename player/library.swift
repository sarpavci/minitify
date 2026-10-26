import Cocoa

/// Every value here comes from the approved design; docs/design.md is the
/// authority if the two ever disagree.
enum LibraryMetrics {
    static let size = NSSize(width: 800, height: 500)
    static let minimum = NSSize(width: 680, height: 360)
    static let header: CGFloat = 64
    static let sidebar: CGFloat = 200
    static let inset: CGFloat = 20

    static let searchHeight: CGFloat = 32
    static let markSize: CGFloat = 22

    static let collectionHeader: CGFloat = 112
    static let collectionArtwork: CGFloat = 88

    static let row: CGFloat = 40
    static let rowGap: CGFloat = 6
    static let rowRadius: CGFloat = 8
    static let rowPadding: CGFloat = 8
    static let rowArtwork: CGFloat = 28
    static let heart: CGFloat = 28
    static let duration: CGFloat = 40
    static let columnGap: CGFloat = 12

    static let sidebarRow: CGFloat = 36
    static let sidebarCover: CGFloat = 32
    static let sidebarFoot: CGFloat = 44

    static let columnHeader: CGFloat = 24
    static let nowStrip: CGFloat = 56
    static let nowCover: CGFloat = 36
    static let listFoot: CGFloat = 34
}

/// The mark, drawn rather than loaded: five bars that spell an M. The
/// geometry is the one frozen in the design lab and recorded in
/// docs/design.md, in its 64 x 64 box, scaled to whatever it is given.
final class MarkView: NSView {
    private static let bars: [(x: CGFloat, height: CGFloat)] = [
        (6.5, 40), (17.5, 18), (28.5, 24), (39.5, 18), (50.5, 40),
    ]
    private static let box: CGFloat = 64
    private static let barWidth: CGFloat = 7
    private static let top: CGFloat = 12

    var colour: NSColor = .systemGreen { didSet { needsDisplay = true } }
    override var mouseDownCanMoveWindow: Bool { true }

    override func draw(_ dirty: NSRect) {
        let scale = min(bounds.width, bounds.height) / Self.box
        let inset = (bounds.width - Self.box * scale) / 2
        colour.setFill()
        for bar in Self.bars {
            // The bars hang from the top of the box, so flip y for AppKit.
            let rect = NSRect(x: inset + bar.x * scale,
                              y: bounds.height - (Self.top + bar.height) * scale,
                              width: Self.barWidth * scale,
                              height: bar.height * scale)
            let radius = Self.barWidth / 2 * 0.95 * scale
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
        }
    }
}

/// Where each column of the track grid starts and how wide it is. A row
/// and the header above it both read it from here, so the two cannot
/// drift apart when one of them is edited.
struct TrackColumns {
    let titleX: CGFloat
    let titleWidth: CGFloat
    let artistX: CGFloat
    let artistWidth: CGFloat
    let timeX: CGFloat
    let heartX: CGFloat

    init(width: CGFloat) {
        let pad = LibraryMetrics.rowPadding
        let gap = LibraryMetrics.columnGap
        heartX = width - pad - LibraryMetrics.heart
        timeX = heartX - gap - LibraryMetrics.duration
        titleX = pad + LibraryMetrics.rowArtwork + gap
        // Title takes 1.5 of the space the artist takes 1 of.
        let available = timeX - gap - titleX
        titleWidth = available * 0.6 - gap / 2
        artistX = titleX + titleWidth + gap
        artistWidth = available - titleWidth - gap
    }
}

/// Covers come over the network while the list is being rebuilt under
/// them, so every load is tied to the url that asked for it and a reply
/// for a url the view has moved on from is dropped.
final class ArtworkLoader {
    private weak var view: NSImageView?
    private let fallback: String
    private let point: CGFloat
    private var url: String?
    private var task: URLSessionDataTask?

    /// Called with the cover once it lands, and with nil while there is
    /// none — the window tints itself from it.
    var onImage: ((NSImage?) -> Void)?

    init(view: NSImageView, fallback: String, point: CGFloat) {
        self.view = view
        self.fallback = fallback
        self.point = point
    }

    deinit { task?.cancel() }

    func load(_ urlString: String?) {
        guard let urlString, let link = URL(string: urlString) else {
            url = nil
            task?.cancel()
            placeholder()
            return
        }
        guard urlString != url else { return }
        url = urlString
        task?.cancel()
        placeholder()
        task = URLSession.shared.dataTask(with: link) { [weak self] data, _, _ in
            guard let data, let image = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, self.url == urlString, let view = self.view else { return }
                view.image = image
                view.contentTintColor = nil
                view.layer?.backgroundColor = NSColor.clear.cgColor
                self.onImage?(image)
            }
        }
        task?.resume()
    }

    private func placeholder() {
        guard let view else { return }
        view.image = NSImage(systemSymbolName: fallback, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: point, weight: .semibold))
        view.contentTintColor = .quaternaryLabelColor
        view.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.06).cgColor
        onImage?(nil)
    }
}

/// The grid's legend, above the first row.
final class ColumnHeader: NSView {
    private let title = DragThroughLabel(labelWithString: "Title")
    private let artist = DragThroughLabel(labelWithString: "Artist")
    private let time = DragThroughLabel(labelWithString: "Time")
    private let heart = DragThroughImageView()
    private let rule = NSView()

    override var mouseDownCanMoveWindow: Bool { true }

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        for label in [title, artist, time] {
            label.font = .systemFont(ofSize: 9, weight: .semibold)
            label.textColor = .tertiaryLabelColor
            addSubview(label)
        }
        time.alignment = .right
        heart.image = NSImage(systemSymbolName: "heart", accessibilityDescription: "Saved")?
            .withSymbolConfiguration(.init(pointSize: 9, weight: .semibold))
        heart.contentTintColor = .tertiaryLabelColor
        addSubview(heart)

        rule.wantsLayer = true
        rule.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.1).cgColor
        addSubview(rule)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layout() {
        super.layout()
        let columns = TrackColumns(width: bounds.width)
        let y = bounds.height - 15
        title.frame = NSRect(x: columns.titleX, y: y, width: columns.titleWidth, height: 11)
        artist.frame = NSRect(x: columns.artistX, y: y, width: columns.artistWidth, height: 11)
        time.frame = NSRect(x: columns.timeX, y: y, width: LibraryMetrics.duration, height: 11)
        heart.frame = NSRect(x: columns.heartX, y: y - 1, width: LibraryMetrics.heart, height: 12)
        rule.frame = NSRect(x: LibraryMetrics.rowPadding, y: 0,
                            width: max(bounds.width - LibraryMetrics.rowPadding * 2, 0), height: 1)
    }
}

/// Four bars that move while something is playing — the mark's EQ beat at
/// strip size. Still bars when paused, so the strip reads the same either
/// way without the motion claiming something is happening.
final class EqualiserView: NSView {
    private var phase: CGFloat = 0
    private var timer: Timer?

    var isAnimating = false {
        didSet {
            guard isAnimating != oldValue else { return }
            timer?.invalidate()
            timer = nil
            if isAnimating {
                timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 12, repeats: true) { [weak self] _ in
                    self?.phase += 0.5
                    self?.needsDisplay = true
                }
            }
            needsDisplay = true
        }
    }

    override var mouseDownCanMoveWindow: Bool { true }
    deinit { timer?.invalidate() }

    override func draw(_ dirty: NSRect) {
        let count = 4
        let width: CGFloat = 3
        let gap: CGFloat = 3
        var x = bounds.width - CGFloat(count) * width - CGFloat(count - 1) * gap
        NSColor.systemGreen.withAlphaComponent(isAnimating ? 0.9 : 0.35).setFill()
        for bar in 0..<count {
            let swing = isAnimating ? (sin(phase + CGFloat(bar) * 1.1) + 1) / 2 : 0.3
            let height = bounds.height * (0.25 + 0.75 * swing)
            let rect = NSRect(x: x, y: (bounds.height - height) / 2, width: width, height: height)
            NSBezierPath(roundedRect: rect, xRadius: width / 2, yRadius: width / 2).fill()
            x += width + gap
        }
    }
}

/// A scroll view's document starts at the bottom unless it is flipped, so
/// a list laid out from the top opens scrolled to its end.
final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// A row in the track list: artwork, title, artist, duration, heart.
/// Separate items rather than a table — each sits on its own surface.
final class TrackRow: NSView {
    private let cover = DragThroughImageView()
    private let title = DragThroughLabel(labelWithString: "")
    private let artist = DragThroughLabel(labelWithString: "")
    private let time = DragThroughLabel(labelWithString: "")
    private let heart = DragThroughImageView()
    private let marker = DragThroughImageView()

    private var trackingAreaRef: NSTrackingArea?
    private var hovering = false
    private lazy var art = ArtworkLoader(view: cover, fallback: "music.note", point: 11)

    private(set) var uri: String?
    var onPlay: ((String) -> Void)?
    var isPlaying = false { didSet { restyle() } }

    override var mouseDownCanMoveWindow: Bool { false }

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = LibraryMetrics.rowRadius

        cover.wantsLayer = true
        cover.layer?.cornerRadius = 5
        cover.layer?.masksToBounds = true
        cover.imageScaling = .scaleProportionallyDown
        addSubview(cover)

        title.font = .systemFont(ofSize: 12, weight: .medium)
        artist.font = .systemFont(ofSize: 11, weight: .regular)
        artist.textColor = .secondaryLabelColor
        time.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        time.textColor = .secondaryLabelColor
        time.alignment = .right
        for label in [title, artist, time] {
            label.lineBreakMode = .byTruncatingTail
            label.maximumNumberOfLines = 1
            addSubview(label)
        }

        marker.contentTintColor = .systemGreen
        marker.isHidden = true
        addSubview(marker)
        addSubview(heart)
        restyle()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

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
        guard let uri, bounds.contains(convert(event.locationInWindow, from: nil)) else { return }
        onPlay?(uri)
    }

    override func layout() {
        super.layout()
        let size = LibraryMetrics.rowArtwork
        let columns = TrackColumns(width: bounds.width)
        cover.frame = NSRect(x: LibraryMetrics.rowPadding, y: (bounds.height - size) / 2,
                             width: size, height: size)
        marker.frame = NSRect(x: cover.frame.maxX - 14, y: cover.frame.minY, width: 14, height: 14)

        heart.frame = NSRect(x: columns.heartX, y: (bounds.height - 20) / 2,
                             width: LibraryMetrics.heart, height: 20)
        time.frame = NSRect(x: columns.timeX, y: (bounds.height - 14) / 2,
                            width: LibraryMetrics.duration, height: 14)
        title.frame = NSRect(x: columns.titleX, y: (bounds.height - 16) / 2,
                             width: columns.titleWidth, height: 16)
        artist.frame = NSRect(x: columns.artistX, y: (bounds.height - 15) / 2,
                              width: columns.artistWidth, height: 15)
    }

    private func restyle() {
        title.textColor = isPlaying ? .systemGreen : .labelColor
        marker.isHidden = !isPlaying
        let surface = NSColor.labelColor.withAlphaComponent(hovering ? 0.12 : 0.06)
        layer?.backgroundColor = surface.cgColor
        layer?.borderWidth = 0.5
        layer?.borderColor = NSColor.labelColor.withAlphaComponent(0.08).cgColor
    }

    func show(_ track: [String: Any], playing: Bool) {
        uri = track["uri"] as? String
        let name = track["name"] as? String ?? ""
        title.stringValue = name
        title.toolTip = name
        artist.stringValue = track["artist"] as? String ?? ""
        let total = Int(max(track["durationMs"] as? Double ?? 0, 0) / 1000)
        time.stringValue = String(format: "%d:%02d", total / 60, total % 60)
        isPlaying = playing

        marker.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Playing")?
            .withSymbolConfiguration(.init(pointSize: 11, weight: .semibold))

        // Read-only: Spotify refuses to tell this app whether a track is
        // saved, or to change it. Every row in Liked Songs is saved by
        // definition, which is where this comes from.
        let saved = track["saved"] as? Bool ?? false
        heart.image = NSImage(systemSymbolName: saved ? "heart.fill" : "heart",
                              accessibilityDescription: saved ? "In Liked Songs" : nil)?
            .withSymbolConfiguration(.init(pointSize: 12, weight: .semibold))
        heart.contentTintColor = saved ? .systemGreen : .tertiaryLabelColor
        heart.toolTip = saved ? "In your Liked Songs" : nil

        art.load(track["artworkUrl"] as? String)
        needsLayout = true
    }
}

/// One collection in the sidebar.
final class SidebarRow: NSView {
    private let cover = DragThroughImageView()
    private let name = DragThroughLabel(labelWithString: "")
    private let count = DragThroughLabel(labelWithString: "")
    private var trackingAreaRef: NSTrackingArea?
    private var hovering = false
    private lazy var art = ArtworkLoader(view: cover, fallback: "music.note.list", point: 12)

    let uri: String?
    var onPick: ((String?) -> Void)?
    var isSelected = false { didSet { restyle() } }

    override var mouseDownCanMoveWindow: Bool { false }

    init(uri: String?, title: String, detail: String, artworkUrl: String?, liked: Bool) {
        self.uri = uri
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 6

        cover.wantsLayer = true
        cover.layer?.cornerRadius = 5
        cover.layer?.masksToBounds = true
        cover.imageScaling = .scaleProportionallyDown
        addSubview(cover)
        if liked {
            // Liked Songs has no cover of its own; it gets the heart.
            cover.image = NSImage(systemSymbolName: "heart.fill", accessibilityDescription: nil)?
                .withSymbolConfiguration(.init(pointSize: 12, weight: .semibold))
            cover.contentTintColor = .systemGreen
            cover.layer?.backgroundColor = NSColor.systemGreen.withAlphaComponent(0.14).cgColor
        } else {
            art.load(artworkUrl)
        }

        name.stringValue = title
        name.toolTip = title
        name.font = .systemFont(ofSize: 12, weight: .medium)
        count.stringValue = detail
        count.font = .systemFont(ofSize: 10, weight: .regular)
        count.textColor = .secondaryLabelColor
        for label in [name, count] {
            label.lineBreakMode = .byTruncatingTail
            label.maximumNumberOfLines = 1
            addSubview(label)
        }
        restyle()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

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
    override func mouseUp(with event: NSEvent) { onPick?(uri) }

    override func layout() {
        super.layout()
        let cv = LibraryMetrics.sidebarCover
        cover.frame = NSRect(x: 8, y: (bounds.height - cv) / 2, width: cv, height: cv)
        let textX = cover.frame.maxX + 8
        let width = bounds.width - textX - 8
        name.frame = NSRect(x: textX, y: bounds.midY - 1, width: width, height: 15)
        count.frame = NSRect(x: textX, y: bounds.midY - 15, width: width, height: 13)
    }

    private func restyle() {
        name.textColor = isSelected ? .labelColor : .secondaryLabelColor
        let alpha = isSelected ? 0.12 : (hovering ? 0.07 : 0)
        layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(alpha).cgColor
    }
}

/// Resizable, and unlike the panel it is an ordinary window the user can
/// click into — a search field has to be able to take the keyboard.
final class LibraryWindow: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(origin: .zero, size: LibraryMetrics.size),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        isMovableByWindowBackground = true
        minSize = LibraryMetrics.minimum
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true
    }

    override var canBecomeKey: Bool { true }
}

final class LibraryController: NSObject, NSSearchFieldDelegate {
    private let window = LibraryWindow()
    private let material = NSVisualEffectView()
    private let sidebar = NSView()
    private let sidebarScroll = NSScrollView()
    private let sidebarStack = FlippedView()
    private let playlistHeading = DragThroughLabel(labelWithString: "YOUR PLAYLISTS")
    private let footTitle = DragThroughLabel(labelWithString: "Your music.")
    private let footLine = DragThroughLabel(labelWithString: "Always a little closer.")
    private let pane = NSView()
    private let columns = ColumnHeader()
    private let scroll = NSScrollView()
    private let list = FlippedView()
    private let listFoot = DragThroughLabel(labelWithString: "")

    /// A wash of the current cover's colour, under everything. It is a
    /// layer rather than a view so it cannot take a click.
    private let wash = CALayer()

    private let nowStrip = NSView()
    private let nowCover = DragThroughImageView()
    private let nowKicker = DragThroughLabel(labelWithString: "")
    private let nowText = DragThroughLabel(labelWithString: "")
    private let equaliser = EqualiserView()
    private lazy var nowArt = ArtworkLoader(view: nowCover, fallback: "music.note", point: 13)

    private let brandMark = MarkView()
    private let brandText = DragThroughLabel(labelWithString: "")
    private let search = NSSearchField()

    private let collectionArt = DragThroughImageView()
    private let collectionKicker = DragThroughLabel(labelWithString: "")
    private let collectionTitle = DragThroughLabel(labelWithString: "")
    private let collectionFacts = DragThroughLabel(labelWithString: "")

    private let emptyTitle = DragThroughLabel(labelWithString: "")
    private let emptyDetail = DragThroughLabel(labelWithString: "")

    private var sidebarRows: [SidebarRow] = []
    private var rows: [TrackRow] = []
    private var tracks: [[String: Any]] = []
    private var filtered: [[String: Any]] = []
    private var selected: String?
    private var selectedName = "Liked Songs"
    private var note: String?
    private var playingURI: String?

    /// Asks the daemon for something and hands back its reply.
    private let request: (String, [Any], @escaping ([String: Any]) -> Void) -> Void
    private let onPlay: (String, String?) -> Void

    init(request: @escaping (String, [Any], @escaping ([String: Any]) -> Void) -> Void,
         onPlay: @escaping (String, String?) -> Void) {
        self.request = request
        self.onPlay = onPlay
        super.init()
        build()
    }

    var isVisible: Bool { window.isVisible }

    func show() {
        window.center()
        window.makeKeyAndOrderFront(nil)
        loadSidebar()
        if selected == nil { pick(nil) }
    }

    func hide() {
        // Nothing is on screen to animate for.
        equaliser.isAnimating = false
        window.orderOut(nil)
    }

    func nowPlaying(_ message: [String: Any]?) {
        let uri = message?["uri"] as? String
        if playingURI != uri {
            playingURI = uri
            for row in rows { row.isPlaying = row.uri != nil && row.uri == uri }
        }

        let title = message?["title"] as? String ?? ""
        let artist = message?["artist"] as? String ?? ""
        let playing = message?["playing"] as? Bool ?? false
        nowKicker.stringValue = title.isEmpty ? "NOTHING PLAYING" : (playing ? "NOW PLAYING" : "PAUSED")
        nowText.stringValue = title.isEmpty
            ? "Pick a track to start."
            : (artist.isEmpty ? title : "\(title) · \(artist)")
        nowArt.load(message?["artworkUrl"] as? String)
        equaliser.isAnimating = playing && window.isVisible
    }

    // MARK: building

    private func build() {
        material.material = .hudWindow
        material.blendingMode = .behindWindow
        material.state = .active
        material.wantsLayer = true
        window.contentView = material
        wash.backgroundColor = NSColor.clear.cgColor
        material.layer?.insertSublayer(wash, at: 0)

        brandMark.setAccessibilityLabel("minitify")
        material.addSubview(brandMark)

        brandText.attributedStringValue = brandLockup()
        material.addSubview(brandText)

        search.placeholderString = "Search tracks or artists"
        search.font = .systemFont(ofSize: 13)
        search.delegate = self
        search.sendsWholeSearchString = false
        search.sendsSearchStringImmediately = true
        material.addSubview(search)

        sidebar.wantsLayer = true
        sidebar.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.12).cgColor
        material.addSubview(sidebar)

        sidebarScroll.drawsBackground = false
        sidebarScroll.hasVerticalScroller = false
        sidebarScroll.documentView = sidebarStack
        sidebar.addSubview(sidebarScroll)

        playlistHeading.font = .systemFont(ofSize: 9, weight: .semibold)
        playlistHeading.textColor = .tertiaryLabelColor
        sidebarStack.addSubview(playlistHeading)

        // The sign-off sits below the scroll, so it never scrolls away.
        footTitle.font = .systemFont(ofSize: 11, weight: .medium)
        footTitle.textColor = .secondaryLabelColor
        footLine.font = .systemFont(ofSize: 11, weight: .regular)
        footLine.textColor = .tertiaryLabelColor
        for label in [footTitle, footLine] {
            label.lineBreakMode = .byTruncatingTail
            sidebar.addSubview(label)
        }

        material.addSubview(pane)
        pane.addSubview(columns)

        collectionArt.wantsLayer = true
        collectionArt.layer?.cornerRadius = 8
        collectionArt.layer?.masksToBounds = true
        collectionArt.imageScaling = .scaleProportionallyDown
        pane.addSubview(collectionArt)

        collectionKicker.font = .systemFont(ofSize: 9, weight: .semibold)
        collectionKicker.textColor = .secondaryLabelColor
        collectionTitle.font = .systemFont(ofSize: 28, weight: .semibold)
        collectionTitle.lineBreakMode = .byTruncatingTail
        collectionFacts.font = .systemFont(ofSize: 11, weight: .regular)
        collectionFacts.textColor = .secondaryLabelColor
        for label in [collectionKicker, collectionTitle, collectionFacts] {
            label.maximumNumberOfLines = 1
            pane.addSubview(label)
        }

        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.automaticallyAdjustsContentInsets = false
        scroll.documentView = list
        pane.addSubview(scroll)

        listFoot.font = .systemFont(ofSize: 10, weight: .regular)
        listFoot.textColor = .tertiaryLabelColor
        listFoot.alignment = .center
        list.addSubview(listFoot)

        nowStrip.wantsLayer = true
        nowStrip.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.04).cgColor
        pane.addSubview(nowStrip)

        nowCover.wantsLayer = true
        nowCover.layer?.cornerRadius = 6
        nowCover.layer?.masksToBounds = true
        nowCover.imageScaling = .scaleProportionallyDown
        nowStrip.addSubview(nowCover)

        nowKicker.font = .systemFont(ofSize: 9, weight: .semibold)
        nowKicker.textColor = .systemGreen
        nowText.font = .systemFont(ofSize: 12, weight: .medium)
        nowText.lineBreakMode = .byTruncatingTail
        for label in [nowKicker, nowText] {
            label.maximumNumberOfLines = 1
            nowStrip.addSubview(label)
        }
        nowStrip.addSubview(equaliser)
        nowArt.onImage = { [weak self] image in self?.tint(from: image) }
        nowPlaying(nil)

        emptyTitle.font = .systemFont(ofSize: 13, weight: .medium)
        emptyTitle.textColor = .secondaryLabelColor
        emptyTitle.alignment = .center
        emptyDetail.font = .systemFont(ofSize: 11, weight: .regular)
        emptyDetail.textColor = .tertiaryLabelColor
        emptyDetail.alignment = .center
        emptyDetail.maximumNumberOfLines = 2
        for label in [emptyTitle, emptyDetail] { pane.addSubview(label) }

        NotificationCenter.default.addObserver(
            forName: NSWindow.didResizeNotification, object: window, queue: .main
        ) { [weak self] _ in self?.layoutAll() }

        layoutAll()
    }

    /// One colour, read from the cover at a single pixel. The average of a
    /// cover is muddy, so only its hue survives: the saturation and
    /// brightness are set here, which keeps every wash the same weight
    /// whatever is playing.
    private func tint(from image: NSImage?) {
        var colour = NSColor.clear
        if let image,
           let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            var pixel = [UInt8](repeating: 0, count: 4)
            let space = CGColorSpaceCreateDeviceRGB()
            if let context = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8,
                                       bytesPerRow: 4, space: space,
                                       bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
                context.draw(cg, in: CGRect(x: 0, y: 0, width: 1, height: 1))
                let average = NSColor(red: CGFloat(pixel[0]) / 255, green: CGFloat(pixel[1]) / 255,
                                      blue: CGFloat(pixel[2]) / 255, alpha: 1)
                if let rgb = average.usingColorSpace(.deviceRGB) {
                    colour = NSColor(hue: rgb.hueComponent, saturation: 0.6,
                                     brightness: 0.5, alpha: 0.14)
                }
            }
        }
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.45)
        wash.backgroundColor = colour.cgColor
        CATransaction.commit()
    }

    /// "mini" in the label colour, "tify" in the accent — the wordmark.
    private func brandLockup() -> NSAttributedString {
        let font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        let text = NSMutableAttributedString(
            string: "mini", attributes: [.font: font, .foregroundColor: NSColor.labelColor])
        text.append(NSAttributedString(
            string: "tify", attributes: [.font: font, .foregroundColor: NSColor.systemGreen]))
        return text
    }

    // MARK: layout

    private func layoutAll() {
        let size = material.bounds.size
        guard size.width > 0 else { return }
        // Laying out is not an animation; the wash should follow the
        // window edge instantly.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        wash.frame = material.bounds
        CATransaction.commit()
        let inset = LibraryMetrics.inset
        let header = LibraryMetrics.header

        let headerY = size.height - header
        brandMark.frame = NSRect(x: inset, y: headerY + (header - LibraryMetrics.markSize) / 2,
                                 width: LibraryMetrics.markSize, height: LibraryMetrics.markSize)
        brandText.frame = NSRect(x: brandMark.frame.maxX + 8, y: headerY + (header - 18) / 2,
                                 width: 110, height: 18)

        let searchX = LibraryMetrics.sidebar
        search.frame = NSRect(x: searchX, y: headerY + (header - LibraryMetrics.searchHeight) / 2,
                              width: size.width - searchX - inset,
                              height: LibraryMetrics.searchHeight)

        sidebar.frame = NSRect(x: 0, y: 0, width: LibraryMetrics.sidebar, height: headerY)
        let foot = LibraryMetrics.sidebarFoot
        sidebarScroll.frame = NSRect(x: 8, y: foot, width: LibraryMetrics.sidebar - 16,
                                     height: max(headerY - foot - 8, 0))
        footTitle.frame = NSRect(x: 16, y: foot - 24, width: LibraryMetrics.sidebar - 32, height: 14)
        footLine.frame = NSRect(x: 16, y: foot - 40, width: LibraryMetrics.sidebar - 32, height: 14)
        layoutSidebar()

        pane.frame = NSRect(x: LibraryMetrics.sidebar, y: 0,
                            width: size.width - LibraryMetrics.sidebar, height: headerY)
        layoutPane()
    }

    private func layoutPane() {
        let inset = LibraryMetrics.inset
        let width = pane.bounds.width
        let art = LibraryMetrics.collectionArtwork
        let headerTop = pane.bounds.height - LibraryMetrics.collectionHeader

        collectionArt.frame = NSRect(x: inset, y: headerTop + (LibraryMetrics.collectionHeader - art) / 2,
                                     width: art, height: art)
        let textX = collectionArt.frame.maxX + 16
        let textWidth = width - textX - inset
        collectionKicker.frame = NSRect(x: textX, y: collectionArt.frame.maxY - 16,
                                        width: textWidth, height: 12)
        collectionTitle.frame = NSRect(x: textX, y: collectionArt.frame.maxY - 52,
                                       width: textWidth, height: 34)
        collectionFacts.frame = NSRect(x: textX, y: collectionArt.frame.minY + 2,
                                       width: textWidth, height: 14)

        // The list is inset by the window's margin less a row's own
        // padding, so a row's text lines up with the header above it while
        // its hover fill still has room to breathe at both edges.
        let strip = LibraryMetrics.nowStrip
        let listX = inset - LibraryMetrics.rowPadding
        let listWidth = width - listX - inset
        let legend = LibraryMetrics.columnHeader

        columns.frame = NSRect(x: listX, y: headerTop - legend, width: listWidth, height: legend)
        columns.needsLayout = true
        scroll.frame = NSRect(x: listX, y: strip, width: listWidth,
                              height: max(headerTop - legend - strip, 0))
        layoutRows()

        nowStrip.frame = NSRect(x: 0, y: 0, width: width, height: strip)
        let cover = LibraryMetrics.nowCover
        nowCover.frame = NSRect(x: inset, y: (strip - cover) / 2, width: cover, height: cover)
        let nowX = nowCover.frame.maxX + 12
        let nowWidth = max(width - nowX - inset - 40, 0)
        nowKicker.frame = NSRect(x: nowX, y: strip / 2 + 2, width: nowWidth, height: 12)
        nowText.frame = NSRect(x: nowX, y: strip / 2 - 17, width: nowWidth, height: 16)
        equaliser.frame = NSRect(x: width - inset - 24, y: (strip - 16) / 2, width: 24, height: 16)

        let centre = NSRect(x: 0, y: strip, width: width, height: max(headerTop - strip, 0))
        emptyTitle.frame = NSRect(x: 0, y: centre.midY, width: width, height: 17)
        emptyDetail.frame = NSRect(x: inset, y: centre.midY - 34,
                                   width: width - inset * 2, height: 30)
    }

    private func layoutSidebar() {
        let width = sidebarScroll.bounds.width
        let step = LibraryMetrics.sidebarRow + 4
        // Liked Songs is pinned at the top; the heading separates it from
        // the playlists underneath.
        let headingSpace: CGFloat = 26
        let rest = max(sidebarRows.count - 1, 0)
        let content = step + headingSpace + CGFloat(rest) * step
        sidebarStack.frame = NSRect(x: 0, y: 0, width: width,
                                    height: max(content, sidebarScroll.bounds.height))
        for (index, row) in sidebarRows.enumerated() {
            let y = index == 0 ? 0 : step + headingSpace + CGFloat(index - 1) * step
            row.frame = NSRect(x: 0, y: y, width: width, height: LibraryMetrics.sidebarRow)
            row.needsLayout = true
        }
        playlistHeading.frame = NSRect(x: 8, y: step + 8, width: max(width - 16, 0), height: 12)
        playlistHeading.isHidden = rest == 0
    }

    private func layoutRows() {
        let width = scroll.bounds.width
        let step = LibraryMetrics.row + LibraryMetrics.rowGap
        let end = CGFloat(rows.count) * step
        let content = end + LibraryMetrics.listFoot
        list.frame = NSRect(x: 0, y: 0, width: width, height: max(content, scroll.bounds.height))
        for (index, row) in rows.enumerated() {
            row.frame = NSRect(x: 0, y: CGFloat(index) * step,
                               width: width, height: LibraryMetrics.row)
            row.needsLayout = true
        }
        listFoot.frame = NSRect(x: LibraryMetrics.rowPadding, y: end + 10,
                                width: max(width - LibraryMetrics.rowPadding * 2, 0), height: 14)
    }

    // MARK: data

    private func loadSidebar() {
        request("playlists", []) { [weak self] reply in
            guard let self else { return }
            let playlists = reply["data"] as? [[String: Any]] ?? []
            self.sidebarRows.forEach { $0.removeFromSuperview() }
            self.sidebarRows = []

            // Liked Songs is pinned above everything else.
            let liked = SidebarRow(uri: nil, title: "Liked Songs", detail: "saved tracks",
                                   artworkUrl: nil, liked: true)
            liked.onPick = { [weak self] uri in self?.pick(uri) }
            self.sidebarRows.append(liked)

            for playlist in playlists {
                let count = playlist["trackCount"] as? Int ?? 0
                let row = SidebarRow(uri: playlist["uri"] as? String,
                                     title: playlist["name"] as? String ?? "",
                                     detail: "\(count) tracks",
                                     artworkUrl: playlist["artworkUrl"] as? String,
                                     liked: false)
                row.onPick = { [weak self] uri in self?.pick(uri) }
                self.sidebarRows.append(row)
            }
            self.sidebarRows.forEach { self.sidebarStack.addSubview($0) }
            self.sidebarStack.addSubview(self.playlistHeading)
            self.markSelection()
            self.layoutSidebar()
        }
    }

    private func pick(_ uri: String?) {
        selected = uri
        selectedName = sidebarRows.first { $0.uri == uri }.map { _ in
            uri == nil ? "Liked Songs" : (sidebarRows.first { $0.uri == uri }?.subviews
                .compactMap { ($0 as? NSTextField)?.stringValue }.first ?? "")
        } ?? "Liked Songs"
        markSelection()
        search.stringValue = ""

        showMessage(title: "Loading…", detail: "")
        let name = uri == nil ? "liked" : "tracks"
        let args: [Any] = uri == nil ? [] : [uri!]
        request(name, args) { [weak self] reply in
            guard let self else { return }
            if reply["ok"] as? Bool != true {
                self.tracks = []
                self.note = reply["error"] as? String
            } else if let payload = reply["data"] as? [String: Any] {
                self.tracks = payload["tracks"] as? [[String: Any]] ?? []
                self.note = payload["note"] as? String
            } else {
                self.tracks = reply["data"] as? [[String: Any]] ?? []
                self.note = nil
            }
            self.applyFilter()
        }
    }

    private func markSelection() {
        for row in sidebarRows { row.isSelected = row.uri == selected }
    }

    private func applyFilter() {
        let needle = search.stringValue.trimmingCharacters(in: .whitespaces).lowercased()
        filtered = needle.isEmpty ? tracks : tracks.filter { track in
            let name = (track["name"] as? String ?? "").lowercased()
            let artist = (track["artist"] as? String ?? "").lowercased()
            return name.contains(needle) || artist.contains(needle)
        }
        rebuildRows()
        updateCollectionHeader(matching: needle)
    }

    private func rebuildRows() {
        rows.forEach { $0.removeFromSuperview() }
        rows = filtered.map { track in
            let row = TrackRow()
            row.show(track, playing: track["uri"] as? String == playingURI)
            row.onPlay = { [weak self] uri in self?.onPlay(uri, self?.selected) }
            list.addSubview(row)
            return row
        }
        layoutRows()

        if let note, filtered.isEmpty {
            showMessage(title: "Nothing to list here", detail: note)
        } else if filtered.isEmpty {
            showMessage(title: tracks.isEmpty ? "Nothing in here yet" : "No match",
                        detail: tracks.isEmpty
                            ? "Add something to this collection in Spotify."
                            : "Try another title or artist.")
        } else {
            showMessage(title: nil, detail: nil)
        }

        let shown = filtered.count == tracks.count
            ? "All \(filtered.count) tracks shown"
            : "\(filtered.count) of \(tracks.count) tracks shown"
        listFoot.stringValue = selected == nil
            ? "\(shown) · Hearts keep this collection yours."
            : "\(shown) · Playing one starts the whole playlist."
    }

    private func showMessage(title: String?, detail: String?) {
        let show = title != nil
        emptyTitle.isHidden = !show
        emptyDetail.isHidden = !show
        scroll.isHidden = show
        columns.isHidden = show
        emptyTitle.stringValue = title ?? ""
        emptyDetail.stringValue = detail ?? ""
    }

    private func updateCollectionHeader(matching needle: String) {
        let liked = selected == nil
        collectionKicker.stringValue = liked ? "SAVED BY YOU" : "YOUR PLAYLIST"
        collectionTitle.stringValue = selectedName
        collectionArt.image = NSImage(systemSymbolName: liked ? "heart.fill" : "music.note.list",
                                      accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 34, weight: .semibold))
        collectionArt.contentTintColor = liked ? .systemGreen : .secondaryLabelColor
        collectionArt.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.06).cgColor

        let seconds = Int(filtered.reduce(0.0) { $0 + (($1["durationMs"] as? Double ?? 0) / 1000) })
        let shown = needle.isEmpty
            ? "\(filtered.count) tracks"
            : "\(filtered.count) of \(tracks.count) tracks"
        collectionFacts.stringValue = filtered.isEmpty ? shown : "\(shown) · \(spoken(seconds))"
    }

    /// Hours once there are any; a library runs to thousands of minutes.
    private func spoken(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 { return "\(hours) hr \(minutes) min" }
        return "\(minutes) min \(seconds % 60) sec"
    }

    func controlTextDidChange(_ obj: Notification) { applyFilter() }
}
