/* ============================================================
   NetSaver — Application Logic
   Infinite canvas map of categories & sites + account vault
   Auto-save via native bridge (falls back to localStorage)
   ============================================================ */
'use strict';

/* ---------- State ---------- */
const State = {
  categories: [],   // {id, name, x, y}
  sites: [],        // {id, catId, name, url, x, y}
  accounts: [],     // {id, site, username, password, notes}
  view: { x: 0, y: 0, scale: 1 },
  _seq: 1
};
function uid(){ return 'n' + (Date.now().toString(36)) + (State._seq++).toString(36) + Math.floor(Math.random()*1296).toString(36); }

/* ---------- Native bridge (WebView) with localStorage fallback ---------- */
const STORE_KEY = 'netsaver_data_v1';
const Native = {
  has(){ return typeof window.saveData === 'function' && typeof window.loadData === 'function'; },
  async save(json){
    try{
      if (this.has()){ await window.saveData(json); return; }
    }catch(e){ console.warn('native save failed', e); }
    try{ localStorage.setItem(STORE_KEY, json); }catch(e){}
  },
  async load(){
    try{
      if (this.has()){
        const r = await window.loadData();
        if (r && r !== 'null' && r.length) return r;
      }
    }catch(e){ console.warn('native load failed', e); }
    try{ return localStorage.getItem(STORE_KEY); }catch(e){ return null; }
  }
};

/* ---------- Auto-save (debounced + coalesced + status) ----------
   Design goals (low memory / low disk churn):
   - Always writes to ONE single file that is overwritten in place
     (handled natively in C++); never keeps multiple snapshots/history.
   - Coalesces bursts of changes (drag, pan, zoom) into a single write via a
     debounce, and skips the write entirely when nothing actually changed
     (dirty-check against the last serialized payload).                       */
let saveTimer = null;
let saving = false;          // a native write is currently in flight
let pendingDirty = false;    // changes arrived while a write was in flight
let lastSerialized = null;   // last payload we wrote (for dirty-check)
const saveStatus = document.getElementById('saveStatus');

function setStatus(s){
  if(s==='saving'){ saveStatus.className='saving'; saveStatus.textContent='● SAVING…'; }
  else if(s==='saved'){ saveStatus.className='saved'; saveStatus.textContent='● SAVED'; }
}
function serialize(){
  // savedAt is intentionally NOT included in the payload used for the
  // dirty-check, so identical state never triggers a needless re-write.
  return JSON.stringify({
    v:1, categories:State.categories, sites:State.sites,
    accounts:State.accounts, view:State.view, _seq:State._seq
  });
}

async function flushSave(){
  const payload = serialize();
  if (payload === lastSerialized){       // nothing changed -> no disk write
    setStatus('saved');
    return;
  }
  if (saving){ pendingDirty = true; return; }  // coalesce into the in-flight write
  saving = true;
  setStatus('saving');
  try{
    await Native.save(payload);
    lastSerialized = payload;
    document.getElementById('statSaved').textContent = new Date().toLocaleTimeString();
  }catch(e){ console.warn('save failed', e); }
  saving = false;
  setStatus('saved');
  refreshStats();
  if (pendingDirty){ pendingDirty = false; flushSave(); }  // pick up coalesced changes
}

function autoSave(){
  setStatus('saving');
  if (saveTimer) clearTimeout(saveTimer);
  // 600ms debounce comfortably coalesces continuous drag / pan / zoom streams
  // into a single write instead of thousands of tiny writes.
  saveTimer = setTimeout(flushSave, 600);
}

/* ---------- Load ---------- */
async function loadState(){
  const raw = await Native.load();
  if (raw){
    try{
      const d = JSON.parse(raw);
      State.categories = d.categories||[];
      State.sites = d.sites||[];
      State.accounts = d.accounts||[];
      State.view = d.view||{x:0,y:0,scale:1};
      State._seq = d._seq||1;
    }catch(e){ console.warn('parse failed', e); }
  }
  if (!State.categories.length && !State.sites.length && !State.accounts.length){
    seedDemo();
  }
  // Seed the dirty-check baseline so the very first interaction doesn't trigger
  // a redundant write of unchanged data.
  lastSerialized = serialize();
  renderAll();
  applyView();
}

function seedDemo(){
  const c1 = {id:uid(), name:'Development', x:-260, y:-120};
  const c2 = {id:uid(), name:'Social', x:120, y:120};
  State.categories.push(c1, c2);
  State.sites.push(
    {id:uid(), catId:c1.id, name:'GitHub', url:'https://github.com', x:-280, y:90},
    {id:uid(), catId:c1.id, name:'Stack Overflow', url:'https://stackoverflow.com', x:-60, y:90},
    {id:uid(), catId:c2.id, name:'X / Twitter', url:'https://x.com', x:120, y:330}
  );
  State.accounts.push(
    {id:uid(), site:'GitHub', username:'neo@matrix.io', password:'Tr1n1ty#2099', notes:'Main dev account.\n2FA enabled (Authenticator).'}
  );
}

