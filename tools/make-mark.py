#!/usr/bin/env python3
"""Generates the animated mark SVGs in .github/assets/.

The mark is five bars that move only in height and y, through four beats:
level meter -> play triangle -> level meter -> M, settling on the M. The
geometry is the one frozen in the design lab and documented in
docs/design.md; this script is the single place it is written down as code.

SMIL is used rather than CSS because GitHub renders README images through
an <img> tag, where declarative SVG animation plays but scripts do not --
and because Firefox's support for animating SVG geometry via CSS is not
something to rely on.

    python3 tools/make-mark.py
"""
import math
import pathlib

N, W, GAP = 5, 7.0, 4.0
H_MAX, H_MIN = 40.0, 6.0
RADIUS_PCT, VEE, COUNTER = 95.0, 60.0, 45.0

RX = round(W / 2 * RADIUS_PCT / 100, 2)
TOP = 32 - H_MAX / 2
SPAN = N * W + (N - 1) * GAP
X0 = (64 - SPAN) / 2
COLUMNS = [round(X0 + i * (W + GAP), 2) for i in range(N)]


def noise(i, k):
    s = math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453
    return s - math.floor(s)


def js_round(x):
    """Python rounds halves to even, JavaScript rounds them up. The design
    lab is JavaScript, so round(0.5) has to be 1 or the second bar of the
    play beat comes out 35.3 instead of 27.7."""
    return math.floor(x + 0.5)


def stepped(t):
    return 1 - (0.55 * t + 0.45 * (js_round(t * 2) / 2))


def fraction(beat, i, k=0):
    t = i / (N - 1)
    if beat == "play":
        return (H_MIN + (H_MAX - H_MIN) * stepped(t)) / H_MAX
    if beat == "eq":
        return (H_MIN + (H_MAX - H_MIN) * noise(i, k)) / H_MAX
    mid = (N - 1) / 2
    if i in (0, N - 1):
        return 1.0
    d = min(i, N - 1 - i)
    ramp = (d - 1) / (mid - 1) if mid > 1 else 1.0
    return (COUNTER + (VEE - COUNTER) * ramp) / 100


def geom(beat, i, k=0, scale=1.0):
    """Height and y for one bar. The M hangs from the top; the other
    beats are centred, which is what makes the stems appear to rise."""
    h = fraction(beat, i, k) * H_MAX * scale
    y = TOP if beat == "m" else 32 - h / 2
    return round(h, 2), round(y, 2)


# (beat, noise frame, time, easing of the segment that STARTS here).
# The overshoot frame is why there is an "m" at 0.95 with scale 1.06:
# SMIL keySplines must stay inside 0..1, so a springy settle has to be
# spelled out as a real keyframe rather than a control point past 1.
EASE_IN_OUT = "0.42 0 0.58 1"
LINEAR = "0 0 1 1"
SCRIPT = [
    ("eq", 0, 0.00, 1.00, EASE_IN_OUT),
    ("eq", 1, 0.07, 1.00, EASE_IN_OUT),
    ("eq", 2, 0.14, 1.00, EASE_IN_OUT),
    ("eq", 3, 0.21, 1.00, "0.5 0 0.2 1"),
    ("play", 0, 0.36, 1.00, LINEAR),
    ("play", 0, 0.46, 1.00, "0.55 0 0.25 1"),
    ("eq", 5, 0.58, 1.00, EASE_IN_OUT),
    ("eq", 6, 0.65, 1.00, EASE_IN_OUT),
    ("eq", 7, 0.73, 1.00, "0.4 0 0.18 1"),
    ("m", 0, 0.92, 1.06, "0.3 0 0.3 1"),
    ("m", 0, 0.97, 1.00, LINEAR),
    ("m", 0, 1.00, 1.00, None),
]

KEY_TIMES = ";".join(f"{f[2]:g}" for f in SCRIPT)
KEY_SPLINES = ";".join(f[4] for f in SCRIPT if f[4] is not None)

GRADIENTS = {
    "dark": ("#9ff0ba", "#3fb673"),
    "light": ("#4fc07d", "#0a6c3a"),
}


def animated(theme, repeat):
    stop0, stop1 = GRADIENTS[theme]
    gid = f"g{theme}"
    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" '
        'height="64" role="img" aria-label="minitify">',
        "  <title>minitify</title>",
        f'  <linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="0.35">',
        f'    <stop offset="0" stop-color="{stop0}"/>',
        f'    <stop offset="1" stop-color="{stop1}"/>',
        "  </linearGradient>",
        f'  <g fill="url(#{gid})">',
    ]
    for i, x in enumerate(COLUMNS):
        frames = [geom(b, i, k, s) for b, k, _, s, _ in SCRIPT]
        rest_h, rest_y = geom("m", i)
        heights = ";".join(f"{h:g}" for h, _ in frames)
        ys = ";".join(f"{y:g}" for _, y in frames)
        common = (
            f'dur="3.6s" repeatCount="{repeat}" fill="freeze" calcMode="spline" '
            f'keyTimes="{KEY_TIMES}" keySplines="{KEY_SPLINES}"'
        )
        out += [
            f'    <rect x="{x:g}" y="{rest_y:g}" width="{W:g}" '
            f'height="{rest_h:g}" rx="{RX:g}">',
            f'      <animate attributeName="height" values="{heights}" {common}/>',
            f'      <animate attributeName="y" values="{ys}" {common}/>',
            "    </rect>",
        ]
    out += ["  </g>", "</svg>", ""]
    return "\n".join(out)


def still(theme=None):
    """The resting M. `theme` of None emits a currentColor template the
    app can load as an NSImage."""
    body = "\n".join(
        f'    <rect x="{x:g}" y="{geom("m", i)[1]:g}" width="{W:g}" '
        f'height="{geom("m", i)[0]:g}" rx="{RX:g}"/>'
        for i, x in enumerate(COLUMNS)
    )
    head = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" '
        'height="64" role="img" aria-label="minitify">',
        "  <title>minitify</title>",
    ]
    if theme is None:
        head.append('  <g fill="currentColor">')
    else:
        stop0, stop1 = GRADIENTS[theme]
        gid = f"s{theme}"
        head += [
            f'  <linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="0.35">',
            f'    <stop offset="0" stop-color="{stop0}"/>',
            f'    <stop offset="1" stop-color="{stop1}"/>',
            "  </linearGradient>",
            f'  <g fill="url(#{gid})">',
        ]
    return "\n".join(head + [body, "  </g>", "</svg>", ""])


def main():
    out = pathlib.Path(__file__).resolve().parent.parent / ".github" / "assets"
    out.mkdir(parents=True, exist_ok=True)
    written = {
        # The README header plays the story twice and then stays the M,
        # so the page settles instead of flickering at the reader.
        "mark-dark.svg": animated("dark", "2"),
        "mark-light.svg": animated("light", "2"),
        # For the docs, where the motion is the subject.
        "mark-loop-dark.svg": animated("dark", "indefinite"),
        "mark-loop-light.svg": animated("light", "indefinite"),
        "mark-still-dark.svg": still("dark"),
        "mark-still-light.svg": still("light"),
        "mark-template.svg": still(None),
    }
    for name, content in written.items():
        (out / name).write_text(content)
        print(f"{name}  {len(content):>5} bytes")


if __name__ == "__main__":
    main()
