/** Approved study styles, installed only for an explicit sign-in. */
export const ARRIVAL_CSS = `
html { scrollbar-gutter:stable; }
html.sage-flight-lock, html.sage-flight-lock body { overflow:hidden !important; }
html.sage-flight-lock .lpc, html.sage-flight-lock .lpc * { pointer-events:none !important; }
html.sage-flight-hover-hold :is(.bloopwin,.fbc-hover,.tr-tip,[role="tooltip"]) { visibility:hidden !important; }

@keyframes saRadial {
  0% { opacity:0; transform:translate3d(calc(var(--rx,0px) * .20),calc(var(--ry,0px) * .20),0) scale(.78); }
  22% { opacity:1; }
  82% { opacity:1; transform:translate3d(calc(var(--rx,0px) * -.006),calc(var(--ry,0px) * -.006),0) scale(1.003); }
  100% { opacity:1; transform:none; }
}
.sage-assemble .lpc { animation:none; }
.sage-assemble .sa-radial { --rd:40ms !important; }
@keyframes saCloudDrop {
  from { transform:translateY(-32px) scale(1.10); }
  to { transform:none; }
}
.sage-arrival-scan { position:fixed; inset:0; z-index:9000; pointer-events:none; overflow:hidden; }
.sage-arrival-scan::before { content:""; position:absolute; top:0; left:0; width:100%; height:18vh; opacity:0;
  background:linear-gradient(to bottom,transparent 15%,rgba(213,245,220,.045) 60%,rgba(228,255,232,.16) 96%,rgba(245,255,240,.22) 98%,transparent 100%); }

.sage-preparing .sage-arrival-scan::before { animation-play-state:paused; }
@keyframes sageArrivalScan {
  0% { opacity:0; transform:translateY(-20vh); }
  12% { opacity:1; }
  82% { opacity:1; }
  100% { opacity:0; transform:translateY(100vh); }
}
@media(prefers-reduced-motion:reduce) {
  .sage-arrival-scan { display:none; }
  .sage-assemble .lpc, .sage-assemble .sg-blobs { animation:none !important; }
  @keyframes saRadial { from { opacity:0; transform:none; } to { opacity:1; transform:none; } }
}

.sage-arrival-wait { position:fixed; inset:0; z-index:9400; display:grid; place-items:center; padding:28px;
  background:radial-gradient(ellipse at center,rgba(11,23,18,.97) 0,rgba(11,23,18,.90) 25%,rgba(11,23,18,.22) 80%); color:#e5efdf;
  animation:proposalWaitIn .42s ease-out both; }
.sage-arrival-wait[hidden] { display:none; }
.sage-arrival-wait article { width:min(440px,100%); text-align:center; }
.sage-arrival-wait img { width:66px; height:66px; object-fit:contain; margin-bottom:20px; }
.sage-arrival-wait h1 { font-size:clamp(23px,4vw,32px); line-height:1.16; letter-spacing:-1px; margin:0 0 12px; outline:none; }
.sage-arrival-wait p { font-size:15px; line-height:1.5; color:#c0d3c6; margin:0 auto 24px; max-width:340px; }
.sage-arrival-wait button { font:inherit; border:1px solid #b5c7b8; border-radius:12px; background:#fff; color:#284333; padding:12px 18px; cursor:pointer; }
.sage-arrival-wait button:focus-visible { outline:3px solid #a96b13; outline-offset:3px; }
.sage-arrival-wait button.primary { background:#d9ebbd; border-color:#d9ebbd; color:#162b1d; margin-right:8px; }
.sage-arrival-wait article { animation:proposalWaitText .6s cubic-bezier(.16,1,.3,1) both; }
.sage-arrival-waiting .sage-jump-canvas { visibility:visible; }
.sage-flight-reduce .sage-arrival-wait { background:#152b22; animation:none; }
.sage-arrival-wait.no-flight { background:#152b22; }
.sage-flight-reduce .sage-arrival-wait article { animation:none; }
@keyframes proposalWaitIn { from{opacity:0} to{opacity:1} }
@keyframes proposalWaitText { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
@media(prefers-reduced-motion:reduce){.sage-arrival-wait{background:#152b22;animation:none}.sage-arrival-wait article{animation:none}}
.sage-flight-reduce .sage-arrival-scan { display:none; }
.sage-flight-reduce .sage-assemble .lpc, .sage-flight-reduce .sage-assemble .lpc * { animation:none !important; }

/* overflow:hidden alone keeps a stable gutter visible. Hold the content width
   separately so the full-bleed flight has no rail and landing has no reflow. */
html.sage-flight-owned.sage-flight-lock { scrollbar-gutter:auto; }
html.sage-flight-owned.sage-flight-lock body { width:calc(100% - var(--arrival-scrollbar-width,0px)); }
/* Same settled dashboard, a stronger common perspective on the way in. */
@keyframes saRadial {
  0% { opacity:0; transform:translate3d(calc(var(--rx,0px) * .46),calc(var(--ry,0px) * .46),0) scale(.54); animation-timing-function:cubic-bezier(.12,.76,.19,1); }
  20% { opacity:1; }
  78% { opacity:1; transform:translate3d(calc(var(--rx,0px) * -.012),calc(var(--ry,0px) * -.012),0) scale(1.012); animation-timing-function:cubic-bezier(.3,0,.4,1); }
  100% { opacity:1; transform:none; }
}
.sage-assemble .sa-radial { --rd:0ms !important; }
/* The dashboard's cleanup must not cancel a scan still finishing on the next
   rendered frame. This class belongs to the scan, not the assembly timer. */
.sage-flight-owned .sage-arrival-scan::before { animation:none; }
.sage-flight-owned.sage-flight-scan .sage-arrival-scan::before { animation:sageArrivalScan .86s cubic-bezier(.22,.5,.32,1) .52s both; }
.sage-flight-owned.sage-preparing .sage-arrival-scan::before { animation-play-state:paused; }
.sage-flight-owned .login-card { transform-origin:50% 50%; }
.sage-flight-owned .sage-arrival-wait button { margin-top:5px; margin-bottom:5px; }
.sage-arrival-destination { position:fixed; z-index:301; pointer-events:none; left:var(--jx,50%); top:var(--jy,50%); width:min(680px,calc(100% - 48px)); transform:translate(-50%,-50%); opacity:0; visibility:hidden; transition:opacity 350ms ease,visibility 0s 350ms; }
.sage-arrival-destination::before { content:''; position:absolute; inset:-100px -24px; background:radial-gradient(ellipse,#152b22 0%,rgba(21,43,34,.92) 25%,rgba(21,43,34,0) 70%); }
.sage-arrival-destination span { position:relative; display:block; text-align:center; font:600 clamp(24px,4.5vw,48px)/1.12 var(--font-display,'Space Grotesk',sans-serif); letter-spacing:-.035em; color:#eef5dd; overflow-wrap:anywhere; text-wrap:balance; transform:scale(.94); transition:transform 650ms cubic-bezier(.16,1,.3,1); }
.sage-arrival-destination[data-state=show] { opacity:1; visibility:visible; transition:opacity 350ms ease; }
.sage-arrival-destination[data-state=show] span { transform:scale(1); }
.sage-arrival-destination[data-state=exit] span { transform:scale(1.1); transition:transform 350ms cubic-bezier(.4,0,1,1); }
.sage-arrival-waiting .sage-arrival-destination,.sage-cover-active .sage-arrival-destination,.sage-flight-reduce .sage-arrival-destination { display:none; }
@media(prefers-reduced-motion:reduce){.sage-arrival-destination{display:none}}
@media(prefers-reduced-motion:reduce){@keyframes saRadial {from{opacity:0;transform:none}to{opacity:1;transform:none}}}
`;

