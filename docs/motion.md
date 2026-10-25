# Motion

Motion either shows where something came from or confirms a press.
Nothing here is decoration, and nothing is improvised per screen: every
animation in the product picks a curve and a duration band from the two
tables below.

All of it is carried by Core Animation or SF Symbols effects. No
animation library ships with this app.

## Five curves

| | CSS | Core Animation | Where |
|---|---|---|---|
| **Enter** | `cubic-bezier(0, 0, .2, 1)` | `CAMediaTimingFunction(controlPoints: 0, 0, 0.2, 1)` | Anything arriving: reveals, popovers, fades in, a thumb growing |
| **Exit** | `cubic-bezier(.4, 0, 1, 1)` | `CAMediaTimingFunction(controlPoints: 0.4, 0, 1, 1)` | Anything leaving. Always 60–70% of the matching entrance |
| **Standard** | `cubic-bezier(.4, 0, .2, 1)` | `CAMediaTimingFunction(controlPoints: 0.4, 0, 0.2, 1)` | In-place change: tint, bounce, a value sliding to a new state |
| **Panel** | `cubic-bezier(.32, .72, 0, 1)` | `CAMediaTimingFunction(controlPoints: 0.32, 0.72, 0, 1)` | Geometry: window resize, mode switch, queue reveal |
| **Settle** | `cubic-bezier(.22, 1.1, .36, 1)` | `CASpringAnimation(mass: 1, stiffness: 320, damping: 26)` | Only where something physical comes to rest |

Exit is always faster than enter. There is exactly one spring in the
system, and it is for things that were being dragged.

## Four bands

A floating overlay is read in a glance. Only the launch story takes its
time.

| Band | For |
|---|---|
| **120–160 ms** | Acknowledgement — press feedback, hover reveal, a thumb growing. Fast enough to read as the control responding rather than animating. |
| **180–250 ms** | Symbol and state — SF Symbols `.replace` and `.bounce`, accent tint, popover open. The macOS default band. |
| **240–380 ms** | Geometry — window resize, mode switch, queue reveal, the clamp back into frame. Anything where the eye follows a shape to a new place. |
| **3600 ms** | Launch only. Nothing else goes near this length. |

## Per feature

### Launch

The mark plays its four beats once — level meter, play triangle, level
meter, **M** — and holds on the M. 3600 ms, one pass.

Easing is per beat: `ease-in-out` between meter frames, `linear` into
the triangle hold, `(.5,0,.2,1)` / `(.55,0,.25,1)` / `(.4,0,.18,1)` at
the hand-offs, and `(.2,1.22,.4,1)` into the M.

**Stays still:** everything except two properties. `x`, `width`, `rx`,
the bar count, the colour and the 64 × 64 box never change — which is
why the morph is a pure interpolation.

**Native:** five `CALayer` bars, one `CAKeyframeAnimation` each on
`bounds.size.height` and `position.y`, in a `CAAnimationGroup` with
`fillMode = .forwards`. Runs on the compositor; no per-frame main-thread
work.

The card around it: 240 ms entrance, stage labels 900 ms each, banner
rows 90 ms apart, wordmark 220 ms.

**Reduce Motion:** no animation is added at all — the layers are built
at the M frame and stay there. The loading state is still communicated,
by the text line below the mark.

### Mode switch

280 ms for the frame and everything travelling; arriving controls take
the same 280 ms after a 90 ms delay. Geometry on **Panel**, late fades
on **Enter**.

The artwork travels 40 → 88 pt along one path and the title travels
with it. Nothing is removed from the hierarchy and re-added, so there is
no fade-out / fade-in and no re-layout flash.

**Stays still:** the window's top edge and its horizontal side against
the screen.

**Native:** `NSWindow.setFrame(_:display:animate:)` inside
`NSAnimationContext.runAnimationGroup`, with the subviews'
`NSLayoutConstraint.animator().constant` changed in the same group so
frame and contents share one clock.

**Reduce Motion:** resized with `animate: false`, constraints applied
outside an animation group — the new mode simply *is*. No fade on the
arriving controls either; a crossfade is still motion.

### The detached buttons

160 ms in on **Enter**, 160 ms out on **Exit**. The side flip is 0 ms,
deliberately: it is not the same button travelling, it is the same
button on the side that still has room.

**Native:** one `NSTrackingArea` spanning panel, gutters and all three
buttons; `NSView.animator().alphaValue` for the fade. The flip is a
constraint swap outside any animation group. Transparent gutters pass
clicks through via `hitTest`.

**Reduce Motion:** the circles appear and disappear at full opacity on
the same hover boundary. The reveal was always a disclosure, never
information.

### Transport

Play ↔ pause is a symbol being *replaced*; previous / next is a symbol
acknowledging a press. Two jobs, two effects.

Replace 250 ms total (150 out, 175 in, 75 overlap). Bounce 220 ms.

**Native:**
`setSymbolImage(_:contentTransition: .replace.downUp)` and
`addSymbolEffect(.bounce.up, options: .nonRepeating)`. Both are system
effects — no `CALayer` work and no timing values to maintain.

