const BASE = 'https://api.spotify.com/v1';

// Spotify cut the search limit from 50 to 10 in February 2026.
export const SEARCH_LIMIT = 10;

const PLAYLIST_PAGE_LIMIT = 50;

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

  function deviceQuery(deviceId) {
    return deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  }

  return {
    async listPlaylists() {
      const data = await request('GET', `/me/playlists?limit=${PLAYLIST_PAGE_LIMIT}&offset=0`);
      return (data?.items ?? []).map((p) => ({
        name: p.name,
        uri: p.uri,
        // The February 2026 API moved this count from `tracks` to `items`.
        trackCount: p.tracks?.total ?? p.items?.total ?? 0,
      }));
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
      };
    },

    // A playlist or album plays as a context; loose tracks play as a uri list.
    playContext(uri, deviceId) {
      return request('PUT', `/me/player/play${deviceQuery(deviceId)}`, { context_uri: uri });
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

    setVolume(percent) {
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        return Promise.reject(new Error('Volume must be between 0 and 100'));
      }
      return request('PUT', `/me/player/volume?volume_percent=${Math.round(percent)}`);
    },
  };
}