/* ============================================================
   MAP — infinite canvas
   ============================================================ */
const canvasWrap = document.getElementById('canvasWrap');
const world      = document.getElementById('world');
const linkSvg    = document.getElementById('linkSvg');
const gridCanvas = document.getElementById('gridCanvas');
const gctx       = gridCanvas.getContext('2d');
const zoomBadge  = document.getElementById('zoomBadge');

const MIN_SCALE = 0.15, MAX_SCALE = 3.5;

function applyView(){
  const {x,y,scale} = State.view;
  world.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  // The SVG layer is NOT CSS-scaled — it stays in screen space and we project
  // node coordinates into it. This keeps the connector lines perfectly glued
  // to the nodes at every zoom level (no drift / detachment).
  zoomBadge.textContent = Math.round(scale*100) + '%';
  drawGrid();
  renderLinks();
}

/* world<->screen helpers */
function screenToWorld(sx, sy){
  return { x:(sx - State.view.x)/State.view.scale, y:(sy - State.view.y)/State.view.scale };
}

/* ---- animated dotted grid background ---- */
function resizeCanvas(){
  gridCanvas.width = canvasWrap.clientWidth;
  gridCanvas.height = canvasWrap.clientHeight;
  drawGrid();
  renderLinks();
}
function drawGrid(){
  const w = gridCanvas.width, h = gridCanvas.height;
  gctx.clearRect(0,0,w,h);
  const s = State.view.scale;
  let step = 48 * s;
  while(step < 26) step *= 2;
  while(step > 120) step /= 2;
  const ox = ((State.view.x % step)+step)%step;
  const oy = ((State.view.y % step)+step)%step;
  // fine grid
  gctx.strokeStyle = 'rgba(0,255,213,0.045)';
  gctx.lineWidth = 1;
  gctx.beginPath();
  for(let x=ox; x<w; x+=step){ gctx.moveTo(x,0); gctx.lineTo(x,h); }
  for(let y=oy; y<h; y+=step){ gctx.moveTo(0,y); gctx.lineTo(w,y); }
  gctx.stroke();
  // bold grid every 4
  const big = step*4;
  const bx = ((State.view.x % big)+big)%big;
  const by = ((State.view.y % big)+big)%big;
  gctx.strokeStyle = 'rgba(0,255,213,0.10)';
  gctx.beginPath();
  for(let x=bx; x<w; x+=big){ gctx.moveTo(x,0); gctx.lineTo(x,h); }
  for(let y=by; y<h; y+=big){ gctx.moveTo(0,y); gctx.lineTo(w,y); }
  gctx.stroke();
  // dots at intersections
  gctx.fillStyle = 'rgba(0,255,213,0.18)';
  for(let x=bx; x<w; x+=big){
    for(let y=by; y<h; y+=big){
      gctx.beginPath(); gctx.arc(x,y,1.4,0,7); gctx.fill();
    }
  }
}

/* ============================================================
   RENDERING NODES
   ============================================================ */
function renderAll(){
  world.innerHTML = '';
  // categories
  State.categories.forEach(c => world.appendChild(buildCategoryEl(c)));
  // sites
  State.sites.forEach(s => world.appendChild(buildSiteEl(s)));
  renderLinks();
  refreshStats();
  applySearchFilter();
}

function buildCategoryEl(c){
  const el = document.createElement('div');
  el.className='node category';
  el.dataset.id=c.id; el.dataset.type='cat';
  el.style.left=c.x+'px'; el.style.top=c.y+'px';
  const count = State.sites.filter(s=>s.catId===c.id).length;
  el.innerHTML = `
    <div class="chead">
      <div class="cicon">⬡</div>
      <div class="ctitle">${esc(c.name)}</div>
      <div class="cbadge">${count}</div>
    </div>
    <div class="anchor"></div>`;
  return el;
}

function buildSiteEl(s){
  const el = document.createElement('div');
  el.className='node site';
  el.dataset.id=s.id; el.dataset.type='site';
  el.style.left=s.x+'px'; el.style.top=s.y+'px';
  const initial = (s.name||'?').trim().charAt(0).toUpperCase() || '?';
  el.innerHTML = `
    <div class="shead">
      <div class="sfav">${esc(initial)}</div>
      <div class="sname">${esc(s.name)}</div>
    </div>
    <div class="surl" title="${esc(s.url)}">${esc(s.url||'')}</div>`;
  return el;
}

