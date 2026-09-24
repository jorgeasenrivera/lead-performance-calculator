# Sage on the App Store: what to type, field by field

Everything here was decided by Jorge on 24 September (C93, proposal:
https://claude.ai/artifact/SyJCgF4wUMvKh2m5Cby3f5). Copy it into App Store
Connect as written. Change it only through Jorge, and change it here too, so
this file and the listing never disagree.

Distribution is **unlisted**: the app is reviewed like any other and reached
only by its link. That is a request to Apple, not a setting (see the end).

**Not yet:** submit only after C92 (the floor rows closed), the Privacy link
under sign-in, the Delete my account page, and one production build carrying
all of it. The privacy and support pages go live with #420.

---

## App information

| Field | Value |
|---|---|
| Name | Sage |
| Subtitle | Who's up, and how you're doing |
| Primary category | Business |
| Secondary category | Productivity |
| Content rights | Contains third-party content, and has the rights to use it: OpenStreetMap map tiles (ODbL, credited on the map) and Google Fonts (open licences) |
| Copyright | 2026 Jorge Rivera |
| Price | Free |
| Availability | United States only |

## Version 1.0

**Description**

```
Sage is a work app for car dealership sales staff. It needs an account set up by your dealership.

Floor rotation. Sign on when you arrive. Sage keeps the order of the up list and shows who is waiting, with a customer, or away. Your phone tells you when it is your turn, including on the lock screen.

Phone line. The same rotation for incoming calls, with which desks are free.

Your numbers. Your month's figures from your dealership's CRM reports: leads, appointments, shows and sales, and how far you are from your goal.

For managers. Each store's floor, each store's month against its goal, and a leaderboard for a showroom TV.
```

**Keywords** (98 of 100 characters)

```
dealership,car sales,sales floor,up system,rotation,salesperson,showroom,leaderboard,phone ups,bdc
```

| Field | Value |
|---|---|
| Support URL | https://www.sageonline.io/support |
| Privacy Policy URL | https://www.sageonline.io/privacy |
| Marketing URL | leave empty |

**Screenshots:** five, 6.9-inch (1320 x 2868), from the demo store, no
captions: Live Floor with a line, You're up, Phone Line with desks, your
corner, and the lock screen card (from a phone; the harness cannot draw it).
Made from the production build, once it exists.

## App Privacy

Tracking: **No**, for every type below.

| Data type | Linked to the person | Used for |
|---|---|---|
| Name | Yes | App Functionality |
| Email Address | Yes | App Functionality |
| Coarse Location | Yes | App Functionality |
| User ID | Yes | App Functionality |
| Device ID | Yes | App Functionality |
| Other User Content | Yes | App Functionality |
| Crash Data | Yes | App Functionality, Analytics |
| Performance Data | Yes | App Functionality, Analytics |
| Other Data (sales figures) | Yes | App Functionality |

Coarse Location is declared although coordinates never leave the phone (only
"on the lot or not" is sent), because the app asks for location Always and a
reviewer will look for it. Jorge's A5.

## App Review information

| Field | Value |
|---|---|
| Sign-in required | Yes |
| User name | demo@sageonline.app |
| Password | Jorge types it in App Store Connect. It is not written here. |
| Contact | Jorge Rivera, jorge.rivera@hollerford.com, and a phone number Jorge adds |

**Notes**

```
Sage is a work app for car dealership staff. Accounts are set up by the dealership; this one is a demo store with fictional people.

Sign in: demo@sageonline.app, password in the fields above. You land on the demo store's floor.

Location "Always": only if a store has drawn its lot. The iPhone watches the edge of the lot and, when the salesperson leaves, asks on the phone whether they are done for the day, so the rotation does not keep calling somebody who has gone home. Coordinates never leave the phone. Location can be refused and the app still works; it asks instead of noticing.

Live Activity: signing on to the floor starts a lock screen card showing your place in line.

Deleting the account: You, then Your account, then Delete my account, then type DELETE.
```

## Age rating

Jorge answers Apple's questions. Every answer that applies is "none", which
comes out 4+. The one to consider: people can write notes to each other
(FlyBy notes), which Apple may count as user-generated content.

## Unlisted distribution

After the app is approved, fill in Apple's unlisted app distribution request
form (developer.apple.com, "Unlisted App Distribution") with the app's name,
its Apple ID from App Store Connect, and why it is for a specific audience:
dealership staff whose accounts their store sets up. Apple replies with the
link to share.
