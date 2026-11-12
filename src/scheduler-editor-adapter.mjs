// Scoped inputs for the dormant editor host. This is not authentication or a
// persistence adapter; the host's synthetic-only activation guard remains.
import { monthDays, validDate, validMonth } from './scheduler-calendar-model.mjs';

export class EditorInputError extends Error {
  constructor(code) { super(`Scheduler input unavailable: ${code}`); this.code = code; }
}
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const epoch = value => Number.isSafeInteger(value) && value >= 0;
const token = value => typeof value === 'string' && ID.test(value);
const norm = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g,' ') : '';
const dateOf = value => {
  const date=typeof value==='string'?value.slice(0,10):'';
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date?date:null;
};

export function zonedToday(timezone, now) {
  if (typeof timezone !== 'string' || !timezone || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const part = type => parts.find(p=>p.type===type)?.value;
    const day = `${part('year')}-${part('month')}-${part('day')}`;
    return validDate(day) ? day : null;
  } catch { return null; }
}

function rosterBounds(data) {
  if (!Array.isArray(data?.roster) || !Array.isArray(data.departed ?? [])) throw new EditorInputError('roster');
  if (data.roster.length > 500) throw new EditorInputError('roster');
  const seen = new Set(), out = [];
  for (const p of data.roster) {
    if (!p || !p.roleId) continue;
    if (!token(p.id) || seen.has(p.id)) throw new EditorInputError('roster');
    seen.add(p.id);
    const name = typeof p.name === 'string' && p.name ? p.name : 'Unnamed';
    const departed = (data.departed || []).find(d=>d && (d.id===p.id || (d.id==null && norm(d.name)===norm(name))));
    const hired=dateOf(p.hiredAt),left=dateOf(departed?.at);
    const supplied=value=>value!==null&&value!==undefined&&value!=='';
    if((supplied(p.hiredAt)&&!hired)||(supplied(departed?.at)&&!left)||(hired&&left&&left<hired))throw new EditorInputError('employment');
    out.push({person:{id:p.id,name,off:null,start:null,end:null,maxHours:null,...(hired?{hiredAt:hired}:{}),...(left?{departedAt:left}:{})},hired,left});
  }
  return out;
}

export function editorStore(store, data, timezone) {
  if (!token(store?.id)) throw new EditorInputError('store');
  return {id:store.id,name:typeof store.name==='string'&&store.name?store.name:store.id,timezone,
    people:rosterBounds(data).map(r=>r.person),rules:[],history:[],teams:[],memberships:[]};
}

export function monthPeople(data) {
  const bounds = rosterBounds(data);
  return month => {
    if (!validMonth(month)) return [];
    const dates = monthDays(month), first=dates[0], last=dates.at(-1);
    return bounds.filter(r=>!(r.left && r.left<first) && !(r.hired && r.hired>last)).map(r=>structuredClone(r.person));
  };
}

// The resolver is supplied by the seeding lane. Do not infer hours or read the
// attendance-adjusted isOff rule here. No source means no assignment facts.
export function editorProps({store,data,timezone,now,principalEpoch,dataEpoch,explicitAssignmentForDay}={}) {
  if (!token(store?.id)) return {ok:false,reason:'store'};
  if (data?.__storeId!==store.id) return {ok:false,reason:'not-ready'};
  if (!epoch(principalEpoch) || principalEpoch!==dataEpoch) return {ok:false,reason:'principal'};
  if (explicitAssignmentForDay!==undefined && typeof explicitAssignmentForDay!=='function') return {ok:false,reason:'assignments'};
  const instant = typeof now==='function' ? now : ()=>now;
  const today = () => { let date=null; try { date=zonedToday(timezone,instant()); } catch {} if(!date)throw new EditorInputError('timezone');return date; };
  try {
    today();
    const snapshot = structuredClone(data), stores=[editorStore(store,snapshot,timezone)], peopleFor=monthPeople(snapshot), storeId=stores[0].id;
    return {ok:true,stores,index:0,strictHours:true,today,assignmentForDay:()=>null,
      peopleForMonth:(index,month)=>index===0?peopleFor(month):[],
      explicitAssignmentForDay(day,index=0) {
        if (index!==0 || !validDate(day)) return null;
        const bound = explicitAssignmentForDay?.(day,index);
        if (bound==null) return null;
        if (typeof bound!=='object' || Array.isArray(bound) || bound.storeId!==storeId || bound.day!==day || !bound.record || typeof bound.record!=='object' || Array.isArray(bound.record)) throw new EditorInputError('assignment-scope');
        return structuredClone(bound);
      }};
  } catch (error) { if(error instanceof EditorInputError)return {ok:false,reason:error.code};throw error; }
}

