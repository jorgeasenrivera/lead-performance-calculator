/* Sender-asserted Date header, not proof of a report's own period or source.
   A conservative RFC 5322 subset is accepted: a four-digit year and an
   explicit numeric offset. Unsupported legal variants are refused, not guessed. */
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const WEEKDAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const formatter = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
export function easternDayForInstant(at) {
  const parts = formatter.formatToParts(at);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function parseEmailSentDate(headers, now = Date.now()) {
  if (!Array.isArray(headers)) return {ok:false,reason:'missing Date header'};
  const dates = headers.filter(h => h && typeof h.key === 'string' && h.key.toLowerCase() === 'date');
  if (dates.length !== 1) return {ok:false,reason:dates.length ? 'duplicate Date headers' : 'missing Date header'};
  const value = dates[0].value;
  if (typeof value !== 'string' || value.length > 128) return {ok:false,reason:'invalid Date header'};
  const m = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),[ \t]+)?(\d{1,2})[ \t]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[ \t]+(\d{4})[ \t]+(\d{2}):(\d{2})(?::(\d{2}))?[ \t]+([+-])(\d{2})(\d{2})$/i.exec(value.trim());
  if (!m) return {ok:false,reason:'invalid or unsupported Date header'};
  const [,weekday,dd,mon,yyyy,hh,mm,ss='00',sign,zh,zm]=m;
  const year=Number(yyyy), month=MONTHS.indexOf(mon.toLowerCase()), day=Number(dd), hour=Number(hh), minute=Number(mm), second=Number(ss), zoneHours=Number(zh), zoneMinutes=Number(zm);
  if (year < 1900 || day < 1 || hour > 23 || minute > 59 || second > 59 || zoneHours > 23 || zoneMinutes > 59) return {ok:false,reason:'invalid Date header'};
  const local=Date.UTC(year,month,day,hour,minute,second), check=new Date(local);
  if (check.getUTCFullYear()!==year || check.getUTCMonth()!==month || check.getUTCDate()!==day || (weekday && WEEKDAYS[check.getUTCDay()]!==weekday.toLowerCase())) return {ok:false,reason:'invalid Date header'};
  const offset=(zoneHours*60+zoneMinutes)*(sign==='+'?1:-1);
  const instant=local-offset*60000;
  if (!Number.isFinite(now) || instant > now) return {ok:false,reason:'Date header is in the future'};
  const at=new Date(instant);
  return {ok:true,day:easternDayForInstant(at),sentAt:at.toISOString(),source:'sender-date-header'};
}

/* A date-shaped filename or subject is a conflict check, never a substitute. */
export function activityDateConflict(sentDay, ...labels) {
  const dates = [];
  for (const label of labels) {
    const value=String(label || '');
    const re=/(?:^|[^\d])(?:(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})|(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2}))(?=$|[^\d])/g;
    for (const m of value.matchAll(re)) {
      const y=m[1] || m[6], mo=m[2] || m[4], d=m[3] || m[5];
      const text=`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
      const parsed=new Date(text+'T00:00:00Z');
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==text) return true;
      dates.push(text);
    }
  }
  return dates.some(day => day !== sentDay);
}
