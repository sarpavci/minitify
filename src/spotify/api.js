const BASE = 'https://api.spotify.com/v1';

// Spotify cut the search limit from 50 to 10 in February 2026.
export const SEARCH_LIMIT = 10;

const PLAYLIST_PAGE_LIMIT = 50;
const MAX_PLAYLIST_PAGES = 20;

// The extended panel shows four rows and nothing scrolls, so asking for
// more would be fetching what no one can see.
export const QUEUE_LIMIT = 4;

// Spotify's repeat cycles through these, in this order.
export const REPEAT_MODES = ['off', 'context', 'track'];

// A queue row draws the cover at 32 pt, so the 640 px version is a waste
// of a download. Spotify lists images largest first, but not reliably.
function smallestCover(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  return images.reduce((best, image) =>
    (image?.width ?? Infinity) < (best?.width ?? Infinity) ? image : best).url ?? null;
}

// Liked Songs and a playlist's items are the same shape behind different
// paths, and both page.
function trackFrom(item) {
  // The 2026 /items response carries the track under `item`; Liked Songs
  // and the old /tracks path both use `track`. A track pulled from the
  // catalogue comes back as a null in either.
  const track = item?.item ?? item?.track;
  if (!track) return null;
  // A playlist can hold podcast episodes, which have none of this.
  if (track.type && track.type !== 'track') return null;
  return {
    name: track.name,
    artist: artistsOf(track),
    durationMs: track.duration_ms ?? 0,
    uri: track.uri,
    artworkUrl: smallestCover(track.album?.images),
  };
}

// The library endpoints take bare ids, not uris.
const bareId = (uri) => String(uri).split(':').pop();

function artistsOf(item) {
  return (item?.artists ?? []).map((a) => a.name).join(', ');
}

