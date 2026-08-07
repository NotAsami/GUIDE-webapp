/* ============================================================================
   SHARD LATTICE EDITOR — DM graph-editor logic.
   Every tree is the SAME schema the player Shard Tree screen consumes
   (tier / angle / cost / prereqs / effect), so "Publish" ships this object.
   ============================================================================ */
const SHARDS = {
  vigor: {
    id:'vigor', name:'Shard of Vigor', rarity:'Uncommon', module:'Physical Enhancement',
    icon:'fa-gem', capacity:8, published:true, bound:['Ros','Brom'],
    flavor:'A knot of dull amber glass, warm to the touch. It sits against the sternum and the body starts telling small lies about how tired it is.',
    attuneRule:'Requires attunement · occupies 1 of 2 shard slots',
    baseMods:[{k:'STR',op:'Modify',v:'+2'},{k:'CON',op:'Modify',v:'+1'},{k:'Max HP',op:'Modify',v:'+5'}],
    baseFeatures:['Shardbearer — Vigor'],
    baseDetails:[{l:'Digitization',v:'+1% / tier'}],
    dm:'Grants on slot, before any node is spent. The +1 CON is what keeps Brom alive through act two.',
    branches:{ core:'Core', might:'Might', vitality:'Vitality', grit:'Grit', apex:'Apex' },
    nodes:[
      {id:'core',name:'Shard Core',tier:0,branch:'core',angle:0,cost:0,icon:'fa-gem',prereqs:[],effect:'Base attunement. +2 STR, +5 max HP.',dm:''},
      {id:'might_1',name:'Hardened Sinew',tier:1,branch:'might',angle:-90,cost:1,icon:'fa-hand-fist',prereqs:['core'],effect:'+1 STR.',dm:''},
      {id:'vit_1',name:'Deep Reserves',tier:1,branch:'vitality',angle:90,cost:1,icon:'fa-droplet',prereqs:['core'],effect:'+5 max HP.',dm:''},
      {id:'grit_1',name:'True Grit',tier:1,branch:'grit',angle:180,cost:1,icon:'fa-anchor',prereqs:['core'],effect:'+2 max HP and advantage on death saving throws.',dm:''},
      {id:'might_2',name:'Powerful Build',tier:2,branch:'might',angle:-120,cost:1,icon:'fa-dumbbell',prereqs:['might_1'],effect:'Lifting and carrying capacity doubled; advantage on STR (Athletics) checks.',dm:''},
      {id:'might_2b',name:'Reckless Power',tier:2,branch:'might',angle:-60,cost:1,icon:'fa-explosion',prereqs:['might_1'],effect:'Once per turn you may take a -2 penalty to AC until your next turn to deal +1d6 damage on a melee hit.',dm:'Watch the AC swing at low levels — this is the node that gets someone killed in tier 1.'},
      {id:'vit_2',name:'Iron Constitution',tier:2,branch:'vitality',angle:120,cost:1,icon:'fa-shield-heart',prereqs:['vit_1'],effect:'+5 max HP; advantage on saving throws against being poisoned.',dm:''},
      {id:'vit_2b',name:'Toughened Hide',tier:2,branch:'vitality',angle:60,cost:1,icon:'fa-shield',prereqs:['vit_1'],effect:'While you wear no heavy armor, your AC increases by 1.',dm:''},
      {id:'grit_2',name:'Adrenal Surge',tier:2,branch:'grit',angle:180,cost:1,icon:'fa-bolt',prereqs:['grit_1'],effect:'When you drop below half your max HP, gain temporary HP equal to your level (once per rest).',dm:''},
      {id:'might_3',name:'Crushing Strikes',tier:3,branch:'might',angle:-45,cost:2,icon:'fa-hammer',prereqs:['might_2b'],effect:'+1 melee weapon damage.',dm:''},
      {id:'might_3b',name:'Brutal Momentum',tier:3,branch:'might',angle:-135,cost:2,icon:'fa-angles-up',prereqs:['might_2'],effect:'Reducing a creature to 0 HP grants +10 ft of movement and advantage on your next attack this turn.',dm:''},
      {id:'vit_3',name:'Second Wind',tier:3,branch:'vitality',angle:45,cost:2,icon:'fa-heart-pulse',prereqs:['vit_2b'],effect:'Regain 1 HP at the start of each of your turns while below half your maximum HP.',dm:''},
      {id:'vit_3b',name:'Regeneration',tier:3,branch:'vitality',angle:135,cost:2,icon:'fa-arrows-rotate',prereqs:['vit_2'],effect:'At the end of a short rest, regain HP equal to your Constitution modifier (minimum 1).',dm:''},
      {id:'grit_3',name:'Unflinching',tier:3,branch:'grit',angle:180,cost:2,icon:'fa-mountain',prereqs:['grit_2'],effect:'Advantage on saving throws against being frightened; you cannot be moved against your will.',dm:''},
      {id:'apex',name:'Unbreakable',tier:4,branch:'apex',angle:0,cost:3,icon:'fa-star',prereqs:['might_3','vit_3'],effect:'+2 STR, +10 max HP, and you cannot be knocked prone.',dm:'Capstone. Do not let this land before session 9.'},
      {id:'toll',name:'The Toll',tier:4,branch:'apex',angle:180,cost:0,icon:'fa-skull',prereqs:['grit_3'],concealed:true,effect:'Your body no longer tires. It also no longer entirely reports to you.',dm:'CONCEALED. Auto-grants on Grit completion — the player never chose it. Digitization +8%.'}
    ]
  },
  echo: {
    id:'echo', name:'Shard of Echo', rarity:'Rare', module:'Cognitive Relay',
    icon:'fa-tower-broadcast', capacity:6, published:true, bound:['Vethra'],
    flavor:'It hums at a frequency just under hearing. Everyone in the room finishes their sentences a half-beat faster.',
    attuneRule:'Requires attunement · occupies 1 of 2 shard slots',
    baseMods:[{k:'INT',op:'Modify',v:'+2'},{k:'Passive Perception',op:'Modify',v:'+1'}],
    baseFeatures:['Shardbearer — Echo'],
    baseDetails:[{l:'Range',v:'30 ft'}],
    dm:'',
    branches:{ core:'Core', signal:'Signal', recall:'Recall', apex:'Apex' },
    nodes:[
      {id:'core',name:'Relay Core',tier:0,branch:'core',angle:0,cost:0,icon:'fa-tower-broadcast',prereqs:[],effect:'Base attunement. You may reroll one Intelligence check per rest.',dm:''},
      {id:'sig_1',name:'Carrier Wave',tier:1,branch:'signal',angle:-70,cost:1,icon:'fa-signal',prereqs:['core'],effect:'You can speak telepathically to one creature you can see within 30 ft.',dm:''},
      {id:'rec_1',name:'Perfect Recall',tier:1,branch:'recall',angle:70,cost:1,icon:'fa-brain',prereqs:['core'],effect:'You remember anything you have seen or heard in the past month.',dm:'She will not notice what it quietly declines to return.'},
      {id:'sig_2',name:'Interference',tier:2,branch:'signal',angle:-100,cost:2,icon:'fa-wave-square',prereqs:['sig_1'],effect:'As a reaction, impose disadvantage on one enemy spell attack within 60 ft.',dm:''},
      {id:'rec_2',name:'Borrowed Skill',tier:2,branch:'recall',angle:100,cost:2,icon:'fa-book-open',prereqs:['rec_1'],effect:'Gain proficiency in one skill an ally within 30 ft has, for one hour.',dm:''},
      {id:'apex',name:'Full Duplex',tier:3,branch:'apex',angle:0,cost:3,icon:'fa-star',prereqs:['sig_2','rec_2'],effect:'The party shares one pooled reaction per round while within 60 ft of you.',dm:''}
    ]
  },
  cinder: {
    id:'cinder', name:'Shard of Cinder', rarity:'Very Rare', module:'Thermal Output',
    icon:'fa-fire', capacity:7, published:false, bound:[],
    flavor:'Draft. Runs hot in the pocket.',
    attuneRule:'Requires attunement · occupies 1 of 2 shard slots',
    baseMods:[{k:'Fire Resistance',op:'Set',v:'Yes'}],
    baseFeatures:[],
    baseDetails:[],
    dm:'',
    branches:{ core:'Core', ember:'Ember', ash:'Ash', apex:'Apex' },
    nodes:[
      {id:'core',name:'Ember Core',tier:0,branch:'core',angle:0,cost:0,icon:'fa-fire',prereqs:[],effect:'Base attunement. Your unarmed strikes deal +1 fire damage.',dm:''},
      {id:'em_1',name:'Kindle',tier:1,branch:'ember',angle:-60,cost:1,icon:'fa-fire-flame-simple',prereqs:['core'],effect:'Ignite a flammable object you touch as a bonus action.',dm:''},
      {id:'ash_1',name:'Ashen Step',tier:1,branch:'ash',angle:120,cost:1,icon:'fa-shoe-prints',prereqs:[],effect:'Leave no tracks; advantage on Stealth in smoke or dust.',dm:'ORPHAN — never linked to the core. Fix before publish.'}
    ]
  },
  null_: {
    id:'null_', name:'Shard of the Lady', rarity:'Legendary', module:'—— UNRESOLVED ——',
    icon:'fa-question', capacity:0, published:false, bound:[],
    flavor:'',
    attuneRule:'—',
    baseMods:[], baseFeatures:[], baseDetails:[],
    dm:'Do not fill this in.',
    branches:{ core:'Core' },
    nodes:[{id:'core',name:'???',tier:0,branch:'core',angle:0,cost:0,icon:'fa-question',prereqs:[],effect:'Node data returns empty. The tree exists. It has not been written by anyone at this table.',dm:'Leave it. It grows on its own between sessions.'}]
  }
};

