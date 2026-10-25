import { emitKeypressEvents } from 'node:readline';

const MARKER = '> ';
const INDENT = '  ';
const DEFAULT_WIDTH = 80;

// Long track names would wrap and corrupt the redraw, so cut them to width.
export function truncate(text, width) {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width === 1) return '…';
  return text.slice(0, width - 1) + '…';
}

// Keeps the frame inside the terminal. A list taller than the window would
// scroll, which sends the cursor-up redraw to the wrong line and erases the
// user's scrollback.
export function visibleWindow(length, selectedIndex, maxRows) {
  if (!maxRows || length <= maxRows) return { start: 0, end: length };
  const half = Math.floor(maxRows / 2);
  const start = Math.min(Math.max(0, selectedIndex - half), length - maxRows);
  return { start, end: start + maxRows };
}

export function renderList(items, selectedIndex, width = DEFAULT_WIDTH, maxRows = 0) {
  const { start, end } = visibleWindow(items.length, selectedIndex, maxRows);
  return items.slice(start, end).map((item, offset) => {
    const index = start + offset;
    const prefix = index === selectedIndex ? MARKER : INDENT;
    return prefix + truncate(item.label, Math.max(0, width - prefix.length));
  });
}

export function moveSelection(index, delta, length) {
  if (length <= 0) return 0;
  return (index + delta + length) % length;
}

/**
 * Shows a keyboard-driven list. Resolves the chosen item, or null when the
 * user escapes or the list is empty.
 */
export function select(items, { header, width, rows, input = process.stdin, write } = {}) {
  const out = write ?? ((s) => process.stdout.write(s));
  const columns = width ?? process.stdout.columns ?? DEFAULT_WIDTH;
  // Leave room for the header and the line the shell prints after us.
  const maxRows = Math.max(3, (rows ?? process.stdout.rows ?? 24) - (header ? 2 : 1));

  if (!items.length) {
    out('No items\n');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let selected = 0;
    let drawnLines = 0;

    const draw = () => {
      // Walk back over the previous frame instead of clearing the screen,
      // so whatever was in the terminal before stays put.
      if (drawnLines) out(`\x1b[${drawnLines}A\x1b[0J`);
      const frame = [];
      if (header) frame.push(truncate(header, columns));
      frame.push(...renderList(items, selected, columns, maxRows));
      out(frame.join('\n') + '\n');
      drawnLines = frame.length;
    };

    const finish = (value) => {
      input.removeListener('keypress', onKey);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      if (drawnLines) out(`\x1b[${drawnLines}A\x1b[0J`);
      resolve(value);
    };

    const onKey = (_str, key) => {
      if (!key) return;
      if (key.name === 'up' || key.name === 'k') { selected = moveSelection(selected, -1, items.length); draw(); }
      else if (key.name === 'down' || key.name === 'j') { selected = moveSelection(selected, 1, items.length); draw(); }
      else if (key.name === 'return') finish(items[selected]);
      else if (key.name === 'escape' || key.name === 'q' || (key.ctrl && key.name === 'c')) finish(null);
    };

    emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    input.on('keypress', onKey);
    draw();
  });
}