/* ---- connecting lines (animated neon) ----
   Coordinates are computed in WORLD space (a node's left/top is already the
   world coordinate because #world holds the transform) and then projected to
   SCREEN space, because the SVG layer is full-screen and never CSS-scaled.
   This guarantees the line stays exactly attached to the nodes at any zoom. */
function nodeBox(id){
  const el = world.querySelector(`[data-id="${id}"]`);
  if(!el) return null;
  // offsetLeft/Top/Width/Height are in the un-scaled world coordinate system.
  return { left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
}
function worldToScreen(wx, wy){
  return { x: State.view.x + wx*State.view.scale, y: State.view.y + wy*State.view.scale };
}

// We reuse SVG elements between renders (pooling) so auto-save / zoom / drag
// don't thrash the DOM. The pool only grows/shrinks when the link count changes.
const linkPool = []; // each: {glow, path, dot, d:{x1,y1,x2,y2,my}}

function ensurePool(n){
  while (linkPool.length < n){
    const NS='http://www.w3.org/2000/svg';
    const glow=document.createElementNS(NS,'path');
    glow.setAttribute('fill','none'); glow.setAttribute('stroke','url(#lineGrad)');
    glow.setAttribute('opacity','0.25'); glow.setAttribute('filter','url(#glow)');
    const path=document.createElementNS(NS,'path');
    path.setAttribute('fill','none'); path.setAttribute('stroke','url(#lineGrad)');
    path.setAttribute('stroke-linecap','round'); path.classList.add('flow');
    const dot=document.createElementNS(NS,'circle'); dot.setAttribute('fill','#fff');
    linkSvg.appendChild(glow); linkSvg.appendChild(path); linkSvg.appendChild(dot);
    linkPool.push({glow, path, dot, d:null});
  }
  // hide any extras
  for (let i=n; i<linkPool.length; i++){
    linkPool[i].glow.style.display='none';
    linkPool[i].path.style.display='none';
    linkPool[i].dot.style.display='none';
    linkPool[i].d=null;
  }
}

function renderLinks(){
  ensurePool(State.sites.length);
  const sc = State.view.scale;
  let i = 0;
  State.sites.forEach(s=>{
    const cb = nodeBox(s.catId), sb = nodeBox(s.id);
    const item = linkPool[i];
    if(!cb||!sb){ if(item){item.glow.style.display='none';item.path.style.display='none';item.dot.style.display='none';item.d=null;} i++; return; }
    // world-space anchors: category bottom-center -> site top-center
    const wp1 = { x: cb.left + cb.w/2, y: cb.top + cb.h };
    const wp2 = { x: sb.left + sb.w/2, y: sb.top };
    // project to screen
    const p1 = worldToScreen(wp1.x, wp1.y);
    const p2 = worldToScreen(wp2.x, wp2.y);
    const my = (p1.y + p2.y)/2;
    const d = `M ${p1.x} ${p1.y} C ${p1.x} ${my}, ${p2.x} ${my}, ${p2.x} ${p2.y}`;
    item.glow.setAttribute('d', d); item.glow.style.display='';
    item.glow.setAttribute('stroke-width', (4*sc).toFixed(2));
    item.path.setAttribute('d', d); item.path.style.display='';
    item.path.setAttribute('stroke-width', (2*sc).toFixed(2));
    const dash = (7*sc).toFixed(2)+' '+(9*sc).toFixed(2);
    item.path.setAttribute('stroke-dasharray', dash);
    item.dot.style.display=''; item.dot.setAttribute('r', (3*sc).toFixed(2));
    item.d = { x1:p1.x, y1:p1.y, x2:p2.x, y2:p2.y, my };
    i++;
  });
}

/* animate dash flow + pulse dots */
let flowOffset = 0;
function animateLinks(){
  flowOffset = (flowOffset - 0.9);
  const t = (performance.now()/1400) % 1;
  const op = (0.4 + 0.6*Math.sin(t*Math.PI)).toFixed(2);
  for (const item of linkPool){
    if (!item.d) continue;
    item.path.style.strokeDashoffset = flowOffset;
    const p = cubicPoint(item.d.x1,item.d.y1, item.d.x1,item.d.my, item.d.x2,item.d.my, item.d.x2,item.d.y2, t);
    item.dot.setAttribute('cx', p.x); item.dot.setAttribute('cy', p.y);
    item.dot.setAttribute('opacity', op);
  }
  requestAnimationFrame(animateLinks);
}
function cubicPoint(x1,y1,cx1,cy1,cx2,cy2,x2,y2,t){
  const mt=1-t;
  const x = mt*mt*mt*x1 + 3*mt*mt*t*cx1 + 3*mt*t*t*cx2 + t*t*t*x2;
  const y = mt*mt*mt*y1 + 3*mt*mt*t*cy1 + 3*mt*t*t*cy2 + t*t*t*y2;
  return {x,y};
}

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ============================================================
   INTERACTIONS — pan / zoom / scroll / drag nodes
   ============================================================ */
let isPanning=false, panStart=null;
let dragNode=null, dragStart=null, dragMoved=false;

/* mouse down on canvas */
canvasWrap.addEventListener('mousedown', e=>{
  if (e.button!==0) return;              // left only for pan/drag
  const nodeEl = e.target.closest('.node');
  if (nodeEl){
    // start dragging a node
    dragNode = nodeEl;
    dragNode.classList.add('dragging');
    const wpt = screenToWorld(e.clientX, e.clientY);
    dragStart = { mx:wpt.x, my:wpt.y, nx:nodeEl.offsetLeft, ny:nodeEl.offsetTop };
    dragMoved = false;
    e.preventDefault();
    return;
  }
  // otherwise pan
  isPanning=true; canvasWrap.classList.add('panning');
  panStart = { x:e.clientX, y:e.clientY, vx:State.view.x, vy:State.view.y };
});

window.addEventListener('mousemove', e=>{
  if (dragNode){
    const wpt = screenToWorld(e.clientX, e.clientY);
    let nx = dragStart.nx + (wpt.x - dragStart.mx);
    let ny = dragStart.ny + (wpt.y - dragStart.my);
    if (Math.abs(wpt.x-dragStart.mx)>1 || Math.abs(wpt.y-dragStart.my)>1) dragMoved=true;
    dragNode.style.left = nx+'px';
    dragNode.style.top  = ny+'px';
    renderLinks();   // line follows in real time
    return;
  }
  if (isPanning){
    State.view.x = panStart.vx + (e.clientX - panStart.x);
    State.view.y = panStart.vy + (e.clientY - panStart.y);
    applyView();
  }
});

window.addEventListener('mouseup', e=>{
  if (dragNode){
    dragNode.classList.remove('dragging');
    if (dragMoved){
      const id = dragNode.dataset.id, type = dragNode.dataset.type;
      const nx = dragNode.offsetLeft, ny = dragNode.offsetTop;
      if (type==='cat'){ const c=State.categories.find(c=>c.id===id); if(c){c.x=nx;c.y=ny;} }
      else { const s=State.sites.find(s=>s.id===id); if(s){s.x=nx;s.y=ny;} }
      autoSave();
    }
    dragNode=null;
  }
  if (isPanning){ isPanning=false; canvasWrap.classList.remove('panning'); autoSave(); }
});

/* wheel: scroll vertical / shift=horizontal / ctrl=zoom */
canvasWrap.addEventListener('wheel', e=>{
  e.preventDefault();
  if (e.ctrlKey){
    // zoom to cursor
    const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, State.view.scale*factor));
    const rect = canvasWrap.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    // keep world point under cursor stable
    const wx = (cx - State.view.x)/State.view.scale;
    const wy = (cy - State.view.y)/State.view.scale;
    State.view.scale = newScale;
    State.view.x = cx - wx*newScale;
    State.view.y = cy - wy*newScale;
    applyView();
    autoSave();
  } else {
    // scroll page up/down (and horizontal with shift)
    if (e.shiftKey){ State.view.x -= e.deltaY; }
    else { State.view.y -= e.deltaY; State.view.x -= e.deltaX; }
    applyView();
    autoSave();
  }
}, {passive:false});

