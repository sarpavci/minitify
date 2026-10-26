import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BIN = fileURLToPath(new URL('../../player/wkplayer', import.meta.url));

export function createPlayer({ pagePort, pageSecret, onMediaKey, onLog, spawnImpl = spawn, binPath = DEFAULT_BIN }) {
  let child = null;
  let deviceId = null;
  let lastError = null;
  let waiters = [];
  let playbackWaiters = [];
  let stateWaiters = [];
  let overlayVisible = false;

  const log = (line) => onLog?.(line);

  function settleReady(id) {
    deviceId = id;
    for (const { resolve, timer } of waiters) {
      clearTimeout(timer);
      resolve(id);
    }
    waiters = [];
  }

  function settlePlayback() {
    for (const { resolve, timer } of playbackWaiters) {
      clearTimeout(timer);
      resolve(true);
    }
    playbackWaiters = [];
  }

  function settleState() {
    for (const { resolve, timer } of stateWaiters) {
      clearTimeout(timer);
      resolve(true);
    }
    stateWaiters = [];
  }

  // Shared by waitForPlayback and waitForState: resolve false on timeout
  // rather than rejecting, because neither is an error — the caller is
  // asking whether something happened, not demanding that it did.
  function waitFor(list, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = list.findIndex((w) => w.timer === timer);
        if (i !== -1) list.splice(i, 1);
        resolve(false);
      }, timeoutMs);
      list.push({ resolve, timer });
    });
  }

  function send(message) {
    if (!child?.stdin) return;
    child.stdin.write(JSON.stringify(message) + '\n');
  }

  function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // the player only ever writes JSON; anything else is noise
    }
    if (message.type === 'mediakey') onMediaKey?.(message.command, message.value);
    // The panel's own close button dismisses it, so the daemon has to
    // learn about it or the next `minitify overlay` would try to hide an
    // already-hidden panel.
    else if (message.type === 'overlay') overlayVisible = Boolean(message.show);
    else if (message.type === 'error') lastError = message.message;
    else if (message.type === 'reloading') {
      // WebKit killed the content process and the page is coming back.
      // The old device id is dead, but Spotify still accepts commands for
      // it — so every play would report success and play nothing.
      deviceId = null;
      lastError = message.reason ?? 'the player reloaded';
      log(`player reloading: ${lastError}`);
    }
  }

  const player = {
    get deviceId() {
      return deviceId;
    },

    get lastError() {
      return lastError;
    },

    get running() {
      return child !== null;
    },

    start() {
      if (child) return child;

      const url = `http://127.0.0.1:${pagePort}/player${pageSecret ? `?k=${pageSecret}` : ''}`;
      child = spawnImpl(binPath, [url], { stdio: ['pipe', 'pipe', 'pipe'] });

      // A restart spawns the replacement before the old child's exit event
      // arrives. Acting on that late news would null the handle to the
      // player that is now live — sends would stop reaching it, quit would
      // stop killing it, and the next waitReady would spawn a second one.
      const spawned = child;
      const isCurrent = () => spawned === child;

      // Whatever error the dead player left behind is not this one's.
      lastError = null;

      // Without this listener a missing or unbuilt binary emits an
      // unhandled 'error' and takes the whole daemon down.
      spawned.on?.('error', (err) => {
        if (!isCurrent()) return;
        lastError = err.code === 'ENOENT'
          ? `The player binary is missing — build it with: sh player/build.sh`
          : `The player could not start: ${err.message}`;
        log(lastError);
        player.handleExit();
      });

      let buffer = '';
      spawned.stdout?.on('data', (chunk) => {
        if (!isCurrent()) return;
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) handleLine(line);
      });

      // stderr is piped, so it has to be drained — an undrained pipe fills
      // at 64 KB and blocks the player's writes. Drained even for a
      // replaced child, which may still be on its way out.
      spawned.stderr?.on('data', (chunk) => log(`[player] ${chunk.toString().trim()}`));

      spawned.on?.('exit', (code) => {
        log(`player exited (code ${code})`);
        if (isCurrent()) player.handleExit();
      });

      // A player that died while the overlay was up comes back with it up.
      if (overlayVisible) send({ type: 'overlay', show: true });

      return child;
    },

    // Separated so tests can simulate a death without a real process.
    handleExit() {
      child = null;
      deviceId = null;
    },

    // Called by the daemon when the SDK page reports an event.
    handleEvent(kind, data) {
      if (kind === 'ready') settleReady(data.device_id);
      else if (kind === 'not_ready') deviceId = null;
      else if (kind === 'error') lastError = data.message || data.kind;
      else if (kind === 'state') {
        settleState();
        if (!data.paused) settlePlayback();
      }
    },

    // Resolves once the SDK reports it is actually playing. The web API
    // returning 200 does not mean sound came out.
    waitForPlayback(timeoutMs = 3000) {
      return waitFor(playbackWaiters, timeoutMs);
    },

    // Resolves on any state at all. The SDK emits one as soon as it is the
    // active player, which is how a transfer announces that it landed — and
    // a transferred device comes back paused, so waitForPlayback is no use
    // for that.
    waitForState(timeoutMs = 3000) {
      return waitFor(stateWaiters, timeoutMs);
    },

    restart() {
      player.stop();
      player.start();
    },

    waitReady(timeoutMs = 5000) {
      if (deviceId) return Promise.resolve(deviceId);
      // A player that died stays dead unless someone restarts it; waiting
      // the full timeout on a corpse helps nobody.
      if (!child) player.start();

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w.timer !== timer);
          reject(new Error('Spotify player is not ready yet'));
        }, timeoutMs);
        waiters.push({ resolve, timer });
      });
    },

    get overlayVisible() {
      return overlayVisible;
    },

    setOverlay(show) {
      overlayVisible = Boolean(show);
      send({ type: 'overlay', show: overlayVisible });
    },

    sendNowPlaying(info) {
      send({ type: 'nowplaying', ...info });
    },

    stop() {
      child?.kill();
      player.handleExit();
    },
  };

  return player;
}
