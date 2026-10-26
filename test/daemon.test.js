import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { handleCommand } from '../src/daemon/commands.js';
import { createPlayer } from '../src/player/control.js';

function fakeApi(overrides = {}) {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push([name, ...args]);
    return overrides[name]?.(...args);
  };
  return {
    calls,
    listPlaylists: record('listPlaylists'),
    search: record('search'),
    status: record('status'),
    playContext: record('playContext'),
    playUris: record('playUris'),
    transfer: record('transfer'),
    pause: record('pause'),
    resume: record('resume'),
    next: record('next'),
    previous: record('previous'),
    seek: record('seek'),
    setVolume: record('setVolume'),
    setShuffle: record('setShuffle'),
    setRepeat: record('setRepeat'),
  };
}

function deps(extra = {}) {
  return {
    api: fakeApi(),
    player: { deviceId: 'DEV', waitReady: async () => 'DEV', lastError: null, stop() {} },
    // The daemon always passes one; commands remember the context in it.
    playbackState: { shuffle: false, repeat: 'off' },
    shutdown: () => {},
    ...extra,
  };
}

test('handleCommand routes pause to api.pause', async () => {
  const d = deps();
  const result = await handleCommand({ name: 'pause' }, d);
  assert.equal(result.ok, true);
  assert.deepEqual(d.api.calls[0], ['pause']);
});

test('handleCommand routes next and prev', async () => {
  const d = deps();
  await handleCommand({ name: 'next' }, d);
  await handleCommand({ name: 'prev' }, d);
  assert.deepEqual(d.api.calls.map((c) => c[0]), ['next', 'previous']);
});

test('handleCommand routes seek, in milliseconds', async () => {
  const d = deps();
  const result = await handleCommand({ name: 'seek', args: [61500] }, d);
  assert.equal(result.ok, true);
  assert.deepEqual(d.api.calls.at(-1), ['seek', 61500]);
});

test('a library write Spotify has closed says so, not just Forbidden', async () => {
  const d = deps();
  d.api.setSaved = async () => {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  };

  const result = await handleCommand({ name: 'like', args: ['spotify:track:a', true] }, d);

  assert.equal(result.ok, false);
  assert.match(result.error, /Development Mode/i);
});

test('a scope the token predates says how to fix it', async () => {
  // Spotify's own wording says nothing a user can act on, and a refresh
  // token carries the scopes it was issued with — no amount of retrying
  // gets this one back.
  const d = deps();
  d.api.savedTracks = async () => {
    const err = new Error('Insufficient client scope');
    err.status = 403;
    throw err;
  };

  const result = await handleCommand({ name: 'liked' }, d);

  assert.equal(result.ok, false);
  assert.match(result.error, /minitify login/);
});

test('tracks marks rows that are in Liked Songs', async () => {
  // The heart is read-only: asking Spotify whether a track is saved is
  // forbidden to this app, but the Liked Songs list answers it for free.
  const d = deps();
  d.api.savedTracks = async () => [{ uri: 'spotify:track:b' }];
  d.api.playlistTracks = async () => [
    { name: 'a', uri: 'spotify:track:a' },
    { name: 'b', uri: 'spotify:track:b' },
  ];

  const result = await handleCommand({ name: 'tracks', args: ['spotify:playlist:7'] }, d);

  assert.deepEqual(result.data.tracks.map((t) => t.saved), [false, true]);
});

test('tracks explains a playlist Spotify will not open rather than failing', async () => {
  // Development Mode only gets the items of playlists the user owns.
  const d = deps();
  d.api.savedTracks = async () => [];
  d.api.playlistTracks = async () => {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  };

  const result = await handleCommand({ name: 'tracks', args: ['spotify:playlist:7'] }, d);

  assert.equal(result.ok, true, 'the window still has something to show');
  assert.deepEqual(result.data.tracks, []);
  assert.match(result.data.note, /follow/i);
});

