# C92: closing the day's floor and phone-line rows

Written 28 September 2026. The server half is built and checked. Nothing on the
live project changes until the last step below.

## The gap

`floor_public` and `queue_public` hold each store's day: the line, the roster
snapshot, FlyBy notes, the history, and the day's sign-in `token` behind the QR
code on the wall. Their six policies, read from the live project on 28 September,
are all `to public` with `true`: select, insert and update, any store, any day.
The public key that satisfies them is in every copy of the page. So anybody on
the internet can read or rewrite any store's floor, and read the code that the
QR on the wall seems to protect.

## Who reads and writes them today

Read from `main` on 28 September:

| Who | Where | Reads | Writes |
|---|---|---|---|
| Signed-in staff | the desk (`Manager.jsx`: FloorBoard, QueueTab, AssistWatcher, MissedStandards, FloorBacklog, TicketsPanel), the salesperson's own screens | yes | yes |
| A phone with no account | `FloorSignIn`, `QueueSignIn` (from the QR: `?f=`/`?q=`/`?o=` with `&t=<token>`) | yes | yes, the whole row |
| A phone at a table tag | `FloorSignIn` via `?f=&tbl=` (no token; valid only if this phone is already on today's line) | yes | yes |
| A TV showing the line | `QueueBoard` via `?qboard=<store>`, no sign-in; shows the QR, so it reads the token | yes | no |
| Anybody filing a ticket | `saveTicket` from `MyDay` and `HelpPanel`, signed in or not | no | insert |
| The server | `api/queue-action.mjs`, `api/queue-changed.mjs`, `api/open-room.mjs`, with the service key | yes | yes |

The monthly TV board (`?board=`) reads a separate published row in `app_data`
and is not part of this.

## After

**Staff read and write the tables directly, for their own stores.** The rule is
`can_use_store(store)`: an active admin; or the store on an approved profile; or
the account linked to a person on that store's floor (`floor_people`). The live
project has 29 profiles: 2 admins, 18 approved managers with stores, 1 approved
manager with none, and 8 pending, 3 of whom are linked to a floor. The link is
why "pending" does not simply mean "out": those 3 are floor staff today.
Nothing changes for staff, so their screens need no change at all.

**Everyone without an account goes through `/api/floor-row`**, which holds the
service key and applies the rules in `api/_floor-access.mjs`:

- **today's code** (`x-sage-day-token`): today's row at that store, read and
  write. Not another day's, not another store's, never to open a room, and never
  to change the code itself.
- **a TV's key** (`x-sage-wall-key`): today's row for one store, read only. The
  key is an HMAC of the store under `WALL_KEY_SECRET`, so one store's key opens
  nothing at another and nothing is stored to check it. Staff fetch it with
  `op: "wallkey"`.
- **tickets**: a phone with any of today's codes at that store may file one;
  once each.

Writes accept `expect`, the `updated_at` the writer read. A row that moved since
is refused with 409 instead of being overwritten, which is C89 seen from the
phone's side.

**Live updates**, for the screens that can no longer hear `postgres_changes`:
`01-doorbell.sql` rings a public Realtime broadcast topic, `row:<table>:<id>`,
on every write, with `{ stamp }` and nothing of the row. The page then reads
the row through the endpoint, as it already reads only when the stamp moves.

## C98, found on the way

`queue_public.store` and `qdate` are `NOT NULL` with no default, on the live
project too. The app's `saveTicket` sends only `id` and `data`. So every ticket
has been refused by the table: "Report a problem" and the notes a salesperson
writes when they miss their standard, which Jorge asked to come to him. There
are 0 tickets on the live project. The endpoint files tickets with both
columns. The app's own `saveTicket` needs the same two fields: that is the app
file, so it is its own item.

## The order, so nothing on the floor breaks

1. **This pull request:** the endpoint, its rules and tests, and the two SQL
   files in `supabase/pending/`, which nothing applies. Nothing live changes.
2. **`01-doorbell.sql` applied.** Additive: a trigger that rings a topic nobody
   listens to yet.
3. **The client switch, in the app file:** the no-account pages and the TV read
   and write through `/api/floor-row` and listen to the doorbell; the table tag
   uses the code the phone kept from its sign-in; `saveTicket` fills its columns
   (C98). Staff code is untouched. Needs `WALL_KEY_SECRET` in Vercel, and each
   TV opened once with its new link.
4. **`02-lock.sql` applied**, and the feel run and a phone check on the
   no-account QR sign-in. Undo is the six baseline policies, written at the
   foot of the file.

## Checked

- `test/floor-access.test.mjs`: the rules on their own, then the endpoint
  against rows in memory, 10 tests.
- `scripts/c92-lock-check.sh`: a throwaway Postgres 16 with stand-ins for
  `auth.uid()` and `realtime.send()`, the baseline's own tables and open
  policies lifted from the file, then both pending files, twice. 28 checks,
  including C98 as the table behaves today. Against a deliberately broken lock
  (`true` in place of `can_use_store`, the anon revoke removed) 12 of them fail.

## Still open

- **How a TV identifies itself** is Jorge's decision: a key in its link (built
  here, recommended), or signed in as a manager. The second leaves a manager's
  session on a screen in the showroom.
- **The table tag** relies on the phone keeping today's code from its QR sign-in.
  A phone that was added to the line by the desk, and never scanned, cannot use
  a tag until it does.
