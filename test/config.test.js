import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { configDir, loadConfig, loadTokens, saveTokens, isExpired } from '../src/config.js';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'minitify-test-'));
  process.env.MINITIFY_CONFIG_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MINITIFY_CONFIG_DIR;
});

test('configDir honours MINITIFY_CONFIG_DIR', () => {
  assert.equal(configDir(), dir);
});

test('loadTokens returns null when the file is missing', () => {
  assert.equal(loadTokens(), null);
});

test('loadTokens returns null when the file is corrupt JSON', () => {
  writeFileSync(join(dir, 'tokens.json'), '{"access_token": "abc');
  assert.equal(loadTokens(), null);
});

test('loadTokens returns the stored tokens', () => {
  const tokens = { access_token: 'a', refresh_token: 'r', expires_at: 123 };
  writeFileSync(join(dir, 'tokens.json'), JSON.stringify(tokens));
  assert.deepEqual(loadTokens(), tokens);
});

test('saveTokens writes mode 0600', () => {
  saveTokens({ access_token: 'a', refresh_token: 'r', expires_at: 1 });
  assert.equal(statSync(join(dir, 'tokens.json')).mode & 0o777, 0o600);
});

test('saveTokens round-trips through loadTokens', () => {
  const tokens = { access_token: 'a', refresh_token: 'r', expires_at: 42 };
  saveTokens(tokens);
  assert.deepEqual(loadTokens(), tokens);
});

test('isExpired is true within the 60s safety margin', () => {
  assert.equal(isExpired({ expires_at: Date.now() + 30_000 }), true);
});

test('isExpired is false well before expiry', () => {
  assert.equal(isExpired({ expires_at: Date.now() + 120_000 }), false);
});

test('isExpired treats a missing token as expired', () => {
  assert.equal(isExpired(null), true);
});

test('loadConfig throws a login hint when the file is absent', () => {
  assert.throws(() => loadConfig(), /Run: minitify login/);
});

test('loadConfig returns the client credentials', () => {
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ clientId: 'id', clientSecret: 'secret' }));
  assert.deepEqual(loadConfig(), { clientId: 'id', clientSecret: 'secret' });
});

test('loadConfig throws a login hint when clientId is missing', () => {
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ clientSecret: 'secret' }));
  assert.throws(() => loadConfig(), /Run: minitify login/);
});
