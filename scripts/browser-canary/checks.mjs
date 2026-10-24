import assert from 'node:assert/strict';
export function checkArguments(args) {
  assert.ok(Array.isArray(args) && args.length > 0, 'missing browser command line');
  for (const arg of args) assert.ok(!/^--(no-sandbox|disable-setuid-sandbox|disable-namespace-sandbox|disable-seccomp-filter-sandbox|disable-gpu-sandbox|single-process)(=|$)/.test(arg), `sandbox-disabling flag: ${arg}`);
}
export function checkSandbox(rows) {
  const fields = Object.fromEntries(rows.map(r => [r[0]?.trim(), r[1]?.trim()]));
  assert.equal(fields['Namespace sandbox'], 'Yes', 'namespace sandbox not confirmed');
  assert.equal(fields['PID namespaces'], 'Yes', 'PID namespace sandbox not confirmed');
  assert.equal(fields['Network namespaces'], 'Yes', 'network namespace sandbox not confirmed');
  assert.equal(fields['Seccomp-BPF sandbox'], 'Yes', 'Chromium seccomp sandbox not confirmed');
  return fields;
}
