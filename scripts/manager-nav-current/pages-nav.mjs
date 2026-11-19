import assert from 'node:assert/strict';
export const NAV='.sage-pages-nav';
export const RAIL=NAV+' .sage-pages-rail';
export const PANEL=NAV+' .sage-pages-panel';
export const RAIL_BUTTONS=RAIL+' > button';
export const MENU_BUTTONS=PANEL+' > button';
export const ANCHOR=NAV+',.sect-strip';
export const NAV_BUTTONS=RAIL_BUTTONS+','+MENU_BUTTONS+',.sect-chip';

export const hasPages=page=>page.locator(NAV).isVisible();
const visible=page=>page.locator(NAV);
const toggle=page=>visible(page).getByRole('button',{name:'Pages',exact:true});
const panel=page=>page.locator(PANEL);
const pin=page=>visible(page).locator('.sage-page-pinned');
const importing=page=>visible(page).locator('.sage-page-import');
const nextFrame=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const focused=locator=>locator.evaluate(node=>node===document.activeElement);

async function opened(page) {
  const button=toggle(page);
  if(await button.getAttribute('aria-expanded')!=='true')await button.click();
  await panel(page).waitFor({state:'visible'});
}
async function closed(page) {
  if(await toggle(page).getAttribute('aria-expanded')==='true'){await toggle(page).focus();await page.keyboard.press('Escape');}
  await panel(page).waitFor({state:'hidden'});
  assert.equal(await toggle(page).getAttribute('aria-expanded'),'false');
}
export async function labels(page){
  if(!await hasPages(page))return page.locator('.sect-chip').allTextContents();
  const rows=await panel(page).locator(':scope > button').allTextContents();
  assert.equal(new Set(rows).size,rows.length,'each disclosed destination is unique');
  assert.ok(rows.every(label=>label.trim())&&!rows.includes('Import'),'Import stays independent of Pages');
  return rows;
}
async function selected(page,label,modern) {
  if(modern){
    const isImport=label==='Import';
    const current=visible(page).locator((isImport?'.sage-page-import':'.sage-page-pinned')+'[aria-current="page"]');
    const destination=isImport?current:current.and(visible(page).getByRole('button',{name:label,exact:true}));
    await destination.waitFor({state:'visible'});
    assert.equal(await destination.getAttribute('aria-current'),'page');
  }else await page.waitForFunction(label=>[...document.querySelectorAll('.sect-chip')].some(n=>n.textContent===label&&n.classList.contains('on')),label);
}
export async function activate(page,label,key=null) {
  const modern=await hasPages(page);
  let target;
  if(modern&&label==='Import')target=importing(page);
  else if(modern){await opened(page);target=panel(page).getByRole('button',{name:label,exact:true});}
  else target=page.getByRole('button',{name:label,exact:true}).and(page.locator('.sect-chip'));
  if(key){await target.focus();await page.keyboard.press(key);}else await target.click();
  // A cold destination can briefly hide the whole shell. Keep the mode of
  // the control that actually received the activation.
  await selected(page,label,modern);
  if(modern&&label!=='Import'){
    await panel(page).waitFor({state:'hidden'});
    // A cold lazy route can temporarily hide the shell as well as the panel.
    // Confirm the new route and visible shell before checking the actual focus.
    await toggle(page).waitFor({state:'visible'});
    assert.equal(await toggle(page).getAttribute('aria-expanded'),'false');
    assert.ok(await focused(toggle(page)),'selection restores meaningful focus to Pages');
  }
}
export const openPages=opened;
export const closePages=closed;

