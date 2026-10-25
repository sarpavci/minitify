const SIMPLE = new Set(['next', 'prev', 'pause', 'resume', 'status', 'quit', 'login']);

export const USAGE = `minitify — a small Spotify remote

  minitify                   pick a playlist
  minitify search <words>    pick from search results
  minitify status            what is playing
  minitify next|prev|pause
  minitify vol <0-100>
  minitify shuffle [on|off]  toggle without an argument
  minitify repeat [off|all|one]
  minitify overlay [on|off]  the floating mini-player
  minitify login             first-time setup
  minitify quit              stop the background player`;

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

  if (name === 'overlay') {
    const arg = rest[0];
    if (arg === undefined) return { name, args: [] };
    if (arg !== 'on' && arg !== 'off') throw new Error('overlay takes on or off');
    return { name, args: [arg] };
  }

  if (name === 'shuffle') {
    const arg = rest[0];
    if (arg === undefined) return { name, args: [] };
    if (arg !== 'on' && arg !== 'off') throw new Error('shuffle takes on or off');
    return { name, args: [arg === 'on'] };
  }

  if (name === 'repeat') {
    const arg = rest[0];
    if (arg === undefined) return { name, args: [] };
    // Spotify's own words are off/context/track; these read better.
    const modes = { off: 'off', all: 'context', one: 'track' };
    if (!(arg in modes)) throw new Error('repeat takes off, all or one');
    return { name, args: [modes[arg]] };
  }

  if (name === 'playlists' || SIMPLE.has(name)) return { name, args: [] };

  throw new Error(`Unknown command: ${name}\n\n${USAGE}`);
}