const PALETTE = [
  {n:'Beige',v:'var(--beige)'},{n:'Amber',v:'var(--amber)'},{n:'Cyan',v:'var(--cyan)'},
  {n:'Violet',v:'var(--violet)'},{n:'Ember',v:'var(--danger-hot)'},{n:'Green',v:'var(--good)'}
];
const BR_COLOR = { core:'var(--amber-hot)', might:'var(--beige)', vitality:'var(--cyan)', grit:'var(--violet)', apex:'var(--amber)',
                   signal:'var(--cyan)', recall:'var(--beige)', ember:'var(--danger-hot)', ash:'var(--violet)' };
const ICONS = ['fa-gem','fa-hand-fist','fa-shield','fa-shield-heart','fa-heart-pulse','fa-droplet','fa-bolt','fa-anchor','fa-hammer','fa-dumbbell','fa-explosion','fa-mountain','fa-angles-up','fa-arrows-rotate','fa-star','fa-fire','fa-brain','fa-eye','fa-skull','fa-wave-square','fa-signal','fa-book-open'];
const RING_GAP = 128;
/* branch colour: per-shard override first, then the built-in map. */
const brColor = k => (tree().branchColors && tree().branchColors[k]) || BR_COLOR[k] || 'var(--beige-dim)';

const S = { shard:'vigor', tab:'node', tool:'select', sel:null, selEdge:null, linkSrc:null,
            mode:'author', snap:true, rings:4, dirty:false, sim:null, simPts:0,
            zoom:1, panX:0, panY:0 };

const $ = id => document.getElementById(id);
const pad=$('pad'), stage=$('stage'), canvas=$('canvas'), svg=$('svg');
const SVGNS='http://www.w3.org/2000/svg';
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tree = () => SHARDS[S.shard];
const node = id => tree().nodes.find(n => n.id === id);
const CR = () => RING_GAP * S.rings + 130;
/* A node is the root if nothing gates it — that, not its ring, is what makes it
   the core. Keeps a mis-dragged T0 node able to return to ring 0. */
const isRoot = n => !n.prereqs.length && !tree().nodes.some(x => x.prereqs.includes(n.id) && x.tier === 0);

/* ---------- geometry ---------- */
function xy(n){ const r=RING_GAP*n.tier, a=n.angle*Math.PI/180, c=CR(); return { x:c+r*Math.sin(a), y:c-r*Math.cos(a) }; }
function polar(x,y){ const c=CR(), dx=x-c, dy=y-c; return { r:Math.hypot(dx,dy), deg:((Math.atan2(dx,-dy)*180/Math.PI)+540)%360-180 }; }

/* ---------- validation ---------- */
function audit(){
  const t=tree(), out=[], ids=new Set(t.nodes.map(n=>n.id));
  const reach=new Set(); const roots=t.nodes.filter(n=>n.tier===0).map(n=>n.id);
  roots.forEach(r=>reach.add(r));
  let grew=true;
  while(grew){ grew=false; t.nodes.forEach(n=>{ if(!reach.has(n.id)&&n.prereqs.length&&n.prereqs.every(p=>reach.has(p))){reach.add(n.id);grew=true;} }); }
  t.nodes.forEach(n=>{
    if(n.tier===0) return;
    if(!n.prereqs.length) out.push({sev:'err',id:n.id,t:'Orphan node',s:esc(n.name)+' has no prerequisite — a player can never reach it.'});
    else if(!reach.has(n.id)) out.push({sev:'err',id:n.id,t:'Unreachable',s:esc(n.name)+' chains to a node that never resolves back to the core.'});
    n.prereqs.forEach(p=>{ const pn=node(p);
      if(!pn) out.push({sev:'err',id:n.id,t:'Dangling link',s:esc(n.name)+' requires a node that no longer exists.'});
      else if(pn.tier>=n.tier) out.push({sev:'warn',id:n.id,t:'Inward flow',s:esc(n.name)+' (T'+n.tier+') requires '+esc(pn.name)+' (T'+pn.tier+'). Prereqs should sit further in.'});
    });
    if(n.cost===0&&!n.concealed) out.push({sev:'warn',id:n.id,t:'Free node',s:esc(n.name)+' costs nothing — it will auto-read as available forever.'});
  });
  t.nodes.forEach((a,i)=>t.nodes.slice(i+1).forEach(b=>{
    if(a.tier===b.tier&&Math.abs(a.angle-b.angle)<9) out.push({sev:'warn',id:b.id,t:'Overlap',s:esc(a.name)+' and '+esc(b.name)+' sit on the same ring within 9°.'});
  }));
  const total=t.nodes.reduce((s,n)=>s+n.cost,0);
  if(total>t.capacity*2.2) out.push({sev:'warn',id:null,t:'Cost ceiling',s:'Total cost '+total+' against capacity '+t.capacity+' — most of this tree is unreachable in a campaign.'});
  if(!out.length) out.push({sev:'ok',id:null,t:'Lattice valid',s:'All nodes resolve to the core. Safe to publish.'});
  return out;
}