export async function geometry(page,{drawer=false,enforce=true,widthMin=44}={}) {
  if(!await hasPages(page))throw Error('Pinned current nav candidate did not render Store pages');
  const selector=drawer?PANEL:RAIL;
  await page.locator(selector).waitFor({state:'visible'});await nextFrame(page);
  const result=await page.locator(selector).evaluate((n,{drawer})=>{
    const rect=(el)=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const outer=rect(n), was=n.scrollLeft;
    n.scrollLeft=9999;const positive=n.scrollLeft;n.scrollLeft=-9999;const negative=n.scrollLeft;n.scrollLeft=was;
    const buttons=[...n.querySelectorAll(':scope > button')].map(b=>{
      const box=rect(b),range=document.createRange();range.selectNodeContents(b);
      const bounds=[...range.getClientRects()].filter(r=>r.width&&r.height).map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom}));
      const points=[[box.x+box.width/2,box.y+box.height/2],[box.x+5,box.y+5],[box.right-5,box.bottom-5]];
      const hits=points.map(([x,y])=>({inView:x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&y>=outer.y&&y<outer.bottom,ok:b.contains(document.elementFromPoint(x,y))}));
      return{text:b.textContent.trim(),box,bounds,hits,selected:b.getAttribute('aria-current')==='page',font:parseFloat(getComputedStyle(b).fontSize)};
    });
    return{outer,drawer,buttons,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,
      innerScrollWidth:n.scrollWidth,clientWidth:n.clientWidth,positive,negative,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight};
  },{drawer});
  if(!enforce)return result;
  const {outer:o,buttons}=result;
  assert.ok(result.scroll<=result.width+1,'Pages does not widen the document');
  assert.ok(result.innerScrollWidth<=result.clientWidth+1&&result.positive===0&&result.negative===0,'Pages does not scroll horizontally');
  assert.ok(o.x>=-1&&o.right<=result.width+1,'Pages fits viewport width');
  if(drawer){assert.ok(buttons.length>0,'drawer exposes actual destinations');assert.ok(o.y>=0&&o.bottom<=result.height+1,'open Pages fits available viewport');}
  else {assert.equal(buttons.length,3,'pinned destination, Import and Pages stay available');assert.equal(buttons.filter(b=>b.selected).length,1,'exactly one destination current while closed');}
  for(const b of buttons) {
    const q=b.box;
    assert.ok(q.width>=widthMin&&q.height>=44,`${b.text}: retains minimum target`);
    assert.ok(q.x>=o.x-1&&q.right<=o.right+1,`${b.text}: horizontally fits container`);
    assert.ok(b.bounds.length&&b.bounds.every(r=>r.x>=q.x-1&&r.right<=q.right+1&&r.y>=q.y-1&&r.bottom<=q.bottom+1),`${b.text}: label and icon stay inside control`);
    assert.ok(b.hits.filter(h=>h.inView).every(h=>h.ok),`${b.text}: visible hit targets aren't obscured`);
    if(!drawer) assert.ok(q.y>=o.y-1&&q.bottom<=o.bottom+1,`${b.text}: controlled wrap fits its rail`);
  }
  for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){
    const a=buttons[i].box,b=buttons[j].box;
    assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=0.5||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=0.5,'visible controls never overlap');
  }
  return result;
}
export async function keyboardPages(page,expected){
  const button=toggle(page), menu=panel(page), first=menu.locator(':scope > button').first();
  assert.ok(await hasPages(page));
  await closed(page);
  assert.equal(await menu.getAttribute('id'),await button.getAttribute('aria-controls'));
  if(expected)assert.deepEqual(await labels(page),expected);
  assert.equal(await menu.isVisible(),false);
  assert.equal(await visible(page).locator('[aria-current=page]:visible').count(),1);
  await button.focus();await page.keyboard.press('Tab');assert.ok(!await menu.evaluate(n=>n.contains(document.activeElement)),'hidden panel is not tabbable');
  for(const key of ['Enter','Space']){
    await button.focus();await page.keyboard.press(key);await menu.waitFor({state:'visible'});
    assert.equal(await button.getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Tab');assert.ok(await focused(first),'open disclosure enters destinations in DOM order');
    assert.ok(await first.evaluate(n=>n.matches(':focus-visible')&&parseFloat(getComputedStyle(n).outlineWidth)>=2),'destination has visible keyboard outline');
    await page.keyboard.press('Shift+Tab');assert.ok(await focused(button),'Shift+Tab reaches Pages, no trap');
    await page.keyboard.press('Tab');await page.keyboard.press('Escape');await closed(page);
    assert.ok(await focused(button),'Escape restores Pages focus');
  }
  await opened(page);
  const drawer=await geometry(page,{drawer:true});
  for(const item of await menu.locator(':scope > button').all()){
    await item.scrollIntoViewIfNeeded();await nextFrame(page);
    assert.ok(await item.evaluate(n=>{const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return n.contains(document.elementFromPoint(x,y));}),
      'every disclosed item has an actual hit target, including scrolled rows');
  }
  await toggle(page).focus();
  await page.keyboard.press('Escape');await closed(page);
  return drawer;
}
