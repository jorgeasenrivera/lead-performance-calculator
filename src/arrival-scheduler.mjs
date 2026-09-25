/** One frame owner for either renderer. Waiting sleeps until a message arrives. */
export function createArrivalScheduler(engine, request, cancel, onError = () => {}) {
  let frame = null, stopped = false;
  const schedule = () => {
    if (!stopped && frame === null && !engine.sleeping()) frame = request(tick);
  };
  const fail = (error) => {
    stopped = true;
    if (frame !== null) cancel(frame);
    frame = null;
    onError(error);
  };
  const tick = (now) => {
    frame = null;
    if (stopped) return;
    try { engine.tick(now); schedule(); } catch (error) { fail(error); }
  };
  return {
    start: schedule,
    send(message) {
      if (stopped) return;
      try { engine.msg(message); schedule(); } catch (error) { fail(error); }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (frame !== null) cancel(frame);
      frame = null;
      engine.msg({ type: "stop" });
    },
  };
}
