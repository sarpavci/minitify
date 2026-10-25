import Cocoa
import WebKit
import MediaPlayer

// A dock-invisible host for the Spotify Web Playback SDK.
//
// Protocol with the daemon:
//   stdout  {"type":"loaded"}
//           {"type":"mediakey","command":"play|pause|toggle|next|previous"}
//           {"type":"error","message":"..."}
//   stdin   {"type":"nowplaying","title":...,"artist":...,
//            "durationMs":...,"positionMs":...,"playing":bool}

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardOutput.write(line.data(using: .utf8)!)
}

final class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let pageURL: URL

    init(pageURL: URL) {
        self.pageURL = pageURL
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration()
        // Without this the SDK cannot start audio on its own.
        config.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 480, height: 320), configuration: config)
        webView.navigationDelegate = self

        // The web view needs to live in a window to render and play, but the
        // window is parked off-screen and never ordered in.
        window = NSWindow(contentRect: NSRect(x: -5000, y: -5000, width: 480, height: 320),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = webView
        window.orderOut(nil)

        webView.load(URLRequest(url: pageURL))

        registerMediaKeys()
        readCommands()
    }

    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        emit(["type": "loaded"])
    }

    func webView(_ view: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        emit(["type": "error", "message": error.localizedDescription])
    }

    func webView(_ view: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        emit(["type": "error", "message": error.localizedDescription])
    }

    // WebKit can kill the content process while this app keeps running.
    // The web view is then blank: the SDK is gone, but the daemon still
    // holds a device id Spotify accepts commands for, so playback silently
    // does nothing. Tell the daemon to drop it, then reload.
    func webViewWebContentProcessDidTerminate(_ view: WKWebView) {
        emit(["type": "reloading", "reason": "web content process terminated"])
        view.load(URLRequest(url: pageURL))
    }

    // MARK: media keys

    private func registerMediaKeys() {
        let center = MPRemoteCommandCenter.shared()

        let bindings: [(MPRemoteCommand, String)] = [
            (center.playCommand, "play"),
            (center.pauseCommand, "pause"),
            (center.togglePlayPauseCommand, "toggle"),
            (center.nextTrackCommand, "next"),
            (center.previousTrackCommand, "previous"),
        ]

        for (command, name) in bindings {
            command.isEnabled = true
            command.addTarget { _ in
                emit(["type": "mediakey", "command": name])
                return .success
            }
        }
    }

    // MARK: now playing

    private func readCommands() {
        // Line-oriented stdin on a background thread; the main thread stays
        // free for the web view's run loop.
        Thread.detachNewThread {
            while let line = readLine(strippingNewline: true) {
                guard let data = line.data(using: .utf8),
                      let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      message["type"] as? String == "nowplaying" else { continue }
                DispatchQueue.main.async { self.updateNowPlaying(message) }
            }

            // stdin closed: the daemon is gone. Nothing can reach this
            // process any more — no dock icon, no window, no socket — so
            // staying alive would leave music playing with no way to stop
            // it short of pkill.
            exit(0)
        }
    }

    // Deliberately does not touch MPNowPlayingInfoCenter.
    //
    // The SDK always registers a media session of its own, and suppressing
    // it breaks playback. Publishing a second one here produced two
    // entries in Control Center and split the media keys between them —
    // the first press after focusing another app went to whichever was
    // most recently active. The page now fills the SDK's entry with the
    // real track instead, so this process stays out of Now Playing and
    // one correct entry remains.
    //
    // The stdin loop is still what tells us the daemon died, so the
    // messages are read and discarded rather than ignored.
    private func updateNowPlaying(_ message: [String: Any]) {}
}

// MARK: entry point

guard CommandLine.arguments.count > 1, let url = URL(string: CommandLine.arguments[1]) else {
    emit(["type": "error", "message": "usage: wkplayer <page-url>"])
    exit(2)
}

let app = NSApplication.shared
// .accessory keeps the process out of the dock and the app switcher.
app.setActivationPolicy(.accessory)
let delegate = Delegate(pageURL: url)
app.delegate = delegate
app.run()
