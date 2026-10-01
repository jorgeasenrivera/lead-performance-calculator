import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeActivityPair} from '../scripts/daily-sales-integrity-copy.mjs';

function fixture() {
  const before = {header: 'Daily Activity · Tue, Sep 22 · numbers as of 1 min ago\nFictional Store A', ranks: [{rank: '1', text: '1\nAlex\n53 pts'}]};
  const after = {header: 'Daily Activity\nAs of 1 min ago', ranks: [{rank: '1', text: 'Alex\n53 pts'}]};
  before.text = `${before.header}\nThe schedule\nHit their minimums\n${before.ranks[0].text}\nCalls 100`;
  after.text = `${after.header}\nSchedule\nAt minimums\n${after.ranks[0].text}\nCalls 100`;
  return [before, after];
}

test('only the enumerated activity presentation changes compare equal', () => {
  const [left, right] = normalizeActivityPair(...fixture());
  assert.equal(left, right);
});

for (const [name, from, to] of [['number', 'Calls 100', 'Calls 101'], ['name', 'Alex', 'Blair']]) {
  test(`activity comparison preserves each ${name}`, () => {
    const pair = fixture();
    pair[1].text = pair[1].text.replace(from, to);
    if (name === 'name') {
      pair[1].ranks[0].text = pair[1].ranks[0].text.replace(from, to);
      assert.throws(() => normalizeActivityPair(...pair));
    } else {
      const [left, right] = normalizeActivityPair(...pair);
      assert.notEqual(left, right);
    }
  });
}

test('changed freshness, duplicate copy and reassociated ranks fail closed', () => {
  const freshness = fixture();
  freshness[1].header = freshness[1].header.replace('1 min', '2 min');
  assert.throws(() => normalizeActivityPair(...freshness));
  const duplicate = fixture();
  duplicate[1].text += '\nSchedule';
  assert.throws(() => normalizeActivityPair(...duplicate));
  const ranks = fixture();
  ranks[1].ranks[0].rank = '2';
  assert.throws(() => normalizeActivityPair(...ranks));
  const missing = fixture();
  missing[1].ranks = [];
  assert.throws(() => normalizeActivityPair(...missing));
});
