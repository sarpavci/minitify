import { connect } from 'node:net';
import { unlinkSync, existsSync } from 'node:fs';

function probe(path) {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once('connect', () => {
      socket.end();
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

/**
 * Decides whether this process may own the daemon socket.
 *
 * Two CLI invocations on a cold start both find no socket and both spawn a
 * daemon. Unlinking blindly would let the second one steal the path and
 * orphan the first — along with its WKWebView. So ask first: if something
 * answers, stand down; only a socket nobody is listening on gets removed.
 */
export async function claimSocket(path, { connectImpl = probe } = {}) {
  if (!existsSync(path)) return true;

  try {
    await connectImpl(path);
    return false; // a live daemon already owns it
  } catch (err) {
    if (err.code !== 'ECONNREFUSED' && err.code !== 'ENOENT') throw err;
  }

  try {
    unlinkSync(path);
  } catch {
    // someone else removed it first; either way the path is free
  }
  return true;
}
