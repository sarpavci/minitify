# minitify

A small Spotify remote for the terminal. Audio plays on this Mac, but
nothing appears in the dock and no Spotify app runs.

```
minitify                 pick a playlist
minitify search <words>  pick from search results
minitify status          what is playing
minitify next | prev | pause
minitify vol <0-100>
minitify login           first-time setup
minitify quit            stop the background player
```

Pick something, press Enter, and the command exits — the music keeps
playing. Closing the terminal does not stop it.

## How it works

The sound comes from Spotify's official Web Playback SDK, running inside
a tiny WKWebView host written in Swift. That host uses the `.accessory`
activation policy, so it never shows up in the dock or the app switcher.
A Node daemon owns it: it serves the SDK page over `127.0.0.1`, keeps the
OAuth tokens fresh, and talks to the Spotify Web API. The `minitify`
command is a thin client that connects to the daemon over a unix socket,
does one thing, and exits.

The page must be served over loopback rather than loaded from a string:
DRM playback needs EME, EME needs a secure context, and `about:blank` is
not one.

**Measured on an M-series Mac while playing:** 133 MB across 5 processes
(19 MB player, 57 MB daemon, 57 MB WebKit). Spotify's own desktop app
uses 400–600 MB and occupies the dock.

Media keys work: play/pause, next and previous are picked up through
`MPRemoteCommandCenter`, and the current track is published to
`MPNowPlayingInfoCenter`, so it also shows up in Control Center.

## Setup

Spotify Premium is required — the Web Playback SDK does not serve free
accounts.

1. Create an app at <https://developer.spotify.com/dashboard>
   - Redirect URI: `http://127.0.0.1:8888/callback` (exactly this;
     Spotify rejects `localhost`)
   - Enable **Web API** and **Web Playback SDK**
2. Build the player once:
   ```sh
   sh player/build.sh
   ```
   Command Line Tools are enough; Xcode is not needed.
3. Log in:
   ```sh
   ./bin/minitify login
   ```
   It asks for the client ID and secret, then opens the browser.

Credentials and tokens live in `~/.config/minitify/` with mode `0600`.

## Running the tests

```sh
node --test
```

No dependencies, no `node_modules`, no install step.

## Known limits

- **macOS only.** WKWebView and `MPRemoteCommandCenter` are platform
  specific.
- **Search returns at most 10 results.** Spotify cut the limit from 50 to
  10 in February 2026. The selector says so instead of paginating.
- **Development Mode apps serve at most 5 users**, which is plenty for
  personal use but means this is not something you hand to a group.
- The player is not covered by automated tests: DRM, audio output and
  media keys cannot be faked in a test environment. They are verified by
  hand.
