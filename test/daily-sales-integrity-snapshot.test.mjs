import test from 'node:test';
import assert from 'node:assert/strict';
import {collectActivitySnapshot} from '../scripts/daily-sales-integrity-snapshot.mjs';
import {fixtureEntry} from '../scripts/daily-sales-integrity-proposal.mjs';

function fixture(phone = false) {
  const visible = {getClientRects: () => [{}]};
  const header = {...visible, innerText: 'Daily Activity\nAs of 4:00 PM'};
  const rank = {getAttribute: () => '1'};
  const person = {...visible, innerText: 'Alex\n53 pts', querySelector: () => rank};
  return {
    innerText: 'Daily Activity\nAs of 4:00 PM\nAlex\n53 pts',
    ownerDocument: {defaultView: {innerWidth: phone ? 390 : 1280}},
    dataset: {fixtureReady: 'true', fixtureStore: 'store-a'},
    querySelector: selector => selector === '.s2-head .s2-idtx' ? header :
      selector === (phone ? '.co-page' : '.checkout.da-page') ? visible : null,
    querySelectorAll: selector => selector === '.da-pod, .da-lbrow' ? [person] : phone ? [{getAttribute: () => '153'}, {getAttribute: () => '25'}] : [],
  };
}

test('desktop text, header, person and rank are read synchronously from one main', () => {
  const main = fixture();
  const result = collectActivitySnapshot(main, false);
  assert.equal(result instanceof Promise, false);
  assert.equal(result.text, main.innerText);
  assert.equal(result.header, 'Daily Activity\nAs of 4:00 PM');
  assert.deepEqual(result.ranks, [{text: 'Alex\n53 pts', rank: '1'}]);
  assert.deepEqual(result.context, {width: 1280, phone: false, ready: 'true', store: 'store-a'});
});

test('phone numeric glyphs and their text share the same snapshot', () => {
  const result = collectActivitySnapshot(fixture(true), true);
  assert.deepEqual(result.numbers, ['153', '25']);
  assert.equal(result.header, null);
  assert.deepEqual(result.ranks, []);
  assert.equal(result.context.width, 390);
});

test('wrong or hidden responsive surfaces fail instead of creating an empty snapshot', () => {
  assert.throws(() => collectActivitySnapshot(fixture(true), false), /Intended activity surface/);
  const hidden = fixture();
  hidden.querySelector = () => ({getClientRects: () => []});
  assert.throws(() => collectActivitySnapshot(hidden, false), /not visible/);
});

test('fictional readiness follows a real shell child commit, including viewer and store changes', () => {
  const entry = fixtureEntry();
  assert.ok(entry.includes('<AppShell'));
  assert.ok(entry.includes("const surfaceKey=[activity?'activity':'dashboard',phone?'phone':'desktop',selected,loaded,role].join(':')"));
  assert.ok(entry.includes('useEffect(()=>setReady(surfaceKey),[surfaceKey])'));
  assert.ok(entry.includes("data-fixture-ready={ready===surfaceKey?'true':'false'}"));
  assert.ok(!entry.includes('setTimeout'));
});
