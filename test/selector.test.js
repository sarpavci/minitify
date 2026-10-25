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

test('select resolves null immediately for an empty list', async () => {
  const printed = [];
  const result = await select([], { header: 'Playlists', write: (s) => printed.push(s) });
  assert.equal(result, null);
  assert.ok(printed.join('').includes('No items'));
});