export function createApi({ getToken, fetchImpl = fetch }) {
  async function request(method, path, body) {
    const token = await getToken();
    const res = await fetchImpl(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    // The playback control endpoints are documented as 204 but answer 200
    // with an opaque, non-JSON token. Anything unparseable is simply "no
    // data" — the status is what says whether the call worked.
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const err = new Error(data?.error?.message || `Spotify request failed (HTTP ${res.status})`);
      err.status = res.status;
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter !== null) err.retryAfter = Number(retryAfter);
      throw err;
    }
    return data;
  }

  async function walkTracks(firstPath) {
    const tracks = [];
    let path = firstPath;
    for (let page = 0; page < MAX_PLAYLIST_PAGES && path; page += 1) {
      const data = await request('GET', path);
      for (const item of data?.items ?? []) {
        const track = trackFrom(item);
        if (track) tracks.push(track);
      }
      path = data?.next ? data.next.replace(BASE, '') : null;
    }
    return tracks;
  }

  function deviceQuery(deviceId) {
    return deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  }

  return {
    async listPlaylists() {
      const playlists = [];
      let path = `/me/playlists?limit=${PLAYLIST_PAGE_LIMIT}&offset=0`;

      // Bounded so a server that always advertises a next page cannot
      // spin here forever.
      for (let page = 0; page < MAX_PLAYLIST_PAGES && path; page += 1) {
        const data = await request('GET', path);
        for (const p of data?.items ?? []) {
          playlists.push({
            name: p.name,
            uri: p.uri,
            // The February 2026 API moved this count from `tracks` to `items`.
            trackCount: p.tracks?.total ?? p.items?.total ?? 0,
            artworkUrl: smallestCover(p.images),
          });
        }
        path = data?.next ? data.next.replace(BASE, '') : null;
      }
      return playlists;
    },

    async search(query) {
      const params = new URLSearchParams({ q: query, type: 'track', limit: String(SEARCH_LIMIT) });
      const data = await request('GET', `/search?${params}`);
      return (data?.tracks?.items ?? []).map((t) => ({
        name: t.name,
        artist: artistsOf(t),
        uri: t.uri,
      }));
    },

    /// Liked Songs, in the order Spotify keeps them.
    savedTracks() {
      return walkTracks(`/me/tracks?limit=${PLAYLIST_PAGE_LIMIT}&offset=0`);
    },

    /// A playlist's contents. The February 2026 API renamed this from
    /// `/tracks` to `/items`, and the old path now answers 403.
    playlistTracks(uri) {
      return walkTracks(
        `/playlists/${bareId(uri)}/items?limit=${PLAYLIST_PAGE_LIMIT}&offset=0`,
      );
    },

    /// Which of these are already in Liked Songs, in the order asked.
    async isSaved(uris) {
      if (!uris?.length) return [];
      const ids = uris.map(bareId).join(',');
      const data = await request('GET', `/me/tracks/contains?ids=${encodeURIComponent(ids)}`);
      return Array.isArray(data) ? data.map(Boolean) : uris.map(() => false);
    },

    setSaved(uri, saved) {
      return request(saved ? 'PUT' : 'DELETE', `/me/tracks?ids=${bareId(uri)}`);
    },

    async queue() {
      // Answers 204 with no body when nothing is playing, which `request`
      // hands back as null rather than throwing.
      const data = await request('GET', '/me/player/queue');
      return (data?.queue ?? []).slice(0, QUEUE_LIMIT).map((t) => ({
        name: t.name,
        artist: artistsOf(t),
        durationMs: t.duration_ms ?? 0,
        uri: t.uri,
        artworkUrl: smallestCover(t.album?.images),
      }));
    },

    async status() {
      const data = await request('GET', '/me/player');
      if (!data?.item) return null;
      return {
        playing: Boolean(data.is_playing),
        trackName: data.item.name,
        artist: artistsOf(data.item),
        positionMs: data.progress_ms ?? 0,
        durationMs: data.item.duration_ms ?? 0,
        deviceName: data.device?.name ?? null,
        shuffle: Boolean(data.shuffle_state),
        repeat: data.repeat_state ?? 'off',
      };
    },

    // A playlist or album plays as a context; loose tracks play as a uri list.
    // `offsetUri` starts the context at one of its tracks instead of the
    // top — the only way to reach a queued track without skipping to it.
    playContext(uri, deviceId, offsetUri) {
      return request('PUT', `/me/player/play${deviceQuery(deviceId)}`, {
        context_uri: uri,
        ...(offsetUri ? { offset: { uri: offsetUri } } : {}),
      });
    },

    playUris(uris, deviceId) {
      return request('PUT', `/me/player/play${deviceQuery(deviceId)}`, { uris });
    },

    transfer(deviceId) {
      return request('PUT', '/me/player', { device_ids: [deviceId], play: false });
    },

    pause() {
      return request('PUT', '/me/player/pause');
    },

    resume(deviceId) {
      return request('PUT', `/me/player/play${deviceQuery(deviceId)}`);
    },

    next() {
      return request('POST', '/me/player/next');
    },

    previous() {
      return request('POST', '/me/player/previous');
    },

    setShuffle(on) {
      return request('PUT', `/me/player/shuffle?state=${on ? 'true' : 'false'}`);
    },

    // Spotify's repeat is three-state, not a toggle.
    setRepeat(mode) {
      if (!REPEAT_MODES.includes(mode)) {
        return Promise.reject(new Error('Repeat must be off, context or track'));
      }
      return request('PUT', `/me/player/repeat?state=${mode}`);
    },

    seek(positionMs) {
      if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
        return Promise.reject(new Error('Seek position must be a number of milliseconds'));
      }
      return request('PUT', `/me/player/seek?position_ms=${Math.round(positionMs)}`);
    },

    setVolume(percent) {
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        return Promise.reject(new Error('Volume must be between 0 and 100'));
      }
      return request('PUT', `/me/player/volume?volume_percent=${Math.round(percent)}`);
    },
  };
}