/* touchpad pinch (ctrl emulation handled above). Double-click empty = create */
canvasWrap.addEventListener('dblclick', e=>{
  if (e.target.closest('.node')) return;
});

/* open url on site url click */
world.addEventListener('click', e=>{
  const urlEl = e.target.closest('.surl');
  if (urlEl && !dragMoved){
    const siteEl = e.target.closest('.site');
    const s = State.sites.find(s=>s.id===siteEl.dataset.id);
    if (s && s.url){ try{ window.open(s.url, '_blank'); }catch(_){} }
  }
});

/* ============================================================
   CONTEXT MENU
   ============================================================ */
const ctxMenu = document.getElementById('ctxMenu');
let ctxWorldPt = {x:0,y:0};

canvasWrap.addEventListener('contextmenu', e=>{
  e.preventDefault();
  const nodeEl = e.target.closest('.node');
  ctxWorldPt = screenToWorld(e.clientX, e.clientY);
  if (nodeEl && nodeEl.dataset.type==='cat'){
    openCtx(e.clientX, e.clientY, catMenu(nodeEl.dataset.id));
  } else if (nodeEl && nodeEl.dataset.type==='site'){
    openCtx(e.clientX, e.clientY, siteMenu(nodeEl.dataset.id));
  } else {
    openCtx(e.clientX, e.clientY, [
      {ic:'⬡', label:'Create Category', act:()=>promptCreateCategory(ctxWorldPt.x, ctxWorldPt.y)},
      {sep:true},
      {ic:'⊹', label:'Reset View', act:resetView},
      {ic:'⊡', label:'Fit All', act:fitView}
    ]);
  }
});

