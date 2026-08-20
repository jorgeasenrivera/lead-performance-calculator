# Checks

`npm test` runs them. They need no dependencies and no network, and they finish
in well under a second, so there is no reason not to run them.

They run on every push and every pull request as well
(`.github/workflows/checks.yml`), because checks that only live on a laptop are
checks that do not run.

## Why these, and not others

Almost every case in here is a fault that reached production first and was found
by somebody noticing a wrong number on a screen days later. They are kept as
checks so that the second time is free:

| file | what it holds the line on |
|---|---|
| `parsers.test.mjs` | Reading the scheduled reports. The Visit column, the `?` DriveCentric prints where a figure does not apply, a store still on the older export, and a person actually named Visitacion. |
| `ingest-routing.test.mjs` | One email carrying two dealerships. Classic Mazda spent a fortnight showing Drivers Mart Winter Park's salespeople. |
| `store-keys.test.mjs` | The keys the rows live under and which fields travel. A field list that drifts writes a row of the right shape with one column missing and says nothing. |
| `floor-presence.test.mjs` | Honest lunch, honest test drive, and gaming the line — which look identical from outside the building. |
| `geofence.test.mjs` | A phone that is not sure where it is, which is most phones most of the time. |
| `link-person.test.mjs` | Who may say that an account belongs to a person on the floor, and which id a device is filed under. |
| `no-duplicates.test.mjs` | The structural one. See below. |

## The structural one

`no-duplicates.test.mjs` does not test behaviour. It lists the names defined at
the top level of the server files and of the app and fails on any name defined
in both.

Three separate production faults in one week came from exactly that: a piece of
logic existing twice, with the copies quietly disagreeing. The parser knew the
word "Visit" in one copy and not the other. `FLOOR_STAT_FIELDS` kept the visit
count on one side and stripped it on the other. `BOARD_STAT_FIELDS` published the
lead counts from one side and not the other.

A second copy is not always a bug. It is always a bet that two things will never
need to agree, and that bet keeps losing. So: share it, or add the name to
`KNOWN` in that file with the reason it is safe.

## Writing a new one

Test the shared modules in `api/`, not the app file. Anything worth checking is
worth moving into a module both sides import — that is the same move that fixes
the drift, so it pays twice.

Import what you are testing. Do not read a source file off disk and pull a
function out of it by line number: the first version of the routing check did
exactly that, with an absolute path, and it passed here and failed the moment it
ran anywhere else. A check that only works on the machine it was written on
teaches people that a red build is normal, which is worse than having no check
at all. There is a test that now fails on any absolute path in this directory.
