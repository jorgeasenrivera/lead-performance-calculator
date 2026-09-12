# The type, on the phone

Sage's three faces, kept here so they are on the phone with the rest of the
app: the worker puts them away with the build, and a lot with no signal still
draws the app in its own type. Fetched from Google Fonts at runtime they fell
back to the system faces the moment the signal went, which is the one visible
break in the design language.

- Geist (300 to 700, variable): the interface.
- Geist Mono (400 to 700, variable): caps, clocks and counts.
- Space Grotesk (400 to 700, variable): display, the same face The Board uses.

Latin and Latin Extended subsets only, which cover every roster name the app
has seen. The files are the ones Google Fonts serves, unchanged. All three
faces are under the SIL Open Font License 1.1, which allows this.

The @font-face rules live in index.html so nothing waits on a second
stylesheet; the two files the first screen paints with are preloaded there.