/* ---------- library ---------- */
function renderLib(){
  $('lib').innerHTML = Object.values(SHARDS).map(s =>
    '<button class="lib-row '+(s.id===S.shard?'sel':'')+'" data-shard="'+s.id+'">'+
      '<span class="lr-ic"><i class="fa-solid '+s.icon+'"></i></span>'+
      '<span class="lr-tx"><span class="lr-t">'+esc(s.name)+'</span><span class="lr-s">'+s.nodes.length+' nodes · '+esc(s.rarity)+(s.bound.length?' · '+s.bound.length+' bound':'')+'</span></span>'+
      '<span class="lr-pub '+(s.published?'':'draft')+'" title="'+(s.published?'Published':'Draft')+'"></span>'+
    '</button>').join('');
  $('libCount').textContent = Object.keys(SHARDS).length;
  $('lib').querySelectorAll('.lib-row').forEach(b=>b.addEventListener('click',()=>{
    S.shard=b.dataset.shard; S.tab='shard'; S.sel=null; S.selEdge=null; S.linkSrc=null; S.rings=Math.max(3,Math.max(...tree().nodes.map(n=>n.tier))+1);
    resetSim(); renderAll(); fit();
  }));
}

function renderAudit(){
  const list=audit(); const errs=list.filter(i=>i.sev==='err').length, warns=list.filter(i=>i.sev==='warn').length;
  $('audit').innerHTML=list.map(i=>'<div class="audit-item '+i.sev+'" '+(i.id?'data-goto="'+i.id+'"':'')+'><i class="fa-solid '+(i.sev==='err'?'fa-circle-exclamation':i.sev==='warn'?'fa-triangle-exclamation':'fa-circle-check')+'"></i><span class="ai-tx"><span class="ai-t">'+i.t+'</span><span class="ai-s">'+i.s+'</span></span></div>').join('');
  $('auditN').textContent = errs+warns ? errs+' err · '+warns+' warn' : 'clean';
  $('audit').querySelectorAll('[data-goto]').forEach(el=>el.addEventListener('click',()=>{ S.sel=el.dataset.goto; S.selEdge=null; center(S.sel); renderCanvas(); renderInspector(); }));
  const bad=errs>0;
  $('valStatus').className='status'+(bad?' bad':'');
  $('valText').textContent = bad ? errs+' blocking issue'+(errs>1?'s':'')+' — publish disabled' : (warns?warns+' warning'+(warns>1?'s':'')+' — publishable':'Lattice valid');
  $('statIssues').textContent=errs+warns; $('statIssues').className='v'+(errs?' warn':'');
  $('statNodes').textContent=tree().nodes.length;
  $('statCost').textContent=tree().nodes.reduce((s,n)=>s+n.cost,0);
}

/* ---------- canvas ---------- */
function renderCanvas(){
  const sz=CR()*2;
  canvas.style.width=sz+'px'; canvas.style.height=sz+'px';
  svg.setAttribute('viewBox','0 0 '+sz+' '+sz); svg.setAttribute('width',sz); svg.setAttribute('height',sz);
  svg.innerHTML=''; canvas.querySelectorAll('.nd').forEach(e=>e.remove());
  const c=CR();
  for(let t=1;t<=S.rings;t++){
    const el=document.createElementNS(SVGNS,'circle');
    el.setAttribute('class','ring-guide'); el.setAttribute('cx',c); el.setAttribute('cy',c); el.setAttribute('r',RING_GAP*t);
    svg.appendChild(el);
    if(S.mode==='author'){ const tg=document.createElementNS(SVGNS,'text'); tg.setAttribute('class','ring-tag');
      const tx=c+6, ty=c-RING_GAP*t+14, k=1/S.zoom;   // counter-scale: keep tags legible at any zoom
      tg.setAttribute('x',tx); tg.setAttribute('y',ty); tg.textContent='T'+t;
      tg.setAttribute('transform','translate('+(tx*(1-k)).toFixed(2)+','+(ty*(1-k)).toFixed(2)+') scale('+k.toFixed(3)+')');
      svg.appendChild(tg); }
  }
  if(S.mode==='author'&&S.snap) for(let a=0;a<360;a+=15){
    const rad=a*Math.PI/180, R=RING_GAP*S.rings;
    const l=document.createElementNS(SVGNS,'line'); l.setAttribute('class','spoke-guide');
    l.setAttribute('x1',c); l.setAttribute('y1',c); l.setAttribute('x2',c+R*Math.sin(rad)); l.setAttribute('y2',c-R*Math.cos(rad));
    svg.appendChild(l);
  }
  tree().nodes.forEach(n=>n.prereqs.forEach(p=>{
    const pn=node(p); if(!pn) return;
    const a=xy(pn), b=xy(n), key=p+'__'+n.id;
    const d='M '+a.x.toFixed(1)+' '+a.y.toFixed(1)+' L '+b.x.toFixed(1)+' '+b.y.toFixed(1);
    let cls='edge';
    if(S.mode==='preview'){ cls='edge'+(S.sim.has(p)&&S.sim.has(n.id)?' live':S.sim.has(p)?' open':' dim'); }
    else if(S.selEdge===key) cls+=' sel';
    else if(pn.tier>=n.tier) cls+=' dead';
    const path=document.createElementNS(SVGNS,'path'); path.setAttribute('class',cls); path.setAttribute('d',d);
    path.style.stroke=brColor(n.branch); svg.appendChild(path);
    if(S.mode==='author'){
      const hit=document.createElementNS(SVGNS,'path'); hit.setAttribute('class','edge-hit'); hit.setAttribute('d',d);
      hit.addEventListener('click',e=>{ e.stopPropagation(); S.selEdge=key; S.sel=null; renderCanvas(); renderInspector(); });
      svg.appendChild(hit);
      const mx=(a.x+b.x)/2, my=(a.y+b.y)/2, ang=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
      const ar=document.createElementNS(SVGNS,'path');
      ar.setAttribute('d','M -5 -4 L 4 0 L -5 4 Z'); ar.setAttribute('fill', S.selEdge===key?'var(--amber)':'var(--beige-dim)');
      ar.setAttribute('transform','translate('+mx+','+my+') rotate('+ang+')'); ar.setAttribute('opacity','.85'); svg.appendChild(ar);
    }
  }));
  tree().nodes.forEach(n=>{
    const p=xy(n), el=document.createElement('button');
    el.className='nd'+(n.tier===0?' core':'')+(n.branch==='apex'?' apex':'')+(S.sel===n.id?' sel':'')+(S.linkSrc===n.id?' linksrc':'');
    if(S.mode==='preview'){ el.classList.add(S.sim.has(n.id)?'p-att':canAttune(n)?'p-avail':'p-locked'); }
    el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.setProperty('--bc',brColor(n.branch));
    el.dataset.id=n.id;
    const concealed = n.concealed && S.mode==='preview' && !S.sim.has(n.id);
    el.innerHTML='<span class="nf"></span><span class="ni"><i class="fa-solid '+(concealed?'fa-question':n.icon)+'"></i></span>'+
      (n.cost>0?'<span class="ncost">'+n.cost+'</span>':'')+
      (n.concealed&&S.mode==='author'?'<span class="nconceal"><i class="fa-solid fa-eye-slash"></i></span>':'')+
      '<span class="ntier">T'+n.tier+'·'+Math.round(n.angle)+'°</span>'+
      '<span class="nlab">'+esc(n.name)+'</span>';
    canvas.appendChild(el);
  });
  wireNodes();
}