function catMenu(id){
  return [
    {ic:'➕', label:'Add Site', act:()=>promptAddSite(id)},
    {ic:'✎', label:'Edit Category', act:()=>promptEditCategory(id)},
    {sep:true},
    {ic:'🗑', label:'Delete Category', danger:true, act:()=>deleteCategory(id)}
  ];
}
function siteMenu(id){
  return [
    {ic:'↗', label:'Open Site', act:()=>{const s=State.sites.find(s=>s.id===id); if(s&&s.url) window.open(s.url,'_blank');}},
    {ic:'✎', label:'Edit Site', act:()=>promptEditSite(id)},
    {sep:true},
    {ic:'🗑', label:'Delete Site', danger:true, act:()=>deleteSite(id)}
  ];
}

function openCtx(x,y,items){
  ctxMenu.innerHTML='';
  items.forEach(it=>{
    if (it.sep){ const s=document.createElement('div'); s.className='sep'; ctxMenu.appendChild(s); return; }
    const d=document.createElement('div');
    d.className='mi'+(it.danger?' danger':'');
    d.innerHTML=`<span class="ic">${it.ic||''}</span><span>${it.label}</span>`;
    d.onclick=()=>{ hideCtx(); it.act(); };
    ctxMenu.appendChild(d);
  });
  ctxMenu.style.display='block';
  const mw=ctxMenu.offsetWidth, mh=ctxMenu.offsetHeight;
  ctxMenu.style.left=Math.min(x, innerWidth-mw-8)+'px';
  ctxMenu.style.top =Math.min(y, innerHeight-mh-8)+'px';
}
function hideCtx(){ ctxMenu.style.display='none'; }
window.addEventListener('click', hideCtx);
window.addEventListener('scroll', hideCtx, true);

/* ============================================================
   MODAL SYSTEM
   ============================================================ */
