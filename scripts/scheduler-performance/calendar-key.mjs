import {icon} from './sage-icons.mjs';
export const historyLevels=Object.freeze([0,1,2,3,4]);
export const historyClass=level=>`history-${historyLevels.includes(level)?level:'unknown'}`;
export const scheduleMarkers=Object.freeze({needs:{label:'Needs review',glyph:'warn'},low:{label:'Low staff',glyph:'warn'},closed:{label:'Closed',symbol:'×'},unknown:{label:'Hours unknown',symbol:'?'}});
export function scheduleMarker(kind){
 const marker=scheduleMarkers[kind];if(!marker)return '';
 return `<span class="${marker.glyph?'schedule-flag':'schedule-state'} ${kind}" data-schedule-marker="${kind}" aria-hidden="true">${marker.glyph?icon(marker.glyph):marker.symbol}</span>`;
}
export function historyScale(){return `<span class="history-scale"><span>Quieter</span>${historyLevels.map(n=>`<i class="${historyClass(n)}" data-history-token="${n}" aria-hidden="true"></i>`).join('')}<span>Busier</span><i class="${historyClass(null)}" data-history-token="unknown" aria-hidden="true"></i><span>Insufficient history</span></span>`;}
export function scheduleKey(){return `<ul class="schedule-key">${Object.entries(scheduleMarkers).map(([kind,m])=>`<li>${scheduleMarker(kind)}<span>${m.label}</span></li>`).join('')}</ul>`;}
