import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseArgs } from '../src/cli/commands.js';
import { connectOrStart } from '../src/cli/client.js';

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

test('parseArgs passes the simple control commands through', () => {
  for (const name of ['next', 'prev', 'pause', 'status', 'quit', 'login']) {
    assert.deepEqual(parseArgs([name]), { name, args: [] });
  }
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