test('liked returns the saved tracks with their saved flag already set', async () => {
  // The panel draws a filled heart on every row, so asking per row would
  // be one request each. They come back marked.
  const d = deps();
  d.api.savedTracks = async () => [
    { name: 'a', uri: 'spotify:track:a' },
    { name: 'b', uri: 'spotify:track:b' },
  ];
  const result = await handleCommand({ name: 'liked' }, d);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.map((t) => t.saved), [true, true]);
});

test('like toggles a track and answers with where it landed', async () => {
  const d = deps();
  const seen = [];
  d.api.setSaved = async (uri, saved) => { seen.push([uri, saved]); };

  assert.deepEqual(
    (await handleCommand({ name: 'like', args: ['spotify:track:a', true] }, d)).data,
    { uri: 'spotify:track:a', saved: true },
  );
  await handleCommand({ name: 'like', args: ['spotify:track:a', false] }, d);

  assert.deepEqual(seen, [['spotify:track:a', true], ['spotify:track:a', false]]);
});

test('like with no state asks Spotify which way to go', async () => {
  const d = deps();
  d.api.isSaved = async () => [true];
  let wrote;
  d.api.setSaved = async (_uri, saved) => { wrote = saved; };

  const result = await handleCommand({ name: 'like', args: ['spotify:track:a'] }, d);

  assert.equal(wrote, false, 'already saved, so the toggle removes it');
  assert.deepEqual(result.data, { uri: 'spotify:track:a', saved: false });
});

test('like without a uri is rejected', async () => {
  const result = await handleCommand({ name: 'like', args: [] }, deps());
  assert.equal(result.ok, false);
  assert.match(result.error, /uri/i);
});

test('jump plays a track inside the context it belongs to', async () => {
  // A queue row reached by playing its uri alone would throw the rest of
  // the playlist away. Spotify keeps the queue when the context is given.
  const d = deps();
  await handleCommand({ name: 'play', args: ['spotify:playlist:1'] }, d);
  await handleCommand({ name: 'jump', args: ['spotify:track:9'] }, d);

  assert.deepEqual(d.api.calls.at(-1), ['playContext', 'spotify:playlist:1', 'DEV', 'spotify:track:9']);
});

test('jump falls back to the track alone when no context is known', async () => {
  const d = deps();
  const result = await handleCommand({ name: 'jump', args: ['spotify:track:9'] }, d);

  assert.equal(result.ok, true);
  assert.deepEqual(d.api.calls.at(-1), ['playUris', ['spotify:track:9'], 'DEV']);
});

test('jump without a uri is rejected', async () => {
  const result = await handleCommand({ name: 'jump', args: [] }, deps());
  assert.equal(result.ok, false);
  assert.match(result.error, /uri/i);
});

test('handleCommand returns ok:false for an unknown command', async () => {
  const result = await handleCommand({ name: 'fly' }, deps());
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown command/);
});

test('handleCommand passes the device id when starting playback', async () => {
  const d = deps();
  await handleCommand({ name: 'play', args: ['spotify:playlist:1'] }, d);
  assert.deepEqual(d.api.calls.at(-1), ['playContext', 'spotify:playlist:1', 'DEV']);
});

// A Web Playback SDK device registers as inactive. Starting playback with
// device_id alone leaves it that way and nothing comes out of the speakers;
// it has to be transferred to first.
test('play transfers to the device before starting playback', async () => {
  const d = deps();
  await handleCommand({ name: 'play', args: ['spotify:playlist:1'] }, d);
  assert.deepEqual(d.api.calls.map((c) => c[0]), ['transfer', 'playContext']);
  assert.deepEqual(d.api.calls[0], ['transfer', 'DEV']);
});

// Spotify answers 200 for a play aimed at a device that has quietly died,
// so "the request succeeded" is not evidence that music started.
test('play restarts the player when playback never actually starts', async () => {
  let restarts = 0;
  const player = {
    deviceId: 'DEV',
    lastError: null,
    waitReady: async () => 'DEV',
    waitForPlayback: async () => false, // nothing ever starts
    restart() { restarts += 1; },
    stop() {},
  };
  const d = deps({ player });
  await handleCommand({ name: 'play', args: ['spotify:playlist:1'] }, d);

  assert.equal(restarts, 1, 'a silent failure must refresh the player');
  const plays = d.api.calls.filter((c) => c[0] === 'playContext');
  assert.equal(plays.length, 2, 'and try once more');
});