function wireNodes(){
  canvas.querySelectorAll('.nd').forEach(el=>{
    const n=node(el.dataset.id);
    el.addEventListener('pointerdown',e=>{
      if(S.mode==='preview'||S.tool!=='select') return;
      e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('dragging');
      S.sel=n.id; S.tab='node'; S.selEdge=null; renderInspector(); markSel();
      const move=ev=>{
        const r=stage.getBoundingClientRect();
        const wx=(ev.clientX-r.left-S.panX)/S.zoom, wy=(ev.clientY-r.top-S.panY)/S.zoom;
        const pol=polar(wx,wy);
        let tier=Math.round(pol.r/RING_GAP); tier=Math.max(isRoot(n)?0:1,Math.min(S.rings,tier));
        let deg=pol.deg; if(S.snap) deg=Math.round(deg/15)*15;
        n.tier=tier; n.angle=deg;
        const p=xy(n); el.style.left=p.x+'px'; el.style.top=p.y+'px';
        el.querySelector('.ntier').textContent='T'+tier+'·'+Math.round(deg)+'°';
        $('snapRead').className='snapread on';
        $('snapRead').textContent='Ring T'+tier+'  ·  '+Math.round(deg)+'°  ·  '+(tree().branches[n.branch]||n.branch);
        drawLinesOnly();
      };
      const up=()=>{ el.classList.remove('dragging'); $('snapRead').className='snapread';
        window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up);
        setDirty(); renderCanvas(); renderAudit(); renderInspector(); };
      window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
    });
    el.addEventListener('click',e=>{
      e.stopPropagation();
      if(S.mode==='preview'){ previewClick(n); return; }
      if(S.tool==='link'){ linkClick(n); return; }
      S.sel=n.id; S.tab='node'; S.selEdge=null; markSel(); renderInspector();
    });
  });
}
function markSel(){ canvas.querySelectorAll('.nd').forEach(el=>el.classList.toggle('sel',el.dataset.id===S.sel)); }
function drawLinesOnly(){
  svg.querySelectorAll('path').forEach(p=>p.remove());
  tree().nodes.forEach(n=>n.prereqs.forEach(pid=>{ const pn=node(pid); if(!pn) return;
    const a=xy(pn), b=xy(n);
    const path=document.createElementNS(SVGNS,'path'); path.setAttribute('class','edge');
    path.style.stroke=brColor(n.branch);
    path.setAttribute('d','M '+a.x+' '+a.y+' L '+b.x+' '+b.y); svg.appendChild(path);
  }));
}

/* ---------- linking ---------- */
function linkClick(n){
  if(!S.linkSrc){ S.linkSrc=n.id; toast('Link from '+n.name+' — pick the node it unlocks'); renderCanvas(); return; }
  if(S.linkSrc===n.id){ S.linkSrc=null; renderCanvas(); return; }
  const src=S.linkSrc;
  if(n.prereqs.includes(src)){ toast('Link already exists','warn'); S.linkSrc=null; renderCanvas(); return; }
  if(createsCycle(src,n.id)){ toast('Refused — that link creates a loop','warn'); S.linkSrc=null; renderCanvas(); return; }
  n.prereqs.push(src); S.linkSrc=null; S.sel=n.id; setDirty();
  toast(node(src).name+' → '+n.name);
  renderCanvas(); renderAudit(); renderInspector();
}
function createsCycle(parent,child){
  const seen=new Set(); const walk=id=>{ if(id===child) return true; if(seen.has(id)) return false; seen.add(id);
    const nd=node(id); return nd ? nd.prereqs.some(walk) : false; };
  return walk(parent);
}

/* ---------- add / delete ---------- */
function addNodeAt(wx,wy){
  const t=tree(), pol=polar(wx,wy);
  let tier=Math.max(1,Math.min(S.rings,Math.round(pol.r/RING_GAP)));
  let deg=S.snap?Math.round(pol.deg/15)*15:Math.round(pol.deg);
  const base='node', keys=Object.keys(t.branches).filter(k=>k!=='core');
  let i=1; while(node(base+i)) i++;
  const branch=keys[0]||'core';
  const n={id:base+i,name:'New Node',tier,branch,angle:deg,cost:1,icon:'fa-star',prereqs:[],effect:'',dm:''};
  // auto-link to nearest inner node (the common case; DM can re-link)
  const inner=t.nodes.filter(x=>x.tier<tier);
  if(inner.length){ const p=xy(n); inner.sort((a,b)=>{const A=xy(a),B=xy(b);return Math.hypot(A.x-p.x,A.y-p.y)-Math.hypot(B.x-p.x,B.y-p.y);}); n.prereqs=[inner[0].id]; n.branch=inner[0].branch==='core'?branch:inner[0].branch; }
  t.nodes.push(n); S.sel=n.id; S.tab='node'; setTool('select'); setDirty();
  renderCanvas(); renderAudit(); renderInspector();
  const f=$('fName'); if(f){ f.focus(); f.select(); }
}
function deleteSel(){
  if(S.selEdge){ const [p,c]=S.selEdge.split('__'); const cn=node(c); cn.prereqs=cn.prereqs.filter(x=>x!==p);
    S.selEdge=null; setDirty(); toast('Link removed'); renderCanvas(); renderAudit(); renderInspector(); return; }
  if(!S.sel) return;
  const n=node(S.sel); if(n.tier===0){ toast('The core cannot be deleted','warn'); return; }
  const t=tree(); t.nodes=t.nodes.filter(x=>x.id!==n.id);
  t.nodes.forEach(x=>{ x.prereqs=x.prereqs.filter(p=>p!==n.id); });
  S.sel=null; setDirty(); toast(n.name+' deleted'); renderCanvas(); renderAudit(); renderInspector();
}

/* ---------- inspector ---------- */
const TABS = () => '<div class="itabs">'+
  '<button data-itab="shard" class="'+(S.tab==='shard'?'on':'')+'"><i class="fa-solid fa-gem"></i> Shard</button>'+
  '<button data-itab="node" class="'+(S.tab==='node'?'on':'')+'"><i class="fa-solid fa-circle-nodes"></i> Node</button></div>';
function wireTabs(){ document.querySelectorAll('#insp [data-itab]').forEach(b=>b.addEventListener('click',()=>{
  S.tab=b.dataset.itab; renderInspector(); })); }

/* SHARD tab — the base stats a shard grants the moment it is slotted,
   before a single attunement point is spent on the lattice. */
