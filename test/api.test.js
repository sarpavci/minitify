import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApi, SEARCH_LIMIT } from '../src/spotify/api.js';

// Builds a fetch stand-in that records calls and replays queued responses.
function stubFetch(...responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    const r = queue.length > 1 ? queue.shift() : queue[0];
    return {
      ok: r.status === undefined ? true : r.status >= 200 && r.status < 300,
      status: r.status ?? 200,
      headers: { get: (name) => (r.headers ?? {})[name.toLowerCase()] ?? null },
      text: async () => {
        if (r.rawText !== undefined) return r.rawText;
        return r.body === undefined ? '' : JSON.stringify(r.body);
      },
    };
  };
  impl.calls = calls;
  return impl;
}

const api = (fetchImpl) => createApi({ getToken: async () => 'TOKEN', fetchImpl });

test('requests carry the bearer token', async () => {
  const f = stubFetch({ body: { items: [] } });
  await api(f).listPlaylists();
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer TOKEN');
});

test('search requests limit=10', async () => {
  const f = stubFetch({ body: { tracks: { items: [] } } });
  await api(f).search('daft punk');
  assert.equal(new URL(f.calls[0].url).searchParams.get('limit'), String(SEARCH_LIMIT));
  assert.equal(SEARCH_LIMIT, 10);
});

test('search maps items to name, artist and uri', async () => {
  const f = stubFetch({
    body: {
      tracks: {
        items: [
          { name: 'One More Time', uri: 'spotify:track:1', artists: [{ name: 'Daft Punk' }, { name: 'X' }] },
        ],
      },
    },
  });
  assert.deepEqual(await api(f).search('q'), [
    { name: 'One More Time', artist: 'Daft Punk, X', uri: 'spotify:track:1' },
  ]);
});

test('listPlaylists maps items to name, uri and trackCount', async () => {
  const f = stubFetch({
    body: { items: [{ name: 'Focus', uri: 'spotify:playlist:1', tracks: { total: 42 } }] },
  });
  assert.deepEqual(await api(f).listPlaylists(), [
    { name: 'Focus', uri: 'spotify:playlist:1', trackCount: 42 },
  ]);
});

test('listPlaylists tolerates a playlist with no track count', async () => {
  const f = stubFetch({ body: { items: [{ name: 'Empty', uri: 'spotify:playlist:2' }] } });
  assert.equal((await api(f).listPlaylists())[0].trackCount, 0);
});

// Since the February 2026 API changes the count arrives under `items`,
// not `tracks`. Older shapes still turn up, so both are read.
test('listPlaylists reads the track count from the items field', async () => {
  const f = stubFetch({
    body: { items: [{ name: 'Focus', uri: 'spotify:playlist:1', items: { total: 9 } }] },
  });
  assert.equal((await api(f).listPlaylists())[0].trackCount, 9);
});

test('status returns null when Spotify answers 204', async () => {
  const f = stubFetch({ status: 204 });
  assert.equal(await api(f).status(), null);
});

test('status maps the playback payload', async () => {
  const f = stubFetch({
    body: {
      is_playing: true,
      progress_ms: 1234,
      item: { name: 'Track', duration_ms: 9999, artists: [{ name: 'Artist' }] },
      device: { name: 'minitify' },
    },
  });
  assert.deepEqual(await api(f).status(), {
    playing: true,
    trackName: 'Track',
    artist: 'Artist',
    positionMs: 1234,
    durationMs: 9999,
    deviceName: 'minitify',
  });
});

test('playContext sends context_uri', async () => {
  const f = stubFetch({ status: 204 });
  await api(f).playContext('spotify:playlist:1', 'DEV');
  assert.deepEqual(f.calls[0].body, { context_uri: 'spotify:playlist:1' });
  assert.equal(new URL(f.calls[0].url).searchParams.get('device_id'), 'DEV');
});

test('playUris sends a uris array', async () => {
  const f = stubFetch({ status: 204 });
  await api(f).playUris(['spotify:track:1'], 'DEV');
  assert.deepEqual(f.calls[0].body, { uris: ['spotify:track:1'] });
});

test('setVolume rejects values outside 0-100', async () => {
  const f = stubFetch({ status: 204 });
  await assert.rejects(() => api(f).setVolume(150), /between 0 and 100/);
  await assert.rejects(() => api(f).setVolume(-1), /between 0 and 100/);
  assert.equal(f.calls.length, 0, 'no request should reach Spotify');
});

test('setVolume rejects a non-numeric value', async () => {
  const f = stubFetch({ status: 204 });
  await assert.rejects(() => api(f).setVolume('loud'), /between 0 and 100/);
});

test('setVolume accepts the boundaries', async () => {
  const f = stubFetch({ status: 204 });
  await api(f).setVolume(0);
  await api(f).setVolume(100);
  assert.equal(f.calls.length, 2);
});

test('a 429 response throws an error carrying retryAfter', async () => {
  const f = stubFetch({ status: 429, headers: { 'retry-after': '18' }, body: { error: { message: 'rate' } } });
  const err = await api(f).next().catch((e) => e);
  assert.equal(err.status, 429);
  assert.equal(err.retryAfter, 18);
});

test('a non-2xx response throws with the Spotify message', async () => {
  const f = stubFetch({ status: 403, body: { error: { message: 'Player command failed' } } });
  await assert.rejects(() => api(f).pause(), /Player command failed/);
});

// Spotify documents 204 for the playback control endpoints, but in practice
// they answer 200 with an opaque, non-JSON token in the body.
test('a 200 response with a non-JSON body resolves to null', async () => {
  const f = stubFetch({ status: 200, rawText: '2ZenW4wmqUdRMw-C7bqKAeFeBIU' });
  assert.equal(await api(f).pause(), null);
});

test('next survives the same non-JSON body', async () => {
  const f = stubFetch({ status: 200, rawText: '3c9L1JVD35sLYRRic-jab5KJ_hA' });
  assert.equal(await api(f).next(), null);
});

test('a non-2xx response with a non-JSON body still throws', async () => {
  const f = stubFetch({ status: 500, rawText: 'upstream exploded' });
  await assert.rejects(() => api(f).pause(), /HTTP 500/);
});

test('transfer posts the device id', async () => {
  const f = stubFetch({ status: 204 });
  await api(f).transfer('DEV');
  assert.deepEqual(f.calls[0].body, { device_ids: ['DEV'], play: false });
});
