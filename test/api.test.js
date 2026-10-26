import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApi, SEARCH_LIMIT, QUEUE_LIMIT } from '../src/spotify/api.js';

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
// A library with more than one page would otherwise be silently cut off.
test('listPlaylists follows pagination', async () => {
  const page1 = { items: [{ name: 'A', uri: 'u1' }], next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50' };
  const page2 = { items: [{ name: 'B', uri: 'u2' }], next: null };
  const f = stubFetch({ body: page1 }, { body: page2 });
  const result = await api(f).listPlaylists();
  assert.deepEqual(result.map((p) => p.name), ['A', 'B']);
  assert.equal(f.calls.length, 2);
});

test('listPlaylists stops at a sane page count', async () => {
  // A server that always advertises a next page must not loop forever.
  const endless = { items: [{ name: 'x', uri: 'u' }], next: 'https://api.spotify.com/v1/me/playlists?offset=50' };
  const f = stubFetch({ body: endless });
  const result = await api(f).listPlaylists();
  assert.ok(f.calls.length <= 20, `made ${f.calls.length} requests`);
  assert.ok(result.length > 0);
});

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
    shuffle: false,
    repeat: 'off',
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

test('playContext can start partway in, which is how a queue row is reached', async () => {
  const f = stubFetch({ status: 204 });
  await api(f).playContext('spotify:playlist:1', 'DEV', 'spotify:track:9');
  assert.deepEqual(f.calls[0].body, {
    context_uri: 'spotify:playlist:1',
    offset: { uri: 'spotify:track:9' },
  });
});

test('playContext without an offset still starts at the beginning', async () => {
  const f = stubFetch({ status: 204 });
  await api(f).playContext('spotify:playlist:1', 'DEV');
  assert.deepEqual(f.calls[0].body, { context_uri: 'spotify:playlist:1' });
});

test('queue returns what is coming, shortened to what the panel shows', async () => {
  const track = (name) => ({
    name,
    artists: [{ name: 'Daft Punk' }],
    duration_ms: 228_000,
    uri: `spotify:track:${name}`,
    album: {
      images: [
        { url: 'https://i.example/large.jpg', width: 640 },
        { url: 'https://i.example/small.jpg', width: 64 },
      ],
    },
  });
  const f = stubFetch({
    body: {
      currently_playing: track('now'),
      queue: ['a', 'b', 'c', 'd', 'e', 'f'].map(track),
    },
  });

  const upcoming = await api(f).queue();

  assert.match(f.calls[0].url, /\/me\/player\/queue$/);
  assert.equal(upcoming.length, QUEUE_LIMIT, 'the panel only has room for four');
  assert.deepEqual(upcoming[0], {
    name: 'a',
    artist: 'Daft Punk',
    durationMs: 228_000,
    uri: 'spotify:track:a',
    // A 32 pt row wants the smallest cover offered, not the 640 one.
    artworkUrl: 'https://i.example/small.jpg',
  });
});

test('queue survives an empty or absent list', async () => {
  assert.deepEqual(await api(stubFetch({ body: {} })).queue(), []);
  assert.deepEqual(await api(stubFetch({ body: { queue: null } })).queue(), []);
  // Nothing playing answers 204 with no body at all.
  assert.deepEqual(await api(stubFetch({ status: 204 })).queue(), []);
});

test('seek asks for a whole number of milliseconds', async () => {
  const f = stubFetch({ status: 204 });
  await api(f).seek(61_500.7);
  assert.match(f.calls[0].url, /\/me\/player\/seek\?position_ms=61501$/);
  assert.equal(f.calls[0].options.method, 'PUT');
});

test('seek rejects a position that is not a finite number of ms', async () => {
  const f = stubFetch({ status: 204 });
  await assert.rejects(() => api(f).seek(-1), /position/i);
  await assert.rejects(() => api(f).seek('half way'), /position/i);
  await assert.rejects(() => api(f).seek(Infinity), /position/i);
  assert.equal(f.calls.length, 0, 'no request should reach Spotify');
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

// Verified against the real API: both endpoints answer 200 and the state
// reads back from /me/player as shuffle_state and repeat_state.
test('setShuffle sends the state as a query parameter', async () => {
  const f = stubFetch({ status: 200, rawText: 'opaque' });
  await api(f).setShuffle(true);
  const url = new URL(f.calls[0].url);
  assert.match(url.pathname, /\/me\/player\/shuffle$/);
  assert.equal(url.searchParams.get('state'), 'true');
});

test('setShuffle sends false as a string, not an empty value', async () => {
  const f = stubFetch({ status: 200, rawText: 'opaque' });
  await api(f).setShuffle(false);
  assert.equal(new URL(f.calls[0].url).searchParams.get('state'), 'false');
});

test('setRepeat accepts the three Spotify modes', async () => {
  for (const mode of ['off', 'context', 'track']) {
    const f = stubFetch({ status: 200, rawText: 'opaque' });
    await api(f).setRepeat(mode);
    assert.equal(new URL(f.calls[0].url).searchParams.get('state'), mode);
  }
});

test('setRepeat rejects a mode Spotify does not know', async () => {
  const f = stubFetch({ status: 200 });
  await assert.rejects(() => api(f).setRepeat('sometimes'), /off, context or track/);
  assert.equal(f.calls.length, 0, 'no request should reach Spotify');
});

test('status reports the shuffle and repeat state', async () => {
  const f = stubFetch({
    body: {
      is_playing: true,
      progress_ms: 0,
      shuffle_state: true,
      repeat_state: 'track',
      item: { name: 'T', duration_ms: 1, artists: [{ name: 'A' }] },
      device: { name: 'd' },
    },
  });
  const s = await api(f).status();
  assert.equal(s.shuffle, true);
  assert.equal(s.repeat, 'track');
});

test('status defaults shuffle and repeat when Spotify omits them', async () => {
  const f = stubFetch({
    body: { is_playing: false, item: { name: 'T', artists: [] }, device: {} },
  });
  const s = await api(f).status();
  assert.equal(s.shuffle, false);
  assert.equal(s.repeat, 'off');
});

test('transfer posts the device id', async () => {
  const f = stubFetch({ status: 204 });
  await api(f).transfer('DEV');
  assert.deepEqual(f.calls[0].body, { device_ids: ['DEV'], play: false });
});
