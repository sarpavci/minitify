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
    setVolume: record('setVolume'),
    setShuffle: record('setShuffle'),
    setRepeat: record('setRepeat'),
  };
}

function deps(extra = {}) {
  return {
    api: fakeApi(),
    player: { deviceId: 'DEV', waitReady: async () => 'DEV', lastError: null, stop() {} },
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