// Pure, read-only legacy input for the planner's explicitAssignmentForDay port.
// Legacy Off facts are not working intervals, attendance, or publication authority.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && value.length > 0
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const dayKey = value => typeof value === 'string' && /^(20\d{2}|2100)-(0[1-9]|1[0-2])-\d{2}$/.test(value)
  && value >= '2014-01-01' && value <= '2100-12-31'
  && Number.isFinite(Date.parse(value + 'T12:00:00Z'))
  && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const revisionKey = value => Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && value.length > 0;
const copy = value => structuredClone(value);
const owns = (value, key) => Object.hasOwn(value, key);
const dense = value => Array.isArray(value) && Object.keys(value).length === value.length
  && Object.keys(value).every((key, index) => key === String(index));

export function createLegacyScheduleResolver({ stores, snapshots, startDate, endDate }) {
  if (!dense(stores) || !stores.length || !dense(snapshots)) throw Error('Supply stores and explicit legacy snapshots.');
  if (!dayKey(startDate) || !dayKey(endDate) || startDate > endDate) throw Error('Supply a valid inclusive date range.');
  const storeIds = new Set(), snapshotById = new Map();
  for (const snapshot of snapshots) {
    if (!plain(snapshot) || !id(snapshot.storeId) || !revisionKey(snapshot.revision)
        || !plain(snapshot.data) || snapshot.data.__storeId !== snapshot.storeId || snapshotById.has(snapshot.storeId)) {
      throw Error('Legacy snapshots need unique matching store identities and explicit revisions.');
    }
    snapshotById.set(snapshot.storeId, copy(snapshot));
  }
  const compiled = stores.map(store => {
    if (!plain(store) || !id(store.id) || storeIds.has(store.id) || !dense(store.people)) throw Error('Supply a unique store and explicit stable-ID roster.');
    storeIds.add(store.id);
    const people = store.people.map(person => person?.id);
    if (people.some(personId => !id(personId)) || new Set(people).size !== people.length) throw Error('Person identities must be stable and unique within the store.');
    const known = new Set(people), snapshot = snapshotById.get(store.id);
    const issues = [], warnings = [], blockedDays = new Set(), offByDay = new Map(), forcedByDay = new Map();
    let blocked = false;
    const issue = (code, details = {}, wholeStore = false) => {
      issues.push({ code, storeId: store.id, ...details });
      if (wholeStore) blocked = true;
      else if (details.date) blockedDays.add(details.date);
    };
    if (!snapshot) {
      issue('legacy-source-unavailable', {}, true);
      return { storeId: store.id, people, snapshot: null, issues, warnings, blocked, blockedDays, offByDay, forcedByDay };
    }
    const data = snapshot.data;
    for (const [field, destination] of [['daysOff', offByDay], ['forcedOff', forcedByDay]]) {
      if (owns(data, field) && !plain(data[field])) { issue('invalid-legacy-map', { field }, true); continue; }
      for (const [personId, dates] of Object.entries(data[field] || {})) {
        if (!id(personId) || !dense(dates) || dates.some(day => !dayKey(day)) || new Set(dates).size !== dates.length) {
          issue('invalid-legacy-date-list', { field, personId }, true); continue;
        }
        for (const day of dates) {
          if (!known.has(personId)) { issue('unresolved-person-id', { field, personId, date: day }); continue; }
          if (!destination.has(day)) destination.set(day, new Set());
          destination.get(day).add(personId);
        }
      }
    }
    if (owns(data, 'daysOffAt') && !plain(data.daysOffAt)) issue('invalid-person-stamps', {}, true);
    else for (const [personId, stamp] of Object.entries(data.daysOffAt || {})) {
      if (!id(personId) || typeof stamp !== 'string' || !stamp) issue('invalid-person-stamp', { personId }, true);
    }
    for (const [day, forced] of forcedByDay) for (const personId of forced) {
      if (!offByDay.get(day)?.has(personId)) issue('forced-off-conflicts-with-days-off', { personId, date: day });
    }
    if (owns(data, 'scheduleSource') && !plain(data.scheduleSource)) warnings.push({ code: 'invalid-upload-provenance-map', storeId: store.id });
    else for (const [sourceMonth, source] of Object.entries(data.scheduleSource || {})) {
      if (!plain(source) || !plain(source.off)) {
        warnings.push({ code: 'invalid-upload-provenance-entry', storeId: store.id, sourceMonth }); continue;
      }
      for (const [personId, dates] of Object.entries(source.off)) {
        if (!id(personId) || !dense(dates) || dates.some(day => !dayKey(day))) warnings.push({ code: 'invalid-upload-provenance-dates', storeId: store.id, sourceMonth, personId });
      }
    }
    return { storeId: store.id, people, snapshot, issues, warnings, blocked, blockedDays, offByDay, forcedByDay };
  });
  if ([...snapshotById.keys()].some(storeId => !storeIds.has(storeId))) throw Error('A legacy snapshot belongs to an unrequested store.');

  const referencesFor = (data, personId, day) => {
    const references = [];
    if (!plain(data.scheduleSource)) return references;
    for (const [sourceMonth, source] of Object.entries(data.scheduleSource)) {
      if (!plain(source) || !plain(source.off) || !dense(source.off[personId]) || source.off[personId].some(value => !dayKey(value)) || !source.off[personId].includes(day)) continue;
      const reference = { sourceMonth, field: 'scheduleSource.off', personId, date: day };
      for (const field of ['file', 'at', 'kind']) if (typeof source[field] === 'string') reference[field] = source[field];
      references.push(reference);
    }
    return references.sort((a, b) => a.sourceMonth.localeCompare(b.sourceMonth));
  };

  const explicitAssignmentForDay = (day, index) => {
    if (!dayKey(day) || day < startDate || day > endDate || !Number.isInteger(index) || !compiled[index]) return null;
    const state = compiled[index];
    if (state.blocked || state.blockedDays.has(day)) return null;
    const { storeId, snapshot, people } = state, data = snapshot.data;
    const record = { on: [], off: [], absences: {}, unknownNotes: {} };
    for (const personId of people) {
      const source = { kind: 'legacy schedule', storeId, snapshotRevision: snapshot.revision, personId, date: day };
      if (state.offByDay.get(day)?.has(personId)) {
        source.field = 'daysOff';
        source.managerForced = Boolean(state.forcedByDay.get(day)?.has(personId));
        source.uploadReferences = referencesFor(data, personId, day);
        source.originalAbsenceTypeKnown = false;
        if (owns(data.daysOffAt || {}, personId)) source.personMutationStamp = data.daysOffAt[personId];
        record.off.push(personId);
        record.absences[personId] = { kind: 'off', source };
      } else {
        source.reason = 'Legacy data contains no explicit working intervals for this person and date.';
        record.unknownNotes[personId] = { source };
      }
    }
    return { storeId, day, record };
  };

  return {
    explicitAssignmentForDay,
    report: () => copy({ startDate, endDate, applyReady: false, completeProvenance: false,
      stores: compiled.map(state => ({ storeId: state.storeId, sourceAvailable: Boolean(state.snapshot),
        revision: state.snapshot?.revision ?? null, blocked: state.blocked,
        blockedDates: [...state.blockedDays].sort(), issues: state.issues, warnings: state.warnings })) }),
  };
}