**Reduce Motion:** SF Symbols honours the system setting itself.
`.replace` becomes an instant swap, `.bounce` does not play. The state
change is never lost, only the transition.

### Seek and volume

Pick up 120 ms · drag 0 ms · release 160 ms · playback tick 1000 ms,
unanimated.

Dragging has no easing because dragging is not an animation — the thumb
is under the pointer. Only the pick-up and the release are animated.

**Native:** a custom `NSSliderCell` drawing the knob through a
`CALayer`; the scale is a `CASpringAnimation` driven from
`startTracking` / `stopTracking`. The elapsed label is an ordinary
`NSTextField` with `monospacedDigitSystemFont`.

**Reduce Motion:** the thumb jumps to its larger size and back. Drag
behaviour is unchanged.

### Shuffle and repeat

Bounce 220 ms and tint 180 ms start together; `repeat` → `repeat.1` is
a 250 ms replace.

**Reduce Motion:** no bounce, no replace — glyph and colour change in
place. The colour is doing the real work here, and colour is not motion.

### Like

Replace 250 ms · tint 180 ms · bounce 220 ms starting at 75 ms. Total
295 ms. Same on the panel and on a library row.

**Reduce Motion:** instant glyph swap, instant colour. Nothing about the
outcome depends on the bounce.

### Device picker

Open 200 ms · close 150 ms · button tint 180 ms · checkmark 180 ms.
Opacity on **Enter**, transform on **Panel**, close on **Exit**.

**Native:** `NSPopover` with `behavior = .transient`. AppKit animates
the appearance itself when `animates = true`; these values describe what
it produces.

**Reduce Motion:** set `animates = false` when
`NSWorkspace.shared.accessibilityDisplayShouldReduceMotion` is true.

### Queue

Frame 280 ms · each row 180 ms · 40 ms stagger · first row delayed
120 ms. Total 420 ms.

**Native:** `NSWindow.setFrame(_:display:animate:)` with the origin
adjusted to preserve the top edge. Rows are `NSTableRowView`s animated
inside one `NSAnimationContext` group.

**Reduce Motion:** the window resizes without animation and all four
rows are at full opacity from the first frame. The queue is either there
or not there.

### Library window

Open 240 ms · close 180 ms · row fade 150 ms · reflow 200 ms.

Selecting a row 120 ms · starting it 180 ms · footer 250 ms. The
equaliser on the playing row loops at 1100 / 858 / 1012 ms — three
deliberately unequal periods, so the bars never fall into step.

**Native:** a `CABasicAnimation` group on `transform.scale` and
`opacity` with `animationBehavior = .none` so the system default does
not fight it. Filtering uses
`NSTableView.removeRows(at:withAnimation: [.effectFade, …])`.

**Reduce Motion:** rows are removed with `withAnimation: []`, so the
list updates between frames. The equaliser stops entirely and renders as
three static bars at 8 / 14 / 10 pt — the same marker the library
already draws. A looping animation is exactly what the setting is for.

### Panel drag

Pick up 120 ms · drag 0 ms · release 160 ms · clamp 380 ms. The clamp is
the system's only spring.

**Native:** `NSWindow.isMovableByWindowBackground`, or
`performDrag(with:)` from `mouseDown` for full control. The lift is a
`CABasicAnimation` group on `transform.scale` and `shadowOpacity` /
`shadowRadius`; the clamp is a `CASpringAnimation`.

**Reduce Motion:** no lift and no spring. The panel still tracks the
pointer — that is direct manipulation, not animation — and on release it
is clamped into `visibleFrame` in one step.

### Terminal

Banner rows 90 ms apart · wordmark 220 ms · loading frame 100 ms · caret
1060 ms.

There is no easing, by definition: characters are discrete.

**Native:** plain `print` to stdout with `\r` and ANSI SGR colour. The
bar heights come from the same parametric model as the vector mark,
quantised to `▁▂▃▄▅▆▇█` — the shell and the app are literally drawing
the same logo.

**Reduce Motion:** the loading line is written once in its settled play
shape and the stage label is updated in place, with no cycling and no
blinking caret. Detect it by honouring `NO_COLOR` and a non-TTY stdout.

## Reduce Motion

Not an afterthought and not a global "turn everything off". Each
feature above states its own fallback, and they follow one rule: **the
outcome is never lost, only the transition.** A heart still fills and
still turns green; it just does not bounce.

Looping animation is the one thing removed outright — the library
equaliser becomes three static bars.

On macOS the setting is
`NSWorkspace.shared.accessibilityDisplayShouldReduceMotion`, with
`NSWorkspace.accessibilityDisplayOptionsDidChangeNotification` to
observe changes. SF Symbols effects honour it on their own.

## The source

The live, replayable version of all of this — every feature at true
size, with its beat map — is `motion.html` in the design workspace. The
tables here are its summary, not a parallel spec; if the two ever
disagree, the page is right.
