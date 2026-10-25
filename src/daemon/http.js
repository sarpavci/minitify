import { createServer } from 'node:http';

import { playerPage } from './page.js';

const MAX_EVENT_BYTES = 64 * 1024;

// Serves the SDK page to the WKWebView and takes its events back.
// `getToken` lets the page pick up a refreshed access token; without it the
// server just hands out the token it was started with.
export function startHttpServer({ token, getToken, deviceName, onEvent }) {
  const currentToken = getToken ?? (async () => token);

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/event') {
        let body = '';
        let tooBig = false;

        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_EVENT_BYTES) {
            tooBig = true;
            req.destroy();
          }
        });

        req.on('end', () => {
          if (tooBig) return;
          try {
            const { kind, data } = JSON.parse(body);
            onEvent(kind, data);
            res.writeHead(204);
            res.end();
          } catch {
            // A malformed event is the page's problem, not the daemon's.
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }

      if (req.url === '/player') {
        currentToken()
          .then((t) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(playerPage(t, deviceName));
          })
          .catch(() => {
            res.writeHead(500);
            res.end();
          });
        return;
      }

      if (req.url === '/token') {
        currentToken()
          .then((t) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ token: t }));
          })
          .catch(() => {
            res.writeHead(500);
            res.end();
          });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.on('error', reject);

    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}/player`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
