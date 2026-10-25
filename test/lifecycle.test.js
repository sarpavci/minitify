import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { claimSocket } from '../src/daemon/lifecycle.js';
import { createPlayer } from '../src/player/control.js';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'minitify-test-'));
  process.env.MINITIFY_CONFIG_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MINITIFY_CONFIG_DIR;
});

// Two CLI invocations racing on a cold start would otherwise each spawn a
// daemon; the second must stand down instead of unlinking the first's
// socket and binding its own.
test('claimSocket refuses when another daemon answers', async () => {
  const path = join(dir, 'daemon.sock');
  writeFileSync(path, '');
  const claimed = await claimSocket(path, { connectImpl: async () => ({ end() {} }) });
  assert.equal(claimed, false);
  assert.equal(existsSync(path), true, 'a live daemon keeps its socket');
});

test('claimSocket takes over a socket nothing is listening on', async () => {
  const path = join(dir, 'daemon.sock');
  writeFileSync(path, '');
  const claimed = await claimSocket(path, {
    connectImpl: async () => {
      const err = new Error('refused');
      err.code = 'ECONNREFUSED';
      throw err;
    },
  });
  assert.equal(claimed, true);
  assert.equal(existsSync(path), false, 'the dead socket is removed');
});

test('claimSocket succeeds when there is no socket at all', async () => {
  const claimed = await claimSocket(join(dir, 'daemon.sock'), {
    connectImpl: async () => {
      const err = new Error('missing');
      err.code = 'ENOENT';
      throw err;
    },
  });
  assert.equal(claimed, true);
});

// --- player lifetime ---

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => { child.killed = true; };
  return child;
}

test('a spawn error is recorded instead of taking the daemon down', async () => {
  const child = fakeChild();
  const player = createPlayer({ pagePort: 1, spawnImpl: () => child });
  player.start();
  const err = new Error('spawn ENOENT');
  err.code = 'ENOENT';
  child.emit('error', err);          // would be an uncaught exception without a listener
  assert.match(player.lastError, /build\.sh/, 'the message must point at the fix');
});

// WebKit can kill the content process while the host app lives on. The
// daemon would keep a device id Spotify still accepts commands for, and
// every play would succeed silently with no sound.
test('a reloading notice clears the stale device id', async () => {
  const child = fakeChild();
  const player = createPlayer({ pagePort: 1, spawnImpl: () => child });
  player.start();
  player.handleEvent('ready', { device_id: 'OLD' });
  assert.equal(player.deviceId, 'OLD');

  child.stdout.write('{"type":"reloading","reason":"web content process terminated"}\n');
  await new Promise((r) => setImmediate(r));

  assert.equal(player.deviceId, null, 'the dead device id must not survive a reload');
  assert.match(player.lastError, /content process/);
});

test('the player is restarted after its process dies', async () => {
  let spawns = 0;
  const player = createPlayer({
    pagePort: 1,
    spawnImpl: () => { spawns += 1; return fakeChild(); },
  });
  player.start();
  assert.equal(spawns, 1);
  player.start();
  assert.equal(spawns, 1, 'start is idempotent while the child lives');

  player.handleExit();
  player.start();
  assert.equal(spawns, 2, 'a dead player can be started again');
});

test('waitReady restarts a dead player rather than waiting out the timeout', async () => {
  let spawns = 0;
  const player = createPlayer({
    pagePort: 1,
    spawnImpl: () => { spawns += 1; return fakeChild(); },
  });
  player.start();
  player.handleExit();

  const pending = player.waitReady(50).catch(() => 'timed out');
  assert.equal(spawns, 2, 'waiting on a dead player brings it back');
  await pending;
});
