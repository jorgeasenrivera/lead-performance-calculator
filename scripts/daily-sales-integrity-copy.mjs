import assert from 'node:assert/strict';

function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length - 1, 1, `approved copy must occur once: ${from}`);
  return text.replace(from, to);
}

// Only the enumerated Signal presentation changes are normalized. Names,
// numeric associations, time metadata and all remaining text stay exact.
export function normalizeActivityPair(before, after) {
  const prefix = 'Daily Activity · Tue, Sep 22 · ';
  const suffix = '\nFictional Store A';
  assert.ok(before.header.startsWith(prefix) && before.header.endsWith(suffix));
  const fresh = before.header.slice(prefix.length, -suffix.length);
  assert.ok(fresh.length > 0);
  assert.equal(after.header, 'Daily Activity\n' + fresh.replace(/^numbers as of/, 'As of'));
  let left = replaceOnce(before.text, before.header, '[ACTIVITY HEADER]');
  let right = replaceOnce(after.text, after.header, '[ACTIVITY HEADER]');
  left = replaceOnce(left, 'The schedule', '[SCHEDULE]');
  right = replaceOnce(right, 'Schedule', '[SCHEDULE]');
  left = replaceOnce(left, 'Hit their minimums', '[MINIMUMS]');
  right = replaceOnce(right, 'At minimums', '[MINIMUMS]');
  assert.ok(before.ranks.length > 0, 'fixture must exercise the approved podium ranks');
  assert.equal(after.ranks.length, before.ranks.length);
  for (let i = 0; i < before.ranks.length; i++) {
    const old = before.ranks[i], current = after.ranks[i];
    assert.match(old.rank, /^\d+$/);
    assert.equal(current.rank, old.rank, 'dot rank stays attached to the same person and points');
    assert.equal(old.text, old.rank + '\n' + current.text, 'only the numeral rendering changes');
    left = replaceOnce(left, old.text, '[RANK ' + old.rank + ']\n' + current.text);
    right = replaceOnce(right, current.text, '[RANK ' + old.rank + ']\n' + current.text);
  }
  return [left, right];
}
