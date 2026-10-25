import { REPEAT_MODES } from '../spotify/api.js';

const PLAYER_READY_TIMEOUT_MS = 5000;
const PLAYBACK_START_TIMEOUT_MS = 3000;

const nextRepeat = (mode) =>
  REPEAT_MODES[(REPEAT_MODES.indexOf(mode) + 1) % REPEAT_MODES.length];

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

        const start = async () => {
          const deviceId = await activateDevice(deps);
          // Tracks play as a uri list; playlists and albums play as a context.
          if (uri.startsWith('spotify:track:')) await api.playUris([uri], deviceId);
          else await api.playContext(uri, deviceId);
        };

        await start();

        // Spotify answers 200 even when the target device has quietly died,
        // so success here is not evidence that music started. If the player
        // never reports playback, refresh it and try once more.
        if (player.waitForPlayback && !(await player.waitForPlayback(PLAYBACK_START_TIMEOUT_MS))) {
          player.restart();
          await start();
        }
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

      case 'shuffle': {
        // With no argument this is a toggle, so it needs to know where it
        // is starting from; the daemon keeps that from the SDK's state.
        const next = args[0] === undefined ? !deps.playbackState?.shuffle : Boolean(args[0]);
        await api.setShuffle(next);
        if (deps.playbackState) deps.playbackState.shuffle = next;
        return ok({ shuffle: next });
      }

      case 'repeat': {
        const current = deps.playbackState?.repeat ?? 'off';
        const next = args[0] === undefined ? nextRepeat(current) : args[0];
        await api.setRepeat(next);
        if (deps.playbackState) deps.playbackState.repeat = next;
        return ok({ repeat: next });
      }

      case 'overlay': {
        const arg = args[0];
        const show =
          arg === 'on' ? true
          : arg === 'off' ? false
          : !player.overlayVisible;
        // The panel lives in the player process, so it has to be running.
        if (show) await ensureDevice(deps);
        player.setOverlay(show);
        return ok({ overlay: show });
      }

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
