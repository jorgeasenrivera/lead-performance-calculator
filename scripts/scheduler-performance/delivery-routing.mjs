// Applied only to the hash-pinned preview copy, never production source.
const once=(source,from,to)=>{if(source.split(from).length!==2)throw Error('Delivery route boundary changed: '+from.slice(0,70));return source.replace(from,to);};
export function deliveryRoutes(source) {
  const start=source.indexOf('function BoardRoomPhone('),end=source.indexOf('function StoreHero(',start);
  if(start<0||end<start)throw Error('Phone delivery route boundary changed');
  let phone=source.slice(start,end);
  phone=once(phone,'  const close = useCallback(() => setPop(null), []);',`  const close = useCallback(() => setPop(null), []);
  const deliveryOpener=useRef(null),deliveryPending=useRef(null),deliveryFocus=useRef(false),deliveryAlive=useRef(true);
  useEffect(()=>{deliveryAlive.current=true;return()=>{deliveryAlive.current=false;deliveryPending.current=null;};},[]);
  useEffect(()=>{
    if(pop){if(deliveryFocus.current){deliveryFocus.current=false;document.querySelector('[data-delivered-route]')?.focus();}return;}
    const route=deliveryPending.current;if(!route)return;deliveryPending.current=null;
    window.dispatchEvent(new CustomEvent('scheduler-open',{detail:route}));
  },[pop]);
  const deliveryContext=next=>{deliveryFocus.current=true;setPop(next);};
  const openDelivered=()=>{
    const saved=pop;
    deliveryPending.current={opener:deliveryOpener.current,store:previewCalendarStore.id,returnLabel:saved.k==='month'?'Month summary':saved.k==='units'?'Units':'Pace',resumeDetails:()=>{if(!deliveryAlive.current)return false;deliveryContext(saved);return true;}};
    setPop(null);
  };`);
  for(const [key,cls,label] of [['units','bp-l1','Units'],['pace','bp-l2','Pace']]) {
    phone=once(phone,`className="${cls}" onClick={() => setPop({ k: "${key}" })}`,`className="${cls}" aria-label={${key==='units'?'"Units, "+fmtNum(totalUnits)+" delivered this month"':'"Pace, "+paceWord'}} onClick={e=>{deliveryOpener.current=e.currentTarget;setPop({k:"${key}"});}}`);
  }
  phone=once(phone,'{hd("Sold by day",','{hd(pop.k === "units" ? "Units" : "Pace",');
  const gridStart=phone.indexOf('        <p className="fr-empty" data-daily-unavailable="phone-calendar">'),gridEnd=phone.indexOf('        <div className="bp-ask">',gridStart);
  if(gridStart<0||gridEnd<gridStart)throw Error('Phone daily grid boundary changed');
  phone=phone.slice(0,gridStart)+phone.slice(gridEnd);
  const stock=phone.indexOf('    if (pop.k === "stock")');
  const actions=phone.lastIndexOf('        {canSetGoal && (',stock);
  if(actions<0)throw Error('Phone monthly context boundary changed');
  phone=phone.slice(0,actions)+`        <div className="fr-acts"><button type="button" className="fr-b pri" data-delivered-route onClick={openDelivered}>View dated Delivered in Schedule</button><button type="button" className="fr-b" onClick={()=>deliveryContext({k:"month",from:pop.k})}>Month summary</button></div>
`+phone.slice(actions);
  phone=once(phone,'<button type="button" className="fr-b pri" onClick={() => setPop({ k: "pace" })}>Sold by day</button>','<button type="button" className="fr-b pri" data-delivered-route onClick={openDelivered}>View dated Delivered in Schedule</button>{pop.from && <button type="button" className="fr-b" onClick={()=>deliveryContext({k:pop.from})}>Back to {pop.from === "units" ? "Units" : "Pace"}</button>}');
  phone=once(phone,'          <div data-daily-unavailable="phone-best-day">{DAILY_TOTALS_UNAVAILABLE}</div>\n','');
  const bestStart=phone.indexOf('          {mcal.best && <div>'),bestEnd=phone.indexOf('\n',bestStart);
  if(bestStart<0||bestEnd<bestStart)throw Error('Phone best-day presentation boundary changed');
  phone=phone.slice(0,bestStart)+phone.slice(bestEnd+1);
  phone=once(phone,'const popTitle = pop ? pop.k : "";','const popTitle = pop ? ({units:"Units",pace:"Pace",month:"Month summary"}[pop.k] || pop.k) : "";');
  return source.slice(0,start)+phone+source.slice(end);
}
