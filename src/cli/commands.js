const SIMPLE = new Set(['next', 'prev', 'pause', 'resume', 'status', 'quit', 'login']);

export const USAGE = `minitify — a small Spotify remote

  minitify                 pick a playlist
  minitify search <words>  pick from search results
  minitify status          what is playing
  minitify next|prev|pause
  minitify vol <0-100>
  minitify login           first-time setup
  minitify quit            stop the background player`;

export function parseArgs(argv) {
  const [name, ...rest] = argv;

  if (!name) return { name: 'playlists', args: [] };

  if (name === 'search') {
    const query = rest.join(' ').trim();
    if (!query) throw new Error('search needs something to look for');
    return { name: 'search', args: [query] };
  }

  if (name === 'vol') {
    const value = Number(rest[0]);
    if (rest.length === 0 || !Number.isFinite(value)) {
      throw new Error('vol needs a number between 0 and 100');
    }
    return { name: 'vol', args: [value] };
  }

  if (name === 'playlists' || SIMPLE.has(name)) return { name, args: [] };

  throw new Error(`Unknown command: ${name}\n\n${USAGE}`);
}
