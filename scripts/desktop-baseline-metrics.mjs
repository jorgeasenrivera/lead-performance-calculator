// rAF measures main-thread scheduling, not GPU presentation or literal FPS.
export function summarizeSample(sample) {
  const frames = sample.frames.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const percentile = p => frames.length ? frames[Math.max(0, Math.ceil(frames.length * p) - 1)] : null;
  const overlap = e => Math.max(0, Math.min(e.startTime + e.duration, sample.end) - Math.max(e.startTime, sample.start));
  return {
    label: sample.label, status: sample.status, usable: !sample.hidden && sample.status === 'complete'
      && Number.isFinite(sample.contentMs) && Number.isFinite(sample.settledMs)
      && frames.length >= 2 && sample.droppedEntries === 0,
    contentMs: sample.contentMs, settledMs: sample.settledMs,
    durationMs: sample.end - sample.start, frameCount: frames.length,
    frameMedianMs: percentile(.5), frameP95Ms: percentile(.95), frameMaxMs: percentile(1),
    gapsOver34Ms: frames.filter(n => n > 34).length,
    longTaskSupported: sample.longTaskSupported,
    longTasks: sample.longTaskSupported ? sample.tasks.filter(e => overlap(e) > 0).length : null,
    longTaskOverlapMs: sample.longTaskSupported ? sample.tasks.reduce((n, e) => n + overlap(e), 0) : null,
    longFrameSupported: sample.longFrameSupported,
    longFrames: sample.longFrameSupported ? sample.longFrames.filter(e => overlap(e) > 0) : null,
    hidden: sample.hidden, droppedEntries: sample.droppedEntries, viewport: sample.viewport,
  };
}

// Everything inside this function is serializable into a local-only HTML page.
// It never touches React state, tokens, storage, the network or visual styles.
export function installDesktopProbe(env = window) {
  const doc = env.document;
  const result = doc.createElement('pre'); result.hidden = true;
  result.id = 'desktop-baseline-results'; result.textContent = '[]'; doc.body.appendChild(result);
  const samples = [], supported = env.PerformanceObserver?.supportedEntryTypes || [];
  let active = null, raf = 0, timer = 0, disarm = () => {};
  const cap = (list, entry) => { if (list.length < 2000) list.push(entry); else active.droppedEntries++; };
  const observers = [];
  for (const type of ['longtask', 'long-animation-frame']) {
    if (!supported.includes(type)) continue;
    const observer = new env.PerformanceObserver(list => {
      if (!active) return;
      for (const entry of list.getEntries()) record(type, entry);
    });
    observer.observe({ type });
    observers.push([type, observer]);
  }
  function record(type, e) {
    const entry = { startTime: e.startTime, duration: e.duration };
    if (type === 'long-animation-frame') {
      entry.blockingDuration = e.blockingDuration;
      entry.scripts = Array.from(e.scripts || []).map(s => ({
        duration: s.duration, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration,
        // Keep a bundle filename only. No URL, function arguments or data.
        source: (s.sourceURL || '').split('/').pop().split('?')[0],
      }));
      cap(active.longFrames, entry);
    } else cap(active.tasks, entry);
  }
  function finish(status) {
    if (!active) return;
    env.cancelAnimationFrame(raf); env.clearTimeout(timer);
    for (const [type, observer] of observers) for (const entry of observer.takeRecords()) record(type, entry);
    active.end = env.performance.now(); active.status = status;
    samples.push(active); active = null; result.textContent = JSON.stringify(samples);
  }
  function visible(selector) {
    if (!selector) return true;
    const el = doc.querySelector(selector);
    return !!el && el.getClientRects().length > 0 && env.getComputedStyle(el).visibility !== 'hidden';
  }
  function tick(t) {
    if (!active) return;
    if (active.lastFrame != null) cap(active.frames, t - active.lastFrame);
    active.lastFrame = t;
    let ready = active.settledMs != null;
    if (!ready) {
      ready = active.absent ? !doc.querySelector(active.selector) : visible(active.selector);
      if (ready && active.contentMs == null) active.contentMs = env.performance.now() - active.start;
      const rootBusy = doc.documentElement.matches('.tab-move,.tool-move,.jump-under,.refresh-hold');
      const card = doc.querySelector('.acard');
      const cardBusy = card && ['opening', 'closing'].includes(card.dataset.signalCardMotion);
      if (ready && !rootBusy && !cardBusy) {
        active.readyFrames++;
        if (active.readyFrames === 2) active.settledMs = env.performance.now() - active.start;
      } else active.readyFrames = 0;
    }
    // Once the lifecycle marker settles, only record rAF timestamps. Repeated
    // box reads can make the probe itself pay the page's pending layout cost.
    if (env.performance.now() - active.start >= active.windowMs && ready && active.settledMs != null) { finish('complete'); return; }
    raf = env.requestAnimationFrame(tick);
  }
  function start(label, selector = null, { absent = false, windowMs = 2200 } = {}) {
    if (active) finish('interrupted');
    active = { label, selector, absent, windowMs, start: env.performance.now(), end: null,
      contentMs: null, settledMs: null, readyFrames: 0, lastFrame: null,
      frames: [], tasks: [], longFrames: [], droppedEntries: 0,
      longTaskSupported: supported.includes('longtask'), longFrameSupported: supported.includes('long-animation-frame'),
      hidden: doc.hidden, viewport: [env.innerWidth, env.innerHeight], status: 'recording' };
    // A background tab can stop rAF forever. Keep the failure bounded and mark
    // it unusable rather than reporting artificially smooth or missing samples.
    timer = env.setTimeout(() => finish('watchdog'), windowMs + 8000);
    raf = env.requestAnimationFrame(tick);
  }
  function arm(label, selector, options = {}, type = 'click', target = 'button') {
    disarm();
    const triggered = event => {
      const el = event.target.closest?.(target);
      if (!el || (type === 'pointerover' && el.contains(event.relatedTarget))) return;
      disarm(); start(label, selector, options);
    };
    disarm = () => doc.removeEventListener(type, triggered, true);
    doc.addEventListener(type, triggered, true);
  }
  const visibility = () => { if (active && doc.hidden) active.hidden = true; };
  doc.addEventListener('visibilitychange', visibility);
  const navigation = event => {
    const button = event.target.closest?.('button');
    if (event.target.closest('.assoc-row') && !event.target.closest('.bloop-host,.s2-rowfoot')) {
      start('associate-open', '.acard'); return;
    }
    if (!button) return;
    const name = button.textContent.trim();
    const routes = { Performance: '.board-page', Dashboard: '.board-page', 'Daily Activity': '.da-page',
      'Live Floor': '.mf-floor .fbc', 'Phone Line': '.mf-line .sd-room', Summary: '.sm-page' };
    if (routes[name]) start(name, routes[name]);
    else if (button.matches('.ac-x')) start('associate-close', '.acard', { absent: true });
  };
  // Only local probe serving enables automatic click capture. Playwright starts
  // samples explicitly so named runs cannot be accidentally overwritten.
  env.__desktopProbe = { samples, start, arm, finish, enableClicks() { doc.addEventListener('click', navigation, true); },
    dispose() { disarm(); finish('disposed'); observers.forEach(([, o]) => o.disconnect());
      doc.removeEventListener('click', navigation, true); doc.removeEventListener('visibilitychange', visibility); } };
}
