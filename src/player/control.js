import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BIN = fileURLToPath(new URL('../../player/wkplayer', import.meta.url));

export function createPlayer({ pagePort, onMediaKey, spawnImpl = spawn, binPath = DEFAULT_BIN }) {
  let child = null;
  let deviceId = null;
  let lastError = null;
  let waiters = [];

  function settleReady(id) {
    deviceId = id;
    for (const { resolve, timer } of waiters) {
      clearTimeout(timer);
      resolve(id);
    }
    waiters = [];
  }

  function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // the player only ever writes JSON; anything else is noise
    }
    if (message.type === 'mediakey') onMediaKey?.(message.command);
    else if (message.type === 'error') lastError = message.message;
  }

  return {
    get deviceId() {
      return deviceId;
    },

    get lastError() {
      return lastError;
    },

    start() {
      if (child) return child;
      const url = `http://127.0.0.1:${pagePort}/player`;
      child = spawnImpl(binPath, [url], { stdio: ['pipe', 'pipe', 'pipe'] });

      let buffer = '';
      child.stdout?.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) handleLine(line);
      });

      child.on?.('exit', () => {
        child = null;
        deviceId = null;
      });

      return child;
    },

    // Called by the daemon when the SDK page reports an event.
    handleEvent(kind, data) {
      if (kind === 'ready') settleReady(data.device_id);
      else if (kind === 'not_ready') deviceId = null;
      else if (kind === 'error') lastError = data.message || data.kind;
    },

    waitReady(timeoutMs = 5000) {
      if (deviceId) return Promise.resolve(deviceId);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w.timer !== timer);
          reject(new Error('Spotify player is not ready yet'));
        }, timeoutMs);
        waiters.push({ resolve, timer });
      });
    },

    sendNowPlaying(info) {
      if (!child?.stdin) return;
      child.stdin.write(JSON.stringify({ type: 'nowplaying', ...info }) + '\n');
    },

    stop() {
      child?.kill();
      child = null;
      deviceId = null;
    },
  };
}
