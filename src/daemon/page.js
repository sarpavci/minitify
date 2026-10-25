// The page is served from 127.0.0.1 on purpose: EME (and therefore the
// SDK's DRM playback) only works in a secure context, and a loopback
// origin counts as one. Loading this markup with loadHTMLString would
// give it an about:blank origin and no EME.
export function playerPage(token, deviceName, secret) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>minitify player</title></head>
<body>
<script src="https://sdk.scdn.co/spotify-player.js"></script>
<script>
const INITIAL_TOKEN = ${JSON.stringify(token)};
const DEVICE_NAME = ${JSON.stringify(deviceName)};
const KEY = ${JSON.stringify(secret ? `?k=${secret}` : '')};

function report(kind, data) {
  fetch('/event' + KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: kind, data: data || {} }),
  }).catch(function () {});
}

// Access tokens live about an hour. Ask the daemon for a fresh one every
// time the SDK needs it, so a long-running player keeps working.
function provideToken(cb) {
  fetch('/token' + KEY)
    .then(function (r) { return r.json(); })
    .then(function (j) { cb(j.token); })
    .catch(function () { cb(INITIAL_TOKEN); });
}

// macOS keeps one Now Playing entry per media session. The SDK registers
// one and cannot be stopped from doing so — replacing navigator.mediaSession
// breaks playback. So the page fills that entry with the real track and
// takes over its buttons, which lets the Swift host stay out of Now Playing
// entirely and leaves exactly one, correct entry.
function publishMetadata(state) {
  if (!('mediaSession' in navigator)) return;
  var t = state.track_window && state.track_window.current_track;
  try {
    if (t && window.MediaMetadata) {
      var images = (t.album && t.album.images) || [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.name || '',
        artist: (t.artists || []).map(function (a) { return a.name; }).join(', '),
        album: (t.album && t.album.name) || '',
        artwork: images.map(function (i) {
          return { src: i.url, sizes: (i.width || 0) + 'x' + (i.height || 0) };
        }),
      });
    }
    navigator.mediaSession.playbackState = state.paused ? 'paused' : 'playing';
  } catch (e) {}
}

// Re-applied on every state change: the SDK sets its own handlers, and the
// last writer wins.
function claimActions() {
  if (!('mediaSession' in navigator)) return;
  var map = { 'play': 'play', 'pause': 'pause', 'previoustrack': 'previous', 'nexttrack': 'next' };
  Object.keys(map).forEach(function (action) {
    try {
      navigator.mediaSession.setActionHandler(action, function () {
        report('mediakey', { command: map[action] });
      });
    } catch (e) {}
  });
}

window.onSpotifyWebPlaybackSDKReady = function () {
  const player = new Spotify.Player({
    name: DEVICE_NAME,
    getOAuthToken: provideToken,
    volume: 0.6,
  });

  player.addListener('ready', function (e) { report('ready', { device_id: e.device_id }); });
  player.addListener('not_ready', function (e) { report('not_ready', { device_id: e.device_id }); });

  ['initialization_error', 'authentication_error', 'account_error', 'playback_error']
    .forEach(function (kind) {
      player.addListener(kind, function (e) { report('error', { kind: kind, message: e.message }); });
    });

  player.addListener('player_state_changed', function (s) {
    if (!s) return;
    publishMetadata(s);
    claimActions();
    const t = s.track_window && s.track_window.current_track;
    report('state', {
      paused: s.paused,
      positionMs: s.position,
      title: t ? t.name : null,
      artist: t ? (t.artists || []).map(function (a) { return a.name; }).join(', ') : null,
      durationMs: s.duration || (t && t.duration_ms) || 0,
    });
  });

  player.connect();
};
</script>
</body>
</html>`;
}
