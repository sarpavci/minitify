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
