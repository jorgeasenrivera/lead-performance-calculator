import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const migrations = new URL('../supabase/migrations/', import.meta.url);
// These SQL files were already applied. Correcting their recorded timestamps
// must not also turn an old migration into a new database change.
const corrected = [
  ['20260912160000', '20260912162646', 'app_errors', 'aa72528571b52cf3bc2aaa1dbbd3f6d3962b4a3120e1f8f522106cd54977a890'],
  ['20260912163000', '20260912163656', 'lock_functions_and_tidy_policies', '4f849631aceba0fa16dcc149324187a0347cf20b7f60e4cb5bbae5c38b74bdfd'],
  ['20260912164500', '20260912164025', 'no_truncate_for_api_roles', 'dfbda51bece515094a66e4e1bf59ccac26af032dd1a9229087e88e1bf7cebba9'],
  ['20260912203000', '20260912203722', 'app_vitals', 'e0b247d27f25fcec0e66839c48ef07a076c49f5f2e81df553e3392064526e3eb'],
  ['20260915170900', '20260915170915', 'drop_queue_identity', '2759b5642ccaeee790e01b0207ea0f8ea4e059a92355630539a1d7562a78c09a'],
];

for (const [oldVersion, version, name, digest] of corrected) {
  test(`migration history: ${name} keeps its applied SQL under ${version}`, () => {
    assert.equal(existsSync(new URL(`${oldVersion}_${name}.sql`, migrations)), false);
    const bytes = readFileSync(new URL(`${version}_${name}.sql`, migrations));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  });
}

test('migration history: SQL filenames have unique fourteen-digit versions', () => {
  const names = readdirSync(migrations).filter(name => name.endsWith('.sql'));
  for (const name of names) assert.match(name, /^\d{14}_[a-z0-9_]+\.sql$/);
  const versions = names.map(name => name.split('_')[0]);
  assert.equal(new Set(versions).size, versions.length);
});

test('migration history: reconciliation leaves the historical baseline untouched', () => {
  const bytes = readFileSync(new URL('00000000000000_baseline.sql', migrations));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '5e9d35fa1f56cf2dce2f33d38775e5c19474b3b5b15db9f07e962716826ccf26');
  assert.match(bytes.toString(), /Not for running against that project/);
});
