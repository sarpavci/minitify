# Troubleshooting

Start here:

```sh
cat ~/.config/minitify/daemon.log
```

The daemon's only voice is a socket reply, so anything that goes wrong
outside a command lands in that file and nowhere else.

## It says "preparing the player…" and stays there

The WebKit content process died and took the SDK device with it, while
Spotify kept accepting calls for the dead device id.

This is handled: the host reports `reloading`, the daemon restarts it,
and `play` retries once after verifying that no playback started. If it
still hangs, `minitify quit` and try again — and send the log, because
the retry should have caught it.

## "Device not found"

The device id the daemon holds is no longer registered. Usually the
player host was killed, or the machine slept long enough for the SDK
session to lapse.

```sh
minitify quit
minitify
```

`play` recovers from this by restarting the host; the `transfer` step
has no retry of its own yet, which is why you can still meet this error
on the first command after a sleep.

## Nothing plays, but no error

If `status` reports a track and you hear nothing, the device is
registered but not active. That is the transfer step failing quietly.
Check the log for `sdk error:` lines — `authentication_error` means the
token is wrong, `account_error` means the account is not Premium.

Worth confirming:

```sh
curl -s -H "Authorization: Bearer $(node -e '
  import("./src/config.js").then(async c => {
    const { getAccessToken } = await import("./src/spotify/auth.js");
    console.log(await getAccessToken(c.loadConfig()));
  })')" https://api.spotify.com/v1/me | grep product
```

`"product": "premium"` is what you need to see.

## The browser never comes back during login

The loopback listener binds `127.0.0.1:8888`. If something else holds
that port, login hangs.

```sh
lsof -nP -iTCP:8888 -sTCP:LISTEN
```

The redirect URI registered with Spotify has to be exactly
`http://127.0.0.1:8888/callback` — `localhost` is rejected by Spotify,
and a trailing slash counts as a different URI.

## Two entries in Control Center

Expected, and not currently fixable. One entry is this app's, with the
real track and working media keys; the other is the SDK's own "Spotify
Embedded Player".

Suppressing the SDK's media session breaks playback outright — the SDK
depends on it and answers `playback_error`. Feeding it correct metadata
instead does not work either: the SDK runs in a cross-origin iframe, so
the metadata never reaches it, and you end up with one entry that has no
track info and no working keys. Both attempts were made and reverted.

As a side effect, the first media-key press after a cold start may go to
the wrong entry. Pressing play/pause once hands the keys over.

## Two daemons

Shouldn't happen — `claimSocket` probes before unlinking, and the loser
of a `listen` race exits `0`. If you see it anyway:

```sh
pgrep -fl 'minitify/src/daemon'
minitify quit
```

and send the log. The sequence to look for is two `daemon listening`
lines without a `standing down` between them.

## A command exits instantly with nothing

The daemon could not start. Almost always the player was never built:

```sh
sh player/build.sh
```

The error message says so, but only after the five-second connect
window expires.

## Resetting

```sh
minitify quit
rm -rf ~/.config/minitify
./bin/minitify login
```

That drops credentials, tokens, the socket and the log. The Spotify app
registration survives — you only need the client ID and secret again.

## Things that are not bugs

**`playlists` is slow the first time.** It pages your whole library, 50
at a time.

**`search` shows 10 results.** Spotify's maximum since February 2026.

**Closing the terminal does not stop the music.** The daemon is detached
on purpose. `minitify quit` is how you stop it.

**The panel does not take focus when clicked.** `canBecomeKey` is
`false`, so it never steals focus from what you were doing.
