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
    private var coverURL: String?
    private var coverTask: URLSessionDataTask?

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
        cover.imageScaling = .scaleProportionallyUpOrDown
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
        let pad = LibraryMetrics.rowPadding
        let art = LibraryMetrics.rowArtwork
        let gap = LibraryMetrics.columnGap
        cover.frame = NSRect(x: pad, y: (bounds.height - art) / 2, width: art, height: art)
        marker.frame = NSRect(x: cover.frame.maxX - 14, y: cover.frame.minY, width: 14, height: 14)

        let heartX = bounds.width - pad - LibraryMetrics.heart
        heart.frame = NSRect(x: heartX, y: (bounds.height - 20) / 2, width: LibraryMetrics.heart, height: 20)
        let timeX = heartX - gap - LibraryMetrics.duration
        time.frame = NSRect(x: timeX, y: (bounds.height - 14) / 2, width: LibraryMetrics.duration, height: 14)

        // Title takes 1.5 of the space the artist takes 1 of.
        let textX = pad + art + gap
        let available = timeX - gap - textX
        let titleWidth = available * 0.6 - gap / 2
        title.frame = NSRect(x: textX, y: (bounds.height - 16) / 2, width: titleWidth, height: 16)
        artist.frame = NSRect(x: textX + titleWidth + gap, y: (bounds.height - 15) / 2,
                              width: available - titleWidth - gap, height: 15)
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

        loadCover(track["artworkUrl"] as? String)
        needsLayout = true
    }

    private func loadCover(_ urlString: String?) {
        let placeholder = {
            self.cover.image = NSImage(systemSymbolName: "music.note", accessibilityDescription: nil)?
                .withSymbolConfiguration(.init(pointSize: 11, weight: .semibold))
            self.cover.contentTintColor = .quaternaryLabelColor
            self.cover.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.06).cgColor
        }
        guard let urlString, let url = URL(string: urlString) else {
            coverURL = nil
            coverTask?.cancel()
            placeholder()
            return
        }
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

/// One collection in the sidebar.
final class SidebarRow: NSView {
    private let cover = DragThroughImageView()
    private let name = DragThroughLabel(labelWithString: "")
    private let count = DragThroughLabel(labelWithString: "")
    private var trackingAreaRef: NSTrackingArea?
    private var hovering = false

    let uri: String?
    var onPick: ((String?) -> Void)?
    var isSelected = false { didSet { restyle() } }

    override var mouseDownCanMoveWindow: Bool { false }

    init(uri: String?, title: String, detail: String, liked: Bool) {
        self.uri = uri
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 6

        cover.wantsLayer = true
        cover.layer?.cornerRadius = 5
        cover.layer?.masksToBounds = true
        cover.imageScaling = .scaleProportionallyUpOrDown
        cover.image = NSImage(systemSymbolName: liked ? "heart.fill" : "music.note.list",
                              accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 12, weight: .semibold))
        cover.contentTintColor = liked ? .systemGreen : .secondaryLabelColor
        cover.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.06).cgColor
        addSubview(cover)

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
    private let divider = NSView()
    private let pane = NSView()
    private let scroll = NSScrollView()
    private let list = FlippedView()

    private let brandMark = DragThroughImageView()
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

    func hide() { window.orderOut(nil) }

    func nowPlaying(_ uri: String?) {
        guard playingURI != uri else { return }
        playingURI = uri
        for row in rows { row.isPlaying = row.uri != nil && row.uri == uri }
    }

    // MARK: building

    private func build() {
        material.material = .hudWindow
        material.blendingMode = .behindWindow
        material.state = .active
        window.contentView = material

        brandMark.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 16, weight: .semibold))
        brandMark.contentTintColor = .systemGreen
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

        divider.wantsLayer = true
        divider.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.12).cgColor
        sidebarStack.addSubview(divider)

        material.addSubview(pane)

        collectionArt.wantsLayer = true
        collectionArt.layer?.cornerRadius = 8
        collectionArt.layer?.masksToBounds = true
        collectionArt.imageScaling = .scaleProportionallyUpOrDown
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
        sidebarScroll.frame = sidebar.bounds.insetBy(dx: 8, dy: 8)
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

        scroll.frame = NSRect(x: inset - LibraryMetrics.rowPadding, y: 0,
                              width: width - (inset - LibraryMetrics.rowPadding) - inset,
                              height: headerTop)
        layoutRows()

        let centre = NSRect(x: 0, y: 0, width: width, height: headerTop)
        emptyTitle.frame = NSRect(x: 0, y: centre.midY, width: width, height: 17)
        emptyDetail.frame = NSRect(x: inset, y: centre.midY - 34,
                                   width: width - inset * 2, height: 30)
    }

    private func layoutSidebar() {
        let width = sidebarScroll.bounds.width
        let step = LibraryMetrics.sidebarRow + 4
        let height = max(CGFloat(sidebarRows.count) * step, sidebarScroll.bounds.height)
        sidebarStack.frame = NSRect(x: 0, y: 0, width: width, height: height)
        for (index, row) in sidebarRows.enumerated() {
            row.frame = NSRect(x: 0, y: CGFloat(index) * step,
                               width: width, height: LibraryMetrics.sidebarRow)
            row.needsLayout = true
        }
        // Liked Songs is pinned; the divider sits under it.
        divider.frame = NSRect(x: 8, y: step - 3, width: max(width - 16, 0), height: 1)
    }

    private func layoutRows() {
        let width = scroll.bounds.width
        let step = LibraryMetrics.row + LibraryMetrics.rowGap
        let height = max(CGFloat(rows.count) * step, scroll.bounds.height)
        list.frame = NSRect(x: 0, y: 0, width: width, height: height)
        for (index, row) in rows.enumerated() {
            row.frame = NSRect(x: 0, y: CGFloat(index) * step,
                               width: width, height: LibraryMetrics.row)
            row.needsLayout = true
        }
    }

    // MARK: data

    private func loadSidebar() {
        request("playlists", []) { [weak self] reply in
            guard let self else { return }
            let playlists = reply["data"] as? [[String: Any]] ?? []
            self.sidebarRows.forEach { $0.removeFromSuperview() }
            self.sidebarRows = []

            // Liked Songs is pinned above everything else.
            let liked = SidebarRow(uri: nil, title: "Liked Songs", detail: "saved tracks", liked: true)
            liked.onPick = { [weak self] uri in self?.pick(uri) }
            self.sidebarRows.append(liked)

            for playlist in playlists {
                let count = playlist["trackCount"] as? Int ?? 0
                let row = SidebarRow(uri: playlist["uri"] as? String,
                                     title: playlist["name"] as? String ?? "",
                                     detail: "\(count) tracks",
                                     liked: false)
                row.onPick = { [weak self] uri in self?.pick(uri) }
                self.sidebarRows.append(row)
            }
            self.sidebarRows.forEach { self.sidebarStack.addSubview($0) }
            self.sidebarStack.addSubview(self.divider)
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
    }

    private func showMessage(title: String?, detail: String?) {
        let show = title != nil
        emptyTitle.isHidden = !show
        emptyDetail.isHidden = !show
        scroll.isHidden = show
        emptyTitle.stringValue = title ?? ""
        emptyDetail.stringValue = detail ?? ""
    }

    private func updateCollectionHeader(matching needle: String) {
        let liked = selected == nil
        collectionKicker.stringValue = liked ? "SAVED BY YOU" : "YOUR PLAYLIST"
        collectionTitle.stringValue = selectedName
        collectionArt.image = NSImage(systemSymbolName: liked ? "heart.fill" : "music.note.list",
                                      accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 30, weight: .semibold))
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
