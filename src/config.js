import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Refresh a little before the token actually expires, so a request issued
// right now cannot arrive after it lapsed.
const EXPIRY_MARGIN_MS = 60_000;

const LOGIN_HINT = 'No Spotify credentials found. Run: minitify login';

export function configDir() {
  const dir = process.env.MINITIFY_CONFIG_DIR || join(homedir(), '.config', 'minitify');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function configPath(name) {
  return join(configDir(), name);
}

export function loadConfig() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath('config.json'), 'utf8'));
  } catch {
    throw new Error(LOGIN_HINT);
  }
  if (!parsed?.clientId || !parsed?.clientSecret) throw new Error(LOGIN_HINT);
  return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
}

export function saveConfig({ clientId, clientSecret }) {
  const path = configPath('config.json');
  writeFileSync(path, JSON.stringify({ clientId, clientSecret }, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

// A half-written or hand-edited file must not take the daemon down; an
// unreadable token store simply means "not logged in".
export function loadTokens() {
  try {
    return JSON.parse(readFileSync(configPath('tokens.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function saveTokens(tokens) {
  const path = configPath('tokens.json');
  writeFileSync(path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  // writeFileSync only applies mode when it creates the file, so an existing
  // one keeps whatever permissions it had.
  chmodSync(path, 0o600);
}

export function isExpired(tokens, now = Date.now()) {
  if (!tokens?.expires_at) return true;
  return tokens.expires_at - EXPIRY_MARGIN_MS <= now;
}
