# Architecture

minitify is three processes that each do one thing.

```
  you ──▶ minitify (CLI)          short-lived. parses, sends one line, exits.
             │ unix socket
             ▼
          daemon (Node)            long-lived. owns tokens, the Web API,
             │                     and the player's lifetime.
             ├── http 127.0.0.1    serves the SDK page, takes its events
             │
             ▼  stdin / stdout
          wkplayer (Swift)         WKWebView host + the floating panel.
             │                     .accessory policy: no dock tile.
             ▼
          Spotify Web Playback SDK ──▶ CoreAudio
```

Nothing here is a framework. The CLI, the daemon and the HTTP server are
Node built-ins; the player is about 550 lines of Swift against AppKit and
WebKit. `package.json` has no `dependencies` key at all.

## Why a browser engine at all

Spotify no longer serves audio over the protocol librespot speaks. The
old client asked for an AES audio key per track; that request is now
refused, and the key exchange is absent from the shipped macOS binary.
Playback goes through EME/Widevine instead, which means a real browser
engine with a CDM.

WKWebView is the cheapest one on macOS that has it. It is part of the
system, so the footprint is the WebKit content process rather than a
bundled Chromium — about 75 MB against roughly 434 MB for headless
Chrome.

That decision is why `wkplayer` exists, and why the daemon runs an HTTP
server at all: EME requires a secure context, and `http://127.0.0.1` is
one. A `file://` page is not.

## The CLI

`bin/minitify` parses the argument vector into `{name, args}`
(`src/cli/commands.js`), opens the unix socket, writes one JSON line,
reads the reply and exits. It holds no state.

Two commands are interactive. `playlists` and `search` fetch a list,
draw a picker on the alternate screen buffer (`src/cli/selector.js`),
and send a `play` for whatever was chosen. On success they print
nothing — the music is the feedback.

### Starting the daemon

`connectOrStart` (`src/cli/client.js`) tries to connect. On failure it
spawns `src/daemon/index.js` **detached and unref'd**, so the CLI can
exit while the music keeps playing, then retries for five seconds.

A stale socket file is a real case: if the daemon crashed, the path
exists but nothing listens, and `connect` returns `ECONNREFUSED`. The
client unlinks the file in exactly that case and in no other, because
unlinking a socket somebody is listening on would orphan a running
daemon together with its WKWebView.

## The daemon

`src/daemon/index.js` wires everything together and then does very
little. Per connection it reads one newline-terminated JSON object,
hands it to `handleCommand`, and ends the socket with the reply.

### The protocol

One line in, one line out, newline-terminated JSON. There is no
handshake, no framing beyond the newline, and no second request on the
same connection.

```jsonc
// request
{"name": "play", "args": ["spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"]}

// reply, success
{"ok": true, "data": null}

// reply, failure
{"ok": false, "error": "Device not found"}
```

`data` carries whatever the command produced: an array for `playlists`
and `search`, an object for `status`, `null` for the commands whose only
result is that they worked.

### Only one daemon

Two CLI invocations on a cold start both find no socket and both spawn a
daemon. Whoever binds second must not steal the path.

`claimSocket` (`src/daemon/lifecycle.js`) probes before it unlinks: if
something answers, this daemon stands down. Only a socket nobody is
listening on gets removed. The race is still winnable by both — two
daemons can pass the probe at the same moment — so the loser is caught
again at `listen`, where `EADDRINUSE`/`EEXIST` is treated as a normal
outcome and exits `0`.

The `ownsSocket` flag exists for the same reason. Cleanup unlinks the
socket only if this process is the one that bound it; otherwise the
loser's exit would delete the winner's socket on the way out.

### Tokens

`src/spotify/auth.js` runs the authorization code flow against a
loopback listener on `127.0.0.1:8888`. Spotify rejects `localhost` in a
redirect URI, so the registered value has to be the literal IP.

Refreshes are memoised while in flight: several concurrent API calls
that all notice an expired token share one refresh instead of racing.
Expiry is checked 60 s early (`EXPIRY_MARGIN_MS`), so a request issued
now cannot arrive after the token lapsed.

Credentials and tokens live in `~/.config/minitify/` with mode `0600`.
An unreadable or half-written `tokens.json` reads as "not logged in"
rather than taking the daemon down.

## The player host

