import React, { useState, useRef, useMemo, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardRoomPhone, StoreHero, Board } from '@sage/Manager.jsx';
import { Style, Shell, DEFAULT_BRAND, DEFAULT_TIERS, usePhoneLayout } from '@sage/LeadPerformanceCalculator.jsx';
import { ownManagerSignalSurface } from '@sage/manager-signal.mjs';
import signalCSS from '@sage/manager-signal.css?inline';
import { CalendarFixtureContext } from './calendar.jsx';
import { createControlledTransport } from '../synthetic-fixtures/controlled-transport.mjs';
import { httpErrors, malformedCases } from '../synthetic-fixtures/fixture-catalog.mjs';
import alpha from '../synthetic-fixtures/payloads/alpha-september.json';
import corrected from '../synthetic-fixtures/payloads/alpha-september-corrected.json';
import held from '../synthetic-fixtures/payloads/alpha-september-all-held.json';
import beta from '../synthetic-fixtures/payloads/beta-september.json';
import alphaOctober from '../synthetic-fixtures/payloads/alpha-october.json';
import betaOctober from '../synthetic-fixtures/payloads/beta-october.json';
import seed from './seed.json';
import './calendar.css';

const payloads = { 'alpha-september': alpha, 'alpha-september-corrected': corrected, 'alpha-september-all-held': held,
  'beta-september': beta, 'alpha-october': alphaOctober, 'beta-october': betaOctober };
const stores = [
  { ...seed.store, id: 'fictional-a', name: 'Fictional Store Alpha' },
  { ...seed.store, id: 'fictional-b', name: 'Fictional Store Beta' },
];
const data = stores.map((store, i) => {
  const value = structuredClone(seed.data); value.__storeId = store.id;
  value.months['2026-09'].stated = { deliveries: i ? 83 : 61, vehicles: { new: i ? 41 : 37, used: i ? 42 : 24 }, at: '2026-09-22T16:00:00.000Z' };
  return value;
});
const config = { stores, roles: [
  { id: 'sales', name: 'Sales Associate', onBoard: true, coaching: true },
  { id: 'service', name: 'Service to Sales', onBoard: true },
  { id: 'manager', name: 'Manager', onBoard: false }, { id: 'bdc', name: 'BDC', onBoard: false },
], standards: Object.fromEntries(stores.map((store) => [store.id, { sales: { tiers: DEFAULT_TIERS }, service: { tiers: DEFAULT_TIERS } }])), holidays: [] };
const noop = () => {};

function Fixture() {
  const [selected, setSelected] = useState(0), [month, setMonth] = useState('2026-09');
  const [scenario, setScenario] = useState('normal'), [revision, setRevision] = useState(0);
  const [mounted, setMounted] = useState(true), [query, setQuery] = useState('');
  const scenarioRef = useRef(scenario); scenarioRef.current = scenario;
  const transport = useMemo(() => createControlledTransport({ abortMode: 'ignore' }), []);
  const mockFetch = useMemo(() => (input, options) => {
    const promise = transport.fetch(input, options);
    const req = transport.requests.at(-1), chosen = scenarioRef.current;
    queueMicrotask(() => {
      if (['loading', 'manual', 'timeout'].includes(chosen)) return;
      if (chosen === 'network') { transport.fail(req.id); return; }
      if (['401','403','503'].includes(chosen)) {
        transport.settle(req.id, httpErrors[{ 401: 'unauthorized', 403: 'forbidden', 503: 'unavailable' }[chosen]]); return;
      }
      let body = req.month === '2026-10' ? req.storeId === 'fictional-a' ? alphaOctober : betaOctober
        : req.storeId === 'fictional-b' ? beta : chosen === 'corrected' ? corrected : chosen === 'held' ? held : alpha;
      if (chosen === 'malformed') transport.settle(req.id, malformedCases(body)['invalid-json']);
      else if (chosen === 'wrong-store') transport.settle(req.id, malformedCases(body)['wrong-store']);
      else transport.settle(req.id, { body });
    });
    return promise;
  }, [transport]);
  const changeScenario = (value) => { setScenario(value); setRevision((r) => r + 1); };
  useLayoutEffect(() => ownManagerSignalSurface(), []);
  const fixture = useMemo(() => ({ month, revision, fetch: mockFetch }), [month, revision, mockFetch]);
  const phone = usePhoneLayout();
  const props = { config, store: stores[selected], data: data[selected], session: { role: 'manager', name: 'Fictional Tester' },
    query, canSetGoal: false, onSaveConfig: noop, onSetRestriction: noop, onCoach: noop, onGoTab: noop, onFilter: noop,
    onMove: noop, onChange: noop, readOnly: true };
  useLayoutEffect(() => {
    window.__calendarFixture = {
      setStore: (id) => { if (!['fictional-a','fictional-b'].includes(id)) throw new Error('Fictional stores only'); setSelected(id === 'fictional-a' ? 0 : 1); },
      setMonth: (value) => { if (!['2026-09','2026-10'].includes(value)) throw new Error('Fixture months only'); setMonth(value); },
      setScenario: changeScenario, setNextResponse: (value) => { scenarioRef.current = value; }, setMounted, reload: () => setRevision((r) => r + 1), transport,
      settle: (id, payloadId) => { if (!payloads[payloadId]) throw new Error('Unknown fixture'); return transport.settle(id, { body: payloads[payloadId] }); },
      fail: (id, kind) => transport.fail(id, kind),
      snapshot: () => ({ storeId: stores[selected].id, month, scenario, revision, mounted, requests: transport.requests }),
    };
  });
  const brand = stores[selected].brand || DEFAULT_BRAND;
  return <CalendarFixtureContext.Provider value={fixture}><Shell entering={false} style={{ '--sp': brand.primary, '--sd': brand.deep, '--sa': brand.accent }}>
    <Style/><style data-fixture-signal-style>{signalCSS}</style>
    <header className="fixture-toolbar">
      <strong>Fictional calendar proposal</strong>
      <label>Store <select aria-label="Fixture store" value={selected} onChange={(event) => setSelected(Number(event.target.value))}><option value="0">Alpha</option><option value="1">Beta</option></select></label>
      <label>Report month <select aria-label="Fixture report month" value={month} onChange={(event) => setMonth(event.target.value)}><option value="2026-09">September</option><option value="2026-10">October</option></select></label>
      <label>Response <select aria-label="Fixture response" value={scenario} onChange={(event) => changeScenario(event.target.value)}>
        {['normal','corrected','held','loading','401','403','503','network','timeout','malformed','wrong-store','manual'].map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label>Search <input aria-label="Fictional associate search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Fictional associate"/></label>
      <button type="button" onClick={() => setMounted((value) => !value)}>{mounted ? 'Unmount view' : 'Mount view'}</button>
      <small>Local only · Actual Signal components from 0f165a2 · Printed store counts are fictional · The existing monthly hero stays on September</small>
    </header>
    <main className="page fixture-root" data-fixture-store={stores[selected].id} data-fixture-layout={phone ? 'phone' : 'desktop'}>
      {mounted ? phone ? <BoardRoomPhone {...props}/> : <><StoreHero {...props}/><Board {...props}/></> : <p>View unmounted for interruption testing</p>}
    </main>
    <footer className="fixture-proof">Proposal only. Calendar copy and interactions need item-by-item approval. Recap, best day and daily channel comparisons remain unavailable.</footer>
  </Shell></CalendarFixtureContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
