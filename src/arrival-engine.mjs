/** Approved lightspeed drawing. Self-contained for worker and main-thread parity. */
export function arrivalEngineCore(ctx, world, post) {
  const { W, H, dpr, mk, field } = world;
  const cx = W / 2, cy = H / 2, far = Math.hypot(W,H) * .7;
  const clamp = p => Math.max(0,Math.min(1,p));
  const smooth = p => { p=clamp(p); return p*p*(3-2*p); };
  ctx.scale(dpr,dpr);
  const ground = ctx.createRadialGradient(cx,cy,0,cx,cy,far);
  ground.addColorStop(0,'#294B3B'); ground.addColorStop(.4,'#152B22'); ground.addColorStop(1,'#0B1712');
  const palette = ['#d4ebd6','#92bfa6','#eef5dd','#739e86'];
  const random = world.random || Math.random;
  // Depth is spatial, not a repeating left-to-right velocity sequence. A
  // shared camera advances every point equally; near points expand faster
  // because of perspective. Mirrored positions receive the same depth.
  const seedAt = (x,y) => { const n=Math.sin(Math.abs(x)*12.9898+Math.abs(y)*78.233)*43758.5453; return n-Math.floor(n); };
  const visible = field.filter(d => d.x>0 && d.x<W && d.y>0 && d.y<H);
  // Continue the actual grid beyond the crop. The 14% inward pull reveals
  // this border; the old viewport filter left a rectangular empty edge.
  const extended = visible.slice(), first = visible[0];
  const neighbour = first && visible.find(d=>d.y===first.y && d.x>first.x);
  if(neighbour){
    const pitch=neighbour.x-first.x,cols=Math.ceil((W-first.x)/pitch);
    const padX=W*.5*(1/.86-1)+pitch,padY=H*.5*(1/.86-1)+pitch;
    for(let iy=Math.floor((-padY-first.y)/pitch);first.y+iy*pitch<H+padY;iy++){
      for(let ix=Math.floor((-padX-first.x)/pitch);first.x+ix*pitch<W+padX;ix++){
        const x=first.x+ix*pitch,y=first.y+iy*pitch;
        if(x>0 && x<W && y>0 && y<H)continue;
        const source=visible[((iy*cols+ix)%visible.length+visible.length)%visible.length];
        extended.push({x,y,size:source.size,tint:source.tint});
      }
    }
  }
  const points = extended.map((d,i) => {
    const seed=seedAt(d.x-cx,d.y-cy),depth=.8+seed*.8;
    return {x:d.x-cx,y:d.y-cy,r:d.size/2,color:d.tint,light:palette[i%4],z:depth,depth,seed,mark:false};
  });
  for (const d of mk) {
    const seed=seedAt(d.sx-cx,d.sy-cy),depth=.8+seed*.8;
    points.push({x:d.hx-cx,y:d.hy-cy,r:d.hr,color:d.fill,
      sx:d.sx-cx,sy:d.sy-cy,sr:d.sr,light:palette[2],z:depth,depth,seed,mark:true});
  }
  // Build exposure colors once, not a new color string for every star/frame.
  const ramps=new Map();
  for(const p of points){
    const key=p.color+p.light;
    if(!ramps.has(key)){
      const parse=c=>c.startsWith('#')?[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16),1]:c.match(/[\d.]+/g).map(Number);
      const from=parse(p.color),to=parse(p.light);
      ramps.set(key,Array.from({length:33},(_,i)=>'rgba('+from.map((n,j)=>n+(to[j]-n)*i/32).join(',')+')'));
    }
    p.ramp=ramps.get(key);
  }
  let start=null,last=null,phase='ratchet',ready=false,done=false,painted=false,cruiseStart=0,exitStart=0;
  let destination='',shownName='',signStarted=null;
  let logoRemaining=mk.length;
  let frames=0,drawTotal=0,drawMax=0,previousDraw=null,gaps=0;
  const setPhase = next => { if(phase!==next){phase=next;post('phase',next);} };
  const finish = () => { if(done)return; done=true; post('metrics',{particles:points.length,logoDots:mk.length,logoDeparted:mk.length-logoRemaining,frames,drawAverageMs:frames?drawTotal/frames:0,drawMaxMs:drawMax,frameGapsOver25Ms:gaps}); post('flash'); };
  const tick = now => {
    if(done)return;
    // A late destination still gets its readable title. Do not add another
    // minimum cruise when the manager has already waited for the connection.
    if(phase==='waiting'){if(ready){cruiseStart=now-360;last=now;setPhase('cruise');}else return;}
    if(start===null){start=now+(world.lead||0);last=now;}
    const elapsed=now-start,dt=Math.min(.035,Math.max(0,(now-last)/1000)); last=now;
    if(elapsed<0)return;
    const stamp=typeof performance!=='undefined'?performance.now():now;
    if(previousDraw!==null && now-previousDraw>25)gaps++;
    previousDraw=now;
    // A short anticipation is followed by a fast departure, not three separate
    // eased animations restarting from zero speed.
    if(elapsed>=140 && phase==='ratchet')setPhase('reform');
    if(elapsed>=880 && phase==='reform')setPhase('streaks');
    if(elapsed>=1600 && phase==='streaks'){cruiseStart=now;setPhase('cruise');}
    // The title's readability backing must not conceal the departing logo.
    if(phase==='cruise' && logoRemaining===0 && destination && destination!==shownName){
      shownName=destination;signStarted=now;post('destination',destination);
    }
    // Let the manager read the destination. Repeated readiness messages must
    // not restart this beat, and an absent name must not hold sign-in forever.
    const signRead=!destination || (signStarted!==null && now-signStarted>=1400);
    if(phase==='cruise' && ready && now-cruiseStart>=360 && signRead){exitStart=now;setPhase('burst');}
    if(phase==='cruise' && now-cruiseStart>=2600){setPhase('waiting');return;}
    const gather=smooth((elapsed-140)/740), launch=clamp((elapsed-880)/720);
    const exit=phase==='burst'?clamp((now-exitStart)/520):0;
    const exposure=smooth((elapsed-300)/780);
    const velocity=(.06+Math.pow(launch,2.6)*1.45)*(1+exit*3.4);
    ctx.clearRect(0,0,W,H);
    ctx.globalAlpha=exposure;ctx.fillStyle=ground;ctx.fillRect(0,0,W,H);
    ctx.globalAlpha=1;
    for(const p of points){
      let x=p.x,y=p.y,r=p.r;
      if(p.mark){x+=(p.sx-x)*gather;y+=(p.sy-y)*gather;r+=(p.sr-r)*gather;}
      else {x*=1-gather*.14;y*=1-gather*.14;}
      if(launch>0){
        p.z-=dt*velocity;
        // The narrow 2.3..2.5 reset depth synchronised the second pass into
        // waves. Each expired point now gets a fresh independent lifetime,
        // bearing and depth. Its new ray fades in, never slides sideways.
        // Reuse the same object; the pool does not grow while travelling.
        // The compact logo is much nearer the axis than the field. Its rays
        // must pass the camera, not recycle while still inside the small S.
        if(p.mark ? p.departed : p.z<.08){
          const angle=random()*Math.PI*2,radius=far*(.15+random()*.7);
          p.depth=1;p.z=.6+random()*4.2;p.birthZ=p.z;
          p.x=Math.cos(angle)*radius/.86;p.y=Math.sin(angle)*radius/.86;
          p.mark=false;p.r=.8+random()*1.2;
          x=p.x*.86;y=p.y*.86;r=p.r;
        }
      }
      const near=p.mark?.00001:.08;
      const zoom=p.depth/Math.max(near,p.z),distance=Math.hypot(x,y)||1;
      const projected=distance*zoom;
      const shutter=(.006+launch*.095)*(1+exit*.6);
      const tail=distance*p.depth/Math.max(near,p.z+velocity*shutter);
      if(p.mark && tail>far*1.65){p.departed=true;logoRemaining--;continue;}
      if(!p.mark && projected>far*1.65)continue;
      // Clip the exposure to a finite offscreen radius, retaining its tail
      // until that too has left. No giant coordinates or new drawing layers.
      const head=p.mark?Math.min(projected,far*1.65):projected;
      const ux=x/distance,uy=y/distance;
      const alpha=(p.birthZ===undefined?1:smooth((p.birthZ-p.z)/.22))*(p.mark?1:.4+.6*exposure);
      const width=Math.min(4.5,Math.max(.65,r*(.5+zoom*.25)));
      ctx.globalAlpha=alpha;
      ctx.strokeStyle=p.ramp[Math.round(exposure*32)];
      ctx.fillStyle=ctx.strokeStyle;
      if(head-tail<2){ctx.beginPath();ctx.arc(cx+x*zoom,cy+y*zoom,Math.max(.6,r*Math.min(1.4,zoom)),0,7);ctx.fill();}
      else {
        // Two nested line segments are a tapered exposure, without blur,
        // shadow filters, extra canvases or hundreds of DOM layers.
        ctx.lineCap='round';
        for(let layer=0;layer<2;layer++){
          const a=tail+(head-tail)*layer*.32;
          ctx.globalAlpha=alpha*(layer===0?.25:.94);
          ctx.lineWidth=width*(1-layer*.55);
          ctx.beginPath();ctx.moveTo(cx+ux*a,cy+uy*a);ctx.lineTo(cx+ux*head,cy+uy*head);ctx.stroke();
        }
      }
    }
    ctx.globalAlpha=1;
    if(!painted){painted=true;post('paint');}
    frames++;
    const cost=(typeof performance!=='undefined'?performance.now():now)-stamp;
    drawTotal+=cost;drawMax=Math.max(drawMax,cost);
    if(exit>=1)finish();
  };
  return {tick,sleeping:()=>done || (phase==='waiting' && !ready),msg:m=>{
    if(m.type==='ready')ready=!!m.ready;
    if(m.type==='dest'){
      destination=typeof m.dest?.name==='string'?m.dest.name.trim():'';
      if(!destination && shownName){shownName='';signStarted=null;post('destination','');}
    }
    if(m.type==='stop')done=true;
  }};
}
