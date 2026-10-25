# Contributing

Thanks for looking. This is a small, opinionated project, so a note on
what it is trying to be before you spend time on a change.

## What minitify is trying to be

**Small enough to read in an afternoon.** About 1,800 lines of
JavaScript and 550 of Swift. If a change makes that materially larger,
it needs to buy something proportional.

**Zero runtime dependencies.** `package.json` has no `dependencies` key
and should stay that way. Node 20+ has `fetch`, `node:test`, `readline`
and `net`; between them they cover everything here. A dependency means
an upgrade treadmill and a supply chain for something a personal music
remote does not need.

**Out of the way.** No dock tile, no app switcher entry, no focus
stealing, no window that outlives what you asked for. A change that
makes the thing more present needs a good reason.

## Before you start

Open an issue first if the change is more than a fix. It is cheaper to
disagree about an approach in writing than after the code exists.

## Setting up

```sh
git clone git@github.com:sarpavci/minitify.git
cd minitify
sh player/build.sh
./bin/minitify login
```

No install step — there is nothing to install.

Point the config somewhere else while you work, so your real tokens stay
untouched:

```sh
export MINITIFY_CONFIG_DIR=/tmp/minitify-dev
```

## Tests

```sh
node --test
```

Bare, with no path argument. `node --test test/` makes Node 24 resolve
the directory as a module and fail with `MODULE_NOT_FOUND`.

**Write the test first and watch it fail.** A test that passes the
moment you write it has proved nothing about whether it can catch the
bug.

The suite uses real code with injected seams — `connectImpl`,
`spawnImpl`, `getToken`, `fetchImpl` — rather than mocking frameworks. A
test that asserts on a mock's call log is asserting on the mock.

### What tests cannot cover

Device transfer, token refresh against the live API, WebKit
content-process death and media keys all need a real Premium account.
Every one of those produced a bug that unit tests had passed over. If
your change touches any of them, exercise it for real and say so in the
pull request.

## Style

Match what is there. Specifically:

Comments explain *why*, never *what*. The code already says what it
does; the comment is for the thing you would otherwise have to
rediscover — that a 200 can mean no sound, that unlinking a socket can
orphan a daemon.

Errors are sentences a person can act on. `could not start the minitify
daemon — see ~/.config/minitify/daemon.log`, not `ENOENT`.

Success is usually silent. The music is the feedback.

Keep files focused. If one is growing past a few hundred lines, that is
usually a boundary asking to exist.

## Commits and pull requests

One concern per commit. Subject in the imperative, under about 70
characters, then a body that says why if it is not obvious.

```
fix: transfer the session before playing

A Web Playback SDK device registers as inactive, so a play call
carrying only device_id succeeds and produces no sound.
```

In the pull request, say what you changed, how you verified it, and what
you did not cover. A known gap stated plainly is worth more than a clean
description that omits it.

CI runs the suite and builds the Swift player on macOS. Both have to be
green.

## UI and motion changes

The visual and motion systems are documented in
[`docs/design.md`](docs/design.md) and
[`docs/motion.md`](docs/motion.md), and they are the authority — SF Pro
only, SF Symbols only, `.systemGreen` as the single accent, the
documented durations and easings.

Motion has to be carried by Core Animation or SF Symbols effects. No
animation library, and nothing that animates `width`/`height` where a
transform would do. `prefers-reduced-motion` — and on macOS, Reduce
Motion — must be honoured.

## Things that will be turned down

A dependency that could be a built-in. A rewrite into a framework. A
menu bar extra or dock icon, unless it is strictly optional and off by
default. Anything requiring an account on a service other than Spotify.
Support for a non-macOS platform — the player is AppKit and WebKit, and
pretending otherwise would mean maintaining a port nobody runs.

Telemetry of any kind.
