# Scheduler persistence contracts (offline)

Row C113. Code: `scripts/scheduler-performance/persistence/`. Nothing here is wired
into the scheduler model or any screen, and nothing here stores, sends or
decides anything. It is pure functions over supplied input, tests, and one
in-memory test double.

## What this is, and what it is not

This is the shape that a saved month would have to take, written down as code
and tests before any storage exists, so that the later, riskier work (a table,
a policy, an endpoint) has something exact to be checked against.

Not part of this, and not decided by it:

- A database, a table, a column, a migration, or reuse of `app_data`.
- Row level security, `has_store`, `can_use_store`, or any other policy.
- Which role may save a draft and which may publish. The code records an actor
  id and nothing about roles. Whether `manager`, `overseer` or `admin` may
  publish is for Jorge to decide.
- An endpoint, a worker, a request, or a signature made on a server.
- Where the audit trail lives, how long versions are kept, or who may read them.
- Whether dated store rules live in `schedule_rules` from the drafted sales
  history migration (#464), which overlaps the rules a draft carries.
- Any change to `month-model.mjs`, `team-model.mjs` or any screen.

A plan produced here is data. It says what would be written and what must still
be true when it is written. Applying it atomically, and checking that the
person applying it is allowed to, are future server guarantees. Every plan
says so itself: `authorization: "not-checked"`.

## Audit baseline and caveats (preserved)

These come from the read-only audit of `66381521f220ff4f001e48f2bf570839da929d9f`
and still hold. Nothing in this change tested or changed them.

- On that commit the scheduler preview kept every draft in a `Map` inside
  `createPlanner` (`month-model.mjs:37-39`). It made no network call, its pages
  carry `connect-src 'none'`, and its database build values are blank. A refresh
  loses everything.
- The live Supabase policies, grants and function bodies were NOT read. The
  repository reference snapshot (`supabase/reference/2026-09-12-baseline.sql`)
  is from 12 September and policies have drifted before.
- That snapshot's `has_store()` checks `active` and the store list, not
  `pending`, and does not tell `manager` from `overseer`. Its `app_data` write
  policies use it, and `lpc:audit:%` is readable and writable by any signed-in
  account. `appendAudit` reads and rewrites one shared row with no revision
  check and keeps 400 entries. That is why the audit trail here is a separate,
  append-only, chained log and not a reuse of the app's.
- The Codex scheduler branches (#481 to #484) and #464 beyond its one SQL file
  were not audited line by line.

## Correction to the earlier audit: membership overlap

The audit listed "overlapping memberships accepted" among the validation gaps
and proposed rejecting them. **That was too broad, and it was wrong as stated.**

Overlap is how the model works. `seedTeams` gives every person one entry that
runs from 2014-01-01 to 2100-12-31 (`team-model.mjs:6`). A CSV import that
confirms a team change adds a single-day entry on top of it
(`schedule-import.mjs:80-81`), and `membershipAt` returns the last matching
entry (`team-model.mjs:10`). A rule that rejected overlap would have refused
every real planner state, including the unedited fixtures.

What is true, and what this change does with it:

- The hazard is not the overlap. It is that **list order is the precedence.**
  Sort, de-duplicate or re-order the list, or store it in an unordered table,
  and a different team wins.
- So the contract preserves membership order exactly. Canonical text sorts
  object keys and never array elements. Two lists with the same entries in a
  different order are different versions with different checksums.
- Overlap is accepted and reported as the warning
  `membership-order-significant`, so a future reader knows the order matters.
  It is never an error.
- Checked against the real model: a planner built from the six synthetic
  fixtures, before and after `setAssignment`, validates with no problems; after
  `setMembership` adds a single-day entry it validates with that one warning.
  (A scratch script, not committed: committed tests import nothing outside the
  persistence folder.)

The other audit findings about validation stand, and the validator refuses each
of them: a day that does not exist or is outside the draft's month, an unknown
person, a person both on and off, a blank or backwards rule, a rule date that
is not a date. The model itself is unchanged and still accepts them in memory.

## Identity

| Thing | Rule |
|---|---|
| Store | The store `id`, lowercase `[a-z0-9][a-z0-9_-]{0,63}`, never a position in a list. Lowercase to agree with the store check in the drafted #464 migration. |
| Month | `YYYY-MM`, 2014-01 to 2100-12, the same range as `validMonth` in the model. |
| Version | A whole number from 1, assigned by whoever stores it, never by a clock and never by the client. |
| Kind | `draft` (mutable head, every save is a new numbered version) or `published` (written once, never changed). |
| Key | `<store>/<month>/<kind>/<rev>`. A store id cannot contain `/`, so the key is unambiguous and parses back exactly. |

The model keys its drafts by array index (`month-model.mjs:41`). The adapter
must translate through `keyForIndex(stores, index, month)`, which resolves the
index to the store id and refuses a list with a duplicate or invalid id. Reorder
the list and every key stays where it was.

## The draft shape that is stored

```
{ storeId, month,
  store: { people, rules, teams, memberships, timezone? },
  overrides: { "<YYYY-MM-DD>": <day record> } }
```

This is the shape `validateDraft` checks and the shape a future
`planner.exportDraft(index, month)` is asked to return. It is a request to the
demand and generator stream, which owns `month-model.mjs`; it is not made here.
Review state (`accepted`, `reviewFingerprint`) is page-local and is dropped on
the way in. Any other unrecognised field is an error, not dropped.

The validator checks **structure and references only**. Conflicts such as a
shift outside availability, weekly hours over the cap, overlapping shifts, too
few people, or a DST-change date stay with the model, which already reports
them to the manager. Unknown availability may be stored as `null`, which the
model also reads as unknown.

One consequence worth knowing: a real state that refers to a person who is no
longer in the store (the model tolerates this and shows "Unknown person") cannot
be serialised. It fails loudly at the boundary instead of being stored.

## Envelope and canonical text

Format `sage.scheduler.version`, version 1. Fields: `format`, `version`,
`kind`, `storeId`, `month`, `rev`, `meta`, `payload`, `hash`.

- Canonical text means sorted keys, no whitespace, one spelling per number
  (`-0` is `0`), and array order kept. Stored text is therefore unique. A reader
  refuses text that is valid JSON but not canonical, which also catches a
  repeated key that `JSON.parse` would quietly collapse.
- **One strict snapshot.** Everything that is checked, sealed, hashed or handed
  back first goes through `plainSnapshot`, which copies the value into fresh
  ordinary objects and arrays and reads each property exactly once. What is
  validated is therefore exactly what is stored and exactly what is returned:
  no later `JSON.stringify` runs a `toJSON` hook, no getter can answer
  differently the second time, and nothing the caller holds is shared with the
  result. Refused: any prototype other than `Object.prototype`, `null` or
  `Array.prototype` (so class instances and `Array` subclasses), getters,
  hidden (non-enumerable) properties, symbol keys, functions, `undefined`,
  `NaN`, `Infinity`, `BigInt`, `Date`, `Map`, arrays with holes or with any
  property that is not an element (so an array `toJSON` is refused), and the key
  names `__proto__`, `constructor` and `prototype`. A `Proxy` is read through its
  own traps once per property like any other object; the guarantee is
  "validated equals emitted", not that a hostile `Proxy` can be recognised.
- **Two nesting limits, on purpose.** A whole *draft* may nest 8 levels below its
  own root (the root is level 0, so a ninth level is refused). Anything else the
  canonical writer or a snapshot is given by default may nest 12 levels, which
  also stops a cycle. A draft inside an envelope sits one level deeper, so the
  8 limit is checked on the draft itself by `validateSnapshot` and the 12 limit
  covers the wrapper around it. Small objects (meta, audit detail, membership
  source) use the 8 limit from their own root.
- **Size limit: 1,000,000 characters of canonical text per version, for every
  form of input.** Text is size-checked before it is parsed; an already-parsed
  object is checked on its canonical form. The canonical writer keeps a running
  count and stops early on an enormous value, and a snapshot stops at 250,000
  values, so an oversized object is refused without being written out in full.
  Exactly the limit is accepted and one more is refused, for text and for objects.
- `meta` is strict per kind. A published version records the draft revision it
  came from, the revision it supersedes (0 if none), a digest of the reviewed
  state, and the neighbouring draft revisions it was reviewed against. A draft
  may record `resetFrom`, `restoredFrom` or `publishedRev`. **Neighbour
  revisions mean the calendar neighbours of the month.** For each neighbour that
  exists the value is a whole number (0 when that month had no saved draft);
  `null` is valid only where the calendar has no such month, that is the month
  before `2014-01` and the month after `2100-12`. A `null` beside a month that
  exists is refused both when sealing and when reading.
- **The hash wrapper is exactly `{ alg, value }`.** `alg` is a short lowercase
  name; `value` is lowercase hexadecimal of 16 to 128 characters. An extra field
  is refused, because the reader would otherwise accept it with nothing covering
  it.
- **The sealer contract.** A sealer is `{ alg, digest(text) }`: synchronous,
  deterministic, used both to create and to verify, returning lowercase hex of
  16 to 128 characters (anything else is refused as `bad-sealer`). It supports no
  asynchronous signing, no key rotation and no verification-only (public key)
  object, and audit entries do not record which sealer made them. Supplying a
  callback does **not** by itself make anything tamper-proof.
- **The checksum is not a defence against tampering.** It is 64-bit FNV-1a over
  UTF-8, written by hand so no crypto or `node:` module is needed. It catches
  accidental damage and a payload moved under another identity. Anyone who can
  write the stored text can recompute it. A keyed signature made on the server
  is future work and is not decided here.
- **UTF-8 edge case.** An unpaired UTF-16 surrogate is encoded as U+FFFD, as a
  standard UTF-8 encoder does, so every unpaired surrogate hashes alike (for
  example `"\ud800"` and `"\udfff"` collide). Canonical JSON escapes such code
  units, so envelope bodies are unaffected; the opaque review fingerprint is
  hashed directly, is compared as the original text, and only its digest is
  recorded.

## Compare-and-swap

A write names the revision it was based on (`baseRev`, 0 when it read nothing).

| Stored now | `baseRev` | Result |
|---|---|---|
| nothing | 0 | `first-write`, next revision 1 |
| nothing | more than 0 | refused `missing-base` |
| revision N | 0 | refused `exists` (read it first) |
| revision N | N | `update`, next revision N + 1 |
| revision N | less than N | refused `stale`, answer carries N |
| revision N | more than N | refused `ahead` |
| revision 9007199254740991 (the last safe whole number) | that revision | refused `revision-exhausted`; the next revision would not be safe |

A refusal never carries a next revision and changes nothing. The first write is
a conflict if anything exists, mirroring how `saveStoreCAS` inserts rather than
upserts.

### Neighbours

A publication also carries the neighbouring months' draft revisions as reviewed
and as they are now, because weekly hour caps cross month edges. They are judged
against the **calendar**, not against each other:

- For every neighbour the calendar has, both snapshots must hold a whole number
  (`0` meaning no saved draft). `null`, a missing key, a negative, a fraction or
  text is refused as `bad-adjacent`, naming the side and which snapshot.
- `null` is valid only where there is no such month: the month before `2014-01`
  and the month after `2100-12`.
- Only then are the two snapshots compared; a difference is `adjacent-moved`
  naming `prev`, `next` or both.
- The plan carries one `expect-head` for **every** neighbour that exists,
  including one at revision 0, so a draft that appears next door after planning
  stops the write. This closes the earlier gap in which `null` on both sides
  compared equal and produced no expectation at all.

The planner cannot see the store: the neighbour revisions are supplied by the
caller. What stops a wrong or stale claim is the `expect-head` operation at apply
time, not the planner.

## Plans and operations

Three operations are the whole vocabulary between a plan and whatever applies
it:

- `expect-head`: a store and month whose draft or published revision must still
  be what the plan assumed. Used for neighbouring months.
- `put-version`: write revision `expectedRev + 1` of a kind, only if the head of
  that kind is `expectedRev`, and only if that version does not already exist.
  Versions are never replaced.
- `append-audit`: add an entry whose `prevHash` is the hash of the last entry.

| Plan | Writes |
|---|---|
| `planDraftSave` | one draft version, one audit entry |
| `planPublication` | one published version, the draft moved on one revision, one audit entry, and an `expect-head` per neighbouring month |
| `planReset` | the next draft version from a fresh draft the caller supplies, one audit entry |
| `planRestore` | the next draft version copied from a verified earlier version, one audit entry |

Publication moves the draft on one revision so an editor still holding the old
one gets `stale` instead of silently saving over something already published.

### Publication refusals, in this order

1. `invalid`: bad identity, actor, time or draft.
2. `bad-head`, `nothing-to-publish`.
3. `stale-draft` (or `ahead`, or `revision-exhausted` for the draft), then
   `revision-exhausted` for the published counter.
4. `not-reviewed`: no review, or the open-issue count is missing.
5. `open-issues`.
6. `fingerprint-mismatch`: the month, worked out again now, is not the month
   that was reviewed. The fingerprint is opaque text supplied by the caller (the
   page's review fingerprint); only its digest is stored.
7. `missing-adjacent`, then `bad-adjacent` (malformed against the calendar),
   then `adjacent-moved`.

The first thing wrong is the thing reported.

## Audit entries

`buildAuditEntry` takes the actor as a parameter, `{ id }` and nothing else, and
the time as UTC text. It never reads either from a draft or envelope, refuses an
unrecognised input field, and refuses an `actor` smuggled into `detail`. Actions:
`draft-save`, `publish`, `reset`, `restore`. Each entry is frozen and carries the
hash of the one before it. Its input is copied once through the same strict
snapshot as everything else.

### What a chain can and cannot show

`verifyChain` checks **the segment it is handed**: each entry is well formed and
matches its own hash, each follows the one before it, and all belong to one store
and month. It shows an entry that was edited, replaced, or taken out of the
interior of the segment.

It does **not** show that the segment is the whole log:

- A **prefix** of a valid chain is itself valid: remove the last entry, the last
  several, or all of them and `verifyChain` still returns `ok`. An empty list
  verifies.
- The **start** can be anchored (`{ after: <hash> }` makes a missing first entry
  show). The **end** cannot be anchored by anything inside the entries.
- Detecting a missing tail needs a trusted copy of the latest hash or the count,
  held where the log's writer cannot reach. Where that lives, and who holds it,
  is not decided here and nothing here stores it.
- A chain is not a signature. Anyone who can write the whole log can write a
  new, equally valid one. It is evidence of careless change, not of authenticity
  or of completeness, and it is not tamper-proof.
- Entries do not record the sealer, so a chain is only checkable with the sealer
  it was written with.

## Trust boundaries

These functions are pure. They cannot authenticate or prove anything they are
handed, so each of the following is a **caller-supplied fact** that the adapter
must obtain from an authoritative source and must not take from the browser:

| Supplied by the caller | What this module does with it | What it cannot do |
|---|---|---|
| the actor (`{ id }`) | records it in the audit entry | check who the person is or what they may do |
| the time (UTC text) | records it | know whether it is true |
| the head (`draftRev`, `publishedRev`) | plans against it | know it is current; the apply-time expectations do that |
| the neighbour revisions | validates their shape against the calendar and plans an expectation for each | know they are the stored truth |
| the review (fingerprint, open issues) and the recomputed fingerprint | compares them | prove the draft supplied is the one that was saved and reviewed |
| the sealer | uses its `digest` to create and to verify | make anything tamper-proof |

`authorization: "not-checked"` on every plan is the same statement. No role
(`manager`, `overseer`, `admin`) is inferred from anything here.

## Recovery

Every write creates the next numbered version and leaves the old ones as they
were. Reset therefore hides a draft instead of deleting it, restore copies an
earlier version forward as the newest draft, and a published version is only
ever superseded by a later one. `assertNoOverwrite(plan, existingIds)` names any
plan that would land on a stored version. Retention (how long old versions are
kept) is not decided.

**A future store must keep a revision high-water mark.** The in-memory double
keeps heads that never go backwards. If a real store ever treated a lost or
deleted draft head as revision 0 while older draft versions still existed, the
next write would claim revision 1 again; the immutable-version check would
refuse the overwrite but would not repair the missing history. The recovery test
that plans from a head showing no draft only *plans*; a second test shows the
double refusing to apply such a plan. Restoration authorization, how a source
version is retrieved, and completeness of the audit trail remain open.

## The test double

`fake-port.mjs` is TEST ONLY and nothing else imports it (a test checks). It
applies a plan to an in-memory copy and keeps the result only if every operation
held, so a plan whose third step fails changes nothing. It checks the plan's own
expectations and nothing about who is applying it. It is not a design for the
real store.

## Verification

```
node --test scripts/scheduler-performance/persistence/*.test.mjs
```

Root `node --test` (the `npm test` command) also finds the nested files on
Node 22.22.0 (CI uses Node 22; its exact minor was not checked), so no
configuration change is needed. The unit tests import nothing outside the
persistence folder, and one test scans the module sources to keep them free of
any clock, storage, network, file, environment, `node:` or model import.

Test totals are not the evidence that matters. The review round added: a failing
run of the new tests against the unfixed source (kept), a reproduction of each
reported defect before and after, a seeded randomized check of the invariants
(a successful serialization always reads back and rewrites to the same bytes; a
successful read always satisfies `validateDraft`; single-character tampering of
valid text is always refused; every neighbour that exists is protected and a
wrong claim cannot be applied), and 55 deliberate one-line breaks of the rules,
each of which the tests catch. These are spot checks chosen by the author, not
exhaustive mutation testing, and a mutation that only changes speed cannot be
observed (the early stop in the canonical writer's character budget).

## Open questions for integration

1. Who may save, who may publish, and does `overseer` write at all?
2. Is `schedule_rules` (#464) the home of dated store rules, or does a month's
   draft carry its own copy as it does here?
3. What is the trusted source of the actor id, and what is a real signature?
4. Retention of drafts and published versions, and who may read them.
5. Other time zones, and DST-change dates (the model flags them; this does not).
6. The `exportDraft` and `importDraft` request to the model's owner, and what the
   adapter should do with a state that names a person who has left the store.
7. Where a trusted latest audit hash or count would live, if truncation of the
   log must be detectable. Nothing here stores it.
8. Whether a real signature, with algorithm and key identifiers recorded in each
   version and entry, replaces the replaceable checksum.
9. Whether the review fingerprint should be restricted to well-formed text (the
   opaque fingerprint is hashed with unpaired surrogates replaced).
