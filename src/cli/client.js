import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { configPath } from '../config.js';

const DAEMON_ENTRY = fileURLToPath(new URL('../daemon/index.js', import.meta.url));

export function socketPath() {
  return configPath('daemon.sock');
}

function connectOnce(path) {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function startDaemonProcess() {
  // Detached and unref'd so the CLI can exit while the music keeps playing.
  const child = spawn(process.execPath, [DAEMON_ENTRY], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connectOrStart({
  connectImpl = connectOnce,
  spawnImpl = startDaemonProcess,
  retries = 25,
  retryDelayMs = 200,
} = {}) {
  const path = socketPath();

  try {
    return await connectImpl(path);
  } catch (err) {
    // ECONNREFUSED means the file is there but nothing is listening — a
    // daemon that crashed. Left alone, every future command would fail.
    if (err.code === 'ECONNREFUSED' && existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {}
    } else if (err.code !== 'ENOENT' && err.code !== 'ECONNREFUSED') {
      throw err;
    }
  }

  spawnImpl();

  for (let attempt = 0; attempt < retries; attempt += 1) {
    await sleep(retryDelayMs);
    try {
      return await connectImpl(path);
    } catch {
      // keep waiting for the daemon to bind
    }
  }

  throw new Error(
    `could not start the minitify daemon — see ${configPath('daemon.log')}\n` +
      'If the player was never built, run: sh player/build.sh',
  );
}

export async function sendCommand(cmd, options) {
  const socket = await connectOrStart(options);

  return new Promise((resolve, reject) => {
    // Kept whole and decoded once. A reply longer than a socket buffer
    // arrives in pieces, and a character straddling the boundary is
    // mangled if each piece is turned into a string on its own — which
    // Liked Songs, full of Korean and Thai titles, does every time.
    const chunks = [];
    socket.on('data', (chunk) => {
      chunks.push(chunk);
    });
    socket.on('end', () => {
      const text = chunks.some((chunk) => typeof chunk === 'string')
        ? chunks.join('')
        : Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('the daemon sent an unreadable reply'));
      }
    });
    socket.on('error', reject);
    socket.write(JSON.stringify(cmd) + '\n');
  });
}
