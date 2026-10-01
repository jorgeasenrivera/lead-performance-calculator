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

The first three rows are gone since C99 (28 September): Jorge retired the QR
sign-in, so a phone with no account has no way onto the floor at all, and an
old code, poster or table tag opens the sign-in screen. That leaves the TV as
the only screen with nobody signed in.

The monthly TV board (`?board=`) reads a separate published row in `app_data`
and is not part of this.

## After

**Staff read and write the tables directly, for their own stores.** The rule is
`can_use_store(store)`: an active admin; or the store on an approved profile; or
the account linked to a person on that store's floor (`floor_people`). The live
project has 29 profiles: 2 admins, 18 approved managers with stores, 1 approved
manager with none, and 8 pending, 3 of whom are linked to a floor. The link is
why "pending" does not simply mean "out": those 3 are floor staff today.
Nothing changes for staff, so their screens need no change at all. Tickets are
staff's too: the same rule covers them.

**The TV goes through `/api/floor-row`**, which holds the service key and
applies the rules in `api/_floor-access.mjs`:

- **a TV's key** (`x-sage-wall-key`): today's row for one store, read only. The
  key is an HMAC of the store under `WALL_KEY_SECRET`, so one store's key opens
  nothing at another and nothing is stored to check it. Jorge chose a key in
  each TV's link over a manager signed in on the TV (28 September).
- **staff** (`Authorization: Bearer`): read their own stores' rows, and ask for
  a TV's key with `op: "wallkey"`, which is how the manager's "TV link" gets it.

There is no write through the endpoint. Before C99 it also took the QR's daily
code and wrote rows and tickets for it; that went with the codes.

**Live updates**, for the TV, which can no longer hear `postgres_changes`:
The doorbell (`supabase/migrations/20260928180229_row_doorbell.sql`) rings a public Realtime broadcast topic, `row:<table>:<id>`,
on every write, with `{ stamp }` and nothing of the row. The TV then reads the
row through the endpoint, as it already reads only when the stamp moves.

## C98, found on the way

`queue_public.store` and `qdate` are `NOT NULL` with no default, on the live
project too. The app's `saveTicket` sent only `id` and `data`. So every ticket
has been refused by the table: "Report a problem" and the notes a salesperson
writes when they miss their standard, which Jorge asked to come to him. There
are 0 tickets on the live project. `saveTicket` now fills both columns.

## The order, so nothing on the floor breaks

1. **The server half** (#434, merged): the endpoint, its rules and tests, and
   the two SQL files in `supabase/pending/`, which nothing applies.
2. **The client switch** (#435, `claude/c92-client`): the QR sign-in retired
   (C99), the TV reads with its key and listens to the doorbell, `saveTicket`
   fills its columns (C98). Needs `WALL_KEY_SECRET` in Vercel (Production, at
   least 32 characters) before the TV link can carry a key. A visual change, so
   it merges after Jorge has had it on a phone.
3. **The doorbell applied** (28 September, done). Additive: a trigger that rings a topic only
   the TV listens to.
4. **Each TV opened once with its new link**, from the manager's "TV link".
   A TV on its old link still reads the table directly, until step 5.
5. **The lock applied** (28 September, `migrations/20260928200830_floor_lock.sql`), then the feel run and a phone check. Undo is
   `02-lock-undo.sql`, which puts back exactly what was live before (the six
   open policies and the public key's four grants). Jorge, 28 September: lock
   now, unlock if a TV that has not been re-linked matters on a given day, lock
   again when they all are. The lock check proves lock, undo and lock again.

## Checked

- `test/floor-access.test.mjs`: the rules on their own, then the endpoint
  against rows in memory.
- `test/row-access.test.mjs`: the TV's side, and the wiring in the app.
- `test/old-links.test.mjs`: an old code, poster or tag link is recognised and
  dropped; the TV's link and every other link are left alone.
- `scripts/c92-lock-check.sh`: a throwaway Postgres 16 with stand-ins for
  `auth.uid()` and `realtime.send()`, the baseline's own tables and open
  policies lifted from the file, then both pending files, twice. It includes
  C98 as the table behaves today, and a write that lands with Realtime down.
  Against a deliberately broken lock (`true` in place of `can_use_store`, the
  anon revoke removed) 12 of the checks fail.

## Still open

- **Table tags** (C100): the tag setup is kept in the manager, but a tag now
  opens the sign-in like any old code. Jorge chose to rebuild them later, for
  salespeople with accounts (C99, A3 b).
