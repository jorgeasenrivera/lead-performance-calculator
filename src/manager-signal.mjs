// Only a mounted manager shell owns this material and navigation treatment.
// The sign-in and salesperson surfaces keep their own styles and motion.
let owners = 0;
let stopObserving = null;

export function recapDue(key, seen, storage) {
  if (seen.has(key)) return false;
  try { return !storage?.getItem(key); } catch { return true; }
}

export function recapPresented(key, seen, storage) {
  seen.add(key);
  try { storage?.setItem(key, '1'); } catch { /* The session still remembers. */ }
}

export function ownManagerSignalSurface(env = window) {
  const root = env.document.documentElement;
  if (++owners === 1) {
    root.classList.add('manager-signal');
    const observePhase = () => {
      // A class write can notify this observer even when the token is already
      // present. Do not turn a real tab phase into a microtask loop.
      if (root.matches('.tool-move,.tab-move') && !root.classList.contains('manager-signal-switch')) {
        root.classList.add('manager-signal-switch');
      }
    };
    const observer = new env.MutationObserver(observePhase);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    observePhase();
    stopObserving = () => observer.disconnect();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners !== 0) return;
    stopObserving?.();
    stopObserving = null;
    root.classList.remove('manager-signal', 'manager-signal-switch');
  };
}
