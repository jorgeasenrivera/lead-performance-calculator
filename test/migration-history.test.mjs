import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const reference = new URL('../supabase/reference/2026-09-12-baseline.sql', import.meta.url);
const baselineDigest = '5e9d35fa1f56cf2dce2f33d38775e5c19474b3b5b15db9f07e962716826ccf26';
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

test('migration history: the reference snapshot preserves every historical byte', () => {
  const bytes = readFileSync(reference);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), baselineDigest);
  assert.match(bytes.toString(), /Not for running against that project/);
});

// Keep the later historical files immutable too; future changes get new files.
const later = [
  ['20260923203721_prune_daily.sql', '06630d8c9f46501d6f2e7eb4e3a9d82e1203c0d80fee317cc9bf67ed30d4ccc7'],
  ['20260924163631_sftp_arrivals.sql', '0c7d34074444351ad5c581daf3d395d402e32808064a650c82643531a658d75b'],
  ['20260928180229_row_doorbell.sql', '5865f55245613089ad03e623cf78faa85125a39bc0def22cf53d2d499817aeae'],
  ['20260928200830_floor_lock.sql', '37511a36215b0b0e8b87ed11a10e1eb91769dfd43e98ad12060bc265d7ecb810'],
  ['20260930210123_prune_store_backups.sql', '2fe922c5aaabe05b1959aa6ffb298b6b8cc984102772d589208177e376b62a10'],
];
for (const [name, digest] of later) {
  test(`migration history: ${name} remains byte-identical`, () => {
    assert.equal(createHash('sha256').update(readFileSync(new URL(name, migrations))).digest('hex'), digest);
  });
}

// Detect the snapshot even under another filename or wrapped in extra SQL.
// This comparison ignores comment-only lines and formatting, not SQL content.
const sqlBody = text => text.replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim();
function assertNoBaselineCopy(name, text) {
  assert.doesNotMatch(name, /baseline|^00000000000000_/i);
  assert.equal(sqlBody(text).includes(sqlBody(readFileSync(reference, 'utf8'))), false,
    `${name} contains the historical baseline`);
}

test('migration history: executable migrations contain no historical baseline copy', () => {
  assert.equal(existsSync(new URL('00000000000000_baseline.sql', migrations)), false);
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql'))) {
    assertNoBaselineCopy(name, readFileSync(new URL(name, migrations), 'utf8'));
  }
});

test('migration history: the exclusion guard rejects renamed and embedded snapshots', () => {
  const snapshot = readFileSync(reference, 'utf8');
  assert.throws(() => assertNoBaselineCopy('20990101000000_copy.sql', snapshot), /historical baseline/);
  assert.throws(() => assertNoBaselineCopy('20990101000000_other.sql',
    `select 1;\n${sqlBody(snapshot)}\nselect 2;`), /historical baseline/);
});

test('migration history: the lock harness reads the reference snapshot', () => {
  const script = readFileSync(new URL('../scripts/c92-lock-check.sh', import.meta.url), 'utf8');
  assert.ok(script.includes('$HERE/supabase/reference/2026-09-12-baseline.sql'));
  assert.ok(!script.includes('supabase/migrations/00000000000000_baseline.sql'));
});
