import { createHash } from "node:crypto";

const sha = source => createHash("sha256").update(source).digest("hex");
// Strip the exact reviewed Dashboard adjustment from the frozen synthetic preview only.
// In particular, restore the two prior entry anchors before the historical inverse.
export const DASHBOARD_MANAGER_SHA = "f9bb7863883289c35c09b575c2cfb198a10977f944c54b87da2878876e18009e";
export const PRIOR_DASHBOARD_MANAGER_SHA = "17de0d26c06578a97b5daae50f05d07f16f6c14cdbfa278a02bdb549f59fae0e";
const inverses = [
  // The count and the list on one planner roster (#542, ddde157): put the
  // floor roster reads back first, so the entries below meet the source they were written for.
  [
    "  }, [digests]);\n  const series = useMemo(() => (digests ? dailySeries(digests, thr) : null), [digests, thr]); // eslint-disable-line\n  // Today in the store's zone. It moves on at midnight there, and again when a\n  // sleeping tab wakes, so the control never keeps yesterday's day or counts.\n",
    "  }, [digests]);\n  const series = useMemo(() => (digests ? dailySeries(digests, thr) : null), [digests, thr]); // eslint-disable-line\n  const floorRoster = activityRoster(config, data);\n  // Today in the store's zone. It moves on at midnight there, and again when a\n  // sleeping tab wakes, so the control never keeps yesterday's day or counts.\n"
  ],
  [
    "  const scheduleLabel = todaysScheduleLabel(staffing?.counts?.on, staffing?.counts?.off);\n  // The list behind it is explicit days off, and only those the planner\n  // confirms are called on. Not being listed off is not being on. It is the\n  // planner's roster, the same one the count reads, so the two always agree.\n  const offToday = staffing?.offPeople || [];\n  const onToday = staffing?.onPeople || [];\n  const mcal = useMemo(() => {\n    const mk = ym();\n",
    "  const scheduleLabel = todaysScheduleLabel(staffing?.counts?.on, staffing?.counts?.off);\n  // The list behind it is explicit days off, and only those the planner\n  // confirms are called on. Not being listed off is not being on.\n  const offToday = floorRoster.filter((a) => (data.daysOff?.[a.id] || []).includes(schedDay));\n  const onToday = floorRoster.filter((a) => staffing?.on.has(a.id));\n  const mcal = useMemo(() => {\n    const mk = ym();\n"
  ],
  [
    "    return o;\n  }, [digests]);\n  // Today in the store's zone, moving on at midnight and when a sleeping tab\n  // wakes. Days off are the explicit ones; on is only what the planner confirms.\n  // The names come from the planner's roster, the one the count reads, so the\n  // label and the list it opens cannot disagree.\n  const schedDay = useZonedToday(store?.timezone || STORE_TZ);\n  const staffing = useMemo(() => staffingFor(store, data, schedDay), [store, data, schedDay]);\n  const offToday = staffing?.offPeople || [];\n  const onToday = staffing?.onPeople || [];\n  const mcal = useMemo(() => {\n    const mk = ym();\n",
    "    return o;\n  }, [digests]);\n  /* The same people the check-out sheet counts, read the same way, so the two\n     screens can never put a different number of bodies on the floor. */\n  const floorRoster = activityRoster(config, data);\n  // Today in the store's zone, moving on at midnight and when a sleeping tab\n  // wakes. Days off are the explicit ones; on is only what the planner confirms.\n  const schedDay = useZonedToday(store?.timezone || STORE_TZ);\n  const staffing = useMemo(() => staffingFor(store, data, schedDay), [store, data, schedDay]);\n  const offToday = floorRoster.filter((a) => (data.daysOff?.[a.id] || []).includes(schedDay));\n  const onToday = floorRoster.filter((a) => staffing?.on.has(a.id));\n  const mcal = useMemo(() => {\n    const mk = ym();\n"
  ],
  [
    "import { staffingFor } from \"./today-staffing.mjs\";\nimport { useZonedToday } from \"./zoned-today.mjs\";\n",
    ""
  ],
  [
    "  manglings, mergeManglings, folds, unfold, transferIn, needsReview } from \"../api/_people-status.mjs\";\n",
    "  manglings, mergeManglings, folds, unfold, transferIn } from \"../api/_people-status.mjs\";\n"
  ],
  [
    "function Board({ config, store, data, onMove, onSetRestriction, readOnly, filter, onFilter, onClearFilter, query = \"\", focusName, onFocus, onIgnore, onOpenPeople }) {\n",
    "function Board({ config, store, data, onMove, onSetRestriction, readOnly, filter, onFilter, onClearFilter, query = \"\", focusName, onFocus, onIgnore }) {\n"
  ],
  [
    "  // A manager gets the People link instead of a \"Needs a position\" card. The\n  // overseer's board is read only and has no People to go to, so it keeps the\n  // list, and its search keeps finding those names, with no controls on it.\n  // Unassigned people have no standards to be judged by, so a bucket filter\n  // hides them.\n  const showUnassigned = !onOpenPeople;\n  const unassigned = !showUnassigned || filter ? [] : (data.roster || []).filter((a) => !a.roleId && matches(a)).sort((a, b) => a.order - b.order);\n",
    "  // unassigned people have no standards to be judged by, so a bucket filter hides them\n  const unassigned = filter ? [] : (data.roster || []).filter((a) => !a.roleId && matches(a)).sort((a, b) => a.order - b.order);\n"
  ],
  [
    "  const reviewCount = useMemo(() => needsReview(data), [data]);\n  const reviewLink = !readOnly && onOpenPeople && !query && reviewCount > 0 ? (\n    <button type=\"button\" className=\"s2-rowbtn s2-pickbtn s2-reviewlink\" onClick={onOpenPeople}>\n      <PixIcon glyph=\"warn\" size={11} /> {reviewCount} {reviewCount === 1 ? \"name needs\" : \"names need\"} review · Open People\n    </button>\n  ) : null;\n",
    ""
  ],
  [
    "  // An empty roster can still have names held back or in the books unclaimed,\n  // and People is the only place they get decided, so the link stays.\n",
    ""
  ],
  [
    "    return <>\n      <div className=\"empty\">No associates yet. Drop today's three reports in the Import tab and the roster builds itself.</div>\n      {reviewLink}\n    </>;\n",
    "    return <div className=\"empty\">No associates yet. Drop today's three reports in the Import tab and the roster builds itself.</div>;\n"
  ],
  [
    "            <span className=\"s2-hflex\" />\n            {[\"cleared\", \"attention\", \"off\"].map((b) => {\n",
    "            <span className=\"s2-hflex\" />\n            {role.id === sections[0]?.role.id && <SignalIgnoreEntry readOnly={readOnly} allowed={!!onIgnore} picking={picking} selected={sel.size} onStart={() => setPicking(true)} onApply={() => { onIgnore([...sel]); stopPicking(); }} onStop={stopPicking} />}\n            {[\"cleared\", \"attention\", \"off\"].map((b) => {\n"
  ],
  [
    "              <span className=\"assoc-name\">{a.name}</span>\n            </div>\n",
    "              <span className=\"assoc-name\">{a.name}</span>\n              {!readOnly && (\n                <select className=\"assign-select\" value=\"\"\n                  onChange={(e) => { if (e.target.value) onMove(a.name, null, e.target.value); }}>\n                  <option value=\"\">Assign a position…</option>\n                  {config.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}\n                </select>\n              )}\n            </div>\n"
  ],
  [
    "      {/* One way into People, not two half-ways. The Dashboard used to carry an\n          ignore picker and a \"Needs a position\" card, which asked a manager to\n          make People decisions in the wrong room and counted a name twice when\n          it was on both lists. Now it only counts, each name once, and the\n          decisions, a position or an ignore, stay apart inside People. */}\n      {reviewLink}\n",
    ""
  ],
  [
    "  // Today in the store's zone. It moves on at midnight there, and again when a\n  // sleeping tab wakes, so the control never keeps yesterday's day or counts.\n  const schedDay = useZonedToday(store?.timezone || STORE_TZ);\n  // The schedule control's counts come from what the planner confirms, not from\n  // who is merely not listed off. Unknown leaves the label without numbers.\n  const staffing = useMemo(() => staffingFor(store, data, schedDay), [store, data, schedDay]);\n  const scheduleLabel = todaysScheduleLabel(staffing?.counts?.on, staffing?.counts?.off);\n  // The list behind it is explicit days off, and only those the planner\n  // confirms are called on. Not being listed off is not being on.\n  const offToday = floorRoster.filter((a) => (data.daysOff?.[a.id] || []).includes(schedDay));\n  const onToday = floorRoster.filter((a) => staffing?.on.has(a.id));\n",
    "  const offToday = floorRoster.filter((a) => (data.daysOff?.[a.id] || []).includes(today()));\n  const onToday = floorRoster.filter((a) => !offToday.includes(a));\n"
  ],
  [
    "    for (const [k, v] of Object.entries(dayUnits)) if (k.slice(0, 7) === mk && v.u != null && (!best || v.u > best.u)) best = { d: k, u: v.u };\n    return { mk, dim, off, dNow, satsLeft, best };\n  }, [dayUnits, schedDay]); // schedDay: the month grid moves on at midnight too\n  const lastImport = (data.importLog || [])[0] || null;\n  const updatedAt = (() => {\n",
    "    for (const [k, v] of Object.entries(dayUnits)) if (k.slice(0, 7) === mk && v.u != null && (!best || v.u > best.u)) best = { d: k, u: v.u };\n    return { mk, dim, off, dNow, satsLeft, best };\n  }, [dayUnits]);\n  const lastImport = (data.importLog || [])[0] || null;\n  const updatedAt = (() => {\n"
  ],
  [
    "        {hd(\"Today\", <>{onToday.length > 0 && <span className=\"fr-st in\">{onToday.length} on</span>}<span className=\"fr-st away\">{offToday.length} off</span></>)}\n        <div className=\"fr-list\">{onToday.map((a) => row(a, true))}{offToday.map((a) => row(a, false))}{!onToday.length && !offToday.length && <p className=\"fr-empty\">No days off set for today.</p>}</div>\n",
    "        {hd(\"Today\", <><span className=\"fr-st in\">{onToday.length} on</span><span className=\"fr-st away\">{offToday.length} off</span></>)}\n        <div className=\"fr-list\">{onToday.map((a) => row(a, true))}{offToday.map((a) => row(a, false))}</div>\n"
  ],
  [
    "            <span className=\"bp-nul\"><span><b>{fmtNum(split.nw)}</b> new</span><span><b>{fmtNum(split.us)}</b> used</span></span>\n          </button>\n        </div>\n        <div className=\"bp-secdiv\" />\n",
    "            <span className=\"bp-nul\"><span><b>{fmtNum(split.nw)}</b> new</span><span><b>{fmtNum(split.us)}</b> used</span></span>\n          </button>\n          <button type=\"button\" className=\"bp-r3\" onClick={() => setPop({ k: \"onoff\" })}>\n            <span className=\"bp-onoff\">{onToday.length} on{offToday.length ? <> · <em>{offToday.length} off</em></> : null}</span>\n          </button>\n        </div>\n        <div className=\"bp-secdiv\" />\n"
  ],
  [
    "        {/* One schedule control on the phone. With the calendar on it opens the\n            planner on today; with it off, the Signal fallback opens today's list. */}\n        {SCHEDULER_CALENDAR\n          ? <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"today\" label={scheduleLabel} /></React.Suspense>\n          : <div className=\"sg-schedule bp-sched\"><button type=\"button\" className=\"sg-schedule-trigger\" aria-haspopup=\"dialog\" onClick={() => setPop({ k: \"onoff\" })}><span className=\"sg-schedule-count\"><PixIcon glyph=\"calendar\" size={10} /> {scheduleLabel}</span></button></div>}\n",
    "        {SCHEDULER_CALENDAR && <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"compact\" /></React.Suspense>}\n"
  ],
  [
    "  // Today in the store's zone, moving on at midnight and when a sleeping tab\n  // wakes. Days off are the explicit ones; on is only what the planner confirms.\n  const schedDay = useZonedToday(store?.timezone || STORE_TZ);\n  const staffing = useMemo(() => staffingFor(store, data, schedDay), [store, data, schedDay]);\n  const offToday = floorRoster.filter((a) => (data.daysOff?.[a.id] || []).includes(schedDay));\n  const onToday = floorRoster.filter((a) => staffing?.on.has(a.id));\n",
    "  const offToday = floorRoster.filter((a) => (data.daysOff?.[a.id] || []).includes(today()));\n  const onCount = floorRoster.length - offToday.length;\n"
  ],
  [
    "      if (k.slice(0, 7) === mk && v.u != null && (!best || v.u > best.u)) best = { d: k, u: v.u };\n    return { mk, dim, off, dNow, satsLeft, best };\n  }, [dayUnits, schedDay]); // schedDay: the month grid moves on at midnight too\n  const lastImport = (data.importLog || [])[0] || null;\n  const videoDials = [\"apptVideoDayPct\", \"bhVideoPct\", \"engagedVideoPct\"]\n",
    "      if (k.slice(0, 7) === mk && v.u != null && (!best || v.u > best.u)) best = { d: k, u: v.u };\n    return { mk, dim, off, dNow, satsLeft, best };\n  }, [dayUnits]);\n  const lastImport = (data.importLog || [])[0] || null;\n  const videoDials = [\"apptVideoDayPct\", \"bhVideoPct\", \"engagedVideoPct\"]\n"
  ],
  [
    "          {SCHEDULER_CALENDAR && <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"today\" label={todaysScheduleLabel(staffing?.counts?.on, staffing?.counts?.off)} /></React.Suspense>}\n",
    "          {SCHEDULER_CALENDAR && <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"panel\" /></React.Suspense>}\n"
  ],
  [
    "<SignalSchedule onCount={staffing?.counts?.on ?? null} offCount={staffing?.counts?.off ?? null} store={store} data={data} schedulerPrincipalEpoch={schedulerPrincipalEpoch} schedulerCanOpen={schedulerCanOpen}>\n",
    "<SignalSchedule onCount={onCount} offCount={offToday.length} store={store} data={data} schedulerPrincipalEpoch={schedulerPrincipalEpoch} schedulerCanOpen={schedulerCanOpen}>\n"
  ],
  [
    "              <b>{staffing?.counts\n                ? <>{staffing.counts.on}<SignalCopy full={\" working today\"} short={\" on today\"} />{offToday.length ? <i> · {offToday.length} off</i> : null}</>\n                : offToday.length ? `${offToday.length} off today` : \"Today’s schedule\"}</b>\n",
    "              <b>{onCount}<SignalCopy full={\" working today\"} short={\" on today\"} />{offToday.length ? <i> · {offToday.length} off</i> : null}</b>\n"
  ],
  [
    "                {onToday.length > 0 && (<>\n                  <div className=\"bw-title\">On today · {onToday.length}</div>\n                  <div className=\"s2-names\">\n                    {onToday.slice(0, 14).map((a) => (\n                      <s key={a.id}><i className=\"s2-pdot on\" />{a.name}</s>\n                    ))}\n                  </div>\n                </>)}\n                {!onToday.length && !offToday.length && <div className=\"bw-title\">No days off set for today</div>}\n",
    "                <div className=\"bw-title\">On today · {onCount}</div>\n                <div className=\"s2-names\">\n                  {floorRoster.filter((a) => !offToday.includes(a)).slice(0, 14).map((a) => (\n                    <s key={a.id}><i className=\"s2-pdot on\" />{a.name}</s>\n                  ))}\n                </div>\n"
  ],
  [
    "                  <div className=\"bw-title\" style={onToday.length ? { marginTop: 10 } : undefined}>Off today · {offToday.length}</div>\n",
    "                  <div className=\"bw-title\" style={{ marginTop: 10 }}>Off today · {offToday.length}</div>\n"
  ],
  [
    ".bp-hero > .bp-sched{ margin-top:16px; }\n",
    ""
  ],
  [
    "function SignalOriginalIgnore({children}) { return useSignal() ? null : children; }\nfunction SignalLeadMeter({value, cap, children}) {\n",
    "function SignalOriginalIgnore({children}) { return useSignal() ? null : children; }\nfunction SignalIgnoreEntry({readOnly, allowed, picking, selected, onStart, onApply, onStop}) {\n  const signal = useSignal();\n  if (!signal || readOnly || !allowed) return null;\n  return <div className=\"sg-ignore-tools\">{picking ? <>\n    <span>{selected} selected</span><button className=\"s2-rowbtn\" disabled={!selected} onClick={onApply}>Ignore selected</button>\n    <button className=\"s2-rowbtn\" onClick={onStop}>Done</button>\n  </> : <button className=\"s2-rowbtn\" onClick={onStart}><PixIcon glyph=\"user\" size={11} /> Select people to ignore</button>}</div>;\n}\nfunction SignalLeadMeter({value, cap, children}) {\n"
  ],
  [
    "/* \"Today’s schedule · 8 on, 3 off\", or just \"Today’s schedule\" when the counts\n   are not known, rather than a zero that reads as an empty floor. */\nfunction todaysScheduleLabel(on, off) {\n  return Number.isInteger(on) && Number.isInteger(off) ? `Today’s schedule · ${on} on, ${off} off` : \"Today’s schedule\";\n}\n",
    ""
  ],
  [
    "    {/* One control, not a month grid beside an on and off chip (Jorge, 18\n        November). The label is today; the panel it opens is today's people\n        first and the month under them, so the calendar is the same tap. */}\n",
    ""
  ],
  [
    "      <span className=\"sg-schedule-count\"><PixIcon glyph=\"calendar\" size={10} /> {todaysScheduleLabel(onCount, offCount)}</span>\n",
    "      {calendar[0]}<span className=\"sg-schedule-count\">{onCount} on today{offCount ? <small> · {offCount} off</small> : null}</span>\n"
  ],
  [
    "    {/* tabIndex -1 so a press on a day, which is not focusable, lands focus\n        on the panel instead of the page. Otherwise the blur below closes the\n        panel on mousedown and the day's click never arrives. */}\n    {open && <div id={panelId} className=\"sg-schedule-details\" tabIndex={-1}>{roster.props.children}<div className=\"sg-schedule-month\">\n      {calendar[0]}{React.cloneElement(calendar[1], {onClickCapture:()=>setPinned(true)})}{calendar[2]}{calendar[3].props.children}\n    </div></div>}\n",
    "    {React.cloneElement(calendar[1], {onClickCapture:()=>setPinned(true)})}{calendar[2]}\n    {open && <div id={panelId} className=\"sg-schedule-details\">{roster.props.children}<div className=\"sg-schedule-month\">{calendar[3].props.children}</div></div>}\n"
  ]
];

export function dashboardPreviewInput(source) {
  if (sha(source) !== DASHBOARD_MANAGER_SHA) return source;
  for (const [from, to] of inverses) {
    if (source.split(from).length !== 2) throw Error("Dashboard preview anchor changed.");
    source = source.replace(from, to);
  }
  if (sha(source) !== PRIOR_DASHBOARD_MANAGER_SHA) throw Error("Dashboard preview did not restore the approved Manager source.");
  return source;
}
