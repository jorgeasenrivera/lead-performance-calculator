const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'native/App.js'), 'utf8');
function extract(text) {
  const start = text.indexOf('  const pendingAct =');
  const end = text.indexOf('  /* ---- the lot question', start);
  const queue = text.indexOf('    const q = pendingAct.current;');
  const flush = text.lastIndexOf('  useEffect(() => {', queue);
  const flushEnd = text.indexOf('\n  /* ---- the Live Activity', flush);
  assert(start >= 0 && end > start && queue > end && flushEnd > flush, 'bridge source boundaries changed; review extraction');
  return text.slice(start, end) + text.slice(flush, flushEnd);
}

// Negative controls reconstruct only the two reviewed regressions. They are
// never shipped or substituted for the current source under test.
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, 'negative control source changed; review fixture');
  return text.replace(from, to);
}
const candidate = extract(source);
let original = replaceOnce(candidate, '  const readyRef = useRef(ready);\n  useLayoutEffect(() => { readyRef.current = ready; }, [ready]);\n', '');
original = replaceOnce(original, '!readyRef.current', '!ready');
original = replaceOnce(original, '  }, []);', '  }, [ready]);');
original = replaceOnce(original, '    return () => sub.remove();\n  }, [ready, relayAct]);', '    return () => sub.remove();\n  }, [relayAct]);');
let rejected = replaceOnce(candidate, '  useLayoutEffect(() => { readyRef.current = ready; }, [ready]);', '  readyRef.current = ready;');
rejected = replaceOnce(rejected, '    return () => sub.remove();\n  }, [ready, relayAct]);', '    return () => sub.remove();\n  }, [relayAct]);');
module.exports = { root, source, candidate, original, rejected };