function modal(title, fieldsHtml, onSubmit, submitLabel){
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal"><h3>${title}</h3><form>${fieldsHtml}
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">${submitLabel||'Save'}</button>
    </div></form></div>`;
  document.body.appendChild(bg);
  requestAnimationFrame(()=>bg.classList.add('show'));
  const form=bg.querySelector('form');
  const close=()=>{ bg.classList.remove('show'); setTimeout(()=>bg.remove(),200); };
  bg.querySelector('[data-cancel]').onclick=close;
  bg.addEventListener('mousedown', e=>{ if(e.target===bg) close(); });
  form.onsubmit=e=>{ e.preventDefault();
    const data={}; form.querySelectorAll('[name]').forEach(i=>data[i.name]=i.value.trim());
    if(onSubmit(data)!==false) close();
  };
  const first=form.querySelector('input,textarea'); if(first) setTimeout(()=>first.focus(),80);
  window.addEventListener('keydown',function esc(ev){ if(ev.key==='Escape'){close();window.removeEventListener('keydown',esc);} });
  return {close, form};
}

/* ============================================================
   CRUD — Categories
   ============================================================ */
function promptCreateCategory(wx, wy){
  modal('⬡ Create Category',
    `<div class="field"><label>Category Name</label><input name="name" placeholder="e.g. Development" required></div>`,
    d=>{
      if(!d.name){ toast('Name required', true); return false; }
      const c={id:uid(), name:d.name, x:Math.round(wx-94), y:Math.round(wy-30)};
      State.categories.push(c);
      world.appendChild(buildCategoryEl(c));
      renderLinks(); refreshStats(); autoSave();
      toast('Category created');
    }, 'Create');
}
function promptEditCategory(id){
  const c=State.categories.find(c=>c.id===id); if(!c) return;
  modal('✎ Edit Category',
    `<div class="field"><label>Category Name</label><input name="name" value="${esc(c.name)}" required></div>`,
    d=>{ if(!d.name){toast('Name required',true);return false;} c.name=d.name; renderAll(); autoSave(); toast('Category updated'); });
}
function deleteCategory(id){
  const c=State.categories.find(c=>c.id===id); if(!c) return;
  const n=State.sites.filter(s=>s.catId===id).length;
  confirmModal('Delete Category', `Delete "<b>${esc(c.name)}</b>" and its <b>${n}</b> site(s)? This cannot be undone.`, ()=>{
    State.sites=State.sites.filter(s=>s.catId!==id);
    State.categories=State.categories.filter(c=>c.id!==id);
    renderAll(); autoSave(); toast('Category deleted');
  });
}

/* ============================================================
   CRUD — Sites
   ============================================================ */
function promptAddSite(catId){
  const c=State.categories.find(c=>c.id===catId); if(!c) return;
  modal('➕ Add Site',
    `<div class="field"><label>Site Name</label><input name="name" placeholder="e.g. GitHub" required></div>
     <div class="field"><label>Site URL</label><input name="url" placeholder="https://github.com"></div>`,
    d=>{
      if(!d.name){ toast('Name required', true); return false; }
      // place below category, offset by existing siblings
      const sibs=State.sites.filter(s=>s.catId===catId).length;
      const s={id:uid(), catId, name:d.name, url:normalizeUrl(d.url),
               x:c.x + (sibs%3)*180 - 0, y:c.y + 160 + Math.floor(sibs/3)*120};
      State.sites.push(s);
      world.appendChild(buildSiteEl(s));
      renderLinks(); refreshStats(); autoSave();
      toast('Site added');
    }, 'Add Site');
}
function promptEditSite(id){
  const s=State.sites.find(s=>s.id===id); if(!s) return;
  modal('✎ Edit Site',
    `<div class="field"><label>Site Name</label><input name="name" value="${esc(s.name)}" required></div>
     <div class="field"><label>Site URL</label><input name="url" value="${esc(s.url||'')}"></div>`,
    d=>{ if(!d.name){toast('Name required',true);return false;} s.name=d.name; s.url=normalizeUrl(d.url); renderAll(); autoSave(); toast('Site updated'); });
}
function deleteSite(id){
  const s=State.sites.find(s=>s.id===id); if(!s) return;
  confirmModal('Delete Site', `Delete site "<b>${esc(s.name)}</b>"?`, ()=>{
    State.sites=State.sites.filter(x=>x.id!==id);
    renderAll(); autoSave(); toast('Site deleted');
  });
}
function normalizeUrl(u){
  u=(u||'').trim(); if(!u) return '';
  if(!/^https?:\/\//i.test(u)) u='https://'+u;
  return u;
}

/* confirm modal */
function confirmModal(title, html, onYes){
  const bg=document.createElement('div'); bg.className='modal-bg';
  bg.innerHTML=`<div class="modal"><h3>⚠ ${title}</h3><p style="color:var(--text);line-height:1.6;font-size:14px">${html}</p>
    <div class="modal-actions"><button class="btn" data-no>Cancel</button><button class="btn danger" data-yes>Delete</button></div></div>`;
  document.body.appendChild(bg);
  requestAnimationFrame(()=>bg.classList.add('show'));
  const close=()=>{bg.classList.remove('show');setTimeout(()=>bg.remove(),200);};
  bg.querySelector('[data-no]').onclick=close;
  bg.querySelector('[data-yes]').onclick=()=>{close();onYes();};
  bg.addEventListener('mousedown',e=>{if(e.target===bg)close();});
}

/* ============================================================
   SEARCH (map)
   ============================================================ */
const mapSearch=document.getElementById('mapSearch');
mapSearch.addEventListener('input', applySearchFilter);
function applySearchFilter(){
  const q=(mapSearch.value||'').toLowerCase().trim();
  world.querySelectorAll('.node').forEach(el=>{
    if(!q){ el.style.opacity=''; el.style.filter=''; return; }
    let txt='';
    const id=el.dataset.id;
    if(el.dataset.type==='cat'){ const c=State.categories.find(c=>c.id===id); txt=(c?c.name:''); }
    else { const s=State.sites.find(s=>s.id===id); txt=((s?s.name:'')+' '+(s?s.url:'')); }
    const match=txt.toLowerCase().includes(q);
    el.style.opacity=match?'1':'0.12';
    el.style.filter=match?'drop-shadow(0 0 14px rgba(0,255,213,.7))':'';
  });
}

/* ============================================================
   ACCOUNTS VAULT
   ============================================================ */
const accGrid=document.getElementById('accGrid');
const accSearch=document.getElementById('accSearch');
accSearch.addEventListener('input', renderAccounts);
document.getElementById('addAccBtn').onclick=()=>promptAccount();

function renderAccounts(){
  const q=(accSearch.value||'').toLowerCase().trim();
  const list=State.accounts.filter(a=>{
    if(!q) return true;
    return (a.site+' '+a.username+' '+(a.notes||'')).toLowerCase().includes(q);
  });
  accGrid.innerHTML='';
  if(!list.length){
    accGrid.innerHTML=`<div class="empty"><div class="big">🔐</div>${
      State.accounts.length? 'No accounts match your search.' : 'No accounts yet. Click <b>+ New Account</b> to add one.'}</div>`;
    return;
  }
  list.forEach(a=>accGrid.appendChild(buildAccCard(a)));
}

function buildAccCard(a){
  const el=document.createElement('div'); el.className='acc-card';
  const initial=(a.site||'?').trim().charAt(0).toUpperCase()||'?';
  el.innerHTML=`
    <div class="ahead"><div class="alogo">${esc(initial)}</div><div class="asite">${esc(a.site)}</div></div>
    <div class="acc-body">
      <div class="acc-row"><span class="lbl">User</span><span class="val">${esc(a.username||'—')}</span><span class="copy" data-copy="${esc(a.username||'')}" title="Copy">⧉</span></div>
      <div class="acc-row"><span class="lbl">Pass</span><span class="val acc-pass" data-pass="${esc(a.password||'')}">••••••••</span>
        <span class="copy reveal" title="Show/Hide">👁</span>
        <span class="copy" data-copy="${esc(a.password||'')}" title="Copy">⧉</span></div>
      ${a.notes?`<div class="acc-desc">${esc(a.notes)}</div>`:''}
    </div>
    <div class="acc-actions">
      <button class="minibtn edit">✎ Edit</button>
      <button class="minibtn del">🗑 Delete</button>
    </div>`;
  // reveal toggle
  const passEl=el.querySelector('.acc-pass');
  let shown=false;
  el.querySelector('.reveal').onclick=()=>{ shown=!shown; passEl.textContent=shown?(passEl.dataset.pass||'—'):'••••••••'; };
  el.querySelectorAll('[data-copy]').forEach(c=>c.onclick=()=>{ copyText(c.dataset.copy); });
  el.querySelector('.edit').onclick=()=>promptAccount(a.id);
  el.querySelector('.del').onclick=()=>{
    confirmModal('Delete Account', `Delete account for "<b>${esc(a.site)}</b>"?`, ()=>{
      State.accounts=State.accounts.filter(x=>x.id!==a.id); renderAccounts(); refreshStats(); autoSave(); toast('Account deleted');
    });
  };
  return el;
}

function promptAccount(id){
  const a=id?State.accounts.find(x=>x.id===id):null;
  modal((a?'✎ Edit':'+ New')+' Account',
    `<div class="field"><label>Site / Service</label><input name="site" value="${a?esc(a.site):''}" placeholder="e.g. GitHub" required></div>
     <div class="field"><label>Username / Email</label><input name="username" value="${a?esc(a.username):''}" placeholder="user@mail.com"></div>
     <div class="field"><label>Password</label><input name="password" value="${a?esc(a.password):''}" placeholder="••••••••"></div>
     <div class="field"><label>Notes / Description</label><textarea name="notes" placeholder="Recovery codes, 2FA, hints...">${a?esc(a.notes):''}</textarea></div>`,
    d=>{
      if(!d.site){ toast('Site required', true); return false; }
      if(a){ Object.assign(a,d); toast('Account updated'); }
      else { State.accounts.push({id:uid(), ...d}); toast('Account created'); }
      renderAccounts(); refreshStats(); autoSave();
    }, a?'Save':'Create');
}

function copyText(t){
  if(!t){ toast('Nothing to copy', true); return; }
  try{
    navigator.clipboard.writeText(t).then(()=>toast('Copied to clipboard'),()=>fallbackCopy(t));
  }catch(_){ fallbackCopy(t); }
}
function fallbackCopy(t){
  const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('Copied to clipboard'); }catch(_){ toast('Copy failed', true); }
  ta.remove();
}

/* ============================================================
   NAVIGATION (tabs)
   ============================================================ */
document.querySelectorAll('.tab').forEach(tab=>{
  tab.onclick=()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.view).classList.add('active');
    if(tab.dataset.view==='accountsView') renderAccounts();
    if(tab.dataset.view==='mapView'){ resizeCanvas(); applyView(); }
  };
});

/* ============================================================
   SETTINGS DRAWER
   ============================================================ */
const settings=document.getElementById('settings');
document.getElementById('openSettings').onclick=()=>{ settings.classList.toggle('open'); refreshStats(); };
document.addEventListener('mousedown', e=>{
  if(settings.classList.contains('open') && !settings.contains(e.target) && e.target.id!=='openSettings'){
    settings.classList.remove('open');
  }
});

function refreshStats(){
  document.getElementById('statCats').textContent=State.categories.length;
  document.getElementById('statSites').textContent=State.sites.length;
  document.getElementById('statAccs').textContent=State.accounts.length;
}

/* ---- View controls ---- */
function resetView(){
  State.view={x: innerWidth/2, y: (innerHeight)/2 - 27, scale:1};
  applyView(); autoSave(); toast('View reset');
}
function fitView(){
  const nodes=[...world.querySelectorAll('.node')];
  if(!nodes.length){ resetView(); return; }
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  nodes.forEach(el=>{
    minX=Math.min(minX, el.offsetLeft); minY=Math.min(minY, el.offsetTop);
    maxX=Math.max(maxX, el.offsetLeft+el.offsetWidth); maxY=Math.max(maxY, el.offsetTop+el.offsetHeight);
  });
  const pad=80; const bw=maxX-minX+pad*2, bh=maxY-minY+pad*2;
  const vw=canvasWrap.clientWidth, vh=canvasWrap.clientHeight;
  const scale=Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(vw/bw, vh/bh)));
  State.view.scale=scale;
  State.view.x = vw/2 - ((minX+maxX)/2)*scale;
  State.view.y = vh/2 - ((minY+maxY)/2)*scale;
  applyView(); autoSave(); toast('Fitted to screen');
}
document.getElementById('resetView').onclick=resetView;
document.getElementById('fitView').onclick=fitView;

/* ============================================================
   BACKUP / RESTORE / WIPE
   ============================================================ */
document.getElementById('downloadBackup').onclick=()=>{
  const data=serialize();
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const fname=`netsaver-backup-${stamp}.json`;
  // try native first
  if(typeof window.exportBackup==='function'){
    try{ window.exportBackup(fname, data); toast('Backup exported'); return; }catch(_){}
  }
  const blob=new Blob([data],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fname;
  document.body.appendChild(a); a.click(); a.remove();
  toast('Backup downloaded');
};

document.getElementById('restoreBackup').onclick=()=>document.getElementById('restoreFile').click();
document.getElementById('restoreFile').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{
    confirmModal('Restore Backup','This will <b>replace all current data</b> with the backup contents. Continue?', ()=>{
      try{
        const d=JSON.parse(r.result);
        State.categories=d.categories||[];
        State.sites=d.sites||[];
        State.accounts=d.accounts||[];
        State.view=d.view||{x:0,y:0,scale:1};
        State._seq=d._seq||1;
        renderAll(); renderAccounts(); applyView(); autoSave();
        toast('Backup restored');
      }catch(err){ toast('Invalid backup file', true); }
    });
  };
  r.readAsText(f);
  e.target.value='';
};

document.getElementById('wipeAll').onclick=()=>{
  confirmModal('Erase All Data','This permanently deletes <b>all</b> categories, sites and accounts. This cannot be undone!', ()=>{
    State.categories=[]; State.sites=[]; State.accounts=[]; State._seq=1;
    renderAll(); renderAccounts(); autoSave(); toast('All data erased');
  });
};

/* ============================================================
   TOAST
   ============================================================ */
const toastEl=document.getElementById('toast');
let toastTimer=null;
function toast(msg, err){
  toastEl.textContent=msg; toastEl.className='show'+(err?' err':'');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.className=err?'err':'', 2200);
}

/* ============================================================
   KEYBOARD SHORTCUTS
   ============================================================ */
window.addEventListener('keydown', e=>{
  if(e.target.matches('input,textarea')) return;
  if(e.key==='/' ){ e.preventDefault(); (document.getElementById('mapView').classList.contains('active')?mapSearch:accSearch).focus(); }
  if(e.key==='0' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); resetView(); }
  if(e.key==='f' && !e.ctrlKey){ fitView(); }
});

/* ============================================================
   FLUSH ON EXIT — make sure the latest changes are persisted even if the
   debounce timer hasn't fired yet when the window is closing/hidden.
   ============================================================ */
function flushNow(){
  if (saveTimer){ clearTimeout(saveTimer); saveTimer=null; }
  const payload = serialize();
  if (payload === lastSerialized) return;   // already saved
  try{ Native.save(payload); lastSerialized = payload; }catch(_){}
}
window.addEventListener('beforeunload', flushNow);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') flushNow(); });

/* ============================================================
   BOOTSTRAP
   ============================================================ */
window.addEventListener('resize', ()=>{ resizeCanvas(); });
resizeCanvas();
animateLinks();

(async function init(){
  await loadState();
  // if no saved view, center
  if(State.view.x===0 && State.view.y===0 && State.view.scale===1){
    State.view.x=innerWidth/2; State.view.y=innerHeight/2-60;
  }
  applyView();
  renderAccounts();
  refreshStats();
  setStatus('saved');
  // mark ready for native host
  if(typeof window.appReady==='function'){ try{ window.appReady(); }catch(_){} }
})();