test('play does not restart the player when music starts', async () => {
  let restarts = 0;
  const player = {
    deviceId: 'DEV',
    lastError: null,
    waitReady: async () => 'DEV',
    waitForPlayback: async () => true,
    restart() { restarts += 1; },
    stop() {},
  };
  const d = deps({ player });
  await handleCommand({ name: 'play', args: ['spotify:playlist:1'] }, d);

  assert.equal(restarts, 0);
  assert.equal(d.api.calls.filter((c) => c[0] === 'playContext').length, 1);
});

test('resume transfers to the device as well', async () => {
  const d = deps();
  await handleCommand({ name: 'resume' }, d);
  assert.deepEqual(d.api.calls.map((c) => c[0]), ['transfer', 'resume']);
});

test('handleCommand plays a track uri through playUris', async () => {
  const d = deps();
  await handleCommand({ name: 'play', args: ['spotify:track:9'] }, d);
  const playCall = d.api.calls.at(-1);
  assert.equal(playCall[0], 'playUris');
  assert.deepEqual(playCall[1], ['spotify:track:9']);
});

test('handleCommand surfaces a 429 retryAfter in the error text', async () => {
  const api = fakeApi({
    next: () => {
      const err = new Error('rate');
      err.status = 429;
      err.retryAfter = 18;
      throw err;
    },
  });
  const result = await handleCommand({ name: 'next' }, deps({ api }));
  assert.equal(result.ok, false);
  assert.match(result.error, /18/);
});

test('a stored SDK error is returned instead of a generic failure', async () => {
  const player = {
    deviceId: null,
    lastError: 'Account error: premium required',
    waitReady: async () => {
      throw new Error('player not ready');
    },
    stop() {},
  };
  const result = await handleCommand({ name: 'play', args: ['spotify:playlist:1'] }, deps({ player }));
  assert.equal(result.ok, false);
  assert.match(result.error, /premium required/);
});

test('handleCommand reports volume validation errors', async () => {
  const api = fakeApi({
    setVolume: () => {
      throw new Error('Volume must be between 0 and 100');
    },
  });
  const result = await handleCommand({ name: 'vol', args: [150] }, deps({ api }));
  assert.equal(result.ok, false);
  assert.match(result.error, /between 0 and 100/);
});

test('shuffle toggles against the last known state', async () => {
  const d = deps();
  d.playbackState = { shuffle: false, repeat: 'off' };
  await handleCommand({ name: 'shuffle' }, d);
  assert.deepEqual(d.api.calls.at(-1), ['setShuffle', true]);

  d.playbackState.shuffle = true;
  await handleCommand({ name: 'shuffle' }, d);
  assert.deepEqual(d.api.calls.at(-1), ['setShuffle', false]);
});

test('shuffle accepts an explicit state', async () => {
  const d = deps();
  d.playbackState = { shuffle: true, repeat: 'off' };
  await handleCommand({ name: 'shuffle', args: [false] }, d);
  assert.deepEqual(d.api.calls.at(-1), ['setShuffle', false]);
});

// Spotify's repeat is a three-way cycle, so the button has to walk it.
test('repeat cycles off then context then track then back', async () => {
  const d = deps();
  d.playbackState = { shuffle: false, repeat: 'off' };

  await handleCommand({ name: 'repeat' }, d);
  assert.deepEqual(d.api.calls.at(-1), ['setRepeat', 'context']);

  d.playbackState.repeat = 'context';
  await handleCommand({ name: 'repeat' }, d);
  assert.deepEqual(d.api.calls.at(-1), ['setRepeat', 'track']);

  d.playbackState.repeat = 'track';
  await handleCommand({ name: 'repeat' }, d);
  assert.deepEqual(d.api.calls.at(-1), ['setRepeat', 'off']);
});

