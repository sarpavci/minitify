# Design

Every value here is in points and is what the AppKit code should use.
Where a value exists because of a constraint rather than a preference,
the constraint is named.

## Principles

**Native first.** SF Pro only, SF Symbols only, `.systemGreen` as the
single accent. The system already decided what a macOS window looks
like; the job is to not fight it.

**Out of the way.** The panel never takes focus, never appears in the
dock, and never covers more than it needs to. Three sizes exist so you
can pick how much presence it has.

**Nothing decorative.** Motion either shows where something came from
or confirms a press. Colour means state, not mood.

## Colour

A single accent. Nothing else is coloured.

| Token | Dark | Light |
|---|---|---|
| Accent (active state, playing track, liked heart) | `#87e6a6` / `#9ce8b5` | `#0f8a4a` |
| Accent, deep (gradient end, logo) | `#3fb673` | `#0a6c3a` |
| Label | `#f2f3f5` | `#20272b` |
| Secondary label | `#b4bec5` | `#58656c` |
| Material | `rgba(30,35,39,.82)` | `rgba(238,242,244,.82)` |
| Strip (darker band) | `rgba(9,14,18,.38)` | `rgba(131,148,155,.2)` |
| Rule (hairline) | `#ffffff22` | `#17283226` |
| Hover | `#ffffff1c` | `#17283218` |
| Row surface | `#ffffff10` | `#ffffff73` |

In AppKit, label and secondary label come from `.labelColor` and
`.secondaryLabelColor` rather than these literals; the hex values are
what the design mock uses to match them.

**Artwork tint.** The library samples the dominant colour of the current
album, reduces its saturation so system greys survive, and layers it at
10% over the `NSVisualEffectView`. It is a tint, not a background.

## Windows and material

| Window | Size | Corner |
|---|---|---|
| Mini | 320 × 60 | 16 |
| Normal | 440 × 188 | 16 |
| Extended | 440 × 424 | 16 |
| Library | 800 × 500, min 680 × 360, resizable | 16 |

Material is `NSVisualEffectView` `.hudWindow`, blending `.behindWindow`,
state `.active`. Shadow: black 25%, blur 32, y −14. Border 0.5 pt, white
60% in light, 23% in dark.

The panel is a borderless `NSPanel` with `.nonactivatingPanel`,
`.floating` level, `.canJoinAllSpaces` and `.fullScreenAuxiliary`.
`canBecomeKey` and `canBecomeMain` are both `false` — that is what stops
it stealing focus.

Insets: mini 10 on all four sides; normal and extended 20.

### The queue

Extended adds 236 pt under the strip, in Spotify's order: the playing
track as the first row, then the `UP NEXT` heading, then three more.

| | |
|---|---|
| Rows | 48 high, cover 32 / radius 4 |
| Heading | 32 high |
| Tail | 12, so the last row does not sit on the panel's edge |
| Row padding | 8 horizontal — the hover band reaches past the contents, which stay on the 20 pt column |
| Playing row | accent title and a `waveform` badge on its cover; not clickable |
| Other rows | click plays that track inside the current context |

## Type

SF Pro, weights 400 / 550 / 600 only.

| | Size | Weight | Leading |
|---|---|---|---|
| Mini title | 13 | 600 | 1.3 |
| Mini artist | 11 | 400 | 1.3 |
| Rich title | 24 | 600 | 1.2 |
| Rich artist | 13 | 400 | 1.5 |
| Library collection title | 28 | 600 | 1.15 |
| Library row | 12 | 550 | — |
| Eyebrow / kicker | 9–10, tracking 0.08em | 550 | — |
| Time and duration | 10–11, tabular figures | 400 | — |

Titles truncate at the tail and carry the full text as a native
`toolTip`.

## Artwork

| Where | Size | Corner |
|---|---|---|
| Mini | 40 | 6 |
| Normal / extended | 88 | 8 |
| Queue row | 32 | 4 |
| Library row | 28 | 5 |
| Library collection header | 88 | 8 |
| Library sidebar | 32 | 5 |

## Controls

Mini transport 32 × 32, gap 4. Rich transport: previous/next 32,
shuffle/repeat/heart/device 24. Primary play 48 circle, green fill,
18 pt glyph.

Bottom strip 76 high, filled with the darker material tint.

Order, left to right: previous · play/pause · next | shuffle · repeat |
heart · device | volume.

Seek sits in the right column of the top row: 3 pt track, 12 pt thumb,
range 0…duration. Volume: 64 pt track width, 3 pt track, range 0…100.

Active controls take the accent; off is `.secondaryLabelColor`.

## The detached buttons

Three 28 pt circles live *outside* the panel body, in transparent
window gutters: mode switch, library, close.

The window is the panel plus 72 transparent points in width and height —
36 on each side for the rich modes, and 36 left/right with 0 top/bottom
for mini. Gap from the panel is 8, and 8 between buttons.

