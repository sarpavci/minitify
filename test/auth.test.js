import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { authorizeUrl, exchangeCode, refresh, getAccessToken, SCOPES } from '../src/spotify/auth.js';
import { saveTokens, loadTokens } from '../src/config.js';

const CREDS = { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://127.0.0.1:8888/callback' };

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'minitify-test-'));
  process.env.MINITIFY_CONFIG_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MINITIFY_CONFIG_DIR;
});

function fakeFetch(response, calls = []) {
  const impl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    };
  };
  impl.calls = calls;
  return impl;
}

test('authorizeUrl carries the client id, redirect and streaming scope', () => {
  const url = new URL(authorizeUrl('id', CREDS.redirectUri));
  assert.equal(url.searchParams.get('client_id'), 'id');
  assert.equal(url.searchParams.get('redirect_uri'), CREDS.redirectUri);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.ok(url.searchParams.get('scope').includes('streaming'));
});

test('authorizeUrl requests every scope the player needs', () => {
  const scope = new URL(authorizeUrl('id', CREDS.redirectUri)).searchParams.get('scope');
  for (const needed of SCOPES.split(' ')) assert.ok(scope.includes(needed), `missing ${needed}`);
});

test('exchangeCode sends Basic auth and the authorization_code grant', async () => {
  const f = fakeFetch({ body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } });
  await exchangeCode('CODE', CREDS, f);
  const { url, options } = f.calls[0];
  assert.equal(url, 'https://accounts.spotify.com/api/token');
  assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('id:secret').toString('base64'));
  const body = new URLSearchParams(options.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'CODE');
});

test('exchangeCode derives expires_at from expires_in', async () => {
  const f = fakeFetch({ body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } });
  const tokens = await exchangeCode('CODE', CREDS, f);
  assert.ok(tokens.expires_at > Date.now() + 3_500_000);
  assert.ok(tokens.expires_at <= Date.now() + 3_600_000);
});

test('exchangeCode throws when Spotify returns an error', async () => {
  const f = fakeFetch({ ok: false, status: 400, body: { error: 'invalid_grant' } });
  await assert.rejects(() => exchangeCode('BAD', CREDS, f), /invalid_grant/);
});

test('refresh sends the refresh_token grant', async () => {
  const f = fakeFetch({ body: { access_token: 'new', expires_in: 3600 } });
  await refresh({ refresh_token: 'r' }, CREDS, f);
  assert.equal(new URLSearchParams(f.calls[0].options.body).get('grant_type'), 'refresh_token');
});

test('refresh keeps the old refresh_token when the response omits one', async () => {
  const f = fakeFetch({ body: { access_token: 'new', expires_in: 3600 } });
  const tokens = await refresh({ refresh_token: 'original' }, CREDS, f);
  assert.equal(tokens.refresh_token, 'original');
  assert.equal(tokens.access_token, 'new');
});

test('refresh takes a rotated refresh_token when Spotify sends one', async () => {
  const f = fakeFetch({ body: { access_token: 'new', refresh_token: 'rotated', expires_in: 3600 } });
  const tokens = await refresh({ refresh_token: 'original' }, CREDS, f);
  assert.equal(tokens.refresh_token, 'rotated');
});

test('getAccessToken returns a live token without calling Spotify', async () => {
  saveTokens({ access_token: 'live', refresh_token: 'r', expires_at: Date.now() + 600_000 });
  const f = fakeFetch({ body: {} });
  assert.equal(await getAccessToken(CREDS, f), 'live');
  assert.equal(f.calls.length, 0);
});

test('getAccessToken refreshes and stores an expired token', async () => {
  saveTokens({ access_token: 'stale', refresh_token: 'r', expires_at: Date.now() - 1000 });
  const f = fakeFetch({ body: { access_token: 'fresh', expires_in: 3600 } });
  assert.equal(await getAccessToken(CREDS, f), 'fresh');
  assert.equal(loadTokens().access_token, 'fresh');
});

test('getAccessToken points at login when there are no tokens', async () => {
  await assert.rejects(() => getAccessToken(CREDS, fakeFetch({ body: {} })), /minitify login/);
});

// Spotify rotates the refresh token on some responses. Two concurrent
// refreshes would both POST, and the loser's saved token is then dead.
test('concurrent getAccessToken calls share one refresh', async () => {
  saveTokens({ access_token: 'stale', refresh_token: 'r', expires_at: Date.now() - 1000 });
  const f = fakeFetch({ body: { access_token: 'fresh', expires_in: 3600 } });
  const [a, b, c] = await Promise.all([
    getAccessToken(CREDS, f),
    getAccessToken(CREDS, f),
    getAccessToken(CREDS, f),
  ]);
  assert.deepEqual([a, b, c], ['fresh', 'fresh', 'fresh']);
  assert.equal(f.calls.length, 1, 'only one refresh request should go out');
});

test('a later expiry refreshes again rather than reusing the memo', async () => {
  saveTokens({ access_token: 'stale', refresh_token: 'r', expires_at: Date.now() - 1000 });
  const f = fakeFetch({ body: { access_token: 'fresh', expires_in: 3600 } });
  await getAccessToken(CREDS, f);
  saveTokens({ access_token: 'stale2', refresh_token: 'r', expires_at: Date.now() - 1000 });
  await getAccessToken(CREDS, f);
  assert.equal(f.calls.length, 2);
});

test('a failed refresh points at login', async () => {
  saveTokens({ access_token: 'stale', refresh_token: 'bad', expires_at: Date.now() - 1000 });
  const f = fakeFetch({ ok: false, status: 400, body: { error: 'invalid_grant' } });
  await assert.rejects(() => getAccessToken(CREDS, f), /minitify login/);
});

test('authorizeUrl carries a state parameter', () => {
  const state = new URL(authorizeUrl('id', CREDS.redirectUri)).searchParams.get('state');
  assert.ok(state && state.length >= 16, 'state must be present and unguessable');
});

test('authorizeUrl generates a different state each time', () => {
  const stateOf = () => new URL(authorizeUrl('id', CREDS.redirectUri)).searchParams.get('state');
  assert.notEqual(stateOf(), stateOf());
});