test('repeat accepts an explicit mode', async () => {
  const d = deps();
  d.playbackState = { shuffle: false, repeat: 'off' };
  await handleCommand({ name: 'repeat', args: ['track'] }, d);
  assert.deepEqual(d.api.calls.at(-1), ['setRepeat', 'track']);
});

test('overlay shows, hides and toggles the panel', async () => {
  const shown = [];
  const player = {
    deviceId: 'DEV', lastError: null,
    waitReady: async () => 'DEV', waitForPlayback: async () => true,
    restart() {}, stop() {},
    setOverlay(v) { shown.push(v); },
    overlayVisible: false,
  };
  const d = deps({ player });

  await handleCommand({ name: 'overlay' }, d);
  assert.deepEqual(shown, [true], 'a hidden overlay is shown');

  player.overlayVisible = true;
  await handleCommand({ name: 'overlay' }, d);
  assert.deepEqual(shown, [true, false], 'a visible overlay is hidden');

  await handleCommand({ name: 'overlay', args: ['on'] }, d);
  assert.deepEqual(shown.at(-1), true, 'an explicit on always shows');

  await handleCommand({ name: 'overlay', args: ['off'] }, d);
  assert.deepEqual(shown.at(-1), false, 'an explicit off always hides');
});

test('overlay starts the player when it is not running yet', async () => {
  const d = deps();
  d.player.deviceId = null;
  d.player.setOverlay = () => {};
  const result = await handleCommand({ name: 'overlay', args: ['on'] }, d);
  assert.equal(result.ok, true);
});

test('quit asks the daemon to shut down', async () => {
  let stopped = false;
  const result = await handleCommand({ name: 'quit' }, deps({ shutdown: () => { stopped = true; } }));
  assert.equal(result.ok, true);
  assert.equal(stopped, true);
});

// --- player control ---

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => { child.killed = true; };
  return child;
}

test('createPlayer resolves waitReady when the ready event arrives', async () => {
  const child = fakeChild();
  const player = createPlayer({ pagePort: 1234, spawnImpl: () => child });
  player.start();
  player.handleEvent('ready', { device_id: 'ABC' });
  assert.equal(await player.waitReady(1000), 'ABC');
  assert.equal(player.deviceId, 'ABC');
});

test('waitReady rejects after the timeout', async () => {
  const player = createPlayer({ pagePort: 1234, spawnImpl: () => fakeChild() });
  player.start();
  await assert.rejects(() => player.waitReady(20), /not ready/);
});

test('createPlayer records the last SDK error', async () => {
  const player = createPlayer({ pagePort: 1234, spawnImpl: () => fakeChild() });
  player.start();
  player.handleEvent('error', { kind: 'account_error', message: 'premium required' });
  assert.match(player.lastError, /premium required/);
});

test('a media key line from the player invokes the callback', async () => {
  const child = fakeChild();
  const seen = [];
  const player = createPlayer({ pagePort: 1234, spawnImpl: () => child, onMediaKey: (c) => seen.push(c) });
  player.start();
  child.stdout.write('{"type":"mediakey","command":"toggle"}\n');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, ['toggle']);
});

test('sendNowPlaying writes one json line to the player', async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on('data', (d) => written.push(d.toString()));
  const player = createPlayer({ pagePort: 1234, spawnImpl: () => child });
  player.start();
  player.sendNowPlaying({ title: 'T', artist: 'A', durationMs: 1000, positionMs: 10, playing: true });
  await new Promise((r) => setImmediate(r));
  const line = JSON.parse(written.join(''));
  assert.equal(line.type, 'nowplaying');
  assert.equal(line.title, 'T');
});

test('the player spawns against the page url built from the port', async () => {
  let seenArgs;
  const player = createPlayer({ pagePort: 4321, spawnImpl: (bin, args) => { seenArgs = args; return fakeChild(); } });
  player.start();
  assert.match(seenArgs[0], /^http:\/\/127\.0\.0\.1:4321\/player$/);
});