function renderShardInspector(box){
  const t=tree();
  $('inspMeta').innerHTML='<span class="acc">'+esc(t.rarity)+'</span> · '+(t.published?'Published':'Draft');
  box.innerHTML=TABS()+
    '<div class="imeta"><i class="fa-solid '+t.icon+'"></i><span class="t">'+esc(t.name)+'</span><span class="s">'+esc(t.id)+'</span></div>'+
    '<span class="field-lab">Shard Name</span><input class="in" id="sName" value="'+esc(t.name)+'">'+
    '<span class="field-lab">Rarity</span><select class="in" id="sRarity">'+
      ['Common','Uncommon','Rare','Very Rare','Legendary','Artifact'].map(r=>'<option '+(r===t.rarity?'selected':'')+'>'+r+'</option>').join('')+
      '</select>'+
    '<span class="field-lab">Module / Classification</span><input class="in" id="sModule" value="'+esc(t.module)+'">'+
    '<div class="grid2"><div><span class="field-lab">Attunement Capacity</span><div class="stepper"><button data-sst="cap-"><i class="fa-solid fa-minus"></i></button><span class="val">'+t.capacity+'<span class="u">pt</span></span><button data-sst="cap+"><i class="fa-solid fa-plus"></i></button></div></div>'+
    '<div><span class="field-lab">Nodes / Total Cost</span><div class="stepper" style="pointer-events:none"><span class="val">'+t.nodes.length+'<span class="u">n</span></span><span class="val">'+t.nodes.reduce((s,n)=>s+n.cost,0)+'<span class="u">pt</span></span></div></div></div>'+
    '<div class="sec"><span class="field-lab">Glyph</span></div><div class="icons" id="sIcons">'+
      ICONS.map(i=>'<div class="ic '+(i===t.icon?'sel':'')+'" data-sicon="'+i+'"><i class="fa-solid '+i+'"></i></div>').join('')+'</div>'+
    '<div class="sec"><span class="field-lab">Flavour — read on slot</span></div>'+
    '<textarea class="prose" id="sFlavor" placeholder="What the player reads the moment the shard seats…">'+esc(t.flavor||'')+'</textarea>'+
    '<div class="wgt"><div class="wgt-head"><i class="fa-solid fa-flask-vial wi"></i><span class="wt">Base Effects</span><span class="wn">Applied on slot · before any node</span></div>'+
      (t.baseMods&&t.baseMods.length
        ? t.baseMods.map(m=>'<div class="mod-row"><span class="mk">'+esc(m.k)+'</span><span class="mop">'+esc(m.op)+'</span><span class="mv">'+esc(m.v)+'</span><i class="fa-solid fa-xmark dx"></i></div>').join('')
        : '<div class="wgt-empty">No base modifiers — this shard grants nothing until nodes are attuned.</div>')+
      '<button class="wgt-btn" style="margin-top:4px"><i class="fa-solid fa-plus"></i> Add Modifier</button></div>'+
    '<div class="wgt"><div class="wgt-head"><i class="fa-solid fa-star wi"></i><span class="wt">Base Features</span><span class="wn">While slotted · Snapshots from the library</span></div>'+
      (t.baseFeatures&&t.baseFeatures.length
        ? t.baseFeatures.map(f=>'<div class="dtl-row"><span class="dl">Feature</span><span class="dv">'+esc(f)+'</span><i class="fa-solid fa-xmark dx"></i></div>').join('')
        : '<div class="wgt-empty">No features — attach perks authored in the Features tab.</div>')+
      '<select class="wgt-sel"><option>Attach a feature…</option></select></div>'+
    '<div class="sec"><span class="field-lab">Detail Rows</span></div>'+
    (t.baseDetails||[]).map(d=>'<div class="dtl-row"><span class="dl">'+esc(d.l)+'</span><span class="dv">'+esc(d.v)+'</span><i class="fa-solid fa-xmark dx"></i></div>').join('')+
    '<div class="dtl-new"><input placeholder="Label"><input placeholder="Value"><button class="wgt-btn"><i class="fa-solid fa-plus"></i> Add</button></div>'+
    '<div class="sec" style="margin-top:14px"><span class="field-lab">Branch Spokes</span></div>'+
    Object.entries(t.branches).map(([k,v])=>{
      const cnt=t.nodes.filter(n=>n.branch===k).length;
      return '<div class="spoke" style="--sc:'+brColor(k)+'"><span class="sd"></span>'+
        '<input class="sn-in" data-brename="'+k+'" value="'+esc(v)+'">'+
        '<span class="sw-set">'+PALETTE.map(p=>'<span class="swt'+(brColor(k)===p.v?' on':'')+'" style="--pc:'+p.v+'" data-brcolor="'+k+'" data-v="'+p.v+'" title="'+p.n+'"></span>').join('')+'</span>'+
        '<span class="sc">'+cnt+'</span>'+
        (k==='core'?'<i class="fa-solid fa-lock dx" style="cursor:default" title="Core spoke — cannot be removed"></i>'
                   :'<i class="fa-solid fa-xmark dx" data-brdel="'+k+'" title="'+(cnt?'Remove branch ('+cnt+' nodes reassigned)':'Remove branch')+'"></i>')+
      '</div>'; }).join('')+
    '<div class="dtl-new" style="grid-template-columns:minmax(0,1fr) auto"><input id="sNewBranch" placeholder="New branch name…"><button class="wgt-btn" id="sAddBranch"><i class="fa-solid fa-plus"></i> Add Branch</button></div>'+
    '<div class="wgt-empty" style="margin:8px 0 12px">Spokes are the tree\'s radial identity — colour carries into the player view. Removing one reassigns its nodes to the first remaining branch.</div>'+
    '<div class="sec"><span class="field-lab">Bound To</span></div>'+
    '<div class="chips">'+(t.bound.length?t.bound.map(b=>'<span class="chip"><i class="fa-solid fa-user"></i> '+esc(b)+'</span>').join(''):'<span class="chip">Unbound</span>')+'</div>'+
    '<div class="sec"><span class="field-lab">DM Note — never shown</span></div>'+
    '<textarea class="prose dm" id="sDm" placeholder="// operator only">'+esc(t.dm||'')+'</textarea>'+
    '<div class="btnrow"><button class="btn ghost" id="sDup"><span class="bf"></span><span class="bi"><i class="fa-solid fa-clone"></i> Duplicate Shard</span></button>'+
    '<button class="btn danger" id="sDel"><span class="bf"></span><span class="bi"><i class="fa-solid fa-trash"></i> Delete</span></button></div>';
  wireTabs();
  const live=(id,ev,fn)=>{ const el=$(id); if(el) el.addEventListener(ev,fn); };
  live('sName','input',e=>{ t.name=e.target.value; setDirty(); renderLib(); });
  live('sRarity','change',e=>{ t.rarity=e.target.value; setDirty(); renderLib(); renderInspector(); });
  live('sModule','input',e=>{ t.module=e.target.value; setDirty(); });
  live('sFlavor','input',e=>{ t.flavor=e.target.value; setDirty(); });
  live('sDm','input',e=>{ t.dm=e.target.value; setDirty(); });
  live('sNewBranch','keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('sAddBranch').click(); } });
  document.querySelectorAll('#insp [data-sicon]').forEach(el=>el.addEventListener('click',()=>{
    t.icon=el.dataset.sicon; setDirty(); renderLib(); renderInspector(); }));
  document.querySelectorAll('#insp [data-sst]').forEach(el=>el.addEventListener('click',()=>{
    t.capacity=Math.max(0,Math.min(20,t.capacity+(el.dataset.sst==='cap+'?1:-1)));
    setDirty(); renderAudit(); renderInspector(); }));
  document.querySelectorAll('#insp [data-brename]').forEach(el=>el.addEventListener('input',()=>{
    t.branches[el.dataset.brename]=el.value; setDirty(); }));
  document.querySelectorAll('#insp [data-brcolor]').forEach(el=>el.addEventListener('click',()=>{
    t.branchColors=t.branchColors||{}; t.branchColors[el.dataset.brcolor]=el.dataset.v;
    setDirty(); renderCanvas(); renderInspector(); }));
  document.querySelectorAll('#insp [data-brdel]').forEach(el=>el.addEventListener('click',()=>{
    const k=el.dataset.brdel, keys=Object.keys(t.branches).filter(x=>x!==k);
    if(!keys.length){ toast('A tree needs at least one branch','warn'); return; }
    const fallback=keys.includes('core')&&keys.length>1?keys.find(x=>x!=='core'):keys[0];
    t.nodes.forEach(n=>{ if(n.branch===k) n.branch=fallback; });
    delete t.branches[k]; if(t.branchColors) delete t.branchColors[k];
    setDirty(); toast('Branch removed'); renderCanvas(); renderInspector(); }));
  live('sAddBranch','click',()=>{
    const inp=$('sNewBranch'), label=(inp.value||'').trim()||'New Branch';
    let key=label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'branch';
    let i=2, base=key; while(t.branches[key]) key=base+'_'+(i++);
    t.branches[key]=label;
    t.branchColors=t.branchColors||{};
    const used=new Set(Object.keys(t.branches).map(brColor));
    t.branchColors[key]=(PALETTE.find(p=>!used.has(p.v))||PALETTE[Object.keys(t.branches).length%PALETTE.length]).v;
    inp.value=''; setDirty(); toast('Branch “'+label+'” added'); renderCanvas(); renderInspector();
    const f=document.querySelector('#insp [data-brename="'+key+'"]'); if(f){ f.focus(); f.select(); } });
}

function renderInspector(){
  const box=$('insp');
  if(S.mode==='preview'){ renderPlayerRead(box); return; }
  if(S.tab==='shard'&&!S.selEdge){ renderShardInspector(box); return; }
  if(S.selEdge){
    const [p,c]=S.selEdge.split('__');
    $('inspMeta').textContent='Link';
    box.innerHTML=TABS()+'<div class="imeta"><i class="fa-solid fa-link"></i><span class="t">Prerequisite Link</span><span class="s">'+esc(p)+' → '+esc(c)+'</span></div>'+
      '<div class="sec"><span class="field-lab">Flow</span></div>'+
      '<div class="chips"><span class="chip">'+esc(node(p).name)+'</span><span class="chip"><i class="fa-solid fa-arrow-right-long"></i> unlocks</span><span class="chip">'+esc(node(c).name)+'</span></div>'+
      '<div class="btnrow"><button class="btn danger" id="delLink"><span class="bf"></span><span class="bi"><i class="fa-solid fa-link-slash"></i> Remove Link</span></button></div>';
    wireTabs(); $('delLink').addEventListener('click',deleteSel); return;
  }
  if(!S.sel){
    $('inspMeta').textContent='No Selection';
    box.innerHTML=TABS()+'<div class="insp-empty"><div class="ic-big"><i class="fa-solid fa-diagram-project"></i></div>'+
      '<div class="d" style="font-family:var(--font-mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber-dim)">Base stats live on the <b style="color:var(--amber)">Shard</b> tab</div>'+
      '<div class="t">Select a node</div>'+
      '<div class="d">Or drop a new one onto a ring. Position is the data — the ring is the tier, the angle is the branch spoke.</div>'+
      '<div class="k"><b>V</b> move &nbsp; <b>N</b> new node &nbsp; <b>L</b> link<br><b>⌫</b> delete &nbsp; <b>Esc</b> deselect</div></div>';
    wireTabs(); return;
  }
  const n=node(S.sel), t=tree();
  $('inspMeta').innerHTML='<span class="acc">'+esc(t.branches[n.branch]||n.branch)+'</span> · Tier '+n.tier;
  box.innerHTML=TABS()+
    '<div class="imeta"><i class="fa-solid '+n.icon+'"></i><span class="t">'+esc(n.name)+'</span><span class="s">'+esc(n.id)+'</span></div>'+
    '<span class="field-lab">Node Name</span><input class="in" id="fName" value="'+esc(n.name)+'">'+
    '<div class="grid2"><div><span class="field-lab">Branch</span><select class="in" id="fBranch">'+
      Object.entries(t.branches).map(([k,v])=>'<option value="'+k+'" '+(k===n.branch?'selected':'')+'>'+esc(v)+'</option>').join('')+
      '</select></div><div><span class="field-lab">Angle</span><input class="in" id="fAngle" type="number" step="'+(S.snap?15:1)+'" value="'+Math.round(n.angle)+'"></div></div>'+
    '<div class="grid2"><div><span class="field-lab">Tier / Ring</span><div class="stepper"><button data-st="tier-"><i class="fa-solid fa-minus"></i></button><span class="val">'+n.tier+'</span><button data-st="tier+"><i class="fa-solid fa-plus"></i></button></div></div>'+
    '<div><span class="field-lab">Attunement Cost</span><div class="stepper"><button data-st="cost-"><i class="fa-solid fa-minus"></i></button><span class="val">'+n.cost+'<span class="u">pt</span></span><button data-st="cost+"><i class="fa-solid fa-plus"></i></button></div></div></div>'+
    '<div class="sec"><span class="field-lab">Glyph</span></div><div class="icons" id="fIcons">'+
      ICONS.map(i=>'<div class="ic '+(i===n.icon?'sel':'')+'" data-icon="'+i+'"><i class="fa-solid '+i+'"></i></div>').join('')+'</div>'+
    '<div class="sec"><span class="field-lab">Prerequisites</span></div>'+
    '<div class="chips">'+(n.prereqs.length?n.prereqs.map(p=>'<span class="chip">'+esc(node(p)?node(p).name:p+' (missing)')+'<i class="fa-solid fa-xmark x" data-unlink="'+p+'"></i></span>').join(''):(n.tier===0?'<span class="chip">Root node</span>':'<span class="chip none"><i class="fa-solid fa-circle-exclamation"></i> Orphan — unreachable</span>'))+'</div>'+
    (n.tier===0?'':'<select class="in" id="fAddPrereq"><option value="">+ Add prerequisite…</option>'+
      t.nodes.filter(x=>x.id!==n.id&&!n.prereqs.includes(x.id)).map(x=>'<option value="'+x.id+'">'+esc(x.name)+' · T'+x.tier+'</option>').join('')+'</select>')+
    '<div class="sec"><span class="field-lab">Player-Facing Effect</span></div>'+
    '<textarea class="prose" id="fEffect" placeholder="What the player reads in the node detail panel…">'+esc(n.effect)+'</textarea>'+
    '<div class="tog '+(n.concealed?'on':'')+'" id="fConceal"><span class="sw"></span><span class="tl"><span class="t">Concealed</span><span class="s">Renders as ??? until its prereqs resolve</span></span></div>'+
    '<div class="wgt"><div class="wgt-head"><i class="fa-solid fa-flask-vial wi"></i><span class="wt">Effects Granted</span><span class="wn">Applied while attuned</span></div>'+
      '<div class="wgt-empty">No modifiers — add the buffs this node grants once attuned (e.g. AC +1, or set STR to 21).</div>'+
      '<button class="wgt-btn"><i class="fa-solid fa-plus"></i> Add Modifier</button></div>'+
    '<div class="wgt"><div class="wgt-head"><i class="fa-solid fa-star wi"></i><span class="wt">Features<br>Granted</span><span class="wn">While attuned · Snapshots from the library</span></div>'+
      '<div class="wgt-empty">No features — attach perks authored in the Features tab (e.g. a shard\'s reaction boon).</div>'+
      '<select class="wgt-sel"><option>Attach a feature…</option></select></div>'+
    '<div class="sec"><span class="field-lab">Detail Rows</span></div>'+
    '<div class="dtl-row"><span class="dl">Uses</span><span class="dv">1 per rest</span><i class="fa-solid fa-xmark dx"></i></div>'+
    '<div class="dtl-new"><input placeholder="Label"><input placeholder="Value"><button class="wgt-btn"><i class="fa-solid fa-plus"></i> Add</button></div>'+
    '<div class="sec" style="margin-top:14px"><span class="field-lab">DM Note — never shown</span></div>'+
    '<textarea class="prose dm" id="fDm" placeholder="// operator only">'+esc(n.dm||'')+'</textarea>'+
    '<div class="btnrow"><button class="btn ghost" id="dupBtn"><span class="bf"></span><span class="bi"><i class="fa-solid fa-clone"></i> Duplicate</span></button>'+
    '<button class="btn danger" id="delNode"><span class="bf"></span><span class="bi"><i class="fa-solid fa-trash"></i> Delete</span></button></div>';
  wireTabs(); wireInspector(n);
}

function wireInspector(n){
  const live=(id,ev,fn)=>{ const el=$(id); if(el) el.addEventListener(ev,fn); };
  live('fName','input',e=>{ n.name=e.target.value; setDirty(); const el=canvas.querySelector('[data-id="'+n.id+'"] .nlab'); if(el) el.textContent=n.name; renderAudit(); });
  live('fBranch','change',e=>{ n.branch=e.target.value; setDirty(); renderCanvas(); renderInspector(); });
  live('fAngle','change',e=>{ n.angle=Number(e.target.value)||0; setDirty(); renderCanvas(); renderAudit(); });
  live('fEffect','input',e=>{ n.effect=e.target.value; setDirty(); });
  live('fDm','input',e=>{ n.dm=e.target.value; setDirty(); });
  live('fAddPrereq','change',e=>{ if(!e.target.value) return;
    if(createsCycle(e.target.value,n.id)){ toast('Refused — that link creates a loop','warn'); renderInspector(); return; }
    n.prereqs.push(e.target.value); setDirty(); renderCanvas(); renderAudit(); renderInspector(); });
  live('fConceal','click',()=>{ n.concealed=!n.concealed; setDirty(); renderCanvas(); renderInspector(); });
  live('delNode','click',deleteSel);
  live('dupBtn','click',()=>{ let i=1; while(node(n.id+'_c'+i)) i++;
    const c=Object.assign({},n,{id:n.id+'_c'+i,name:n.name+' (copy)',angle:n.angle+15,prereqs:n.prereqs.slice()});
    tree().nodes.push(c); S.sel=c.id; setDirty(); renderCanvas(); renderAudit(); renderInspector(); });
  document.querySelectorAll('#insp [data-unlink]').forEach(el=>el.addEventListener('click',()=>{
    n.prereqs=n.prereqs.filter(p=>p!==el.dataset.unlink); setDirty(); renderCanvas(); renderAudit(); renderInspector(); }));
  document.querySelectorAll('#insp .ic').forEach(el=>el.addEventListener('click',()=>{
    n.icon=el.dataset.icon; setDirty(); renderCanvas(); renderInspector(); }));
  document.querySelectorAll('#insp [data-st]').forEach(el=>el.addEventListener('click',()=>{
    const k=el.dataset.st;
    if(k==='tier+') n.tier=Math.min(S.rings,n.tier+1);
    if(k==='tier-') n.tier=Math.max(isRoot(n)?0:1,n.tier-1);
    if(k==='cost+') n.cost=Math.min(9,n.cost+1);
    if(k==='cost-') n.cost=Math.max(0,n.cost-1);
    setDirty(); renderCanvas(); renderAudit(); renderInspector(); }));
}

/* ---------- player preview simulation ---------- */
function resetSim(){ S.sim=new Set(tree().nodes.filter(n=>n.tier===0).map(n=>n.id)); S.simPts=tree().capacity; }
function canAttune(n){ return !S.sim.has(n.id) && n.prereqs.length>0 && n.prereqs.every(p=>S.sim.has(p)); }
function previewClick(n){
  if(S.sim.has(n.id)){ renderPlayerRead($('insp'),n); return; }
  if(!canAttune(n)){ toast('Locked — prerequisites unmet','warn'); renderPlayerRead($('insp'),n); return; }
  if(S.simPts<n.cost){ toast('Insufficient attunement in sim','warn'); return; }
  S.sim.add(n.id); S.simPts-=n.cost; $('pvPts').textContent=S.simPts;
  renderCanvas(); renderPlayerRead($('insp'),n);
}
function renderPlayerRead(box,n){
  n = n || (S.sel?node(S.sel):null);
  $('inspMeta').innerHTML='<span class="acc">Player Read</span>';
  if(!n){ box.innerHTML='<div class="insp-empty"><div class="ic-big"><i class="fa-solid fa-eye"></i></div><div class="t">Preview Mode</div>'+
    '<div class="d">This is the tree as the party sees it. Click nodes to spend simulated attunement and walk the unlock path before you publish.</div></div>'; return; }
  const state=S.sim.has(n.id)?'Attuned':canAttune(n)?'Available':'Locked';
  const concealed=n.concealed&&!S.sim.has(n.id);
  box.innerHTML='<div class="imeta" style="border-left-color:var(--cyan);background:rgba(0,166,214,.06);border-color:rgba(0,166,214,.3)">'+
      '<i class="fa-solid '+(concealed?'fa-question':n.icon)+'" style="color:var(--cyan-hot)"></i>'+
      '<span class="t" style="color:var(--cyan-hot)">'+(concealed?'???':esc(n.name))+'</span><span class="s">'+state+'</span></div>'+
    '<div class="chips"><span class="chip">'+esc(tree().branches[n.branch]||n.branch)+'</span><span class="chip">Tier '+n.tier+'</span><span class="chip">'+(n.cost?'Cost '+n.cost:'Free')+'</span></div>'+
    '<div class="sec"><span class="field-lab">Effect</span></div>'+
    '<div style="font-family:var(--font-prose);font-size:15px;line-height:1.55;color:'+(concealed?'var(--beige-dim)':'var(--text)')+'">'+(concealed?'Node data withheld until prerequisites resolve.':esc(n.effect)||'—')+'</div>'+
    (n.dm?'<div class="sec"><span class="field-lab">DM Note</span></div><div style="font-family:var(--font-mono);font-size:10.5px;line-height:1.6;color:var(--amber)">// '+esc(n.dm)+'</div>':'');
}

/* ---------- pan / zoom ---------- */
let tagT;
function refreshTags(){ clearTimeout(tagT); tagT=setTimeout(()=>{ if(S.mode==='author') renderCanvas(); },120); }
function apply(){ refreshTags(); canvas.style.transform='translate('+S.panX.toFixed(1)+'px,'+S.panY.toFixed(1)+'px) scale('+S.zoom.toFixed(3)+')'; }
const clampZ=z=>Math.max(.28,Math.min(2.4,z));
function fit(){ const vw=stage.clientWidth,vh=stage.clientHeight,sz=CR()*2; if(!vw)return;
  const top=S.mode==='preview'?38:0;              // clear the preview banner
  S.zoom=clampZ(Math.min(vw/sz,(vh-top)/sz)*.94);
  S.panX=(vw-sz*S.zoom)/2; S.panY=top+(vh-top-sz*S.zoom)/2; apply(); }
function center(id){ const n=node(id); if(!n)return; const p=xy(n);
  S.panX=stage.clientWidth/2-p.x*S.zoom; S.panY=stage.clientHeight/2-p.y*S.zoom; apply(); }
function zoomAt(f,ox,oy){ const nz=clampZ(S.zoom*f), wx=(ox-S.panX)/S.zoom, wy=(oy-S.panY)/S.zoom;
  S.zoom=nz; S.panX=ox-wx*S.zoom; S.panY=oy-wy*S.zoom; apply(); }

stage.addEventListener('wheel',e=>{ e.preventDefault(); const r=stage.getBoundingClientRect();
  zoomAt(e.deltaY<0?1.12:1/1.12,e.clientX-r.left,e.clientY-r.top); },{passive:false});

let dragging=false,moved=false,sx=0,sy=0,spx=0,spy=0;
stage.addEventListener('pointerdown',e=>{ dragging=true;moved=false;sx=e.clientX;sy=e.clientY;spx=S.panX;spy=S.panY; });
window.addEventListener('pointermove',e=>{
  if(S.linkSrc){ ghostLine(e); }
  if(!dragging) return;
  const dx=e.clientX-sx,dy=e.clientY-sy;
  if(!moved&&Math.hypot(dx,dy)>4){moved=true;pad.classList.add('grabbing');}
  if(moved){ S.panX=spx+dx; S.panY=spy+dy; apply(); }
});
window.addEventListener('pointerup',()=>{ dragging=false; pad.classList.remove('grabbing'); });
stage.addEventListener('click',e=>{
  if(moved){ moved=false; return; }
  const r=stage.getBoundingClientRect();
  const wx=(e.clientX-r.left-S.panX)/S.zoom, wy=(e.clientY-r.top-S.panY)/S.zoom;
  if(S.mode==='author'&&S.tool==='add'){ addNodeAt(wx,wy); return; }
  if(S.linkSrc){ S.linkSrc=null; renderCanvas(); return; }
  S.sel=null; S.selEdge=null; renderCanvas(); renderInspector();
});
function ghostLine(e){
  svg.querySelectorAll('.link-ghost').forEach(g=>g.remove());
  const src=node(S.linkSrc); if(!src) return;
  const r=stage.getBoundingClientRect(), a=xy(src);
  const wx=(e.clientX-r.left-S.panX)/S.zoom, wy=(e.clientY-r.top-S.panY)/S.zoom;
  const l=document.createElementNS(SVGNS,'path'); l.setAttribute('class','link-ghost');
  l.setAttribute('d','M '+a.x+' '+a.y+' L '+wx+' '+wy); svg.appendChild(l);
}

/* ---------- chrome wiring ---------- */
function setTool(t){ S.tool=t; S.linkSrc=null;
  document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===t));
  pad.classList.toggle('linking',t==='link'); pad.classList.toggle('adding',t==='add');
  setHint(); renderCanvas();
}
function setHint(){
  $('hint').textContent = S.mode==='preview' ? 'Click an available node to spend simulated attunement · Drag to pan · Scroll to zoom'
    : S.tool==='add' ? 'Click anywhere on a ring to drop a node — it auto-links to the nearest inner node'
    : S.tool==='link' ? 'Click the prerequisite node, then the node it unlocks'
    : 'Drag node to re-tier · Drag empty space to pan · Scroll to zoom';
}
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
$('snapBtn').addEventListener('click',()=>{ S.snap=!S.snap; $('snapBtn').classList.toggle('on',S.snap);
  $('snapBtn').innerHTML='<i class="fa-solid fa-bullseye"></i> <span class="lbl">Snap '+(S.snap?'15°':'off')+'</span>'; renderCanvas(); });
