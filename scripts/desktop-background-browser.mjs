// Runs only in the fictional diagnostic browser. Nothing imports this in src.
export function installBackgroundScope({ variant }, env = window) {
  if (!['root', 'backdrop'].includes(variant)) throw new Error('unknown background variant');
  if (env.location.hostname !== '127.0.0.1') return;
  if (env.__desktopBackgroundScope) throw new Error('background override already installed');
  // Browser init scripts precede the HTML root. Install as soon as it exists,
  // before deferred app code runs, rather than polling or skipping the hook.
  if (!env.document.documentElement) {
    const observer = new env.MutationObserver(() => {
      if (!env.document.documentElement) return;
      observer.disconnect();
      installBackgroundScope({ variant }, env);
    });
    observer.observe(env.document, { childList: true });
    return;
  }
  const doc = env.document, rootStyle = doc.documentElement.style;
  const prototype = env.CSSStyleDeclaration.prototype, original = prototype.setProperty;
  const state = { variant, calls: 0, rootWrites: 0, backdropWrites: 0, fallbackWrites: 0,
    shellRestores: 0, lastValue: null };
  let current = null;
  const snapshot = () => ({ ...state });
  // The app can replace its shell between screens. The root retains its last
  // value, so the candidate must carry that exact value to a replacement too.
  // Both variants observe the same child-list changes for comparable overhead.
  const shells = new env.MutationObserver(() => {
    if (current?.isConnected) return;
    const targets = doc.querySelectorAll('.bg-live');
    if (targets.length !== 1) return;
    current = targets[0];
    if (variant === 'backdrop' && state.lastValue != null) {
      original.call(current.style, '--bgy', state.lastValue, state.lastPriority);
      state.shellRestores++;
    }
  });
  shells.observe(doc.documentElement, { childList: true, subtree: true });
  prototype.setProperty = function(name, value, priority) {
    if (this !== rootStyle || name !== '--bgy') return Reflect.apply(original, this, arguments);
    if (typeof value !== 'string' || !/^-?\d+(\.\d+)?px$/.test(value)) throw new Error('unexpected parallax value');
    state.calls++; state.lastValue = value; state.lastPriority = priority;
    if (variant === 'backdrop') {
      const targets = doc.querySelectorAll('.bg-live');
      if (targets.length === 1) {
        current = targets[0];
        state.backdropWrites++;
        return original.call(targets[0].style, name, value, priority);
      }
      // Preserve the original behavior on an unexpected shell, but reject that
      // fallback as evidence for a successfully scoped experiment.
      state.fallbackWrites++;
    }
    state.rootWrites++;
    return Reflect.apply(original, this, arguments);
  };
  env.__desktopBackgroundScope = { snapshot, inspect() {
    const targets = doc.querySelectorAll('.bg-live');
    if (targets.length !== 1) throw new Error('expected exactly one live backdrop');
    const style = env.getComputedStyle(targets[0]), value = style.getPropertyValue('--bgy').trim();
    const matrix = new env.DOMMatrixReadOnly(style.transform);
    return { ...snapshot(), effectiveValue: value, translateY: matrix.m42,
      identityExceptY: matrix.m11 === 1 && matrix.m22 === 1 && matrix.m33 === 1 && matrix.m44 === 1 &&
        [matrix.m12, matrix.m13, matrix.m14, matrix.m21, matrix.m23, matrix.m24,
          matrix.m31, matrix.m32, matrix.m34, matrix.m41, matrix.m43].every(n => n === 0) };
  } };
}

export function validateBackgroundSample(before, after) {
  const fail = message => { throw new Error(message); };
  if (!before || !after || before.variant !== after.variant) fail('background snapshot variant changed');
  const delta = Object.fromEntries(['calls', 'rootWrites', 'backdropWrites', 'fallbackWrites', 'shellRestores'].map(name => {
    if (!Number.isInteger(before[name]) || !Number.isInteger(after[name]) || before[name] < 0 || after[name] < before[name]) fail('invalid background counters');
    return [name, after[name] - before[name]];
  }));
  if (delta.calls !== delta.rootWrites + delta.backdropWrites) fail('background writes lost');
  if (after.variant === 'root') {
    if (delta.backdropWrites || delta.fallbackWrites || delta.shellRestores) fail('control was scoped unexpectedly');
  } else if (after.variant === 'backdrop') {
    if (delta.rootWrites || delta.fallbackWrites) fail('backdrop experiment used root fallback');
  } else fail('unknown background variant');
  if (after.lastValue != null && (after.effectiveValue !== after.lastValue || !after.identityExceptY ||
    !Number.isFinite(after.translateY) || Math.abs(after.translateY - parseFloat(after.lastValue)) > 0.01)) fail('background transform did not preserve the requested value');
  return delta;
}
