import { applyQueueAction, QUEUE_ACTIONS } from './_queue-action.mjs';
import { applyPhoneAction, isPhoneAction } from './_phone-action.mjs';
import { releasePerson, stationOf } from './_stations.mjs';
import { pointsForDay, stampLineMoves } from './_phone-rows.mjs';
export const SELF_COMMANDS = ['join','status','table','table-checkin','undo-checkin','checkout','complete-checkout','assist','cancel-assist','goal-note','heartbeat','leave','release-desk','offday-denied'];
const tableValue = t => typeof t === 'string' || typeof t === 'number';
const fail = why => { throw Object.assign(new Error(why), { status: 400 }); };
/* Caller passes authenticated link, current authoritative row/config and figures.
   No actor, label, counts, timestamp or replacement JSON is accepted from input. */
export function selfRoomCommand({ room, row, personId, action, input = {}, now, config, store, figures, standards, allowedTables = [] }) {
  if (!row || !Array.isArray(row.line)) return fail('Room unavailable');
  const roster = (row.roster || []).find(p=>p.id===personId);
  if (!roster) return fail('Linked person is not on this roster');
  if (room === 'line' && action === 'status') {
    const mapped = { waiting: 'back-line', lunch: 'lunch-line', away: 'away-line' }[input.status];
    if (!mapped) return fail('Invalid status');
    return applyPhoneAction(config,store,row,personId,mapped,now);
  }
  if (room === 'line' && isPhoneAction(action)) return applyPhoneAction(config,store,row,personId,action,now,{desk:input.desk});
  if (room === 'floor' && QUEUE_ACTIONS.includes(action)) {
    const out=applyQueueAction(row,personId,action,now);
    const completed=(row.checkouts||[]).find(c=>c.id===personId&&!c.partial);
    if(action==='leave'&&completed&&out.changed)out.row.checkouts=(out.row.checkouts||[]).map(c=>c.id===personId?completed:c);
    return out;
  }
  if (!SELF_COMMANDS.includes(action)) return fail('Unknown room command');
  const next=structuredClone(row);next.history ||= [];
  let me=next.line.find(p=>p.id===personId);
  const log = action => next.history.push({t:now,action,id:personId,who:roster.label||roster.name,by:'self'});
  if(action==='offday-denied') {
    if(room!=='floor')return fail('Invalid room');
    return {row,changed:false}; // Private evidence is validated and written in the transaction.
  } else if(action==='release-desk') {
    if(!['line','online'].includes(room)||!['out','left','lunch'].includes(input.reason))return fail('Invalid seat release');
    const out=releasePerson(next,personId,now,input.reason);
    if(input.reason==='lunch'){
      const p=(out.row?.line||[]).find(x=>x.id===personId);
      if(p){p.status='lunch';p.statusAt=now;p.awayReason='lunch';}
    }
    return out;
  } else if (action==='goal-note') {
    if(room!=='floor'||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000||typeof input.forDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.forDay)||input.forDay>row.date||!Number.isFinite(Date.parse(input.forDay+'T12:00:00Z'))||new Date(input.forDay+'T12:00:00Z').toISOString().slice(0,10)!==input.forDay) return fail('Invalid coaching note');
    const name=roster.name||roster.label;
    next.goalNotes=[{at:now,forDay:input.forDay,id:personId,who:String(name).trim().toLowerCase().replace(/\s+/g,' '),name,by:name,text:input.text.trim()},...(next.goalNotes||[])];
  } else if(action==='heartbeat') {
    if(!['line','online'].includes(room)) return fail('Invalid room');
    const seat=stationOf(next,personId);if(seat==null)return {row,changed:false};
    next.stations[seat].seen=now;
  } else if(action==='leave') {
    if(!['line','online'].includes(room))return fail('Invalid room');
    const released=releasePerson(next,personId,now,'out');
    const out=released.row||next;out.line=(out.line||[]).filter(p=>p.id!==personId);
    out.history ||= [];out.history.push({t:now,action:'left',id:personId,who:roster.label||roster.name,by:'self'});
    return {row:out,changed:true};
  } else if (action==='join') {
    if(me) return {row,changed:false};
    next.line.push({id:personId,label:roster.label||roster.name,joinedAt:now,status:'waiting',statusAt:now});log('signed-in');
  } else if (action==='checkout' || action==='complete-checkout') {
    if (!figures) return fail('Current activity unavailable');
    const current=(next.checkouts||[]).find(c=>c.id===personId);
    if(action==='complete-checkout' && !current?.partial) return {row,changed:false};
    const snapshot={};for(const k of ['calls','video','tasks','tasksPosted','units','rocked','uploadedAt']) if(figures[k]!==undefined) snapshot[k]=figures[k];
    const entry={id:personId,who:roster.label||roster.name,name:roster.name,t:current?.t||now,...snapshot,points:pointsForDay(figures,standards).points,asOf:figures.uploadedAt||null};
    next.checkouts=[...(next.checkouts||[]).filter(c=>c.id!==personId),entry];
  } else if(action==='assist') {
    if(!me || !['to','fly'].includes(input.kind)) return fail('Invalid assistance request');
    if(input.table!=null && (!tableValue(input.table)||!allowedTables.map(String).includes(String(input.table)))) return fail('Unknown table');
    if(input.note!=null && (typeof input.note!=='string'||input.note.length>500)) return fail('Invalid note');
    next.assists=[{id:`${personId}:${now}`,t:now,kind:input.kind,byId:personId,byName:roster.name,table:input.table??null,spot:input.table==null?'lot':'floor',note:input.note||null},...(next.assists||[]).filter(a=>a.byId!==personId||a.doneAt)].slice(0,40);
  } else if(action==='cancel-assist') {
    const a=(next.assists||[]).find(a=>a.id===input.assistId && a.byId===personId && !a.doneAt);
    if(!a) return {row,changed:false};a.doneAt=now;a.cancelled=true;
  } else {
    if(!me) return fail('Join the room first');
    if(action==='status') {
      if(!(room==='floor'?['waiting','customer','lunch','away']:['waiting','lunch','away']).includes(input.status)) return fail('Invalid status');
      me.awayReason=input.status==='waiting'?null:input.status;me.status=input.status;me.statusAt=now;log(input.status==='waiting'?'back':input.status);
    } else if(action==='table'||action==='table-checkin') {
      if(room!=='floor'||!tableValue(input.table)||!allowedTables.map(String).includes(String(input.table))) return fail('Unknown table');
      if(action==='table'&&me.status!=='customer') return fail('Take a customer before choosing a table');
      if(action==='table-checkin'&&me.status!=='customer'){me.status='customer';me.statusAt=now;me.awayReason=null;me.autoFlip=false;log('checkin');}
      me.table=input.table;
    } else if(action==='undo-checkin') {
      if(room!=='floor'||!me.autoFlip||!me.accidentalUntil||!Number.isFinite(Date.parse(me.accidentalUntil))||Date.parse(me.accidentalUntil)<Date.parse(now)) return fail('Check-in reversal expired');
      me.status='waiting';me.statusAt=now;me.autoFlip=false;me.accidentalUntil=null;log('accidental-undo');
    }
  }
  stampLineMoves(row,next,now);
  return {row:next,changed:true};
}