They are hidden at rest and fade in over 160 ms when the pointer enters
a **single tracking area** that spans the panel, the empty gutter and
all three buttons. Crossing the gap must never hide them. Only the
visible circles accept clicks; every other transparent point passes the
mouse through.

They flip to stay on screen:

- **Mode button, horizontally.** Panel centre in the left half of the
  screen → button on the right, and the reverse.
- **Library and close, vertically.** Panel centre in the top half →
  buttons below; bottom half → above.

The whole window is clamped to `visibleFrame`.

Glyphs: `arrow.up.left.and.arrow.down.right` in mini and normal,
`arrow.down.right.and.arrow.up.left` in extended. The cycle is
mini → normal → extended → mini.

## Library

Sidebar 200 wide. Liked Songs is pinned at the top with a
`.systemGreen` heart on its own material tile; a `YOUR PLAYLISTS`
heading at 9/600 follows, then the playlists, each with its own 32 pt
cover. Below the scroll, never scrolling away: `Your music.` over
`Always a little closer.`

The header is 64 high: the brand lockup (22 pt mark + wordmark, 8 gap)
on the left, search field 32 high on the right.

The track pane is padded 16 / 12 / 0. Inside it:

**Collection header** 112 high — 88 pt artwork, 16 gap, kicker, 28 pt
title, then count and total duration at 11.

**Column template** 28 · 1.5fr · 1fr · 40 · 28, gaps 12 — artwork,
title, artist, duration, heart. The play target covers artwork and
title together. A 24 pt legend above the first row names the columns at
9/600 over a hairline, on the same template, so the two cannot drift.

**Rows** are separate items, not a table: 40 high, corner 8, 8 pt
horizontal padding, 6 pt apart, each on the row surface with a 0.5 pt
inset hairline. No dividers. Selected rows take the hover colour and a
1 pt inset ring; the playing row takes the accent on its title and
carries a 14 pt equaliser badge on its artwork.

**Hearts** are always visible — 60% secondary label when off, 100%
`.systemGreen` when on. They are read-only: Spotify refuses a
Development Mode app both the saved state of a track and the right to
change it, so every row in Liked Songs is filled by definition and
nothing else is.

Below the last row, inside the scroll: a one-line summary at 10 —
`All N tracks shown · Hearts keep this collection yours.` for Liked
Songs, `· Playing one starts the whole playlist.` for a playlist.

Pinned under the pane, outside the scroll: a 56 pt now-playing strip —
36 pt cover, `NOW PLAYING` / `PAUSED` / `NOTHING PLAYING` at 9/600 in
the accent, title · artist at 12, and a four-bar equaliser at the right
edge that moves only while something plays.

## The mark

Five bars, 64 × 64 viewBox, animated by `height` and `y` only.

```
x       6.5   17.5   28.5   39.5   50.5
width   7     corner radius 3.33 (95% of half-width)
```

The resting mark is an **M**: bars hang from `y = 12` with heights
`40 · 18 · 24 · 18 · 40` — full-height stems at the ends, the diagonal
ramping from the counter depth (45%) at the stem edge down to the apex
(60%) at the centre. Flat top, V-shaped bottom.

Two other states exist only inside the launch animation:

- **Play** — centred bars descending left to right under a stepped
  falloff, `1 − (0.55t + 0.45·round(2t)/2)`, giving `40 · 27.7 · 23 ·
  10.7 · 6`. The blend of a quantised and a linear term is what keeps
  any two bars from landing on the same height.
- **Level meter** — the same bars at pseudo-random heights.

See [motion.md](motion.md) for the sequence.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../.github/assets/mark-still-dark.svg">
    <img src="../.github/assets/mark-still-light.svg" alt="The resting mark" width="88" height="88">
  </picture>
</p>

Assets live in `.github/assets/`, all produced by `tools/make-mark.py`:
`mark-dark.svg` and `mark-light.svg` animate the four beats twice and
settle, `mark-loop-*.svg` repeat forever, and `mark-still-*.svg` are the
resting M alone. `mark-template.svg` is that same M in `currentColor`,
ready for the app to load as a template `NSImage` — the player does not
reference it yet, because the panel currently draws only SF Symbols.

In the terminal the mark is drawn with block characters — four rows,
one column per bar separated by a space, for the banner; and a single
line of `▁▂▃▄▅▆▇█` redrawn in place for loading, settling on the play
shape `█ ▆ ▅ ▂ ▁`. The M cannot be drawn on one line because block
characters only grow from the bottom.

## Symbols

`backward.fill` · `play.fill` · `pause.fill` · `forward.fill` ·
`shuffle` · `repeat` · `repeat.1` · `heart` / `heart.fill` ·
`hifispeaker` · `books.vertical` · `xmark` · `magnifyingglass` ·
`arrow.up.left.and.arrow.down.right` ·
`arrow.down.right.and.arrow.up.left`

All loaded as vector `NSImage` symbols. No raster assets ship in the
app; the 3× PNGs in the design mock exist only because a browser cannot
load SF Symbols.
