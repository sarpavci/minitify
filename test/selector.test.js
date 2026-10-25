import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderList, moveSelection, select, truncate } from '../src/cli/selector.js';

const items = [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }];

test('renderList marks the selected row', () => {
  const rows = renderList(items, 1, 40);
  assert.ok(rows[1].startsWith('>'), 'selected row is marked');
  assert.ok(!rows[0].startsWith('>'), 'unselected row is not');
});

test('renderList keeps every label', () => {
  const rows = renderList(items, 0, 40);
  assert.equal(rows.length, 3);
  assert.ok(rows[2].includes('Gamma'));
});

test('renderList truncates a label wider than the terminal', () => {
  const rows = renderList([{ label: 'x'.repeat(200) }], 0, 40);
  assert.ok(rows[0].length <= 40, `row was ${rows[0].length} chars`);
  assert.ok(rows[0].includes('…'), 'truncation is visible');
});

test('renderList copes with a very narrow terminal', () => {
  const rows = renderList([{ label: 'something long' }], 0, 6);
  assert.ok(rows[0].length <= 6);
});

test('truncate leaves a short string alone', () => {
  assert.equal(truncate('short', 40), 'short');
});

test('moveSelection wraps at both ends', () => {
  assert.equal(moveSelection(0, -1, 3), 2);
  assert.equal(moveSelection(2, 1, 3), 0);
});

test('moveSelection steps within the list', () => {
  assert.equal(moveSelection(0, 1, 3), 1);
  assert.equal(moveSelection(2, -1, 3), 1);
});

test('moveSelection stays at 0 for an empty list', () => {
  assert.equal(moveSelection(0, 1, 0), 0);
});

// A frame taller than the terminal scrolls, the cursor-up lands in the
// wrong place, and the redraw erases the user's scrollback.
test('renderList never returns more rows than the terminal has', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ label: `item ${i}` }));
  const rows = renderList(many, 0, 40, 10);
  assert.ok(rows.length <= 10, `got ${rows.length} rows for a 10-row window`);
});

test('renderList keeps the selection inside the visible window', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ label: `item ${i}` }));
  const rows = renderList(many, 45, 40, 10);
  assert.ok(rows.some((r) => r.startsWith('>') && r.includes('item 45')), 'selected row must be visible');
});

test('renderList shows the whole list when it fits', () => {
  assert.equal(renderList(items, 0, 40, 10).length, 3);
});

test('select resolves null immediately for an empty list', async () => {
  const printed = [];
  const result = await select([], { header: 'Playlists', write: (s) => printed.push(s) });
  assert.equal(result, null);
  assert.ok(printed.join('').includes('No items'));
});