test('the player can ask the daemon for something', async () => {
  // The library window needs data on demand: playlists and tracks are too
  // big to push on every state change and are wanted only when it is open.
  const child = fakeChild();
  const asked = [];
  const player = createPlayer({
    pagePort: 1234,
    spawnImpl: () => child,
    onRequest: (request) => asked.push(request),
  });
  player.start();

  child.stdout.write(JSON.stringify({
    type: 'request', id: 7, name: 'tracks', args: ['spotify:playlist:1'],
  }) + '\n');
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(asked, [{ id: 7, name: 'tracks', args: ['spotify:playlist:1'] }]);
});

test('an answer goes back to the player as one line', async () => {
  const child = fakeChild();
  const written = [];
  child.stdin.on('data', (d) => written.push(d.toString()));
  const player = createPlayer({ pagePort: 1234, spawnImpl: () => child });
  player.start();

  player.sendAnswer(7, { ok: true, data: [1, 2] });
  await new Promise((r) => setImmediate(r));

  const line = JSON.parse(written.join(''));
  assert.deepEqual(line, { type: 'answer', id: 7, ok: true, data: [1, 2] });
});

test('a media key message carries its value through', async () => {
  // The overlay's sliders travel the same path as the media keys, and a
  // volume or seek is meaningless without the number attached.
  const child = fakeChild();
  const seen = [];
  const player = createPlayer({
    pagePort: 1234,
    spawnImpl: () => child,
    onMediaKey: (command, value) => seen.push([command, value]),
  });
  player.start();

  child.stdout.write(JSON.stringify({ type: 'mediakey', command: 'toggle' }) + '\n');
  child.stdout.write(JSON.stringify({ type: 'mediakey', command: 'vol', value: 55 }) + '\n');
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(seen, [['toggle', undefined], ['vol', 55]]);
});

test('waitForState settles on any state, playing or paused', async () => {
  // A transferred device comes back paused, so waitForPlayback never
  // settles for it. The SDK emits a state event as soon as it is the
  // active player, which is the signal a transfer has actually landed.
  const player = createPlayer({ pagePort: 1234, spawnImpl: () => fakeChild() });
  player.start();

  const settled = player.waitForState(1000);
  player.handleEvent('state', { paused: true, title: 'T' });

  assert.equal(await settled, true);
  assert.equal(await player.waitForState(10), false, 'and times out when nothing comes');
});

test('a restart survives the old player exiting afterwards', async () => {
  // stop() kills the old child and start() spawns its replacement, but the
  // old child's exit event arrives later. Handling it blindly nulls the
  // handle to the player that is now live: sends stop reaching it, quit
  // stops killing it, and the next waitReady spawns a second one.
  const children = [];
  const player = createPlayer({
    pagePort: 1234,
    spawnImpl: () => { const c = fakeChild(); children.push(c); return c; },
  });

  player.start();
  const old = children[0];
  player.restart();
  const live = children[1];

  old.emit('exit', 0);                 // late news about a process already replaced
  await new Promise((r) => setImmediate(r));

  assert.equal(player.running, true, 'the replacement is still the live player');

  const written = [];
  live.stdin.on('data', (d) => written.push(d.toString()));
  player.handleEvent('ready', { device_id: 'NEW' });
  player.setOverlay(true);
  await new Promise((r) => setImmediate(r));

  assert.equal(player.deviceId, 'NEW');
  assert.match(written.join(''), /"type":"overlay"/, 'messages must still reach it');

  player.stop();
  assert.equal(live.killed, true, 'quit has to be able to kill the live player');
  assert.equal(children.length, 2, 'no third process may be spawned');
});

// ── a device id Spotify no longer knows ──────────────────────────────
// After a sleep the daemon still holds the id the SDK registered, but
// Spotify has dropped the device. Every call naming it answers 404.

function deviceGone() {
  const err = new Error('Device not found');
  err.status = 404;
  return err;
}

function recoveringDeps(apiOverrides) {
  const state = { restarts: 0, deviceId: 'STALE' };
  return {
    state,
    api: fakeApi(apiOverrides(state)),
    player: {
      get deviceId() { return state.deviceId; },
      waitReady: async () => state.deviceId,
      lastError: null,
      stop() {},
      restart() { state.restarts += 1; state.deviceId = 'FRESH'; },
      waitForPlayback: async () => true,
    },
    shutdown: () => {},
  };
}

