# Commands

Every command connects to the daemon, does one thing, and exits. The
daemon keeps playing.

| Command | What it does |
|---|---|
| `minitify` | Lists your playlists and plays the one you pick |
| `minitify search <words>` | Searches tracks and plays the one you pick |
| `minitify status` | Prints what is playing |
| `minitify pause` | Pauses |
| `minitify resume` | Resumes, transferring the session back to the player first |
| `minitify next` | Next track |
| `minitify prev` | Previous track |
| `minitify vol <0-100>` | Sets the volume |
| `minitify shuffle [on\|off]` | Toggles without an argument |
| `minitify repeat [off\|all\|one]` | Cycles without an argument |
| `minitify overlay [on\|off]` | Shows or hides the floating player |
| `minitify login` | First-time setup |
| `minitify quit` | Stops the background player |
| `minitify --help` | Prints the usage |

## Picking things

`minitify` with no arguments and `minitify search` both open a picker.

```
↑ ↓        move
Enter      play
Esc / q    leave without changing anything
```

The picker draws on the alternate screen buffer and restores the
terminal on the way out, so your scrollback survives. It shows what is
currently playing as a header, and never draws more rows than the
terminal has — the window scrolls with the selection instead.

Picking something prints nothing. A cold daemon takes a few seconds to
have audio ready, and after 400 ms the command says `preparing the
player…` on stderr so it does not look hung.

## Arguments

**`vol`** takes a number from 0 to 100. Anything unparseable is
rejected before a request is made.

**`shuffle`** with no argument toggles. The daemon tracks the current
value from the SDK's own state, so the toggle does not need to ask
Spotify first.

**`repeat`** cycles `off → all → one → off`. The words are translated
on the way out: Spotify's own names for those modes are `off`,
`context` and `track`.

**`overlay`** with no argument toggles. Turning it on starts the player
host if it is not already running, because the panel lives in that
process.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Done. For the pickers, also what you get when you press Esc. |
| `1` | Anything else, with the reason on stderr. |

Errors arrive as plain sentences. A rate limit carries its wait:
`API rate limit exceeded — retry in 12s`.

## What the daemon sends back

Useful when driving it from a script. Connect to
`~/.config/minitify/daemon.sock`, write one JSON line, read one back.

`status`:

```json
{"ok": true, "data": {
  "playing": true,
  "trackName": "Instant Crush",
  "artist": "Daft Punk, Julian Casablancas"
}}
```

`playlists`:

```json
{"ok": true, "data": [
  {"name": "Evening rotation", "uri": "spotify:playlist:...", "trackCount": 42}
]}
```

`search`: the same shape with `name`, `artist` and `uri`.

`shuffle`, `repeat` and `overlay` return the value they settled on —
`{"shuffle": true}`, `{"repeat": "context"}`, `{"overlay": false}` —
which is how a toggle tells you where it landed.

## Limits worth knowing

`search` returns at most **10** results. Spotify cut the limit from 50
in February 2026; narrowing the query is the only way to see more, and
the picker says so in its header when a search comes back full.

`playlists` pages through your library 50 at a time, up to 20 pages.
