import { createHash } from 'node:crypto';
export const PINNED_MANAGER_SHA256 = 'fd27fcc2561a15bf39f487c6999b3f8e4a6e30fabb4181d7558b0d411ac6dc16';
export function transformManager(source) {
  if (createHash('sha256').update(source).digest('hex') !== PINNED_MANAGER_SHA256) throw new Error('Manager source changed. Review the owner handoff before repinning.');
  const phoneStart = source.indexOf('function BoardRoomPhone(');
  const desktopStart = source.indexOf('function StoreHero(');
  const desktopEnd = source.indexOf('\nfunction ', desktopStart + 1);
  const operations = [];
  const replaceOne = (text, from, to, name) => {
    if (text.split(from).length !== 2) throw new Error(`Fixture transform must match once: ${name}`);
    operations.push(name); return text.replace(from, to);
  };
  const replaceRegion = (text, start, end, replacement, name) => {
    const a = text.indexOf(start), b = text.indexOf(end, a);
    if (a < 0 || b < 0 || text.indexOf(start, a + 1) !== -1) throw new Error(`Fixture region missing or ambiguous: ${name}`);
    operations.push(name); return text.slice(0, a) + replacement + text.slice(b);
  };
  let phone = source.slice(phoneStart, desktopStart);
  phone = replaceOne(phone, '  const [pop, setPop] = useState(null);',
    '  const [pop, setPop] = useState(null);\n  const reportDaily = useReportedMonth(store.id, data.__storeId, pop?.k === "pace" || pop?.k === "units", pop?.k === "units" ? ".bp-l1" : ".bp-l2");', 'phone request lifecycle');
  phone = replaceOne(phone,
    '{hd("Sold by day", <><span className="fr-st in">{new Date().toLocaleDateString("en-US", { month: "long" })}</span><span className="fr-w">day {mcal.dNow} of {mcal.dim}</span></>)}',
    '{hd("Reported deliveries", <span className="fr-w">Printed store count</span>)}', 'phone metric title');
  phone = replaceRegion(phone, '        <p className="fr-empty" data-daily-unavailable="phone-calendar">', '        <div className="bp-ask">',
    '        <ReportedCalendarPanel report={reportDaily} variant="phone" />\n', 'phone calendar display only');
  phone = replaceOne(phone, '  const popTitle = pop ? pop.k : "";',
    '  const popTitle = pop ? ["pace", "units"].includes(pop.k) ? "Reported deliveries" : pop.k : "";', 'phone dialog accessible name');
  let desktop = source.slice(desktopStart, desktopEnd);
  desktop = replaceOne(desktop,
    'function StoreHero({ config, store, data, session, onGoTab, filter, onFilter, onFocus, canSetGoal, onSaveConfig }) {',
    'function StoreHero({ config, store, data, session, onGoTab, filter, onFilter, onFocus, canSetGoal, onSaveConfig }) {\n  const reportDaily = useReportedMonth(store.id, data.__storeId);', 'desktop isolated report state');
  desktop = replaceRegion(desktop, '                    <div className="bw-title">Sold by day', '                  </BloopWin>',
    '                    <div className="bw-title">Reported deliveries</div>\n                    <ReportedCalendarPanel report={reportDaily} variant="desktop" date={dayPick} onSelect={setDayPick} />\n', 'desktop stock popup display only');
  const capStart = desktop.indexOf('            <div className="s2-mcal bloop-host"');
  const capEnd = desktop.indexOf('</SignalSchedule>', capStart);
  let schedule = desktop.slice(capStart, capEnd);
  schedule = replaceOne(schedule, '{new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" })}',
    '{formatReportMonth(reportDaily.month)}', 'schedule month label');
  schedule = replaceRegion(schedule, '              <div className="s2-mc-grid">', '              <div className="s2-mc-sub">',
    '              <ReportedMiniCalendar report={reportDaily} date={dayPick} onSelect={setDayPick} />\n', 'actual Signal schedule grid');
  const detailStart = schedule.indexOf('                <div className="s2-detail" data-daily-unavailable="desktop-day-detail">');
  const detailEnd = schedule.indexOf('</div>', detailStart) + '</div>'.length;
  if (detailStart < 0 || detailEnd < 6) throw new Error('Missing original desktop detail');
  operations.push('actual Signal schedule detail');
  schedule = schedule.slice(0, detailStart)
    + '                <div className="rd-calendar-label">Reported deliveries <span>Printed store count</span></div>\n                <ReportedDayDetail report={reportDaily} date={dayPick} />'
    + schedule.slice(detailEnd);
  desktop = desktop.slice(0, capStart) + schedule + desktop.slice(capEnd);
  const result = 'import { useReportedMonth, ReportedCalendarPanel, ReportedMiniCalendar, ReportedDayDetail, formatReportMonth } from "@calendar-fixture/calendar.jsx";\n'
    + source.slice(0, phoneStart) + phone + desktop + source.slice(desktopEnd);
  return { code: result, operations, boundaries: { phoneStart, desktopStart, desktopEnd } };
}
