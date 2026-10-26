import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

import { parseArgs } from '../src/cli/commands.js';
import { connectOrStart, sendCommand } from '../src/cli/client.js';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'minitify-test-'));
  process.env.MINITIFY_CONFIG_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MINITIFY_CONFIG_DIR;
});

test('parseArgs defaults to the playlists command with no arguments', () => {
  assert.deepEqual(parseArgs([]), { name: 'playlists', args: [] });
});

test('parseArgs joins the words after search into one query', () => {
  assert.deepEqual(parseArgs(['search', 'daft', 'punk']), { name: 'search', args: ['daft punk'] });
});

test('parseArgs rejects search without a query', () => {
  assert.throws(() => parseArgs(['search']), /search needs/);
});

test('parseArgs reads vol as a number', () => {
  assert.deepEqual(parseArgs(['vol', '40']), { name: 'vol', args: [40] });
});

test('parseArgs rejects vol without a number', () => {
  assert.throws(() => parseArgs(['vol']), /vol needs/);
  assert.throws(() => parseArgs(['vol', 'loud']), /vol needs/);
});

test('a reply split across chunks mid-character still parses', async () => {
  // Reproduces a live failure: Liked Songs with Korean and Thai titles
  // came back as broken JSON. The daemon's reply arrives in 64 KB chunks
  // and a multi-byte character straddles the boundary.
  const reply = JSON.stringify({ ok: true, data: [{ name: '돌덩이', artist: 'Ha Hyun Woo' }] });
  const whole = Buffer.from(reply, 'utf8');
  // Split inside the first Korean character.
  const cut = whole.indexOf(Buffer.from('돌', 'utf8')) + 1;

  const socket = new EventEmitter();
  socket.write = () => {};
  socket.setEncoding = function (enc) { this.encoding = enc; };

  const pending = sendCommand({ name: 'liked' }, { connectImpl: async () => socket });
  await new Promise((r) => setImmediate(r));
  socket.emit('data', whole.subarray(0, cut));
  socket.emit('data', whole.subarray(cut));
  socket.emit('end');

  const result = await pending;
  assert.equal(result.data[0].name, '돌덩이');
});

test('parseArgs passes the simple control commands through', () => {
  for (const name of ['next', 'prev', 'pause', 'resume', 'status', 'quit', 'login']) {
    assert.deepEqual(parseArgs([name]), { name, args: [] });
  }
});

test('parseArgs takes overlay with no argument as a toggle', () => {
  assert.deepEqual(parseArgs(['overlay']), { name: 'overlay', args: [] });
});

test('parseArgs passes overlay on and off through', () => {
  assert.deepEqual(parseArgs(['overlay', 'on']), { name: 'overlay', args: ['on'] });
  assert.deepEqual(parseArgs(['overlay', 'off']), { name: 'overlay', args: ['off'] });
});

test('parseArgs rejects an overlay argument that is neither on nor off', () => {
  assert.throws(() => parseArgs(['overlay', 'maybe']), /on or off/);
});

test('parseArgs takes shuffle with no argument as a toggle', () => {
  assert.deepEqual(parseArgs(['shuffle']), { name: 'shuffle', args: [] });
});

test('parseArgs reads shuffle on and off as booleans', () => {
  assert.deepEqual(parseArgs(['shuffle', 'on']), { name: 'shuffle', args: [true] });
  assert.deepEqual(parseArgs(['shuffle', 'off']), { name: 'shuffle', args: [false] });
});

test('parseArgs takes repeat with no argument as a cycle', () => {
  assert.deepEqual(parseArgs(['repeat']), { name: 'repeat', args: [] });
});

test('parseArgs maps the friendly repeat words to Spotify modes', () => {
  assert.deepEqual(parseArgs(['repeat', 'off']), { name: 'repeat', args: ['off'] });
  assert.deepEqual(parseArgs(['repeat', 'all']), { name: 'repeat', args: ['context'] });
  assert.deepEqual(parseArgs(['repeat', 'one']), { name: 'repeat', args: ['track'] });
});

test('parseArgs rejects a repeat mode nobody has', () => {
  assert.throws(() => parseArgs(['repeat', 'twice']), /off, all or one/);
});

test('parseArgs rejects an unknown command', () => {
  assert.throws(() => parseArgs(['fly']), /Unknown command/);
});

test('connectOrStart removes a stale socket before starting the daemon', async () => {
  const socket = join(dir, 'daemon.sock');
  writeFileSync(socket, '');          // a file left behind by a crashed daemon
  const attempts = [];

  await assert.rejects(
    () => connectOrStart({
      // Always refuses, as a dead socket file does.
      connectImpl: () => {
        attempts.push('connect');
        const err = new Error('connect ECONNREFUSED');
        err.code = 'ECONNREFUSED';
        return Promise.reject(err);
      },
      spawnImpl: () => attempts.push('spawn'),
      retries: 1,
      retryDelayMs: 1,
    }),
    /could not start/i,
  );

  assert.equal(existsSync(socket), false, 'the stale socket file must be removed');
  assert.ok(attempts.includes('spawn'), 'the daemon must be started');
});

test('connectOrStart returns the connection when the daemon is already up', async () => {
  const fake = { marker: true };
  let spawned = false;
  const conn = await connectOrStart({
    connectImpl: async () => fake,
    spawnImpl: () => { spawned = true; },
  });
  assert.equal(conn, fake);
  assert.equal(spawned, false, 'a live daemon must not be started again');
});

test('connectOrStart starts the daemon when no socket exists', async () => {
  let spawned = false;
  let calls = 0;
  const conn = await connectOrStart({
    connectImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('no socket');
        err.code = 'ENOENT';
        throw err;
      }
      return { marker: true };
    },
    spawnImpl: () => { spawned = true; },
    retries: 3,
    retryDelayMs: 1,
  });
  assert.equal(spawned, true);
  assert.deepEqual(conn, { marker: true });
});
