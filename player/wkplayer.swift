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
        }
    }

    private func updateNowPlaying(_ message: [String: Any]) {
        let playing = message["playing"] as? Bool ?? false
        var info: [String: Any] = [:]

        info[MPMediaItemPropertyTitle] = message["title"] as? String ?? ""
        info[MPMediaItemPropertyArtist] = message["artist"] as? String ?? ""
        info[MPMediaItemPropertyPlaybackDuration] = (message["durationMs"] as? Double ?? 0) / 1000
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = (message["positionMs"] as? Double ?? 0) / 1000
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
    }
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