`player/wkplayer.swift` is a `WKWebView` in an app with the
`.accessory` activation policy — the reason nothing appears in the dock
or the app switcher. It loads the daemon's page, forwards SDK events
back over stdout as JSON lines, and takes commands on stdin.

It exits on stdin EOF. Without that, killing the daemon would leave an
invisible WebKit process playing music with nothing able to reach it.

`webViewWebContentProcessDidTerminate` is handled: WebKit can kill the
content process under memory pressure, which silently invalidates the
SDK device id while Spotify keeps accepting calls for it. The host
reports `reloading` and reloads.

### The page

`src/daemon/page.js` is generated, not a file on disk. It boots the Web
Playback SDK, registers the device, and POSTs every state change to
`/event`.

Both `/token` and `/event` are guarded. The daemon generates a random
secret at startup and puts it in the URL it gives the player; a request
without it gets `403`. The `Host` header is checked against loopback
names, because a browser lured in by DNS rebinding carries the
attacker's hostname and a loopback client never does. This port hands
out a live Spotify access token, so it is a trust boundary rather than
an implementation detail.

## The floating panel

`player/overlay.swift` is a borderless `NSPanel` with
`.nonactivatingPanel`, `.floating` level, and
`.canJoinAllSpaces` + `.fullScreenAuxiliary`. `canBecomeKey` and
`canBecomeMain` are both `false`, so clicking it never steals focus from
what you were doing. The material is `NSVisualEffectView` `.hudWindow`.

All glyphs are SF Symbols loaded as vector `NSImage`, never raster
assets.

## Two things that look like bugs and are not

**A play call that returns 200 and plays nothing.** A Web Playback SDK
device registers as *inactive*. A `PUT /me/player/play` carrying only
`device_id` succeeds and leaves it that way. `activateDevice` transfers
the session to the device first; that is what actually hands it over.

**Playback endpoints answering 200 instead of 204.** The documentation
says `204 No Content`; the live API returns `200` with a short opaque
non-JSON body. `JSON.parse` on it throws, which used to break every
pause and skip. `src/spotify/api.js` reads the body as text and parses
only when it looks like JSON.

Because 200 is not evidence that sound started, `play` verifies: if the
player reports no playback within 3 s, the host is restarted and the
call is made once more.

**A device id that outlives its device.** A sleep drops the device
server-side, and the SDK page does not always get a `not_ready` through
before it goes — so the daemon keeps handing Spotify an id nobody will
accept, and every call answers 404.

`retryOnDeadDevice` wraps the commands that need a live device: it
restarts the player, waits for a fresh id, transfers to it, and runs the
command again.

Deciding *when* to do that takes more than the status code. Four things
answer 404 on these endpoints, observed against the live API:

| Message | Means |
|---|---|
| `Device not found` | the id we transferred to is dead |
| `Not found.` | the device went while Spotify still thought it was active |
| `Player command failed: No active device found` | **either** our device died **or** nothing is playing anywhere |
| `Non existing id: spotify:…` | the music is gone, not the device |

The first two are always ours. The last is never — restarting the player
for a deleted playlist would cut off the music to fix something a
restart cannot.

The third is the interesting one: Spotify gives it both for a device of
ours that has died and for the ordinary case of nothing playing, and
which one it is depends only on how fast the device deregistered. The
message cannot separate them, so the daemon uses what it knows about
itself instead — **a healthy player holds a device id, one that has died
does not.**

Once a recovery is under way that heuristic stops applying, because we
hold a fresh id by definition. Spotify's transfer is also eventually
consistent: measured live, the device takes about a second more to count
as active. So the retry is attempted up to three times, 400 ms apart,
treating any device complaint as the transfer still landing. Only then
is the failure reported.

Two commands can meet the dead device at once — the daemon serves
connections concurrently and media keys run commands of their own — so
the restart is shared through a single in-flight promise. Without that
the second restart would kill the player the first had just spawned.

## Testing

The suite lives under `test/` and runs with `node --test` — bare, with
no path argument. Passing `test/` makes Node 24 try to resolve the
directory as a module and fail with `MODULE_NOT_FOUND`.

The suite is unit-level and uses real code with injected seams
(`connectImpl`, `spawnImpl`, `getToken`) rather than mocks. The HTTP
guard test speaks raw HTTP on a socket, because `fetch` refuses to set a
`Host` header.

What unit tests cannot reach — device transfer, token refresh against
the live API, WebKit content-process death — has to be exercised against
a real account.