$('ringPlus').addEventListener('click',()=>{ S.rings=Math.min(7,S.rings+1); renderCanvas(); });
$('ringMinus').addEventListener('click',()=>{ S.rings=Math.max(Math.max(...tree().nodes.map(n=>n.tier)),S.rings-1); renderCanvas(); });
$('delBtn').addEventListener('click',deleteSel);
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{
  S.mode=b.dataset.mode; S.linkSrc=null;
  document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('on',x.dataset.mode===S.mode));
  document.body.classList.toggle('preview',S.mode==='preview');
  $('pvBanner').style.display=S.mode==='preview'?'flex':'none';
  if(S.mode==='preview'){ resetSim(); $('pvPts').textContent=S.simPts; toast('Preview — party data untouched','cyan'); }
  setHint(); renderCanvas(); renderInspector(); fit();
}));
$('pvReset').addEventListener('click',e=>{ e.stopPropagation(); resetSim(); $('pvPts').textContent=S.simPts; renderCanvas(); renderInspector(); });
document.querySelectorAll('.zoomers button').forEach(b=>b.addEventListener('click',()=>{
  const vw=stage.clientWidth,vh=stage.clientHeight;
  if(b.dataset.z==='in') zoomAt(1.25,vw/2,vh/2);
  if(b.dataset.z==='out') zoomAt(1/1.25,vw/2,vh/2);
  if(b.dataset.z==='fit') fit();
}));
$('newShard').addEventListener('click',()=>{
  let i=1; while(SHARDS['new'+i]) i++;
  SHARDS['new'+i]={id:'new'+i,name:'Untitled Shard',rarity:'Common',module:'Unassigned',icon:'fa-diamond',capacity:6,published:false,bound:[],
    flavor:'',attuneRule:'Requires attunement · 1 shard slot',baseMods:[],baseFeatures:[],baseDetails:[],dm:'',
    branches:{core:'Core',alpha:'Branch A',beta:'Branch B'},
    nodes:[{id:'core',name:'Shard Core',tier:0,branch:'core',angle:0,cost:0,icon:'fa-diamond',prereqs:[],effect:'Base attunement.',dm:''}]};
  S.shard='new'+i; S.tab='shard'; S.sel='core'; S.rings=3; resetSim(); renderAll(); fit(); toast('New lattice created');
});
$('saveBtn').addEventListener('click',()=>{ S.dirty=false; $('dirty').classList.remove('on'); toast('Draft saved · '+tree().name); console.log('[LATTICE] save draft',tree()); });
$('pubBtn').addEventListener('click',()=>{
  if(audit().some(i=>i.sev==='err')){ toast('Blocked — resolve lattice errors first','warn'); return; }
  tree().published=true; S.dirty=false; $('dirty').classList.remove('on');
  toast('Published to party · '+tree().name); renderLib(); console.log('[LATTICE] publish',tree());
});
$('revertBtn').addEventListener('click',()=>toast('Revert — would reload last saved draft','warn'));
$('backBtn').addEventListener('click',()=>toast('Return to Operator Console','warn'));

document.addEventListener('keydown',e=>{
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const k=e.key.toLowerCase();
  if(k==='v') setTool('select'); if(k==='n') setTool('add'); if(k==='l') setTool('link');
  if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); deleteSel(); }
  if(e.key==='Escape'){ S.sel=null; S.selEdge=null; S.linkSrc=null; renderCanvas(); renderInspector(); }
  if(k==='f') fit();
});

let toastT;
function toast(msg,kind){ const el=$('toast'); $('toastTx').textContent=msg;
  el.className='toast on'+(kind==='cyan'?' cyanv':''); el.querySelector('i').className='fa-solid '+(kind==='warn'?'fa-triangle-exclamation':'fa-circle-check');
  clearTimeout(toastT); toastT=setTimeout(()=>el.className='toast'+(kind==='cyan'?' cyanv':''),2200); }
function setDirty(){ S.dirty=true; $('dirty').classList.add('on'); }

function renderAll(){ renderLib(); renderCanvas(); renderAudit(); renderInspector(); }
resetSim(); renderAll(); fit();
window.addEventListener('resize',fit);
if(document.fonts&&document.fonts.ready) document.fonts.ready.then(fit);
