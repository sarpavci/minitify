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

export function renderList(items, selectedIndex, width = DEFAULT_WIDTH) {
  return items.map((item, index) => {
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
export function select(items, { header, width, input = process.stdin, write } = {}) {
  const out = write ?? ((s) => process.stdout.write(s));
  const columns = width ?? process.stdout.columns ?? DEFAULT_WIDTH;

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
      const rows = [];
      if (header) rows.push(truncate(header, columns));
      rows.push(...renderList(items, selected, columns));
      out(rows.join('\n') + '\n');
      drawnLines = rows.length;
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
