// Undo the exact reviewed rail placement before the historical three-hunk inverse.
import {createHash} from 'node:crypto';
export const CURRENT_MANAGER_SHA='60f6fc43869b4f85b49b0bf2879054ab3afad428d57b4a5b48ed4afb8f0855d8';
const PRE_RAIL_MANAGER_SHA='1e6b3b83b269953e03f8138ab83068bfc6c436bcb56eed5c5a1ee3c64ec3be4f';
export const HISTORICAL_MANAGER_SHA='e1cd2c3b844bcd75d7d85f99445a023f4c7a82fb12de42d8cda8e1fc207c2f2b';
const sha=value=>createHash('sha256').update(value).digest('hex');
const railInverse=[
  [
    "          {SCHEDULER_CALENDAR && <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"panel\" /></React.Suspense>}\n          <div className=\"s2-chip-state\">\n<SignalSchedule",
    "          <div className=\"s2-chip-state\">\n<SignalSchedule"
  ],
  [
    "            )}\n          </div>\n        </div>\n        </div>\n        {/* ---- the card's own right-hand column ----\n",
    "            )}\n          </div>\n        </div>\n        {SCHEDULER_CALENDAR && <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"panel\" /></React.Suspense>}\n        </div>\n        {/* ---- the card's own right-hand column ----\n"
  ]
];
const inverse=[
  [
    "            );\n          })}\n        </div>\n        {SCHEDULER_CALENDAR && <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"compact\" /></React.Suspense>}\n      </div>\n\n      {canSetGoal && !goalMonth.set && (\n        <GoalAskCard store={store} month={ym()} onSave={(d) => saveGoal(d)} />\n      )}\n\n      <div className=\"bp-stand\">\n        <div className=\"bp-filt\">\n",
    "            );\n          })}\n        </div>\n      </div>\n\n      {canSetGoal && !goalMonth.set && (\n        <GoalAskCard store={store} month={ym()} onSave={(d) => saveGoal(d)} />\n      )}\n      {SCHEDULER_CALENDAR && <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"compact\" /></React.Suspense>}\n\n      <div className=\"bp-stand\">\n        <div className=\"bp-filt\">\n"
  ],
  [
    "            )}\n          </div>\n        </div>\n        {SCHEDULER_CALENDAR && <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"panel\" /></React.Suspense>}\n        </div>\n        {/* ---- the card's own right-hand column ----\n        The controls used to ride along the top of the head, which is the one\n",
    "            )}\n          </div>\n        </div>\n        </div>\n        {/* ---- the card's own right-hand column ----\n        The controls used to ride along the top of the head, which is the one\n"
  ],
  [
    "  const [hover, setHover] = React.useState(false);\n  const [pinned, setPinned] = React.useState(false);\n  const panelId = React.useId();\n  if (SCHEDULER_CALENDAR) return null;\n  const parts = React.Children.toArray(children).filter(React.isValidElement);\n  if (!signal) return children;\n  const roster = React.Children.toArray(parts[0].props.children)[1];\n",
    "  const [hover, setHover] = React.useState(false);\n  const [pinned, setPinned] = React.useState(false);\n  const panelId = React.useId();\n  if (SCHEDULER_CALENDAR) return <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} principalEpoch={schedulerPrincipalEpoch} canOpenStore={schedulerCanOpen} layout=\"panel\" /></React.Suspense>;\n  const parts = React.Children.toArray(children).filter(React.isValidElement);\n  if (!signal) return children;\n  const roster = React.Children.toArray(parts[0].props.children)[1];\n"
  ]
];
export function historicalManagerFixture(current){
 if(sha(current)!==CURRENT_MANAGER_SHA)throw Error('Historical Manager fixture input changed. Re-review entry points.');
 let source=current;
 for(const[from,to]of railInverse){if(source.split(from).length!==2)throw Error('Historical Manager rail anchor changed.');source=source.replace(from,to);}
 if(sha(source)!==PRE_RAIL_MANAGER_SHA)throw Error('Historical Manager pre-rail fixture changed.');
 for(const[from,to]of inverse){if(source.split(from).length!==2)throw Error('Historical Manager fixture anchor changed.');source=source.replace(from,to);}
 if(sha(source)!==HISTORICAL_MANAGER_SHA)throw Error('Historical Manager fixture output changed.');
 return source;
}
