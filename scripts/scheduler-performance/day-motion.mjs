// Preview motion uses monotonic easing and opaque frames. Touch entry is 220 ms;
// settling and exit use the existing planner 160 ms duration.
export const DAY_MOTION_MS=160;
export function swipeIntent(dx,dy){if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx))return 'vertical';return Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*2?'horizontal':'pending';}
export function swipeDirection(dx,dy,elapsed){return elapsed<=1200&&Math.abs(dx)>=60&&Math.abs(dx)>Math.abs(dy)*2?(dx<0?1:-1):0;}
export function createDayMotion({getLive,getHost,getDay,neighbor,markup,commit,reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches}){
 let state=null,serial=0,entry=null,exit=null;
 const x=el=>{const t=getComputedStyle(el).transform;return t==='none'?0:new DOMMatrix(t).m41;};
 function stopAnimation(){if(!state)return;const offset=state.animations?.length?x(getLive()):state.offset;serial++;for(const a of state.animations||[])a.cancel();state.animations=[];state.offset=offset;position(offset);}
 function position(offset){if(!state)return;state.offset=offset;if(reduced())return;getLive().style.transform=`translateX(${offset}px)`;for(const p of state.previews)p.element.style.transform=`translateX(${offset+p.direction*state.width}px)`;}
 function cleanup(){serial++;for(const a of state?.animations||[])a.cancel();for(const p of state?.previews||[])p.element.remove();state=null;const live=getLive();if(live)live.style.transform='';}
 function cancel(){entry?.cancel();entry=null;exit?.cancel();exit=null;cleanup();}
 function prepare(target,direction){
  const live=getLive(),host=getHost();if(!live||!host)return;
  const width=host.clientWidth;
  const previews=[];
  if(!reduced())for(const side of [-1,1]){const day=side===direction?target:neighbor(getDay(),side);if(!day)continue;const element=document.createElement('section');element.className='panel day-panel day-motion-preview';element.setAttribute('aria-hidden','true');element.inert=true;element.innerHTML=markup(day);for(const el of element.querySelectorAll('[id]'))el.removeAttribute('id');element.style.top=host.scrollTop+'px';element.style.width=width+'px';host.append(element);previews.push({element,day,direction:side});}
  state={origin:getDay(),target,direction,width,previews,offset:0,animations:[],desired:target,focusId:null};position(0);
 }
 function settle(commitTarget){
  if(!state)return;if(!commitTarget)state.desired=state.origin;stopAnimation();const s=state,live=getLive(),from=s.offset,to=commitTarget?-s.direction*s.width:0,token=++serial;
  const finish=()=>{if(token!==serial||state!==s)return;const focusId=s.focusId,target=s.target;cleanup();if(commitTarget)commit(target,focusId);};
  if(reduced()||Math.abs(to-from)<1){finish();return;}
  const duration=DAY_MOTION_MS*Math.min(1,Math.abs(to-from)/s.width);
  s.animations=[live.animate([{transform:`translateX(${from}px)`},{transform:`translateX(${to}px)`}],{duration,easing:'ease-out',fill:'forwards'})];
  for(const p of s.previews)s.animations.push(p.element.animate([{transform:`translateX(${from+p.direction*s.width}px)`},{transform:`translateX(${to+p.direction*s.width}px)`}],{duration,easing:'ease-out',fill:'forwards'}));
  Promise.all(s.animations.map(a=>a.finished)).then(finish,()=>{});
 }
 function navigateTo(target,direction,focusId){entry?.cancel();exit?.cancel();prepare(target,direction);if(!state)return;state.focusId=focusId;settle(true);}
 function navigate(direction,focusId,animated=true){
  if(!animated){const target=neighbor(state?.desired||getDay(),direction);cancel();if(target)commit(target,focusId);return;}
  if(state){const desired=neighbor(state.desired||state.origin,direction);if(!desired)return;stopAnimation();state.desired=desired;state.focusId=focusId;if(desired===state.origin){settle(false);return;}state.target=desired;state.direction=desired>state.origin?1:-1;const p=state.previews.find(p=>p.direction===state.direction);if(p&&p.day!==desired){p.day=desired;p.element.innerHTML=markup(desired);for(const el of p.element.querySelectorAll('[id]'))el.removeAttribute('id');}settle(true);return;}
  const target=neighbor(getDay(),direction);if(target)navigateTo(target,direction,focusId);
 }
 function begin(){entry?.cancel();exit?.cancel();if(state){stopAnimation();state.desired=state.target;}return state?.offset||0;}
 function drag(offset){
  const direction=offset<0?1:-1,target=state?.direction===direction&&state.target?state.target:neighbor(getDay(),direction);
  if(!state)prepare(target,direction);else{state.direction=direction;state.target=target;state.desired=target;const p=state.previews.find(p=>p.direction===direction);if(p&&target&&p.day!==target){p.day=target;p.element.innerHTML=markup(target);for(const el of p.element.querySelectorAll('[id]'))el.removeAttribute('id');}}
  if(state)position(target?Math.max(-state.width,Math.min(state.width,offset)):Math.max(-12,Math.min(12,offset*.15)));
 }
 function release(eligible=true){if(!state)return;state.desired=state.target;settle(Boolean(eligible&&state.target&&Math.abs(state.offset)>=60));}
 function enter(animated=true){cancel();if(reduced()||!animated)return;entry=getLive()?.animate([{transform:'translateY(12px)'},{transform:'translateY(0)'}],{duration:220,easing:'ease-out'});}
 async function leave(animated=true){const from=getLive()?getComputedStyle(getLive()).transform:'none';cancel();if(reduced()||!animated)return true;const animation=exit=getLive()?.animate([{transform:from},{transform:'translateY(12px)'}],{duration:160,easing:'ease-out',fill:'forwards'});try{await animation?.finished;if(exit!==animation)return false;exit=null;animation?.cancel();return true;}catch{return false;}}
 function finish(){const target=state?.desired,focusId=state?.focusId;cancel();if(target&&target!==getDay())commit(target,focusId);}
 return {navigate,begin,drag,release,enter,leave,cancel,finish};
}
