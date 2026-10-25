# minitify documentation

| | |
|---|---|
| [Spotify setup](spotify-setup.md) | Registering your app, the exact redirect URI, scopes, and the 2026 API behaviour that catches people out |
| [Commands](commands.md) | Every command, its arguments, output and exit codes — plus the socket protocol if you want to drive it from a script |
| [Architecture](architecture.md) | The three processes, why a browser engine is involved at all, and the two things that look like bugs and are not |
| [Design](design.md) | Windows, materials, type, colour and components |
| [Motion](motion.md) | Every animation: beat map, duration, easing, and the native API that carries it |
| [Troubleshooting](troubleshooting.md) | The failure modes already hit, with their causes |
| [Contributing](../CONTRIBUTING.md) | What this project is trying to be, and what will be turned down |

## The short version

A command connects to a daemon over a unix socket, sends one JSON line,
and exits. The daemon owns the Spotify tokens and a hidden WKWebView
that runs Spotify's Web Playback SDK — which is where the sound
actually comes from, and why nothing shows up in the dock.

```
minitify (exits) ──socket──▶ daemon ──stdio──▶ wkplayer ──▶ CoreAudio
```

No runtime dependencies. Node built-ins and about 550 lines of Swift.

## If you are reading this to make a change

[Contributing](../CONTRIBUTING.md) first, then
[Architecture](architecture.md). For anything visual,
[Design](design.md) and [Motion](motion.md) are the authority rather
than taste.
