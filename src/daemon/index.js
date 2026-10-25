import { createServer } from 'node:net';
import { unlinkSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { configPath, loadConfig } from '../config.js';
import { getAccessToken } from '../spotify/auth.js';
import { createApi } from '../spotify/api.js';
import { startHttpServer } from './http.js';
import { createPlayer } from '../player/control.js';
import { handleCommand } from './commands.js';

export const DEVICE_NAME = 'minitify';

export function socketPath() {
  return configPath('daemon.sock');
}

export async function startDaemon() {
  const creds = loadConfig();
  const api = createApi({ getToken: () => getAccessToken(creds) });

  // Remembered so a media key can toggle without asking Spotify first.
  let lastState = { paused: true };

  const httpServer = await startHttpServer({
    token: await getAccessToken(creds),
    getToken: () => getAccessToken(creds),
    deviceName: DEVICE_NAME,
    onEvent: (kind, data) => {
      player.handleEvent(kind, data);
      if (kind === 'state') {
        lastState = data;
        player.sendNowPlaying({
          title: data.title,
          artist: data.artist,
          durationMs: data.durationMs,
          positionMs: data.positionMs,
          playing: !data.paused,
        });
      }
    },
  });

  const player = createPlayer({
    pagePort: httpServer.port,
    onMediaKey: (command) => {
      const deps = { api, player, shutdown };
      const name =
        command === 'toggle' ? (lastState.paused ? 'resume' : 'pause')
        : command === 'play' ? 'resume'
        : command === 'previous' ? 'prev'
        : command;
      handleCommand({ name }, deps).catch(() => {});
    },
  });

  player.start();

  const path = socketPath();
  // A socket file left behind by a crashed daemon would block listen().
  if (existsSync(path)) unlinkSync(path);

  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', async (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;

      const line = buffer.slice(0, newline);
      buffer = '';

      let result;
      try {
        result = await handleCommand(JSON.parse(line), { api, player, shutdown });
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      socket.end(JSON.stringify(result) + '\n');
    });
    socket.on('error', () => {});
  });

  function shutdown() {
    player.stop();
    httpServer.close().catch(() => {});
    server.close();
    try {
      unlinkSync(path);
    } catch {}
    // Give the socket a moment to flush the reply to `minitify quit`.
    setTimeout(() => process.exit(0), 50);
  }

  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);

  await new Promise((resolve) => server.listen(path, resolve));
  return { socketPath: path, shutdown };
}

// Started detached by the CLI as `node src/daemon/index.js`.
function runAsScript() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (runAsScript()) {
  startDaemon().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