test('play replaces a device Spotify has dropped and succeeds', async () => {
  const d = recoveringDeps(() => ({
    transfer: async (id) => { if (id === 'STALE') throw deviceGone(); },
  }));

  const result = await handleCommand({ name: 'play', args: ['spotify:track:1'] }, d);

  assert.equal(result.ok, true, 'the second attempt must succeed');
  assert.equal(d.state.restarts, 1, 'the dead player has to be brought back');
  assert.deepEqual(d.api.calls.map((c) => c[0]), ['transfer', 'transfer', 'playUris']);
  assert.deepEqual(d.api.calls[1], ['transfer', 'FRESH']);
});

test('resume replaces a device Spotify has dropped', async () => {
  const d = recoveringDeps(() => ({
    transfer: async (id) => { if (id === 'STALE') throw deviceGone(); },
  }));

  const result = await handleCommand({ name: 'resume' }, d);

  assert.equal(result.ok, true);
  assert.equal(d.state.restarts, 1);
});

test('next recovers when no device is active any more', async () => {
  const d = recoveringDeps((state) => ({
    next: async () => { if (state.deviceId === 'STALE') throw deviceGone(); },
  }));

  const result = await handleCommand({ name: 'next' }, d);

  assert.equal(result.ok, true);
  assert.equal(d.state.restarts, 1);
  // The retry only works because the fresh device was made active first.
  assert.deepEqual(d.api.calls.map((c) => c[0]), ['next', 'transfer', 'next']);
});

test('a failure that is not about the device is reported, not retried', async () => {
  const d = recoveringDeps(() => ({
    next: async () => {
      const err = new Error('Service unavailable');
      err.status = 503;
      throw err;
    },
  }));

  const result = await handleCommand({ name: 'next' }, d);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Service unavailable');
  assert.equal(d.state.restarts, 0, 'restarting the player cannot fix a 503');
  assert.deepEqual(d.api.calls.map((c) => c[0]), ['next']);
});

test('a 404 about the music, not the device, never restarts the player', async () => {
  // Playing a playlist that has been deleted also answers 404. Treating
  // that as a dead device would kill whatever is currently playing to
  // recover from something a restart cannot fix.
  const d = recoveringDeps(() => ({
    playContext: async () => {
      const err = new Error('Non existing id: spotify:playlist:gone');
      err.status = 404;
      throw err;
    },
  }));

  const result = await handleCommand({ name: 'play', args: ['spotify:playlist:gone'] }, d);

  assert.equal(result.ok, false);
  assert.match(result.error, /Non existing id/);
  assert.equal(d.state.restarts, 0, 'the music must not be cut off for this');
});

test('a bare 404 from a playback endpoint counts as a dead device', async () => {
  // Spotify does not always put a reason in the body; api.js then falls
  // back to its own wording. On the playback endpoints nothing else 404s.
  const d = recoveringDeps((state) => ({
    next: async () => {
      if (state.deviceId !== 'STALE') return;
      const err = new Error('Spotify request failed (HTTP 404)');
      err.status = 404;
      throw err;
    },
  }));

  const result = await handleCommand({ name: 'next' }, d);

  assert.equal(result.ok, true);
  assert.equal(d.state.restarts, 1);
});

test('nothing playing anywhere is reported, not recovered from', async () => {
  // "No active device" is the ordinary answer when nothing is playing at
  // all. Treating it as a dead device would tear down and respawn a player
  // that is perfectly healthy, then transfer playback to it — taking it
  // away from the phone it may be on — to skip a track that is not there.
  const d = recoveringDeps(() => ({
    next: async () => {
      const err = new Error('Player command failed: No active device found');
      err.status = 404;
      throw err;
    },
  }));

  const result = await handleCommand({ name: 'next' }, d);

  assert.equal(result.ok, false);
  assert.match(result.error, /No active device/);
  assert.equal(d.state.restarts, 0, 'a healthy player must not be restarted');
  assert.deepEqual(d.api.calls.map((c) => c[0]), ['next'], 'and nothing transferred');
});

