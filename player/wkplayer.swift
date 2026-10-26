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
    var overlay: OverlayController!
    var library: LibraryController!
    // Requests the library window has in flight, keyed by the id sent out.
    var pending: [Int: ([String: Any]) -> Void] = [:]
    var nextRequestId = 1
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

        // The overlay's buttons travel the same path as the media keys, so
        // the daemon handles both with one code path.
        overlay = OverlayController { [weak self] action, value in
            if action == "close" {
                self?.overlay.hide()
                emit(["type": "overlay", "show": false])
            } else if action == "library" {
                guard let self else { return }
                if self.library.isVisible { self.library.hide() } else { self.library.show() }
            } else if let value {
                // Controls that carry something: a volume percent, a seek
                // position in milliseconds, or the uri of a queue row.
                emit(["type": "mediakey", "command": action, "value": value])
            } else {
                emit(["type": "mediakey", "command": action])
            }
        }

        // Requests carry an id so an answer can find its way back to the
        // call that asked; replies arrive on stdin like everything else.
        library = LibraryController(
            request: { [weak self] name, args, done in
                guard let self else { return }
                let id = self.nextRequestId
                self.nextRequestId += 1
                self.pending[id] = done
                emit(["type": "request", "id": id, "name": name, "args": args])
            },
            onPlay: { uri, context in
                // Inside its collection, so the queue follows from there.
                if let context {
                    emit(["type": "mediakey", "command": "play", "value": context])
                    emit(["type": "mediakey", "command": "jump", "value": uri])
                } else {
                    emit(["type": "mediakey", "command": "jump", "value": uri])
                }
            })

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
                      let type = message["type"] as? String else { continue }

                DispatchQueue.main.async {
                    switch type {
                    case "nowplaying":
                        self.updateNowPlaying(message)
                        self.overlay.apply(message)
                        self.library.nowPlaying(message["uri"] as? String)
                    case "overlay":
                        if message["show"] as? Bool == true { self.overlay.show() }
                        else { self.overlay.hide() }
                    case "answer":
                        // The reply to one of the library's requests.
                        if let id = message["id"] as? Int, let done = self.pending.removeValue(forKey: id) {
                            done(message)
                        }
                    default:
                        break
                    }
                }
            }

            // stdin closed: the daemon is gone. Nothing can reach this
            // process any more — no dock icon, no window, no socket — so
            // staying alive would leave music playing with no way to stop
            // it short of pkill.
            exit(0)
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

// Top-level code is only allowed in main.swift once there is more than one
// file, so the entry point is explicit instead.
@main
enum Player {
    static func main() {
        guard CommandLine.arguments.count > 1,
              let url = URL(string: CommandLine.arguments[1]) else {
            emit(["type": "error", "message": "usage: wkplayer <page-url>"])
            exit(2)
        }

        let app = NSApplication.shared
        // .accessory keeps the process out of the dock and the app switcher.
        app.setActivationPolicy(.accessory)
        let delegate = Delegate(pageURL: url)
        app.delegate = delegate
        app.run()
    }
}
