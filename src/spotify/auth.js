import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { loadTokens, saveTokens, saveConfig, isExpired } from '../config.js';

export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export const REDIRECT_PORT = 8888;
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

// Without `state`, any page the user visits during the login window can
// drive their browser to the loopback callback with an attacker's code and
// bind minitify to the attacker's Spotify account.
export function authorizeUrl(clientId, redirectUri, state = randomBytes(16).toString('hex')) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

function basicAuth(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function tokenRequest(params, { clientId, clientSecret }, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(clientId, clientSecret),
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const reason = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Spotify token request failed: ${reason}`);
  }
  return data;
}

// Spotify returns a lifetime, not a deadline; store the deadline so every
// later check is a plain comparison.
function withExpiry(data, previous) {
  return {
    access_token: data.access_token,
    // A refresh response often omits refresh_token, meaning "keep using
    // the one you have".
    refresh_token: data.refresh_token || previous?.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export async function exchangeCode(code, creds, fetchImpl = fetch) {
  const data = await tokenRequest(
    { grant_type: 'authorization_code', code, redirect_uri: creds.redirectUri },
    creds,
    fetchImpl,
  );
  return withExpiry(data);
}

export async function refresh(tokens, creds, fetchImpl = fetch) {
  const data = await tokenRequest(
    { grant_type: 'refresh_token', refresh_token: tokens.refresh_token },
    creds,
    fetchImpl,
  );
  return withExpiry(data, tokens);
}

// Spotify rotates the refresh token on some responses, so two refreshes
// racing would leave the loser's saved token dead. Callers share one.
let inFlightRefresh = null;

export async function getAccessToken(creds, fetchImpl = fetch) {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) throw new Error('Not logged in. Run: minitify login');
  if (!isExpired(tokens)) return tokens.access_token;

  if (!inFlightRefresh) {
    inFlightRefresh = refresh(tokens, creds, fetchImpl)
      .then((renewed) => {
        saveTokens(renewed);
        return renewed.access_token;
      })
      .catch((err) => {
        if (/invalid_grant|revoked/i.test(err.message)) {
          throw new Error(`Spotify rejected the saved login. Run: minitify login`);
        }
        throw err;
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }
  return inFlightRefresh;
}

// Runs the loopback leg of the authorization code flow. Not unit tested:
// it binds a port and opens a browser.
const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function login({ clientId, clientSecret }) {
  const creds = { clientId, clientSecret, redirectUri: REDIRECT_URI };
  const expectedState = randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        return res.end();
      }

      const failure = url.searchParams.get('error');
      const code = url.searchParams.get('code');

      // Rejects a callback the user's browser was driven to by another page.
      if (url.searchParams.get('state') !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>This login did not come from minitify.</p>');
        server.close();
        return reject(new Error('Spotify login failed: unexpected state'));
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        failure
          ? `<p>Login failed: ${escapeHtml(failure)}</p>`
          : '<p>minitify is connected. You can close this tab.</p>',
      );
      server.close();

      if (failure) return reject(new Error(`Spotify login failed: ${failure}`));

      try {
        const tokens = await exchangeCode(code, creds);
        saveConfig({ clientId, clientSecret });
        saveTokens(tokens);
        resolve(tokens);
      } catch (err) {
        reject(err);
      }
    });

    server.on('error', reject);
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      const url = authorizeUrl(clientId, REDIRECT_URI, expectedState);
      console.log('Opening Spotify authorization in your browser:');
      console.log(url);
      spawn('open', [url], { stdio: 'ignore' }).unref();
    });
  });
}
