import React, { createContext, useContext, useState, useRef, useLayoutEffect } from 'react';
import { createMonthReader, visibleMonth } from './month-reader.mjs';

export const CalendarFixtureContext = createContext(null);
const ZONE = 'America/New_York', TODAY = '2026-09-22';
export const formatReportMonth = (month) => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'long', year: 'numeric' }).format(new Date(`${month}-15T16:00:00Z`));
export const formatReportDay = (date) => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T16:00:00Z`));
const formatTime = (timestamp) => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(timestamp));
const known = (day) => day?.status === 'provisional' && Number.isFinite(day.count);

export function useReportedMonth(storeId, loadedStoreId, active = true) {
  const fixture = useContext(CalendarFixtureContext);
  if (!fixture) throw new Error('Reported calendar may run only inside the isolated fixture context');
  const [state, setState] = useState({ phase: 'idle', days: [] });
  const [retry, setRetry] = useState(0);
  const reader = useRef(null);
  if (!reader.current) reader.current = createMonthReader({ fetch: fixture.fetch, onChange: setState, timeoutMs: 5000 });
  const revision = `${fixture.revision}:${retry}`;
  const identityOK = storeId === loadedStoreId;
  useLayoutEffect(() => {
    if (!active || !identityOK) { reader.current.cancel(); return; }
    reader.current.select({ storeId, month: fixture.month, revision });
    return () => reader.current.cancel({ silent: true });
  }, [storeId, loadedStoreId, fixture.month, revision, active, identityOK]);
  const visible = visibleMonth(state, { storeId, month: fixture.month, revision, active: active && identityOK });
  return { ...visible, phase: identityOK ? visible.phase : 'error', retry: () => setRetry((r) => r + 1) };
}

function calendarDays(month) {
  const [year, number] = month.split('-').map(Number);
  return { offset: new Date(Date.UTC(year, number - 1, 1)).getUTCDay(), length: new Date(Date.UTC(year, number, 0)).getUTCDate() };
}
function fallbackDate(month) { return month === TODAY.slice(0, 7) ? TODAY : `${month}-01`; }
function stateWords(report) {
  if (report.phase === 'loading') return 'Loading reports';
  if (report.phase === 'denied') return 'Reports unavailable for this account';
  if (report.phase === 'error') return 'Reports unavailable';
  return 'No report available';
}
export function ReportedDayDetail({ report, date }) {
  const selected = date?.startsWith(`${report.month}-`) ? date : fallbackDate(report.month);
  const day = report.phase === 'ready' ? report.days.find((item) => item.date === selected) : null;
  return <section className="rd-detail s2-detail" data-reported-detail={selected} data-report-phase={report.phase}>
    <div className="rd-date">{formatReportDay(selected)}</div>
    {known(day) ? <>
      <div className="rd-value"><strong data-report-count>{day.count}</strong><span>reported {day.count === 1 ? 'delivery' : 'deliveries'}</span><span className="rd-provisional">Provisional</span></div>
      <div className="rd-split">{day.vehicles.new === null ? 'New / used breakdown unavailable' : <><b>{day.vehicles.new}</b> new <span aria-hidden="true">·</span> <b>{day.vehicles.used}</b> used</>}</div>
      <div className="rd-asof">{day.asOf.basis === 'report_received' ? 'Report received' : 'Report sent'} {formatTime(day.asOf.timestamp)}</div>
    </> : <div className="rd-unavailable"><span aria-hidden="true">·</span>{stateWords(report)}</div>}
    {report.phase === 'error' && <button type="button" className="rd-retry" onClick={report.retry}>Try again</button>}
  </section>;
}

export function ReportedCalendarPanel({ report, variant = 'phone', date, onSelect }) {
  const [localDate, setLocalDate] = useState(null);
  const selected = date || localDate || fallbackDate(report.month);
  const choose = onSelect || setLocalDate;
  const { offset, length } = calendarDays(report.month);
  const days = new Map((report.phase === 'ready' ? report.days : []).map((day) => [day.date, day]));
  return <div className={`rd-calendar rd-${variant}`} data-reported-calendar={variant} data-report-store={report.storeId} data-report-month={report.month}>
    <div className="rd-caption"><span>{formatReportMonth(report.month)}</span><span>Printed store count</span></div>
    <div className="rd-week" aria-hidden="true">{['S','M','T','W','T','F','S'].map((label, i) => <span key={i}>{label}</span>)}</div>
    <div className={variant === 'phone' ? 'bp-swg rd-grid' : 's2-sw-grid rd-grid'} aria-label="Reported deliveries by day">
      {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} className="rd-empty" aria-hidden="true" />)}
      {Array.from({ length }, (_, i) => {
        const number = i + 1, key = `${report.month}-${String(number).padStart(2, '0')}`, day = days.get(key);
        const available = known(day), future = key > TODAY;
        return <button type="button" key={key} data-report-date={key} data-report-known={available ? 'true' : 'false'}
          className={`rd-day${selected === key ? ' rd-selected' : ''}${key === TODAY ? ' rd-today' : ''}${future ? ' rd-future' : ''}${available ? ' rd-known' : ''}`}
          aria-pressed={selected === key} aria-label={`${formatReportDay(key)}: ${available ? `${day.count} reported deliveries, provisional` : stateWords(report)}`}
          onClick={(event) => { event.stopPropagation(); choose(key); }}>
          <em>{number}</em><b>{available ? day.count : '·'}</b>
        </button>;
      })}
    </div>
    <div className="rd-legend">Reported counts are provisional <span aria-hidden="true">·</span> Dot means unavailable</div>
    <ReportedDayDetail report={report} date={selected}/>
  </div>;
}

export function ReportedMiniCalendar({ report, date, onSelect, onClickCapture }) {
  const { offset, length } = calendarDays(report.month);
  const values = new Map((report.phase === 'ready' ? report.days : []).map((day) => [day.date, day]));
  return <div className="s2-mc-grid rd-mini" onClickCapture={onClickCapture} aria-label="Select a reported-delivery day">
    {Array.from({ length: offset }, (_, i) => <i className="e" key={`blank-${i}`} aria-hidden="true"/>)}
    {Array.from({ length }, (_, i) => {
      const key = `${report.month}-${String(i + 1).padStart(2, '0')}`, day = values.get(key);
      return <button type="button" key={key} data-mini-date={key} className={key === TODAY ? 't' : key < TODAY ? 'p' : ''}
        aria-pressed={date === key} aria-label={`${formatReportDay(key)}: ${known(day) ? `${day.count} reported deliveries, provisional` : stateWords(report)}`}
        onFocus={() => onSelect(key)} onClick={(event) => { event.stopPropagation(); onSelect(key); }}><span>{i + 1}</span></button>;
    })}
  </div>;
}
