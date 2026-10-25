import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect as netConnect } from 'node:net';

import { playerPage } from '../src/daemon/page.js';
import { startHttpServer } from '../src/daemon/http.js';

test('playerPage embeds the token as a JSON string literal', () => {
  assert.ok(playerPage('TOKEN123', 'minitify').includes('"TOKEN123"'));
});

test('playerPage escapes a token containing a quote', () => {
  const html = playerPage('ab"cd', 'minitify');
  assert.ok(html.includes('"ab\\"cd"'), 'the quote must be escaped, not closed');
});

test('playerPage names the device', () => {
  assert.ok(playerPage('t', 'my-player').includes('"my-player"'));
});

test('playerPage loads the official SDK', () => {
  assert.ok(playerPage('t', 'd').includes('https://sdk.scdn.co/spotify-player.js'));
});

// Replacing navigator.mediaSession with an inert object broke playback —
// the SDK depends on it. So instead of suppressing it, the page writes the
// real track into it and claims its action handlers, which lets the Swift
// host drop its own Now Playing entry and leaves one correct entry.
test('playerPage leaves navigator.mediaSession usable by the SDK', () => {
  assert.ok(
    !playerPage('t', 'd').includes('defineProperty(navigator'),
    'the SDK needs a working media session',
  );
});

test('playerPage writes the current track into the media session', () => {
  const html = playerPage('t', 'd');
  assert.ok(html.includes('MediaMetadata'), 'metadata must be published');
  assert.ok(html.includes('mediaSession.playbackState'), 'play state must be published');
});

test('playerPage claims the media session action handlers', () => {
  const html = playerPage('t', 'd');
  for (const action of ['previoustrack', 'nexttrack', 'play', 'pause']) {
    assert.ok(html.includes(`'${action}'`), `missing handler for ${action}`);
  }
});

test('media session actions are reported as media keys', () => {
  assert.ok(playerPage('t', 'd').includes("report('mediakey'"), 'actions must reach the daemon');
});

test('the server serves the page at /player', async () => {
  const server = await startHttpServer({ token: 'T', deviceName: 'd', onEvent: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/player`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('spotify-player.js'));
  } finally {
    await server.close();
  }
});

test('the server 404s on an unknown path', async () => {
  const server = await startHttpServer({ token: 'T', deviceName: 'd', onEvent: () => {} });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/nope`)).status, 404);
  } finally {
    await server.close();
  }
});

test('POST /event forwards kind and data to onEvent', async () => {
  const seen = [];
  const server = await startHttpServer({ token: 'T', deviceName: 'd', onEvent: (k, d) => seen.push([k, d]) });
  try {
    await fetch(`http://127.0.0.1:${server.port}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ready', data: { device_id: 'DEV' } }),
    });
    assert.deepEqual(seen, [['ready', { device_id: 'DEV' }]]);
  } finally {
    await server.close();
  }
});

// The access token carries streaming, playback-control and library scopes.
// Without a check, any local process can curl it off the loopback port, and
// a web page can reach it through DNS rebinding.
test('/token refuses a request without the secret', async () => {
  const server = await startHttpServer({ token: 'T', deviceName: 'd', onEvent: () => {}, secret: 's3cret' });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/token`);
    assert.equal(res.status, 403);
    assert.ok(!(await res.text()).includes('T'), 'the token must not leak in the body');
  } finally {
    await server.close();
  }
});

test('/token answers when the secret matches', async () => {
  const server = await startHttpServer({ token: 'T', deviceName: 'd', onEvent: () => {}, secret: 's3cret' });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/token?k=s3cret`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).token, 'T');
  } finally {
    await server.close();
  }
});

test('/event refuses a forged event without the secret', async () => {
  const seen = [];
  const server = await startHttpServer({
    token: 'T', deviceName: 'd', secret: 's3cret', onEvent: (k, d) => seen.push([k, d]),
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ready', data: { device_id: 'ATTACKER' } }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(seen, [], 'a forged ready must not reach the daemon');
  } finally {
    await server.close();
  }
});

// A browser lured to the daemon through DNS rebinding sends the attacker's
// hostname in Host; a loopback client never does. fetch() cannot set Host
// (it is a forbidden header), so this speaks HTTP directly.
test('a request with a foreign Host header is refused', async () => {
  const server = await startHttpServer({ token: 'T', deviceName: 'd', onEvent: () => {}, secret: 's' });
  try {
    const status = await new Promise((resolve, reject) => {
      const socket = netConnect(server.port, '127.0.0.1', () => {
        socket.write('GET /token?k=s HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n');
      });
      let data = '';
      socket.on('data', (c) => { data += c; });
      socket.on('end', () => resolve(Number(data.split(' ')[1])));
      socket.on('error', reject);
    });
    assert.equal(status, 403);
  } finally {
    await server.close();
  }
});

test('the server binds a kernel-assigned port on loopback', async () => {
  const server = await startHttpServer({ token: 'T', deviceName: 'd', onEvent: () => {} });
  try {
    assert.ok(server.port > 0);
  } finally {
    await server.close();
  }
});

test('a malformed event body does not take the server down', async () => {
  const server = await startHttpServer({ token: 'T', deviceName: 'd', onEvent: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/event`, { method: 'POST', body: 'not json' });
    assert.equal(res.status, 400);
    // still serving
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/player`)).status, 200);
  } finally {
    await server.close();
  }
});
