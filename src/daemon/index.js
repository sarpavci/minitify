import { createServer } from 'node:net';
import { unlinkSync, realpathSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { configPath, loadConfig } from '../config.js';
import { getAccessToken } from '../spotify/auth.js';
import { createApi } from '../spotify/api.js';
import { startHttpServer } from './http.js';
import { createPlayer } from '../player/control.js';
import { handleCommand } from './commands.js';
import { claimSocket } from './lifecycle.js';

export const DEVICE_NAME = 'minitify';

export function socketPath() {
  return configPath('daemon.sock');
}

export function logPath() {
  return configPath('daemon.log');
}

// The daemon's only voice is a socket reply, so anything that goes wrong
// outside a command would otherwise vanish. This is where to look first.
function log(line) {
  try {
    appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

export async function startDaemon() {
  const path = socketPath();
  if (!(await claimSocket(path))) {
    log('another daemon is already running; standing down');
    return null;
  }

  const creds = loadConfig();
  const api = createApi({ getToken: () => getAccessToken(creds) });

  // Guards the loopback endpoints that hand out a live access token.
  const secret = randomBytes(16).toString('hex');

  // Remembered so a media key can toggle without asking Spotify first.
  let lastState = { paused: true };
  let player;

  const httpServer = await startHttpServer({
    token: await getAccessToken(creds),
    getToken: () => getAccessToken(creds),
    deviceName: DEVICE_NAME,
    secret,
    onEvent: (kind, data) => {
      player.handleEvent(kind, data);
      if (kind !== 'state') log(`sdk ${kind}: ${JSON.stringify(data)}`);
      if (kind === 'error') log(`sdk error: ${data.kind ?? ''} ${data.message ?? ''}`);
      // Media keys can arrive from the page's media session as well as
      // from the Swift host; both land here.
      if (kind === 'mediakey') runMediaKey(data.command);
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

  function runMediaKey(command) {
    const name =
      command === 'toggle' ? (lastState.paused ? 'resume' : 'pause')
      : command === 'play' ? 'resume'
      : command === 'previous' ? 'prev'
      : command;
    handleCommand({ name }, { api, player, shutdown }).catch((err) => log(`media key: ${err.message}`));
  }

  player = createPlayer({
    pagePort: httpServer.port,
    pageSecret: secret,
    onLog: log,
    onMediaKey: runMediaKey,
  });

  player.start();

  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', async (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;

      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);

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

  // Only the daemon that actually bound the socket may remove it. Two
  // daemons can pass claimSocket at once — the loser must leave the
  // winner's socket alone on its way out.
  let ownsSocket = false;
  let closed = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    player.stop();
    httpServer.close().catch(() => {});
    server.close();
    if (ownsSocket) {
      try {
        unlinkSync(path);
      } catch {}
    }
  }

  function shutdown() {
    cleanup();
    // Give the socket a moment to flush the reply to `minitify quit`.
    setTimeout(() => process.exit(0), 50);
  }

  server.on('error', (err) => {
    // EADDRINUSE / EEXIST means another daemon won the race; that is a
    // normal outcome, not a failure worth reporting to the user.
    const lostRace = err.code === 'EADDRINUSE' || err.code === 'EEXIST';
    log(lostRace ? 'another daemon won the socket; standing down' : `socket server error: ${err.message}`);
    cleanup();
    process.exit(lostRace ? 0 : 1);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
  process.on('exit', cleanup);
  process.on('uncaughtException', (err) => {
    log(`uncaught: ${err.stack ?? err.message}`);
    cleanup();
    process.exit(1);
  });

  await new Promise((resolve) => server.listen(path, resolve));
  ownsSocket = true;
  log(`daemon listening on ${path}`);
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
    log(`startup failed: ${err.message}`);
    console.error(err.message);
    process.exit(1);
  });
}
