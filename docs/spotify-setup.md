# Spotify setup

minitify talks to your own Spotify app, not to a service someone else
runs. That takes about three minutes and keeps your credentials on your
machine.

**Spotify Premium is required.** The Web Playback SDK does not serve
free accounts; it refuses at device registration, so nothing plays.

## 1. Register the app

Go to the [developer dashboard](https://developer.spotify.com/dashboard)
and create an app.

| Field | Value |
|---|---|
| Redirect URI | `http://127.0.0.1:8888/callback` |
| APIs used | **Web API** and **Web Playback SDK** — tick both |

The redirect URI has to be exactly that. Spotify rejects `localhost` in
redirect URIs, so the literal IP is not a style choice. If you change
the port you have to change `REDIRECT_PORT` in `src/spotify/auth.js`
too.

Copy the client ID and secret from the app's settings.

## 2. Build the player

```sh
sh player/build.sh
```

This compiles `player/wkplayer.swift` and `player/overlay.swift` with
`swiftc`. Command Line Tools are enough; Xcode is not needed. If
`swiftc` is missing:

```sh
xcode-select --install
```

## 3. Log in

```sh
./bin/minitify login
```

It asks for the client ID and secret, writes them to
`~/.config/minitify/config.json` with mode `0600`, then opens your
browser. Approve the scopes and the loopback listener takes the code
from the redirect.

Tokens land in `~/.config/minitify/tokens.json`, also `0600`. Access
tokens refresh automatically, a minute before they expire.

## Scopes

| Scope | Why |
|---|---|
| `streaming` | Required by the Web Playback SDK to play anything |
| `user-read-email`, `user-read-private` | The SDK checks the account is Premium |
| `user-modify-playback-state` | Play, pause, skip, volume, shuffle, repeat |
| `user-read-playback-state` | `status`, and reading devices |
| `playlist-read-private`, `playlist-read-collaborative` | Listing your playlists |

Adding a scope later means logging in again — the refresh token carries
the set it was issued with.

## What changed in the 2026 API

Things that are documented one way and behave another, all of which
this project hit for real:

**Development Mode caps you at 5 users.** A new app starts there. Fine
for yourself; it means you cannot hand the binary to a team without
applying for an extension.

**Search returns 10 results, not 50.** The limit was cut in February
2026. `limit=50` is accepted and ignored.

**Playlist track counts moved.** `GET /me/playlists` used to carry
`tracks.total`; the field is now `items.total`. The code reads
`p.tracks?.total ?? p.items?.total ?? 0` so it survives either.

**`GET /playlists/{id}/tracks` is gone**, replaced by
`/playlists/{id}/items`.

**Playback endpoints answer 200, not 204.** The reference still says
`204 No Content`. The live API returns `200` with a short opaque
non-JSON body, so anything that assumes JSON throws on every pause and
skip.

**A new SDK device is inactive.** Registering gives you a device id, but
a `play` carrying only `device_id` returns success and produces no
sound. You have to `PUT /me/player` to transfer the session first.

## Where your data lives

```
~/.config/minitify/
  config.json    client id and secret        0600
  tokens.json    access and refresh tokens   0600
  daemon.sock    the command socket
  daemon.log     the only place startup errors are recorded
```

Nothing leaves your machine except calls to Spotify. Delete the
directory to revoke everything locally; revoke the app itself from your
[Spotify account page](https://www.spotify.com/account/apps/).
