const PLAYER_READY_TIMEOUT_MS = 5000;

const ok = (data = null) => ({ ok: true, data });
const fail = (error) => ({ ok: false, error });

// A 429 is the one error where the user can do something useful with the
// detail, so carry the wait into the message.
function describe(err) {
  if (err.status === 429 && err.retryAfter) {
    return `${err.message} — retry in ${err.retryAfter}s`;
  }
  return err.message;
}

// The player may still be booting when the first command lands. If it never
// becomes usable, prefer the SDK's own explanation (wrong account type,
// authentication) over our generic timeout.
async function ensureDevice({ player }) {
  if (player.deviceId) return player.deviceId;
  try {
    return await player.waitReady(PLAYER_READY_TIMEOUT_MS);
  } catch (err) {
    if (player.lastError) throw new Error(player.lastError);
    throw err;
  }
}

// A Web Playback SDK device registers as inactive, and a play call carrying
// only device_id leaves it that way — the call succeeds and no sound comes
// out. Transferring first is what actually hands it the session.
async function activateDevice(deps) {
  const deviceId = await ensureDevice(deps);
  await deps.api.transfer(deviceId);
  return deviceId;
}

export async function handleCommand(cmd, deps) {
  const { api, player, shutdown } = deps;
  const args = cmd.args ?? [];

  try {
    switch (cmd.name) {
      case 'playlists':
        return ok(await api.listPlaylists());

      case 'search':
        return ok(await api.search(args[0]));

      case 'status':
        return ok(await api.status());

      case 'play': {
        const uri = args[0];
        if (!uri) return fail('play needs a Spotify uri');
        const deviceId = await activateDevice(deps);
        // Tracks play as a uri list; playlists and albums play as a context.
        if (uri.startsWith('spotify:track:')) await api.playUris([uri], deviceId);
        else await api.playContext(uri, deviceId);
        return ok();
      }

      case 'pause':
        return ok(await api.pause());

      case 'resume': {
        const deviceId = await activateDevice(deps);
        return ok(await api.resume(deviceId));
      }

      case 'next':
        return ok(await api.next());

      case 'prev':
        return ok(await api.previous());

      case 'vol':
        return ok(await api.setVolume(args[0]));

      case 'quit':
        shutdown();
        return ok();

      default:
        return fail(`Unknown command: ${cmd.name}`);
    }
  } catch (err) {
    return fail(describe(err));
  }
}
