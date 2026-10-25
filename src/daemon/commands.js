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

// Spotify answers 404 for a device it no longer has registered. The daemon
// can still be holding that id: a sleep drops the device server-side, and
// the SDK page does not always get a not_ready through before it goes.
//
// Matched on the message, not on the status alone. Playing a playlist that
// has been deleted is also a 404, and restarting the player for that would
// cut off whatever is currently playing to fix something a restart cannot.
const DEVICE_GONE = /device not found|no active device|device_not_found/i;

const isDeviceGone = (err) => {
  const message = err?.message ?? '';
  return DEVICE_GONE.test(message)
    // A 404 whose body carried no explanation at all. On the playback
    // endpoints that is the device; nothing else we call there can 404.
    || (err?.status === 404 && /HTTP 404/.test(message));
};

/**
 * Runs a command, and if the only thing wrong was a device Spotify has
 * dropped, brings the player back and runs it once more.
 *
 * Once, deliberately. A second 404 is a real failure and the user needs to
 * hear it rather than watch the player cycle.
 *
 * `prepare` is what makes a device usable again. `play` and `resume`
 * transfer as part of their own work, so they pass nothing; the commands
 * that run against whatever device is active have to be handed one.
 */
async function retryOnDeadDevice(deps, attempt, prepare) {
  try {
    return await attempt();
  } catch (err) {
    if (!isDeviceGone(err)) throw err;
    deps.player.restart();
    if (prepare) await prepare();
    return attempt();
  }
}

// Shorthand for the commands that carry no device id of their own.
const onActiveDevice = (deps, attempt) =>
  retryOnDeadDevice(deps, attempt, () => activateDevice(deps));

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

        // Two different failures, each needing the same recovery. The call
        // can throw because the device is gone, or it can answer 200 while
        // the device has quietly died and no sound comes out.
        await retryOnDeadDevice(deps, start);

        if (player.waitForPlayback && !(await player.waitForPlayback(PLAYBACK_START_TIMEOUT_MS))) {
          player.restart();
          await start();
        }
        return ok();
      }

      case 'pause':
        return ok(await onActiveDevice(deps, () => api.pause()));

      case 'resume':
        return ok(await retryOnDeadDevice(deps, async () => {
          const deviceId = await activateDevice(deps);
          return api.resume(deviceId);
        }));

      case 'next':
        return ok(await onActiveDevice(deps, () => api.next()));

      case 'prev':
        return ok(await onActiveDevice(deps, () => api.previous()));

      case 'vol':
        return ok(await onActiveDevice(deps, () => api.setVolume(args[0])));

      case 'shuffle': {
        // With no argument this is a toggle, so it needs to know where it
        // is starting from; the daemon keeps that from the SDK's state.
        const next = args[0] === undefined ? !deps.playbackState?.shuffle : Boolean(args[0]);
        await onActiveDevice(deps, () => api.setShuffle(next));
        if (deps.playbackState) deps.playbackState.shuffle = next;
        return ok({ shuffle: next });
      }

      case 'repeat': {
        const current = deps.playbackState?.repeat ?? 'off';
        const next = args[0] === undefined ? nextRepeat(current) : args[0];
        await onActiveDevice(deps, () => api.setRepeat(next));
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
