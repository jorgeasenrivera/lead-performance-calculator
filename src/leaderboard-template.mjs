export function LEADERBOARD_HTML(p, PIX) {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${p.storeName} · Leaderboard</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Sora:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  :root { --blue:#2A5E9B; --dblue:#1D4674; --lime:#C1D730; --lblue:#88C6EA;
    --green:#1F8A6B; --greenbg:#E1F1EA; --yellow:#E0A100; --yellowbg:#FCF2D3; --red:#C8352B; --redbg:#FAE4E2; }
  /* Same guard as the app: plenty of these screens are driven by an Android stick
     or an Android TV, and every size on this board is computed from the height of
     the screen. Chrome deciding a column should be bigger than the arithmetic said
     is the one thing that can throw the whole layout out. */
  html,body { height:100%; -webkit-text-size-adjust:100%; text-size-adjust:100%; }
  body { font-family:'Space Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif; color:#EAF1F8;
    font-variant-numeric:tabular-nums; font-feature-settings:'tnum' 1;
    background:#0E2033; overflow:hidden; }
  /* Store colors mode: the whole backdrop derives from the store's brand palette,
     darkened for contrast so the rows and pills still read from across a floor. */
  body.bg-store { background: color-mix(in srgb, var(--bd, #1D4674), black 62%); }
  body.bg-store::before {
    background:
      radial-gradient(42% 55% at 18% 8%, color-mix(in srgb, var(--bp, #2A5E9B), transparent 20%), transparent 70%),
      radial-gradient(38% 50% at 82% 12%, color-mix(in srgb, var(--ba, #C1D730), transparent 84%), transparent 70%),
      radial-gradient(50% 60% at 50% 100%, color-mix(in srgb, var(--bp, #2A5E9B), transparent 60%), transparent 72%);
  }
  /* slow aurora. Long cycles on purpose: this hangs on a wall all day and must never
     become the thing people look at instead of the numbers. */
  body::before { content:''; position:fixed; inset:-15%; z-index:0; pointer-events:none;
    background:
      radial-gradient(42% 55% at 18% 8%, rgba(36,79,128,.95), transparent 70%),
      radial-gradient(38% 50% at 82% 12%, rgba(193,215,48,.12), transparent 70%),
      radial-gradient(50% 60% at 50% 100%, color-mix(in srgb, var(--p2) 35%, transparent), transparent 72%);
    animation: aurora 40s ease-in-out infinite alternate; }
  @keyframes aurora {
    0% { transform: translate3d(0,0,0) scale(1); }
    100% { transform: translate3d(-2.5%, 2%, 0) scale(1.08); }
  }
  /* The wall screen is always "idle", so it gets the faster colour travel the app
     only reaches once a manager stops scrolling. */
  body::after { content:''; position:fixed; inset:-22%; z-index:0; pointer-events:none;
    background:
      radial-gradient(24% 26% at 28% 26%, rgba(122,79,155,.26), transparent 70%),
      radial-gradient(22% 24% at 74% 60%, rgba(0,168,150,.26), transparent 70%),
      radial-gradient(20% 22% at 52% 92%, rgba(193,215,48,.16), transparent 72%);
    animation: tvMorph 15s ease-in-out infinite alternate; }
  @keyframes tvMorph {
    0%   { transform: scale(1) rotate(0deg); filter: hue-rotate(0deg) saturate(1); }
    50%  { transform: scale(1.16) rotate(-7deg); filter: hue-rotate(130deg) saturate(1.3); }
    100% { transform: scale(1.3) rotate(12deg); filter: hue-rotate(265deg) saturate(1.1); }
  }
  /* Display tuning, set at the TV itself.
     --tscale   : overall text size
     --squeeze  : horizontal pre-compression. If the TV stretches the picture sideways
                  (casting 4:3 into 16:9, or a stretched picture mode), squeezing the
                  content here means it comes out the right shape on the wall.
     --pad      : edge inset, for TVs that overscan and crop the borders. */
  .wrap { position:relative; z-index:1;
    --tscale: 1; --squeeze: 1; --pad: 0vw;
    padding-left: calc(2vw + var(--pad)); padding-right: calc(2vw + var(--pad));
    transform: scaleX(var(--squeeze));
    transform-origin: center center; }
  .wrap { height:100vh; display:flex; flex-direction:column; padding:2.2vh 2vw; }
  .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.6vh; }
  .head-l { display:flex; align-items:center; gap:1.2vw; }
  .head-r { display:flex; align-items:center; gap:2.4vw; }
  .head-logo { width:calc(6.6vh * var(--tscale)); height:calc(6.6vh * var(--tscale)); border-radius:1.2vh; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .head-logo img { width:100%; height:100%; object-fit:contain; }
  .head-title { font-family:'Space Grotesk',sans-serif; font-weight:700; letter-spacing:-.01em; font-size:calc(5.4vh * var(--tscale)); letter-spacing:.5px; line-height:1; }
  .head-sub { font-size:calc(1.7vh * var(--tscale)); color:#A8CBEA; letter-spacing:.10em; text-transform:uppercase; font-weight:600; }
  .total { text-align:right; }
  .total-num { font-family:'Space Grotesk',sans-serif; font-weight:700; letter-spacing:-.01em; font-size:calc(5.8vh * var(--tscale)); line-height:1; color:var(--lime); }
  .total-cap { font-size:calc(1.5vh * var(--tscale)); color:#A8CBEA; letter-spacing:.10em; text-transform:uppercase; font-weight:700; margin-top:.4vh; }
  .clock { text-align:right; font-family:'Space Grotesk',sans-serif; }
  .clock-time { font-size:calc(3.2vh * var(--tscale)); font-weight:700; }
  .clock-date { font-size:1.5vh; color:#9FC2E4; display:flex; align-items:center; gap:.4vw; justify-content:flex-end; }
  .live { width:.8vh; height:.8vh; border-radius:50%; background:#69E08A; flex:0 0 auto;
    box-shadow:0 0 0 0 rgba(105,224,138,.7); animation: livePulse 2.4s ease-out infinite; }
  @keyframes livePulse {
    0% { box-shadow:0 0 0 0 rgba(105,224,138,.55); }
    70% { box-shadow:0 0 0 1.1vh rgba(105,224,138,0); }
    100% { box-shadow:0 0 0 0 rgba(105,224,138,0); }
  }

  /* ---- the hand-over ----
     The board's unit mark is a car, so a screen changing store is those cars
     making the trip: the outgoing board slides away, a convoy crosses carrying
     the next store's name, and the new board slides in behind it.

     The veil FADES rather than wipes. A wedge wide enough to cover a screen has
     its leading edge off the other side of it while it covers, which takes the
     convoy riding that edge off screen with it — the cars were invisible for
     exactly the part of the move they exist for. A fade lets the convoy cross the
     middle of the screen where it can be seen, and a fade is not a cut. */
  .handoff { position:fixed; inset:0; z-index:60; pointer-events:none; overflow:hidden; }
  /* ---- The convoy's clock ----
     One variable so the veil, the road, the name and the cars can never drift out
     of step with each other, and so the whole hand-over can be lengthened by
     changing a single number. Slow on purpose: this is the one moment the board
     asks to be watched, and at 1.6s it was over before anybody looked up. */
  .handoff { --ho: 3.4s; }
  .ho-veil {
    position:absolute; inset:0; background:rgba(9,20,34,.93);
    animation:hoVeil var(--ho) linear both;
  }
  /* Longer at full strength than before, and eased in and out rather than cut in
     at a fixed frame — the veil is what hides the swap, so the moment it covers is
     the moment there is room to work in. */
  @keyframes hoVeil { 0% { opacity:0 } 14%, 74% { opacity:1 } 100% { opacity:0 } }
  /* a low band of light the convoy travels along, so it reads as a road rather
     than as icons floating on a dark screen */
  .ho-road {
    position:absolute; left:0; right:0; top:0; bottom:0;
    background:linear-gradient(180deg, transparent 6%, rgba(193,215,48,.05) 34%,
      rgba(193,215,48,.09) 50%, rgba(193,215,48,.05) 66%, transparent 94%);
    animation:hoVeil var(--ho) linear both;
  }
  /* Each car carries its own duration: the big ones in the near lanes cross
     faster than the small ones further off, which is what a road actually looks
     like from the side. All of them stay linear — a car that eases into and out
     of its own speed reads as a slide, not as traffic. */
  .ho-car {
    position:absolute; top:var(--lane); left:-24vw; width:var(--sz); height:var(--sz);
    color:#C1D730; opacity:var(--fade, 1);
    filter:drop-shadow(0 0 1.2vh rgba(193,215,48,.55)) drop-shadow(0 0 4vh rgba(193,215,48,.22));
    animation:hoDrive var(--dur, 3s) linear var(--dly) both;
  }
  /* .pix9 sets width:1em and is defined later in this sheet, so the car needs a
     selector that outranks it rather than a bare class of its own. */
  .ho-car > svg { width:100%; height:100%; display:block; }
  @keyframes hoDrive { from { transform:translateX(0) } to { transform:translateX(152vw) } }
  .ho-name {
    position:absolute; top:50%; left:50%; width:76vw; margin-left:-38vw;
    text-align:center; white-space:nowrap;
    font-family:'Space Grotesk',sans-serif; font-weight:700; letter-spacing:-.01em;
    /* --tscale lives on .wrap and this layer is a sibling of it on the body, so
       without the fallback the whole calc is invalid and the text collapses to
       whatever it happens to inherit. */
    font-size:calc(5.6vh * var(--tscale, 1)); color:#F4F9FF;
    text-shadow:0 .4vh 3.4vh rgba(0,0,0,.85);
    animation:hoName var(--ho) cubic-bezier(.32,0,.30,1) both;
  }
  .ho-name .ho-to {
    display:block; font-size:calc(1.5vh * var(--tscale, 1)); letter-spacing:.18em;
    text-transform:uppercase; color:#C1D730; margin-bottom:.8vh; font-weight:700;
  }
  /* The name rides in with the convoy, then holds still in the middle for a beat
     — long enough to actually be read, which is the point of putting it there. */
  @keyframes hoName {
    0%       { transform:translate(-46vw,-50%) scale(.94); opacity:0 }
    26%      { transform:translate(0,-50%)     scale(1);   opacity:1 }
    68%      { transform:translate(0,-50%)     scale(1);   opacity:1 }
    100%     { transform:translate(46vw,-50%)  scale(.96); opacity:0 }
  }
  /* the board steps aside and comes back from the other side, under the veil */
  #root.drive-out { animation:boardOut 1s cubic-bezier(.5,0,.85,.4) both; }
  #root.drive-in  { animation:boardIn 1.15s cubic-bezier(.16,.72,.28,1) both; }
  @keyframes boardOut { to { transform:translateX(-8vw); opacity:0; } }
  @keyframes boardIn { from { transform:translateX(8vw); opacity:0; } }
  @media (prefers-reduced-motion: reduce) {
    .ho-car, .ho-road { display:none }
    #root.drive-out, #root.drive-in { animation-duration:.35s }
    @keyframes boardOut { to { opacity:0 } }
    @keyframes boardIn { from { opacity:0 } }
  }

  /* one panel, one table, everybody visible without scrolling */
  .panel { flex:1; position:relative; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
    border-radius:1.4vh; padding:1.2vh 1.2vw; min-height:0; overflow:hidden;
    display:flex; flex-direction:column; }
  .scroller { flex:1 1 auto; min-height:0; overflow:hidden; }
  /* The podium stays on screen while the rest of the list walks past it.
     Its own table above the scroller, rather than three sticky rows inside it.
     Sticky was the obvious way and it does not survive this board: every row
     carries the rowIn entrance, whose filled end state leaves an identity
     transform behind, so each row is permanently its own stacking context and a
     z-index on a pinned cell can never lift it above a row that comes later in
     the document. Lifting the three out of the scroll container removes the
     question entirely — nothing overlaps because nothing shares a scrollport.
     Both tables are width:100% with table-layout:fixed and the same column
     classes, which is what keeps the columns lined up across the join. */
  .podium-tbl { flex:0 0 auto; }
  .podium-tbl tbody tr > td { background:rgba(255,255,255,.05); }
  .podium-tbl tbody tr:nth-child(even) > td { background:rgba(255,255,255,.025); }
  /* one hairline where the fixed three meet the moving list */
  .podium-edge { flex:0 0 auto; height:1px; background:rgba(255,255,255,.14); margin:.5vh 0 .4vh; }
  /* soft fade at the bottom edge so a row cut mid-scroll reads as intentional */
  .panel::after { content:''; position:absolute; left:0; right:0; bottom:0; height:5vh; pointer-events:none;
    background:linear-gradient(180deg, transparent, rgba(14,32,51,.75)); border-radius:0 0 1.4vh 1.4vh; }
  /* The table is capped and centred. Stretched across a 65in screen the columns drifted
     so far apart the eye lost the row on the way across. */
  .lb { width:100%; max-width:1500px; margin:0 auto; border-collapse:separate; border-spacing:0; table-layout:fixed; }
  .lb th { font-size:calc(1.7vh * var(--tscale)); text-transform:uppercase; letter-spacing:.10em; color:#A8CBEA;
    font-weight:700; padding:0 .5vw 1.2vh; text-align:center; }
  .lb th.nm { text-align:left; padding-left:1vw; }
  .lb td { padding:var(--rowpad) .5vw; font-size:var(--rowfs); text-align:center; }

  /* zebra striping instead of hairlines: from across the room a solid band is far
     easier to track than a 1px line */
  .lb tbody tr:nth-child(odd) { background:rgba(255,255,255,.045); }
  .lb tbody tr td:first-child { border-radius:1vh 0 0 1vh; }
  .lb tbody tr td:last-child { border-radius:0 1vh 1vh 0; }

  .lb .rank { width:6%; }
  /* podium badges. Gold, silver, bronze read instantly from across a floor. */
  .badge { display:inline-flex; align-items:center; justify-content:center;
    width:calc(var(--rowfs) * 1.7); height:calc(var(--rowfs) * 1.7); border-radius:50%;
    font-family:'Space Grotesk',sans-serif;  font-size:calc(var(--rowfs) * .82);
    background:rgba(255,255,255,.08); color:#8FB3D6; }
  .badge.m1 { background:linear-gradient(145deg,#FFD75E,#E0A100); color:#3A2B00;
    box-shadow:0 0 calc(var(--rowfs)*.8) rgba(255,200,60,.55); }
  .badge.m2 { background:linear-gradient(145deg,#E6ECF2,#AFBECB); color:#2A3540; }
  .badge.m3 { background:linear-gradient(145deg,#E8A87C,#C0764A); color:#3A1E0B; }

  .lb .nm { width:30%; text-align:left; padding-left:1vw; font-weight:700;
    font-size:calc(var(--rowfs) * 1.12); letter-spacing:-.01em;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* Delivered doubles as a bar chart: volume is instantly comparable down the column */
  .lb .sold { width:14%; position:relative; }
  /* --barw is a percentage of the cell, and the leader gets 100%. Starting at 6% meant
     the leader's bar ran to 106% and spilled into the Internet column. Scale it into
     the space that actually exists. */
  .lb .sold .bar { position:absolute; left:5%; top:14%; bottom:14%;
    width:calc(var(--barw) * 0.86);
    background:linear-gradient(90deg, rgba(193,215,48,.32), rgba(193,215,48,.08));
    border-radius:.5vh; z-index:0; transition:width .8s cubic-bezier(.22,1,.36,1); }
  .lb .sold .soldnum { position:relative; z-index:1;
    font-family:'Space Grotesk',sans-serif;  color:var(--lime);
    font-size:calc(var(--rowfs) * 1.45); }
  .lb .pcell { width:16.6%; white-space:nowrap; }

  /* rows arrive in sequence rather than all at once */
  .lb tbody tr.row { animation: rowIn .5s cubic-bezier(.22,1,.36,1) both;
    animation-delay: calc(var(--i) * 45ms); }
  @keyframes rowIn { from { opacity:0; transform: translateY(1.2vh); } to { opacity:1; transform:none; } }

  /* the leader gets a lit band and a slow shine that travels across it */
  .lb tbody tr.leader { position:relative; }
  .lb tbody tr.leader td { background:linear-gradient(90deg, rgba(193,215,48,.16), rgba(193,215,48,.03) 60%, transparent); }
  .lb tbody tr.leader .nm { color:#F2F7DC; }
  .lb tbody tr.leader .nm::after { content:''; position:absolute; inset:0; pointer-events:none;
    background:linear-gradient(105deg, transparent 35%, rgba(255,255,255,.16) 50%, transparent 65%);
    background-size:220% 100%; animation: shine 5.5s ease-in-out infinite; }
  @keyframes shine { 0% { background-position:180% 0; } 55%,100% { background-position:-60% 0; } }

  .pill { font-family:'Space Grotesk',sans-serif; font-weight:700; letter-spacing:-.01em; font-size:calc(var(--rowfs) * 1.05);
    padding:.3vh 0; border-radius:.9vh; display:inline-flex; align-items:center; justify-content:center;
    width:7vw; text-align:center; box-sizing:border-box; font-variant-numeric:tabular-nums; }
  .pill.g { background:var(--greenbg); color:var(--green); }
  .pill.y { background:var(--yellowbg); color:var(--yellow); }
  .pill.r { background:var(--redbg); color:var(--red); }
  .pill.dim { background:rgba(255,255,255,.07); color:#6E93BC; }
  .pill-mark { display:inline-flex; align-items:center; line-height:0; margin-right:.35vw; opacity:1;
    font-size:calc(var(--rowfs) * 1.05); }
  /* Every dot glyph is one em square and inherits the colour of the text around it,
     so a mark, an arrow and a car all scale with the row rather than fighting it. */
  .pix9 { width:1em; height:1em; display:block; fill:currentColor; }
  .pix-flat { opacity:.5; }
  /* The trend slot is a fixed width. It used to size itself to its contents, so a
     row carrying a delta pushed its pill sideways and the column stopped lining up. */
  .move { display:inline-flex; align-items:center; gap:.25vw; justify-content:flex-start;
    position:absolute; left:100%; top:50%; transform:translateY(-50%); margin-left:.5vw;
    width:3.6vw; min-width:3.6vw; }
  .lb .pcell { text-align:center; }
  .pcell-in { position:relative; }
  .lb .pcell-in { display:inline-flex; align-items:center; justify-content:center; }
  .trend { font-size:calc(var(--rowfs) * 1.0); display:inline-flex; align-items:center; }
  .delta { font-size:calc(var(--rowfs) * .72); font-weight:700; font-variant-numeric:tabular-nums; }
  .up { color:#69E08A; } .down { color:#FF8A80; } .flat { color:#5C7F9F; }

  .flag { color:#FFCF6B; }
  .foot { text-align:center; font-size:1.4vh; color:#7FA8D4; margin-top:1.1vh; letter-spacing:.04em; }
  .empty { color:#7FA8D4; font-size:2vh; padding:4vh; text-align:center; }
  .fade { animation:fade .5s ease; } @keyframes fade { from{opacity:0;transform:translateY(6px);} to{opacity:1;} }

  /* tuning controls: nearly invisible until someone goes looking for them */
  .gear { position:fixed; right:1.2vw; bottom:1.2vh; z-index:40; width:4.4vh; height:4.4vh; border-radius:50%;
    border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.07); color:#9FC2E4;
    font-size:2.2vh; cursor:pointer; opacity:.16; transition:opacity .25s, background .25s; }
  .gear:hover { opacity:1; background:rgba(255,255,255,.14); }
  /* ---- Bars style (Digital-Dealership-System look): one huge striped bar per person ---- */
  .lb2 { width:100%; max-width:1500px; margin:0 auto; border-collapse:separate; border-spacing:0; table-layout:fixed; }
  .lb2 th { font-size:calc(1.7vh * var(--tscale)); text-transform:uppercase; letter-spacing:.04em; color:#A8CBEA;
    padding:.6vh .4vw; border-bottom:1px solid rgba(255,255,255,.14); text-align:left;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lb2 td { padding:var(--rowpad) .5vw; font-size:var(--rowfs); }
  .lb2 tbody tr:nth-child(odd) { background:rgba(255,255,255,.045); }
  .lb2 tbody tr td:first-child { border-radius:1vh 0 0 1vh; }
  .lb2 tbody tr td:last-child { border-radius:0 1vh 1vh 0; }
  .lb2 .rank { width:5%; text-align:center; }
  .lb2 .nm { width:12%; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lb2 .sold2 { width:10%; text-align:center; padding-right:1vw; }
  .lb2 td.sold2 { font-family:'Space Grotesk',sans-serif; font-weight:700; letter-spacing:-.01em;
    font-size:calc(var(--rowfs) * 1.1); }
  /* Each % column is a fixed width and its contents are centred, so every pill is
     the same size across the whole board. The pill has a fixed width too (all
     percentages read identically), and the arrow lives in a reserved lane to the
     right so a row with movement doesn't shove the pill off-centre from one without. */
  .lb2 .pcell2 { width:15%; text-align:center; white-space:nowrap; }
  .lb2 .pcell-in { display:inline-flex; align-items:center; justify-content:center; }
  /* pill + arrow are sized in em so they grow with the row's own font, not the
     screen width — on a wide TV the row gets taller and the pills grow with it,
     and horizontal scroll (already built) covers any overflow. */
  .lb2 .pcell2 .pill { width:5.6em; min-width:0; padding:.28em 0; text-align:center;
    font-size:calc(var(--rowfs) * .96); }
  .lb2 .move2 { width:2.6em; min-width:2.6em; margin-left:.4em; justify-content:flex-start; }
  .lb2 .move2 .delta { font-size:calc(var(--rowfs) * .66); }
  .lb2 .move2 .trend { font-size:calc(var(--rowfs) * .95); }
  .lb2 .sold2 { width:10%; text-align:center; }
  .lb2 td.sold2 { padding:0; font-size:calc(var(--rowfs) * 1.15); }
  .lb2 .sold2 .soldnum { display:inline-block; }
  .lb2 .carcell { width:26%; padding-left:.6vw; }
  /* soft "holding the last board" banner when a refresh is distrusted */
  .stale-note { position:fixed; left:50%; top:1.4vh; transform:translate(-50%,-140%); z-index:60;
    background:rgba(20,40,66,.92); color:#DCEBFA; font-weight:600; font-size:1.8vh;
    padding:1vh 2vw; border-radius:1vh; border:1px solid rgba(136,198,234,.3);
    box-shadow:0 1vh 3vh rgba(0,0,0,.35); backdrop-filter:blur(8px);
    transition:transform .6s cubic-bezier(.22,1,.36,1); pointer-events:none; }
  .stale-note.on { transform:translate(-50%, 0); }

  /* congratulations sweep: a card per new sale, entering from the right with a
     confetti burst, holding, then sliding off. Staggered so a double gets its own. */
  .congrats { position:fixed; right:2.5vw; top:12vh; z-index:70; display:flex; flex-direction:column;
    gap:1.4vh; pointer-events:none; transition:opacity .7s ease; }
  .congrats.out { opacity:0; }
  .cg-card { position:relative; display:flex; align-items:center; gap:1.2vw; overflow:visible;
    background:linear-gradient(120deg, rgba(193,215,48,.96), rgba(120,180,60,.96));
    color:#132; padding:1.6vh 2vw 1.6vh 1.6vw; border-radius:1.4vh; min-width:22vw;
    box-shadow:0 1.4vh 4vh rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.5);
    transform:translateX(120%); opacity:0;
    animation: cgIn .7s cubic-bezier(.22,1,.36,1) var(--d) forwards,
               cgOut .6s ease calc(var(--d) + 4.4s) forwards; }
  @keyframes cgIn  { from { transform:translateX(120%); opacity:0; } to { transform:translateX(0); opacity:1; } }
  @keyframes cgOut { from { transform:translateX(0); opacity:1; } to { transform:translateX(120%); opacity:0; } }
  .cg-ico { font-size:4vh; line-height:1; animation: cgPop .5s ease var(--d) both; }
  @keyframes cgPop { 0%{ transform:scale(0) rotate(-20deg);} 60%{ transform:scale(1.25) rotate(8deg);} 100%{ transform:scale(1) rotate(0);} }
  .cg-txt b { font-family:'Space Grotesk',sans-serif; font-size:2.7vh; display:block; letter-spacing:-.01em; }
  .cg-txt span { font-size:1.9vh; font-weight:600; opacity:.85; }
  /* confetti burst behind the icon */
  .cg-burst { position:absolute; left:2.6vw; top:50%; width:0; height:0; }
  .cg-burst::before, .cg-burst::after { content:''; position:absolute; left:0; top:0; width:.9vh; height:.9vh;
    border-radius:2px; animation: cgConfetti 1s ease var(--d) both; }
  .cg-burst::before { background:#2A5E9B; }
  .cg-burst::after  { background:#fff; animation-delay: calc(var(--d) + .08s); }
  @keyframes cgConfetti {
    0% { transform:translate(0,0) scale(1); opacity:1; }
    100% { transform:translate(3vw,-4vh) scale(0); opacity:0; }
  }
  .car-more { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:calc(var(--rowfs) * .9);
    color:#C7DDF2; margin-left:.4vw; align-self:center; }
  .cars { display:flex; align-items:center; flex-wrap:nowrap; gap:0 .12vw; overflow:hidden;
    animation: carsIn .6s cubic-bezier(.22,1,.36,1) both; animation-delay:calc(var(--i) * .06s); }
  @keyframes carsIn { from { opacity:0; transform:translateX(-1vw); } to { opacity:1; transform:none; } }
  .cars-inner { display:flex; align-items:center; flex-wrap:nowrap; gap:0 .1vw; width:100%; }
  .car { width:calc(var(--rowfs) * var(--csz, 1)); height:calc(var(--rowfs) * var(--csz, 1)); flex:0 0 auto;
    fill:var(--carfill); }
  .cars.g { --carfill:#3ECf6E; } .cars.y { --carfill:#EFD75A; } .cars.r { --carfill:#EF6A72; }
  /* the delivered number sits right of the % pills now, with its trend beside it */
  .lb2 .sold2 .move { min-width:0; margin-left:.3vw; }
  .lb2 td.sold2 { line-height:1.05; }
  .lb2 tbody tr.leader .nm { color:var(--lime); }

  /* bottom ticker, bars style only: streaks and callouts drift by like a news crawl */
  .ticker { position:relative; overflow:hidden; margin-top:1vh; border-radius:1vh;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10);
    font-size:calc(2.1vh * var(--tscale)); font-weight:700; padding:.8vh 0; }
  .ticker-track { display:inline-block; white-space:nowrap; padding-left:100%;
    animation: tickerMove var(--tickdur, 40s) linear infinite; }
  @keyframes tickerMove { to { transform: translateX(-100%); } }
  .ticker-item { display:inline-block; margin-right:3.5vw; }
  .ticker-item .tk-cap { color:#A8CBEA; font-weight:600; margin-right:.4vw; }

  .tuner-seg { display:flex; gap:.5vw; margin-bottom:1vh; }
  .tuner-seg button { flex:1; padding:.8vh .5vw; border-radius:.9vh; border:1px solid rgba(255,255,255,.18);
    background:transparent; color:#BFD9F0; cursor:pointer; font:inherit; font-size:1.6vh; }
  .tuner-seg button.on { background:#C1D730; border-color:#C1D730; color:#0E2033; font-weight:800; }

  .tuner { position:fixed; right:1.2vw; bottom:7vh; z-index:41; width:min(340px, 32vw);
    background:rgba(10,24,40,.96); border:1px solid rgba(255,255,255,.14); border-radius:1.4vh;
    padding:1.6vh 1.4vw; display:none; box-shadow:0 1.5vh 4vh rgba(0,0,0,.55); font-size:1.6vh; }
  .tuner.on { display:block; }
  .tuner-head { display:flex; justify-content:space-between; align-items:center;
    font-weight:800; font-size:1.9vh; margin-bottom:1.2vh; }
  .tuner-x { background:none; border:none; color:#9FC2E4; cursor:pointer; line-height:1; width:3vh; height:3vh; display:grid; place-items:center; }
  .tuner-x svg, .gear svg { width:60%; height:60%; fill:currentColor; display:block; }
  .tuner-row { display:block; margin-bottom:1vh; }
  .tuner-row span { display:flex; justify-content:space-between; color:#BFD9F0; margin-bottom:.5vh; }
  .tuner-row b { color:#fff; }
  .tuner-row input[type=range] { width:100%; accent-color:#C1D730; }
  .tuner-rota { display:flex; flex-direction:column; gap:.5vh; margin:.6vh 0 .2vh; max-height:22vh; overflow-y:auto; }
  .tuner-rota button { display:flex; align-items:center; gap:.7vw; width:100%; text-align:left;
    font:inherit; font-size:1.5vh; color:#DCE9F6; background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.12); border-radius:.8vh; padding:.7vh .9vw; cursor:pointer; }
  .tuner-rota button.on { background:rgba(193,215,48,.16); border-color:rgba(193,215,48,.5); color:#F2F7DC; }
  .tuner-rota .tick { flex:0 0 auto; width:1.6vh; height:1.6vh; border-radius:.4vh;
    border:1px solid rgba(255,255,255,.3); display:grid; place-items:center; font-size:1.1vh; }
  .tuner-rota button.on .tick { background:#C1D730; border-color:#C1D730; color:#26301A; }
  .tuner-rota .none { color:#8FB3D6; font-size:1.4vh; padding:.4vh 0; }
  .tuner-hint { color:#7FA8D4; font-size:1.35vh; margin:-.3vh 0 1.2vh; line-height:1.45; }
  .tuner-foot { display:flex; gap:.6vw; margin-top:1.4vh; }
  .tuner-btn { flex:1; padding:.9vh .6vw; border-radius:.9vh; border:1px solid rgba(255,255,255,.18);
    background:rgba(255,255,255,.06); color:#EAF1F8; font-size:1.5vh; font-weight:700; cursor:pointer; }
  .tuner-btn.primary { background:#C1D730; color:#1F2A00; border-color:#C1D730; }
  .tuner-msg { color:#69E08A; font-size:1.35vh; margin-top:.8vh; min-height:1.6vh; }

  /* ---- on a phone ----
     This board is laid out for a television: seven columns, everything sized in
     vh so it fills a wall. On a 390px screen the columns run off the right and
     the units bar lands on top of the Delivered figure.

     Same board, made to fit. Each person becomes a card — rank and name on top
     with the units figure, the three channel rates on their own row, the bar
     underneath — and vh gives way to px, because a phone's viewport height has
     nothing to do with how big text should be in the hand. Nothing is dropped:
     it is the same seven cells, stacked. */
  @media (max-width: 700px) {
    body { overflow-y:auto; }
    .wrap, .panel { height:auto; min-height:0; padding:10px 12px 28px; }
    /* The header rules here used to name .head h1, .store, .kpi, .sub and
       .kpi-lbl — none of which this board has. They matched nothing, so the
       header kept its wall sizes: a 45px store name over a 70px logo. These are
       the real class names. */
    .head { flex-wrap:wrap; gap:10px 14px; padding:12px; }
    .head-l { flex:1 1 100%; gap:10px; min-width:0; }
    .head-logo { width:40px; height:40px; border-radius:9px; flex:0 0 auto; }
    .head-title { font-size:22px; line-height:1.1; letter-spacing:0; }
    .head-sub { font-size:10.5px; }
    /* The units figure and the clock keep the right-hand side they hold on a
       TV. Wrapping put them on their own line but left them hard against the
       left edge, under the store name, reading as two more lines of the title
       block rather than as the day's number. */
    .head-r { flex:1 1 100%; justify-content:flex-end; align-items:flex-end; gap:18px; }
    .total-num { font-size:30px; }
    .total-cap, .clock-date { font-size:10px; }
    .clock-time { font-size:18px; }
    .scroller { overflow:visible; }
    .gear { width:34px; height:34px; font-size:15px; opacity:.5; right:10px; bottom:10px; }

    /* Almost every size on this board is calc(var(--rowfs) * n), and --rowfs is
       set inline in vh so the rows fill a wall. On a phone that makes the badge,
       the pills, the arrows and the deltas all read the viewport HEIGHT, which is
       why they came out at wildly different weights from the px sizes below them.
       Pinning --rowfs to px here re-bases the whole sheet in one line. It needs
       !important only because the vh value is an inline style on .panel. */
    .panel { --rowfs:12px !important; --rowpad:5px !important; }

    .lb, .lb2 { display:block; table-layout:auto; }
    .lb thead, .lb2 thead { display:none; }          /* each cell carries its own label */
    .lb tbody, .lb2 tbody, .lb tr, .lb2 tr, .lb td, .lb2 td { display:block; }
    /* Three equal columns, not 34px | 1fr | auto. The old tracks were cut for
       row 1 and row 2 had to live in them too — so the first rate was squeezed
       into a 34px track and the third pushed its delta off the side of the card.
       That is the "spread out weirdly". Row 1 keeps its narrow badge by letting
       the name SHARE the badge's column and step past it with padding; grid items
       are allowed to overlap, and it is what lets both rows use one set of
       tracks. */
    .lb tr, .lb2 tr {
      display:grid; grid-template-columns:repeat(3, 1fr); gap:6px 10px; align-items:center;
      margin-bottom:8px; padding:10px 12px; border-radius:14px;
      background:rgba(255,255,255,.06) !important; }
    .lb td, .lb2 td { padding:0; font-size:15px; }
    .lb .rank, .lb2 .rank { grid-column:1; grid-row:1; width:auto; font-size:15px;
      justify-self:start; z-index:1; }
    .badge { width:28px; height:28px; font-size:13px; }
    .lb .nm, .lb2 .nm { grid-column:1 / 3; grid-row:1; width:auto; font-size:17px;
      padding-left:36px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .lb .sold, .lb2 .sold2 { grid-column:3; grid-row:1; width:auto; text-align:right;
      font-size:20px; padding-right:0; }
    .lb .sold .soldnum, .lb2 .sold2 .soldnum { font-size:20px; }

    /* the three rates share one row, evenly */
    .lb .pcell, .lb2 .pcell2 { grid-row:2; width:auto; text-align:center; font-size:12px; }
    .lb .pcell:nth-of-type(4), .lb2 .pcell2:nth-of-type(3) { grid-column:1; }
    .lb .pcell:nth-of-type(5), .lb2 .pcell2:nth-of-type(4) { grid-column:2; }
    .lb .pcell:nth-of-type(6), .lb2 .pcell2:nth-of-type(5) { grid-column:3; }
    /* The pill is 5.6em wide and its arrow another 2.6em on a TV, where the
       column is a fixed 15% of a very wide table. In a third of a phone card
       those add up to more than the column holds, and the overflow is what ran
       off the right. Both size to their content here. */
    /* This is the one that actually caused it. On a TV the trend is pinned
       OUTSIDE its pill — position:absolute, left:100% — so the pills stay on a
       shared grid no matter who has a delta. Hung off the end of a third of a
       phone card, each arrow landed on top of the next pill along and the last
       one hung off the edge of the card entirely. Back in flow here, and under
       the pill rather than beside it, because side by side the pair is wider
       than the column. */
    .lb .pcell-in, .lb2 .pcell-in { display:flex; flex-direction:column;
      align-items:center; justify-content:center; gap:2px; min-width:0; }
    .lb .pcell .move, .lb2 .pcell2 .move { position:static; transform:none;
      margin-left:0; width:auto; min-width:0; justify-content:center; }
    .lb2 .pcell2 .pill { width:auto; min-width:0; padding:.3em .5em; }
    .lb2 .move2 { width:auto; min-width:0; margin-left:0; }

    /* width:auto matters as much as the grid placement. The desktop rule sets
       .carcell to 26% for a seven-column table, and 26% of a phone card is 82px
       — so the units row was folding onto three lines inside a strip a quarter
       of the card wide while the rest of the row sat empty. */
    .lb2 .carcell { grid-column:1 / -1; grid-row:3; width:auto;
      padding-left:0 !important; text-align:left; }
    .lb2 .carcell svg, .lb2 .carcell .pix { max-width:100%; }
    /* One glyph is one unit, so a phone must wrap them rather than clip them —
       nowrap plus overflow:hidden silently cut a big month down to whatever fit
       the width, which is the one thing this row must never do. */
    .cars, .cars-inner { flex-wrap:wrap; overflow:visible; row-gap:2px; }
    .cars { height:auto; }
  }
</style></head>
<body>
<div class="stale-note" id="stale-note">Holding the last board: the newest report looked incomplete. Updating on the next cycle.</div>
<div class="wrap" id="root"><div class="empty">Loading leaderboard…</div></div>

<!-- Tuning happens standing at the TV, so the controls live here rather than back in the app. -->
<button class="gear" id="gear" title="Display settings"></button>
<div class="tuner" id="tuner">
  <div class="tuner-head">Display <button class="tuner-x" id="tclose" aria-label="Close"></button></div>

  <label class="tuner-row"><span>Board style</span></label>
  <div class="tuner-seg">
    <button id="sty-classic">Classic</button>
    <button id="sty-bars">Bars</button>
  </div>

  <label class="tuner-row"><span>Background</span></label>
  <div class="tuner-seg">
    <button id="bg-navy">Navy</button>
    <button id="bg-store">Store colors</button>
  </div>

  <label class="tuner-row">
    <span>Text size <b id="v-t">100%</b></span>
    <input id="s-t" type="range" min="60" max="160" step="5" value="100">
  </label>
  <p class="tuner-hint">For the store on the wall right now. A screen that rotates keeps a size for each store.</p>

  <label class="tuner-row">
    <span>Horizontal squeeze <b id="v-s">100%</b></span>
    <input id="s-s" type="range" min="70" max="100" step="1" value="100">
  </label>
  <p class="tuner-hint">If the TV stretches the picture sideways, pull this down until the letters look the right shape on the wall.</p>

  <label class="tuner-row">
    <span>Edge inset <b id="v-p">0%</b></span>
    <input id="s-p" type="range" min="0" max="8" step="0.5" value="0">
  </label>
  <p class="tuner-hint">For screens that crop the edges.</p>

  <label class="tuner-row"><span>Also show</span></label>
  <div class="tuner-rota" id="rot-list"></div>
  <p class="tuner-hint">Tick a store and this screen will show its board too, handing over each time the list has scrolled all the way down.</p>

  <div class="tuner-foot">
    <button class="tuner-btn" id="treset">Reset</button>
    <button class="tuner-btn primary" id="tsave">Save for this store</button>
  </div>
  <div class="tuner-msg" id="tmsg"></div>
</div>
<script>
  var CFG = ${JSON.stringify(p)};
  // The same one grid as the rest of the tool, sent whole rather than as two
  // tables the board then has to choose between. Drawn at 1em so every mark
  // scales with the row text instead of being pinned to a pixel size.
  var PIXG = ${JSON.stringify(PIX)};
  function pix(g, cls, frac){
    var rows = PIXG[g] || PIXG.dot, out = '';
    var n = rows.length;
    var r = 0.48;   // same ratio as PixIcon, and for the same reason
    for (var y = 0; y < n; y++) {
      var row = rows[y];
      for (var x = 0; x < row.length; x++) {
        if (row[x] !== '1') continue;
        // frac fills the glyph left to right, which is how a half unit is drawn
        var lit = (frac == null) || (((x + 0.5) / row.length) <= frac);
        out += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="' + r + '"'
          + (lit ? '' : ' fill="rgba(255,255,255,.13)"') + '/>';
      }
    }
    return '<svg class="pix9' + (cls ? ' ' + cls : '') + '" viewBox="0 0 ' + n + ' ' + n + '"'
      + ' shape-rendering="geometricPrecision">' + out + '</svg>';
  }
  function norm(s){return (s||'').trim().toLowerCase().replace(/\\s+/g,' ');}
  // the gear and the close are the same dots as everything else on the screen
  document.getElementById('gear').innerHTML = pix('gear');
  document.getElementById('tclose').innerHTML = pix('close');
  // No external library and no CDN. A TV on a dealership network may not be able to
  // reach an external CDN at all, and an import that never resolves left it stuck on
  // "Loading" forever. Plain fetch against the REST API, with the token refreshed by
  // hand so the screen can sit there unattended for days.
  var TOK = CFG.tokens ? {
    access: CFG.tokens.access_token,
    refresh: CFG.tokens.refresh_token
  } : null;
  // The board row is readable with the anon key alone, which is what lets a TV with
  // nobody signed in sit there for weeks. A signed-in session is used when one was
  // handed over, but nothing here depends on it.
  var DB = CFG.db || (CFG.tokens ? { url: CFG.tokens.url, anonKey: CFG.tokens.anonKey } : null);

  function withTimeout(promise, ms){
    return Promise.race([
      promise,
      new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('timeout')); }, ms); })
    ]);
  }

  async function refreshToken(){
    if (!TOK || !TOK.refresh) return false;
    try {
      var r = await withTimeout(fetch(CFG.tokens.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.tokens.anonKey },
        body: JSON.stringify({ refresh_token: TOK.refresh })
      }), 12000);
      if (!r.ok) return false;
      var d = await r.json();
      if (!d.access_token) return false;
      TOK.access = d.access_token;
      if (d.refresh_token) TOK.refresh = d.refresh_token;
      return true;
    } catch (e) { return false; }
  }

  function getStore(){ return getStoreByKey(CFG.storeKey); }
  async function getStoreByKey(storeKey){
    if (!DB) return { __err: 'This board has no database details. Open it again from the tool.' };
    var url = DB.url + '/rest/v1/app_data?key=eq.' + encodeURIComponent(storeKey) + '&select=value';
    function headers(){
      return { apikey: DB.anonKey, Authorization: 'Bearer ' + (TOK ? TOK.access : DB.anonKey) };
    }
    try {
      var res = await withTimeout(fetch(url, { headers: headers() }), 12000);
      if (res.status === 401 || res.status === 403) {
        var ok = await refreshToken();
        if (!ok) return { __err: 'This screen cannot read the board row. Check the database read rule for lpc:board keys.' };
        res = await withTimeout(fetch(url, { headers: headers() }), 12000);
      }
      if (!res.ok) return { __err: 'Could not reach the database (' + res.status + '). Retrying...' };
      var rows = await res.json();
      return (rows && rows[0]) ? rows[0].value : null;
    } catch (e) {
      return { __err: 'No connection to the database. Retrying...' };
    }
  }

  // keep the session alive well before it lapses, so an all-day board never drops out
  setInterval(function(){ refreshToken(); }, 40 * 60 * 1000);
  // each channel is judged on its own scale: a 25% showroom close and a 25% internet
  // close are nowhere near the same achievement
  // A row of little cars: one filled car per whole unit, a half-filled car for a
  // half (splits credit .5). Scaled against the leader and capped so a monster
  // month can't run off a TV.
  // One car per whole unit, a half-filled car for a .5 split, always matching the
  // number exactly. If the leader is over CAP whole cars we DON'T rescale the
  // count (that broke the 1-car-per-unit promise and rounded 5.5 up to 6); we draw
  // the honest cars up to CAP and append a "+N" so the row still fits a TV.
  var CAR_ROW = 0;
  function cars(sold, maxSold){
    // Cars shrink to fit: the row-leader's count sets the size for everyone, so the
    // whole column shares one scale and the biggest month still fits on one line.
    // Past HARDCAP even that is illegible, so those overflow into a "+N".
    var HARDCAP = 34;
    CAR_ROW++;
    var whole = Math.floor(sold + 1e-6);
    var half = (sold - whole) >= 0.5 - 1e-6 ? 1 : 0;
    var CAP = HARDCAP;
    // A dot car. A half unit lights the left half of the grid, so the split still
    // reads honestly from across the floor without any clip paths to collide.
    function car(frac){ return pix('car', 'car', frac <= 0 ? 0 : frac); }
    var drawWhole = Math.min(whole, CAP);
    // The most anyone sold decides the shared car size: more cars => smaller cars,
    // clamped so a light day's cars don't balloon. Set once per render on the row.
    var peak = Math.min(Math.max(maxSold, 1), CAP + (half ? 0.5 : 0));
    var sizeEm = Math.max(0.62, Math.min(1.15, 22 / peak));
    var out = '<span class="cars-inner" style="--csz:' + sizeEm.toFixed(3) + '">';
    for (var i=0;i<drawWhole;i++) out += car(1);
    if (whole <= CAP && half) out += car(0.5);
    if (whole > CAP) out += '<span class="car-more">+'+(whole - CAP + (half ? 0.5 : 0))+'</span>';
    if (!whole && !half) out += car(0);
    out += '</span>';
    return out;
  }

  function soldArrow(cur, prev){
    if (prev == null || cur == null) return ['','',''];
    var d = cur - prev;
    if (d > 0.001)  return ['up','▲','+'+(Math.round(d*10)/10)];
    if (d < -0.001) return ['down','▼',(Math.round(d*10)/10).toString()];
    return ['flat','',''];
  }
  function soldMove(cur, prev){
    var ar = soldArrow(cur, prev);
    if (!ar[0] || ar[0]==='flat') return '';
    var delta = ar[2] ? '<span class="delta '+ar[0]+'">'+ar[2]+'</span>' : '';
    return '<span class="move"><span class="trend '+ar[0]+'">'+ar[1]+'</span>'+delta+'</span>';
  }

  function tone(pct, ch){
    if (pct==null) return 'r';
    var t = (CFG.thresholds && CFG.thresholds[ch]) || { green: 20, yellow: 10 };
    var v = pct*100;
    if (v>=t.green) return 'g';
    if (v>=t.yellow) return 'y';
    return 'r';
  }
  // symbol as well as colour, so the board reads for colour-blind viewers too
  /* The same three glyphs the app uses (five-second pass, item 5). */
  function toneMark(t){ return pix(t === 'g' ? 'check' : t === 'y' ? 'clock' : 'warn'); }
  // direction AND distance moved since the previous report, in percentage points
  function arrow(cur, prev){
    if (cur==null||prev==null) return ['flat', pix('dot','pix-flat'), ''];
    var d = (cur - prev) * 100;
    if (d > 0.05)  return ['up', pix('triup'), '+'+d.toFixed(1)];
    if (d < -0.05) return ['down', pix('tridown'), d.toFixed(1)];
    return ['flat', pix('dot','pix-flat'), ''];
  }
  function fmtPct(v){ return v==null?'-':(v*100).toFixed(1)+'%'; }
  function num(v){ return v==null?0:v; }
  function render(store){
    CAR_ROW = 0;
    var root = document.getElementById('root');
    // an error is not the same as an empty store: say which, never just hang
    if (store && store.__err){
      root.innerHTML = '<div class="empty">' + store.__err + '</div>';
      return;
    }
    if (!store){ root.innerHTML = '<div class="empty">No data yet for this store. Import the delivery reports in the tool and this board will fill in.</div>'; return; }
    var M = (store.months||{})[CFG.ym] || {stats:{}};

    // CFG.roles already excludes any role turned off for The Board (BDC by default),
    // so only the people who actually deliver units show up here.
    var boardRoles = {};
    (CFG.roles||[]).forEach(function(r){ boardRoles[r.id] = true; });

    var gone = {};
    (CFG.departed || store.departed || []).forEach(function(n){ gone[norm(n)] = true; });
    var people = (store.roster||[])
      .filter(function(a){ return a.roleId && boardRoles[a.roleId] && !gone[norm(a.name)]; })
      .map(function(a){
        var s = M.stats[norm(a.name)] || {};
        var iU=num(s.internetUnits), pU=num(s.phoneUnits), rU=num(s.showroomUnits);
        var cU=num(s.campaignUnits);   // service-to-sales and finance apps: units count, close rate is not graded
        var haveAll = (s.internetUnits!=null) && (s.phoneUnits!=null) && (s.showroomUnits!=null);
        return {
          name:a.name,
          internetPct:s.internetPct, phonePct:s.phonePct, showroomPct:s.showroomPct,
          prev:(s.prevPct||{}),
          camp: cU,
          sold: iU+pU+rU+cU,
          prevSold: (function(pu){
            if(!pu) return null;
            var any = ['internet','phone','showroom','campaign'].some(function(c){ return pu[c]!=null; });
            if(!any) return null;
            return num(pu.internet)+num(pu.phone)+num(pu.showroom)+num(pu.campaign);
          })(s.prevUnits),
          haveAll:haveAll
        };
      })
      .sort(function(a,b){ return b.sold - a.sold; });

    // Short display names: first name + last initial ("Sterling B.") to buy the bars
    // room. If two people collide (Juan R. twice), the last-name prefix grows just
    // enough to tell them apart (Juan Ra. / Juan Ro.) instead of showing the same tag.
    (function(){
      function parts(n){ var t = String(n||'').trim().split(/\\s+/); return { first: t[0]||'', rest: t.slice(1).join(' ') }; }
      people.forEach(function(x){
        var pr = parts(x.name);
        x.disp = pr.rest ? pr.first + ' ' + pr.rest[0] + '.' : pr.first;
      });
      var need = true, len = 1;
      while (need && len < 8) {
        need = false;
        var seen = {};
        people.forEach(function(x){ seen[x.disp] = (seen[x.disp]||0) + 1; });
        people.forEach(function(x){
          if (seen[x.disp] > 1) {
            var pr = parts(x.name);
            if (pr.rest && pr.rest.length > len) { x.disp = pr.first + ' ' + pr.rest.slice(0, len+1) + '.'; need = true; }
          }
        });
        len++;
      }
    })();

    var totalSold = people.reduce(function(n,x){ return n + x.sold; }, 0);
    var grandFlag = Math.abs(totalSold - Math.round(totalSold)) > 0.01;

    // Everyone has to fit on one screen with no scrolling, so the rows scale to the
    // size of the team rather than being a fixed height.
    // Size from the space that is actually available rather than a fixed lookup.
    // This is on a TV across a showroom floor, so fill the screen: a small team should
    // read enormous, and a big team should still be as large as it possibly can be.
    var n = Math.max(people.length, 1);
    var AVAIL = 80;                                   // vh the table body gets
    /* The ceiling is what a rota exposed: a fifteen-person store fills the wall,
       then hands over to a three-person store that stopped growing at the old cap
       and sat in the top third of an empty screen. Both boards are sized from the
       screen, so both should reach the bottom of it — a small team is not a small
       board, it is a board with enormous rows. */
    var rowH  = Math.min(20, AVAIL / (n + 1));
    /* Six columns have to fit across as well, and type is sized in vh — so the real
       ceiling on a short list is the WIDTH of the screen, not its height. 3.15% of
       the width is the size the columns stop colliding at; on a 16:9 TV that is the
       5.6vh this board has always used, and a wider wall gets the benefit. */
    var wideCap = 3.15 * (window.innerWidth / window.innerHeight);         // vh
    // Never shrink below what is readable from across a floor. If the team does not
    // fit at that size, the board scrolls instead of squinting.
    var rowFs = Math.max(2.2, Math.min(wideCap, rowH * 0.62)) * DISP.tscale;   // vh
    /* Whatever height the type could not take, the row takes: a three-person store
       reaching the bottom of the wall in tall bands beats the same three rows
       stacked in the top third with the rest of the screen empty. */
    var tightPad = Math.max(0.35, rowH * 0.10) * DISP.tscale;
    var rowPad = Math.max(tightPad, (rowH - rowFs * 1.35) / 2 * DISP.tscale);

    function cell(pct, prevVal, ch){
      if (pct == null) return '<td class="pcell"><span class="pcell-in"><span class="pill dim">-</span><span class="move"></span></span></td>';
      var tn = tone(pct, ch);
      var ar = arrow(pct, prevVal);
      var delta = ar[2] ? '<span class="delta '+ar[0]+'">'+ar[2]+'</span>' : '';
      return '<td class="pcell"><span class="pcell-in">' +
        '<span class="pill '+tn+'"><span class="pill-mark">'+toneMark(tn)+'</span>'+fmtPct(pct)+'</span>' +
        '<span class="move"><span class="trend '+ar[0]+'">'+ar[1]+'</span>'+delta+'</span>' +
      '</span></td>';
    }

    var maxSold = people.reduce(function(m,x){ return Math.max(m, x.sold); }, 0) || 1;

    var rows = people.map(function(x,i){
      var medal = i < 3 ? ' m' + (i+1) : '';
      var barw = Math.round((x.sold / maxSold) * 100);
      return '<tr class="row' + (i === 0 ? ' leader' : '') + (i < 3 ? ' pin' : '') + '" style="--i:' + i + '; --barw:' + barw + '%">' +
        '<td class="rank"><span class="badge' + medal + '">' + (i+1) + '</span></td>' +
        '<td class="nm">' + x.disp + (x.haveAll ? '' : ' <span class="flag" title="A delivery report is missing for this person, so their total may be incomplete.">&#9873;</span>') + '</td>' +
        '<td class="sold"><span class="bar"></span><span class="soldnum" data-to="' + x.sold + '">0</span>' +
          soldMove(x.sold, x.prevSold) +
        '</td>' +
        cell(x.internetPct, x.prev.internet, 'internet') +
        cell(x.phonePct,    x.prev.phone,    'phone') +
        cell(x.showroomPct, x.prev.showroom, 'showroom') +
      '</tr>';
    });

    if (!rows.length) rows = ['<tr><td colspan="6" class="empty">No sales associates on the board yet. Give them a position in the tool.</td></tr>'];

    // ---- Bars style: rank, name, units, one huge striped bar sized against the leader ----
    var bars = DISP.style === 'bars';
    // bars view now carries the same +/- movement as the classic board; the pill
    // is narrower to leave room for the arrow beside it.
    function cell2(pct, ch, prevVal){
      if (pct == null) return '<td class="pcell2"><span class="pcell-in"><span class="pill dim">-</span><span class="move move2"></span></span></td>';
      var tn = tone(pct, ch);
      var ar = arrow(pct, prevVal);
      var delta = ar[2] ? '<span class="delta '+ar[0]+'">'+ar[2]+'</span>' : '';
      return '<td class="pcell2"><span class="pcell-in">' +
        '<span class="pill '+tn+'"><span class="pill-mark">'+toneMark(tn)+'</span>'+fmtPct(pct)+'</span>' +
        '<span class="move move2"><span class="trend '+ar[0]+'">'+ar[1]+'</span>'+delta+'</span>' +
      '</span></td>';
    }
    var rows2 = people.map(function(x,i){
      var medal = i < 3 ? ' m' + (i+1) : '';
      var ratio = x.sold / maxSold;
      // The podium is always green — top three have earned it no matter the spread.
      var t2 = i < 3 ? 'g' : ratio >= 0.75 ? 'g' : ratio >= 0.4 ? 'y' : 'r';
      var barw = Math.max(2, Math.round(ratio * 100));
      return '<tr class="row' + (i === 0 ? ' leader' : '') + (i < 3 ? ' pin' : '') + '" style="--i:' + i + '; --barw:' + barw + '%">' +
        '<td class="rank"><span class="badge' + medal + '">' + (i+1) + '</span></td>' +
        '<td class="nm">' + x.disp + (x.haveAll ? '' : ' <span class="flag" title="A delivery report is missing for this person, so their total may be incomplete.">&#9873;</span>') + '</td>' +
        cell2(x.internetPct, 'internet', x.prev.internet) +
        cell2(x.phonePct, 'phone', x.prev.phone) +
        cell2(x.showroomPct, 'showroom', x.prev.showroom) +
        '<td class="sold2"><span class="soldnum" data-to="' + x.sold + '">0</span>' + soldMove(x.sold, x.prevSold) + '</td>' +
        '<td class="carcell"><div class="cars ' + t2 + '">' + cars(x.sold, maxSold) + '</div></td>' +
      '</tr>';
    });
    if (!rows2.length) rows2 = ['<tr><td colspan="7" class="empty">No sales associates on the board yet. Give them a position in the tool.</td></tr>'];

    /* The top three come out of the scroll container and sit in their own table
       above it, so they stay on screen for the whole pass. */
    var PIN = 3;
    var pin  = function(a){ return a.slice(0, PIN).join(''); };
    var rest = function(a){ return a.length > PIN ? a.slice(PIN).join('') : ''; };

    // ticker items: leader + best of each channel, plus the streaks passed from the tool
    var tickerItems = [];
    if (people.length && people[0].sold > 0) tickerItems.push('&#128081; ' + people[0].name + ' leads with ' + people[0].sold + ' units');
    ['internetPct','phonePct','showroomPct'].forEach(function(k){
      var best = null;
      people.forEach(function(x){ if (x[k] != null && (!best || x[k] > best[k])) best = x; });
      if (best && best[k] > 0) {
        var lbl = k === 'internetPct' ? 'Top Internet' : k === 'phonePct' ? 'Top Phone' : 'Top Showroom';
        tickerItems.push('<span class="tk-cap">' + lbl + ':</span>' + best.name + ' ' + fmtPct(best[k]));
      }
    });
    (CFG.ticker || []).forEach(function(t){ tickerItems.push(t); });
    var tickerHtml = tickerItems.map(function(t){ return '<span class="ticker-item">' + t + '</span>'; }).join('');
    var tickDur = Math.max(25, tickerItems.length * 7);

    root.innerHTML =
      '<div class="head"><div class="head-l"><div class="head-logo">'+(CFG.icon?'<img src="'+CFG.icon+'"/>':'')+'</div>'+
      '<div><div class="head-title">'+CFG.storeName+'</div><div class="head-sub">Delivery Leaderboard</div></div></div>'+
      '<div class="head-r">'+
        '<div class="total"><div class="total-num"><span class="totnum" data-to="'+totalSold+'">0</span>'+(grandFlag?' <span class="flag">&#9873;</span>':'')+'</div><div class="total-cap">Units Delivered</div></div>'+
        '<div class="clock"><div class="clock-time" id="clk"></div><div class="clock-date" id="dat"><span class="live"></span><span id="datt"></span></div></div>'+
      '</div></div>'+
      '<div class="panel" style="--rowfs:'+rowFs+'vh; --rowpad:'+rowPad+'vh;">'+
        /* The header and the top three, fixed. Then the rest, scrolling. Both
           tables carry the same classes and table-layout:fixed, which is what
           keeps the columns aligned across the join. */
        (bars
          ? '<table class="lb2 podium-tbl">'+
              '<thead><tr>'+
                '<th class="rank">#</th>'+
                '<th class="nm">Associate</th>'+
                '<th class="pcell2" style="text-align:center">Internet %</th>'+
                '<th class="pcell2" style="text-align:center">Phone %</th>'+
                '<th class="pcell2" style="text-align:center">Showroom %</th>'+
                '<th class="sold2" style="text-align:center">Delivered</th>'+
                '<th class="carcell" style="text-align:left; padding-left:.6vw">units</th>'+
              '</tr></thead>'+
              '<tbody>'+pin(rows2)+'</tbody>'+
            '</table>'
          : '<table class="lb podium-tbl">'+
              '<thead><tr>'+
                '<th class="rank">#</th>'+
                '<th class="nm">Associate</th>'+
                '<th class="sold">Delivered</th>'+
                '<th class="pcell">Internet %</th>'+
                '<th class="pcell">Phone %</th>'+
                '<th class="pcell">Showroom %</th>'+
              '</tr></thead>'+
              '<tbody>'+pin(rows)+'</tbody>'+
            '</table>')+
        (((bars ? rows2 : rows).length > 3) ? '<div class="podium-edge"></div>' : '')+
        '<div class="scroller" id="scroller">'+
        (bars
          ? '<table class="lb2"><tbody>'+rest(rows2)+'</tbody></table>'
          : '<table class="lb"><tbody>'+rest(rows)+'</tbody></table>')+
        '</div>'+
      '</div>'+
      (bars
        ? '<div class="ticker"><div class="ticker-track" style="--tickdur:'+tickDur+'s">'+tickerHtml+'</div></div>'
        : '<div class="foot">' +
            'Green at: Internet ' + CFG.thresholds.internet.green + '%+ &middot; ' +
            'Phone ' + CFG.thresholds.phone.green + '%+ &middot; ' +
            'Showroom ' + CFG.thresholds.showroom.green + '%+' +
            ' &middot; arrows show the change since the previous report &middot; data refreshes every 15 minutes' +
          '</div>');
    tick();
    countUp();
    trimFill(tightPad, rowPad);
    startScroll();
  }

  /* The padding above is arithmetic against an ASSUMED 80vh of panel; the real
     panel is whatever the header, the footer and the ticker leave behind. When the
     guess overshoots, a list that fits on the screen would start scrolling for the
     sake of white space it never needed — so hand the height back until it fits,
     down to the tight padding a full board uses and no further. */
  function trimFill(tight, pad){
    var sc = document.getElementById('scroller');
    var panel = document.querySelector('.panel');
    if (!sc || !panel || pad <= tight) return;
    var vh = window.innerHeight / 100;
    for (var i = 0; i < 8 && pad > tight; i++) {
      var over = sc.scrollHeight - sc.clientHeight;
      if (over <= 4) return;
      var rows = document.querySelectorAll('.panel tbody tr').length + 1;   // + the header row
      pad = Math.max(tight, pad - (over / (2 * rows)) / vh);
      panel.style.setProperty('--rowpad', pad + 'vh');
    }
  }

  // If the whole team cannot fit at a readable size, the board walks slowly down the
  // list, holds at the bottom, then springs back to the top with a bounce. Nobody at
  // the bottom of the board should be invisible all day.
  var scrollRAF = null;
  var idleRefill = null;   // refill timer for boards small enough not to scroll
  var settleTimer = null;  // the measure-after-layout delay
  var dwellTimer = null;   // hand-over clock for a board too short to scroll
  /* Every render starts a scroll cycle, and a hand-over renders — so without a
     generation stamp each rotation leaves its predecessor's frame loop alive on a
     detached element, still counting down to a hand-over of its own. Two boards
     become four clocks, then eight, and the room sees the store change every few
     seconds. A cycle checks its stamp before it does anything; only the newest
     one is still the current cycle. */
  var scrollGen = 0;
  function startScroll(){
    var gen = ++scrollGen;
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
    var el = document.getElementById('scroller');
    if (!el) return;

    // let layout settle before measuring
    settleTimer = setTimeout(function(){
      settleTimer = null;
      if (gen !== scrollGen) return;
      var over = el.scrollHeight - el.clientHeight;
      if (over <= 4) {
        // Everyone fits, so there's no scroll cycle to trigger the bar refill.
        // Give a non-scrolling board the same flourish on a gentle idle timer.
        if (idleRefill) clearInterval(idleRefill);
        idleRefill = setInterval(replayBars, 2 * 60 * 1000);
        /* A short list has no cycle to end, so the hand-over needs its own clock —
           otherwise a rotation that reaches a small store stops there for the day. */
        if (rotates()) dwellTimer = setTimeout(function(){
          dwellTimer = null;
          if (gen === scrollGen) nextStore();
        }, Math.max(3000, MIN_STORE_MS - (Date.now() - storeShownAt)));
        return;
      }
      if (idleRefill) { clearInterval(idleRefill); idleRefill = null; }

      var HOLD_TOP = 4000;                   // pause so the leaders get their moment
      var HOLD_BOTTOM = 2500;
      var SPEED = 13;                        // px per second: a slow, readable crawl
      var BLOOP = 950;                       // the spring back to the top

      var phase = 'holdTop', t0 = null, from = 0;

      function bloopEase(p){
        // overshoot slightly then settle: the "bloop"
        var c = 1.70158 * 1.2;
        return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
      }

      function frame(ts){
        if (gen !== scrollGen) return;   // a newer cycle owns the board now
        if (t0 === null) t0 = ts;
        var dt = ts - t0;

        if (phase === 'holdTop') {
          el.scrollTop = 0;
          if (dt > HOLD_TOP) { phase = 'down'; t0 = ts; }
        } else if (phase === 'down') {
          var y = (dt / 1000) * SPEED;
          if (y >= over) { el.scrollTop = over; phase = 'holdBottom'; t0 = ts; }
          else el.scrollTop = y;
        } else if (phase === 'holdBottom') {
          if (dt > HOLD_BOTTOM) { phase = 'bloop'; t0 = ts; from = el.scrollTop; }
        } else if (phase === 'bloop') {
          var p = Math.min(1, dt / BLOOP);
          el.scrollTop = Math.max(0, from * (1 - bloopEase(p)));
          if (p >= 1) {
            el.scrollTop = 0; phase = 'holdTop'; t0 = ts; replayBars();
            /* One full pass, then the next store. The hand-over happens here rather
               than on a timer so a screen never changes store mid-scroll — you
               always see a board from its leader to its last name before it moves
               on. The frame loop is left running: the new render calls startScroll
               again, which retires this cycle by stamp, and if the hand-over fails
               there is still a board scrolling rather than a frozen one.

               A pass is the earliest a store may leave, not the moment it must:
               a board with barely more than a screenful scrolls a few pixels and
               springs straight back, and rotating on that is a store every ten
               seconds. It stays until it has had its minute, then leaves at the
               end of the next pass. */
            if (rotates() && Date.now() - storeShownAt >= MIN_STORE_MS) nextStore();
          }
        }
        scrollRAF = requestAnimationFrame(frame);
      }
      scrollRAF = requestAnimationFrame(frame);
    }, 400);
  }

  // When the board springs back to the top, the bars refill from zero as a little
  // reward moment. Only the bars: the numbers alongside them stay put, so the
  // figures on screen never look like they changed when they didn't.
  function replayBars(){
    var fills = document.querySelectorAll('.fill2');
    for (var k = 0; k < fills.length; k++) {
      (function(f){
        f.style.animation = 'none';
        void f.offsetWidth;                 // reflow so the animation actually restarts
        f.style.animation = '';
      })(fills[k]);
    }
  }

  // numbers roll up rather than snapping into place. Runs on every refresh, so a
  // new unit landing on the board actually announces itself.
  function countUp(){
    var els = document.querySelectorAll('[data-to]');
    for (var k = 0; k < els.length; k++) {
      (function(el){
        var to = parseFloat(el.getAttribute('data-to')) || 0;
        var dur = 900, t0 = null;
        function step(ts){
          if (!t0) t0 = ts;
          var p = Math.min(1, (ts - t0) / dur);
          var eased = 1 - Math.pow(1 - p, 3);
          var v = to * eased;
          el.textContent = (to % 1 === 0) ? Math.round(v) : v.toFixed(1);
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      })(els[k]);
    }
  }
  function tick(){ var n=new Date();
    var c=document.getElementById('clk'); var d=document.getElementById('dat');
    if(c) c.textContent = n.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    var dt = document.getElementById('datt');
    if(dt) dt.textContent = n.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'});
    else if(d) d.textContent = n.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'}); }
  // A refresh that swings wildly from the last one is almost always a bad import
  // or a half-written file, not real. Hold the current board and try again next
  // cycle rather than flashing garbage onto a showroom TV. "Wildly" = the total
  // units moved by more than half, on a board that had real numbers to begin with.
  function tooDifferent(prev, next){
    try {
      if (!prev || !prev.store || !next || !next.store) return false;
      function totalUnits(st){
        var t = 0, r = (st.roster||[]);
        for (var i=0;i<r.length;i++){
          var v = (st.months && st.months[next.ym] && st.months[next.ym].stats) || {};
          var k = norm(r[i].name), o = v[k]; if (!o) continue;
          t += (+o.internetUnits||0)+(+o.phoneUnits||0)+(+o.showroomUnits||0)+(+o.campaignUnits||0);
        }
        return t;
      }
      var a = totalUnits(prev), b = totalUnits(next);
      if (a < 5) return false;                       // nothing meaningful to protect yet
      var drop = (a - b) / a;
      return drop > 0.5;                             // lost more than half: distrust it
    } catch(e){ return false; }
  }

  // Who sold since the last good refresh — drives the congratulations sweep.
  function newlySold(prev, next){
    var out = [];
    try {
      if (!prev || !next) return out;
      function unitsOf(st, name){
        var v = (st.months && st.months[next.ym] && st.months[next.ym].stats) || {};
        var o = v[norm(name)]; if (!o) return 0;
        return (+o.internetUnits||0)+(+o.phoneUnits||0)+(+o.showroomUnits||0)+(+o.campaignUnits||0);
      }
      var roster = (next.roster||[]);
      for (var i=0;i<roster.length;i++){
        var nm = roster[i].name;
        var before = unitsOf(prev, nm), after = unitsOf(next, nm);
        if (after > before + 1e-6) out.push({ name: nm, gained: after - before });
      }
    } catch(e){}
    return out;
  }

  function congratulate(list){
    if (!list.length) return;
    var host = document.createElement('div');
    host.className = 'congrats';
    // one banner per seller, staggered, so a double sale gets its own moment
    host.innerHTML = list.slice(0, 6).map(function(w, i){
      var u = w.gained % 1 ? w.gained.toFixed(1) : w.gained;
      return '<div class="cg-card" style="--d:'+(i*1.5)+'s">'
        + '<div class="cg-burst"></div>'
        + '<div class="cg-ico">&#127881;</div>'
        + '<div class="cg-txt"><b>'+w.name+'</b><span>just delivered '+u+(w.gained==1?' unit':' units')+'</span></div>'
        + '</div>';
    }).join('');
    document.body.appendChild(host);
    // total life = last card's delay + its own 5s, then fade
    var life = (Math.min(list.length,6) * 1.5 + 5) * 1000;
    setTimeout(function(){ host.classList.add('out'); setTimeout(function(){ host.remove(); }, 700); }, life);
  }

  async function loop(){
    var s = await getStore();
    var switched = SWITCHING; SWITCHING = false;
    // Failsafe: a good previous board plus a suspicious new one = keep the old one.
    // Skipped across a hand-over: two different dealerships are supposed to look
    // nothing like each other, and this check would refuse every rotation.
    if (!switched && LAST && !LAST.__err && s && !s.__err && tooDifferent(LAST, s)) {
      var warn = document.getElementById('stale-note');
      if (warn) warn.classList.add('on');
      return;                                        // skip this render entirely
    }
    /* Nobody "just delivered" anything because the screen changed store, so the
       congratulations are held across a hand-over too. */
    var wsold = (!switched && LAST && !LAST.__err && s && !s.__err) ? newlySold(LAST, s) : [];
    if (!LAST) {
      // First load only, so a live adjustment is never stamped over on refresh.
      // The store's published setting is the starting point; anything set on this
      // particular screen wins over it, because somebody stood in front of this
      // television and decided the text was the wrong size for this room.
      var d = (s && !s.__err && s.boardDisplay) ? s.boardDisplay : {};
      var mine = {};
      try { mine = JSON.parse(localStorage.getItem(DKEY) || '{}') || {}; } catch (e) {}
      var pick = function(k, dflt){
        if (mine[k] != null) return mine[k];
        if (d[k] != null) return d[k];
        return dflt;
      };
      DISP.style   = pick('style', DISP.style);
      DISP.bg      = pick('bg', DISP.bg);
      DISP.squeeze = pick('squeeze', 1);
      DISP.pad     = pick('pad', 0);
      DISP.rotate  = pick('rotate', []) || [];
      /* A screen tuned before text size became per store keeps its size for
         the store it was opened for. */
      if (mine.tscale != null && !tsizeMine(HOME.id)) tsizeKeep(HOME.id, mine.tscale);
    }
    /* Its own row is the authority on who a store is: the sibling list only
       carries a name, and brand, icon and thresholds all differ per store. */
    SWITCHING = switched;
    renderStore(s);
    var warn = document.getElementById('stale-note');
    if (warn) warn.classList.remove('on');
    if (wsold.length) congratulate(wsold);
  }
  /* ---------- rotating through more than one store ----------
     A screen in a shared hallway shows one store's board, walks it top to bottom,
     then hands over to the next one on the list. The list is a display setting on
     the board it was opened for, so it is set standing at the TV like everything
     else here, and it saves to that store rather than to the screen.

     Every store publishes its whole board row — name, brand, icon, thresholds and
     all — so switching is a matter of pointing at another key and re-reading. No
     new data has to be written for this to work. */
  function rotates(){ return (DISP.rotate || []).length > 0; }
  function rotaList(){ return [HOME.id].concat(DISP.rotate || []); }
  var HOME = { id: CFG.storeId, key: CFG.storeKey, name: CFG.storeName,
               icon: CFG.icon, brand: CFG.brand, thresholds: CFG.thresholds };
  var ROT_I = 0;

  /* How long a store is entitled to the wall before the rota may move on. The
     scroll cycle decides WHEN it leaves — always at the end of a pass, never
     mid-list — and this decides how soon that is allowed to be. */
  var MIN_STORE_MS = 45000;
  var storeShownAt = Date.now();

  /* True for exactly one pass of loop(), because the two guards in it compare the
     board on screen with the one arriving — which is the right thing to do for a
     refresh of the same store and completely wrong across a hand-over. */
  var SWITCHING = false;
  var HANDING = false;      // one hand-over at a time

  /* The convoy.
     The board's own unit mark is a car, so the hand-over is that car making the
     trip: a few of them drive across the screen carrying the next store's name,
     and the board changes underneath while they cover it. No cut, and the room
     can see where the screen is going before it gets there.

     The next store's row is fetched BEFORE anything moves, so the new board is
     already in hand when the convoy reaches the middle. A hand-over that had to
     wait on the network would show an empty screen behind the cars. */
  function driveTo(label, swap){
    var lane = document.createElement('div');
    lane.className = 'handoff';
    /* Lane, size, head start, speed and weight: cars leaving together on one
       timing read as a graphic, cars leaving a beat apart read as traffic — and
       cars crossing at DIFFERENT speeds read as distance. The near lanes are big,
       bright and quick; the far ones are small, dimmer and slower, which is what
       gives the hand-over depth rather than a row of icons sliding past.
       [ lane vh, size vh, delay s, duration s, opacity ] */
    var lanes = [
      [10, 5.2, .10, 3.5, .55],
      [21, 7.0, .02, 3.0, .80],
      [33, 9.2, .16, 2.5, 1],
      [45, 5.8, .30, 3.3, .62],
      [57, 8.2, .08, 2.7, .95],
      [70, 6.2, .22, 3.2, .70],
      [82, 9.6, .00, 2.4, 1],
    ];
    var cars = lanes.map(function(l){
      return '<span class="ho-car" style="--lane:' + l[0] + 'vh; --sz:' + l[1] + 'vh; --dly:' + l[2]
        + 's; --dur:' + l[3] + 's; --fade:' + l[4] + '">' + pix('car', '', 1) + '</span>';
    }).join('');
    lane.innerHTML = '<div class="ho-veil"></div><div class="ho-road"></div>' + cars
      + '<div class="ho-name"><span class="ho-to">Now showing</span>' + label + '</div>';
    document.body.appendChild(lane);

    var root = document.getElementById('root');
    if (root) root.classList.add('drive-out');
    /* Swapped behind the convoy, not before it: the veil is at full strength from
       roughly 480ms to 2.5s of a 3.4s hand-over, and the swap sits in the middle of
       that window with room on both sides. These three numbers are the CSS clock
       read back — if --ho changes, they change with it. */
    setTimeout(function(){
      swap();
      var r = document.getElementById('root');
      if (r) { r.classList.remove('drive-out'); r.classList.add('drive-in');
        setTimeout(function(){ r.classList.remove('drive-in'); }, 1150); }
    }, 1250);
    setTimeout(function(){ lane.remove(); HANDING = false; }, 3600);
  }

  async function nextStore(){
    var list = rotaList();
    if (list.length < 2 || HANDING) return;
    HANDING = true;
    var at = (ROT_I + 1) % list.length;
    var id = list[at];
    var key = 'lpc:board:' + id + ':v1';
    var s = await getStoreByKey(key);
    if (!s || s.__err) {
      /* That store has never been published, or the network blinked. Stay where we
         are and let the next pass try the one after it, rather than driving the
         room to an empty board. */
      HANDING = false; ROT_I = at; storeShownAt = Date.now(); startScroll();
      return;
    }
    ROT_I = at;
    var known = (CFG.siblings || []).filter(function(x){ return x.id === id; })[0];
    var name = s.storeName || (id === HOME.id ? HOME.name : (known && known.name)) || 'Next store';
    driveTo(name, function(){
      // Until the covered swap, the controls still belong to the leaving store.
      CFG.storeId = id;
      CFG.storeKey = key;
      storeShownAt = Date.now();
      SWITCHING = true;
      renderStore(s);
    });
  }

  /* The tail of loop(), reusable: the hand-over already has the row in hand and
     must not fetch it a second time. */
  function renderStore(s){
    var switched = SWITCHING; SWITCHING = false;
    /* Both a refresh and the convoy arrive here. Picking the team's size in
       loop() alone missed the convoy, which calls this directly with its row.
       Leave same-store refreshes alone so an adjustment in progress survives. */
    if (!LAST || switched) {
      var own = tsizeMine(CFG.storeId);
      var pub = (s && !s.__err && s.boardDisplay && s.boardDisplay.tscale != null) ? s.boardDisplay.tscale : null;
      DISP.tscale = own != null ? own : (pub != null ? pub : 1);
    }
    if (switched && s && !s.__err) {
      if (s.storeName) CFG.storeName = s.storeName;
      if (s.icon !== undefined) CFG.icon = s.icon;
      if (s.brand) CFG.brand = s.brand;
      if (s.thresholds) CFG.thresholds = s.thresholds;
    }
    if (s && !s.__err) LAST = s;
    applyDisp();
    render(s);
    wireTuner();
    applyDisp();
  }

  /* ---------- display tuning ---------- */
  // Read whatever was saved for this store, and let the person at the TV change it.
  var DISP = { tscale: 1, squeeze: 1, pad: 0, style: 'classic', bg: 'navy', rotate: [] };
  var DKEY = 'lpc:disp:' + (CFG.storeId || 'board');
  /* the text size this screen was given for one store, kept by that store */
  function tsizeMine(id){ try { var v = localStorage.getItem('lpc:disp:t:' + id); return v == null ? null : Number(v); } catch (e) { return null; } }
  function tsizeKeep(id, v){ try { localStorage.setItem('lpc:disp:t:' + id, String(v)); return true; } catch (e) { return false; } }

  function applyDisp(){
    var b = CFG.brand || {};
    document.body.style.setProperty('--bp', b.primary || '#2A5E9B');
    document.body.style.setProperty('--bd', b.deep || '#1D4674');
    document.body.style.setProperty('--ba', b.accent || '#C1D730');
    document.body.className = DISP.bg === 'store' ? 'bg-store' : '';
    var w = document.getElementById('root');
    if (!w) return;
    w.style.setProperty('--tscale', DISP.tscale);
    w.style.setProperty('--squeeze', DISP.squeeze);
    w.style.setProperty('--pad', DISP.pad + 'vw');
    var t = document.getElementById('v-t'), s = document.getElementById('v-s'), pd = document.getElementById('v-p');
    if (t) t.textContent = Math.round(DISP.tscale * 100) + '%';
    if (s) s.textContent = Math.round(DISP.squeeze * 100) + '%';
    if (pd) pd.textContent = DISP.pad + '%';
  }

  /* One drawing for both, the list the tool hands in and the list a wall
     reads for itself, so the two can never drift apart. */
  function drawRota(rl, sibs){
    if (!sibs.length) { rl.innerHTML = '<div class="none">This is the only store on this account.</div>'; return; }
    /* A store that has since left the group stops being a tickable row, and
       stops being in the rota. Only ever run against a list that was actually
       read: dropping ids against a list that failed to load would quietly
       empty a working wall's rota. */
    DISP.rotate = (DISP.rotate || []).filter(function(id){
      return sibs.some(function(x){ return x.id === id; }); });
    rl.innerHTML = sibs.map(function(x){
      var on = (DISP.rotate || []).indexOf(x.id) >= 0;
      return '<button data-rot="' + x.id + '" class="' + (on ? 'on' : '') + '">'
        + '<span class="tick">' + (on ? '&#10003;' : '') + '</span>'
        + '<span>' + x.name + '</span></button>';
    }).join('');
    rl.querySelectorAll('[data-rot]').forEach(function(b){
      b.onclick = function(){
        var id = b.getAttribute('data-rot');
        var at = (DISP.rotate || []).indexOf(id);
        if (at >= 0) DISP.rotate.splice(at, 1); else (DISP.rotate = DISP.rotate || []).push(id);
        /* Back to the home board whenever the list changes, so what is on
           screen always matches what is ticked. */
        ROT_I = 0;
        if (CFG.storeId !== HOME.id) { CFG.storeId = HOME.id; CFG.storeKey = HOME.key;
          CFG.storeName = HOME.name; CFG.icon = HOME.icon; CFG.brand = HOME.brand;
          CFG.thresholds = HOME.thresholds; SWITCHING = true; loop(); }
        wireTuner();
      };
    });
  }

  function wireTuner(){
    var gear = document.getElementById('gear');
    var tun = document.getElementById('tuner');
    var st = document.getElementById('s-t'), ss = document.getElementById('s-s'), sp = document.getElementById('s-p');
    if (!gear || !tun) return;

    gear.onclick = function(){ tun.classList.toggle('on'); };
    function paintStyleSeg(){
      var bc = document.getElementById('sty-classic'), bb = document.getElementById('sty-bars');
      if (!bc) return;
      bc.className = DISP.style === 'bars' ? '' : 'on';
      bb.className = DISP.style === 'bars' ? 'on' : '';
    }
    paintStyleSeg();
    document.getElementById('sty-classic').onclick = function(){ DISP.style='classic'; paintStyleSeg(); if (LAST) render(LAST); };
    document.getElementById('sty-bars').onclick = function(){ DISP.style='bars'; paintStyleSeg(); if (LAST) render(LAST); };
    function paintBgSeg(){
      var bn = document.getElementById('bg-navy'), bs = document.getElementById('bg-store');
      if (!bn) return;
      bn.className = DISP.bg === 'store' ? '' : 'on';
      bs.className = DISP.bg === 'store' ? 'on' : '';
    }
    paintBgSeg();
    document.getElementById('bg-navy').onclick = function(){ DISP.bg='navy'; paintBgSeg(); applyDisp(); };
    document.getElementById('bg-store').onclick = function(){ DISP.bg='store'; paintBgSeg(); applyDisp(); };
    document.getElementById('tclose').onclick = function(){ tun.classList.remove('on'); };

    /* The rota list. Rebuilt on every open so a ticked store that has since been
       removed from the group does not linger as a dead row. */
    var rl = document.getElementById('rot-list');
    if (rl) {
      /* Which stores this screen can hand over to. Opened from the tool it
         arrives on the payload, because the tool has the config in front of
         it. On a wall there is no config, so the screen reads the one public
         row that carries every store's id and name, with its own anon key,
         the same way it reads a board row.

         Before this the list was empty on every television, which is the one
         place the control was ever meant to be used: the gear offered a rota
         and then told whoever was standing there that the account had one
         store. The rota still ran, because it comes from the published
         display settings, so a wall could be handing over while its own gear
         denied there was anywhere to hand over to. C84. */
      if (CFG.siblings) drawRota(rl, CFG.siblings);
      else {
        rl.innerHTML = '<div class="none">Reading the store list...</div>';
        getStoreByKey(CFG.storesKey || 'lpc:board:stores:v1').then(function(v){
          /* Read and empty is a one-store account. Not read at all is not the
             same thing and must not say it is. Opening the gear again tries
             again, which is what this offers rather than promising a retry
             that nothing would actually perform: the list is fetched when the
             tuner is opened, and the board's own refresh does not carry it. */
          if (!v || v.__err) { rl.innerHTML = '<div class="none">Cannot reach the store list. Close this and open it again to try.</div>'; return; }
          CFG.siblings = ((v.stores) || []).filter(function(x){ return x && x.id !== HOME.id; });
          drawRota(rl, CFG.siblings);
        });
      }
    }

    st.value = Math.round(DISP.tscale * 100);
    ss.value = Math.round(DISP.squeeze * 100);
    sp.value = DISP.pad;

    // text size changes the row maths, so re-render; the others are pure CSS
    st.oninput = function(){ DISP.tscale = st.value / 100; applyDisp(); if (LAST) render(LAST); };
    ss.oninput = function(){ DISP.squeeze = ss.value / 100; applyDisp(); };
    sp.oninput = function(){ DISP.pad = parseFloat(sp.value); applyDisp(); };

    document.getElementById('treset').onclick = function(){
      /* Reset is for the look of the board. The rota is what this screen is FOR,
         so it survives — losing it to a stray tap on Reset would be baffling. */
      DISP = { tscale: 1, squeeze: 1, pad: 0, style: DISP.style, bg: DISP.bg, rotate: DISP.rotate || [] };
      st.value = 100; ss.value = 100; sp.value = 0;
      applyDisp(); if (LAST) render(LAST);
    };

    document.getElementById('tsave').onclick = async function(){
      var msg = document.getElementById('tmsg');
      // The convoy can move on while a save waits. Keep the store and its size
      // from the press together, not whichever store happens to be next.
      var storeId = CFG.storeId;
      var display = JSON.parse(JSON.stringify(DISP));
      var current = LAST;
      try {
        // Always keep it on the screen itself first, so a reboot, a nightly
        // reload or a new build cannot undo what someone set by hand.
        var kept = false;
        try {
          // The home record holds the screen's look, never a visitor's size.
          // Otherwise the legacy migration can give that size to home on reopen.
          var look = {}; for (var k in display) if (k !== 'tscale') look[k] = display[k];
          var sizeKept = tsizeKeep(storeId, display.tscale);
          localStorage.setItem(DKEY, JSON.stringify(look));
          kept = sizeKept;
        } catch (e) {}
        var op = window.opener || (window.parent !== window ? window.parent : null);
        if (op && op.__lpcSaveBoardDisplay) {
          /* The look of the board belongs to the board this screen was opened
             for, HOME, however far round its rota it is. The text size belongs
             to the store on the wall right now, so it is published to that
             store, merged into what it already had. */
          var ok = true;
          if (storeId === HOME.id) {
            ok = await op.__lpcSaveBoardDisplay(HOME.id, display);
          } else {
            var cur = (current && !current.__err && current.boardDisplay) ? current.boardDisplay : {};
            var curNext = {}; for (var ck in cur) curNext[ck] = cur[ck]; curNext.tscale = display.tscale;
            var home = await getStoreByKey(HOME.key);
            // A failed read is not a home size of 100%. Keep the local save and
            // report it as local only instead of publishing an invented size.
            if (!home || home.__err) {
              ok = false;
            } else {
              var homeNext = {}; for (var dk in display) homeNext[dk] = display[dk];
              homeNext.tscale = (home.boardDisplay && home.boardDisplay.tscale != null) ? home.boardDisplay.tscale : 1;
              ok = (await op.__lpcSaveBoardDisplay(storeId, curNext)) && (await op.__lpcSaveBoardDisplay(HOME.id, homeNext));
            }
          }
          msg.textContent = ok ? 'Saved for this store, on every screen.' : (kept ? 'Saved on this screen only.' : 'Could not save.');
        } else {
          msg.textContent = kept ? 'Saved on this screen. Save from the tool to set it everywhere.' : 'Could not save.';
        }
      } catch (e) { msg.textContent = 'Could not save.'; }
      setTimeout(function(){ msg.textContent = ''; }, 4000);
    };
  }

  var LAST = null;   // last store payload, so a text-size change can re-render

  // Data is pulled every 15 minutes. Hitting the database every 30 seconds all day
  // was pointless: the reports only change when a manager uploads one.
  // The clock is separate and ticks every 10 seconds, so the minute on screen is
  // always right regardless of when the data last refreshed.
  loop();
  setInterval(loop, 15 * 60 * 1000);
  setInterval(tick, 10000);
</script></body></html>`;
}