test('a device that died mid-playback is recovered from', async () => {
  // Observed against the live API: when the device goes while Spotify
  // still believes it is the active one, a transport command answers 404
  // "Not found." — not "Device not found", and not the "No active device
  // found" that means nothing is playing. This is the shape a sleep
  // leaves behind, so it is the one that matters most.
  const d = recoveringDeps((state) => ({
    next: async () => {
      if (state.deviceId !== 'FRESH') {
        const err = new Error('Not found.');
        err.status = 404;
        throw err;
      }
    },
  }));

  const result = await handleCommand({ name: 'next' }, d);

  assert.equal(result.ok, true);
  assert.equal(d.state.restarts, 1);
  assert.deepEqual(d.api.calls.map((c) => c[0]), ['next', 'transfer', 'next']);
});

test('no active device IS our device when we no longer have one', async () => {
  // Same wording as the nothing-is-playing case above, and Spotify gives
  // both for the same dead device depending on how fast it deregisters.
  // The message cannot separate them; our own state can. A healthy player
  // holds a device id, one that has died does not.
  const d = recoveringDeps((state) => ({
    next: async () => {
      if (state.deviceId !== 'FRESH') {
        const err = new Error('Player command failed: No active device found');
        err.status = 404;
        throw err;
      }
    },
  }));
  d.state.deviceId = null;          // the player died and took the id with it

  const result = await handleCommand({ name: 'next' }, d);

  assert.equal(result.ok, true);
  assert.equal(d.state.restarts, 1);
});

test('the retry waits for the transfer to land before giving up', async () => {
  // Measured live: the command that triggers the recovery fails, and the
  // same command a second later works. Spotify's transfer is eventually
  // consistent, so the device needs a moment to count as active — and by
  // then we do hold a device id, so the entry heuristic no longer applies.
  let attempts = 0;
  const d = recoveringDeps(() => ({
    next: async () => {
      attempts += 1;
      if (attempts >= 3) return;
      const err = new Error('Player command failed: No active device found');
      err.status = 404;
      throw err;
    },
  }));
  d.state.deviceId = null;

  const result = await handleCommand({ name: 'next' }, d);

  assert.equal(result.ok, true);
  assert.equal(d.state.restarts, 1, 'still only one restart');
  assert.equal(attempts, 3);
});

test('two commands meeting the dead device share one recovery', async () => {
  // The daemon serves connections concurrently and media keys run their own
  // commands, so two can meet the dead device at once. Restarting twice
  // kills the player the first restart just spawned, and the first command
  // then waits five seconds for a process that no longer exists.
  const state = { restarts: 0, deviceId: 'STALE' };
  const waiters = [];
  const d = {
    api: fakeApi({
      next: async () => { if (state.deviceId !== 'FRESH') throw deviceGone(); },
    }),
    player: {
      get deviceId() { return state.deviceId; },
      waitReady: () => new Promise((resolve) => waiters.push(resolve)),
      lastError: null,
      stop() {},
      restart() { state.restarts += 1; state.deviceId = null; },
      waitForPlayback: async () => true,
    },
    shutdown: () => {},
  };

  const both = Promise.all([
    handleCommand({ name: 'next' }, d),
    handleCommand({ name: 'next' }, d),
  ]);

  await new Promise((r) => setImmediate(r));
  state.deviceId = 'FRESH';                 // the replacement registers
  for (const resolve of waiters) resolve('FRESH');

  const results = await both;

  assert.deepEqual(results.map((r) => r.ok), [true, true]);
  assert.equal(state.restarts, 1, 'one restart, not one per command');
});

test('a device that is gone twice reports the error instead of looping', async () => {
  const d = recoveringDeps(() => ({
    transfer: async () => { throw deviceGone(); },
  }));

  const result = await handleCommand({ name: 'play', args: ['spotify:track:1'] }, d);

  assert.equal(result.ok, false);
  assert.match(result.error, /Device not found/);
  assert.equal(d.state.restarts, 1, 'exactly one recovery attempt');
});
