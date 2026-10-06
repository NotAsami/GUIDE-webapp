/* applies-to.js — pure model for applies-to wiring (docs/Applies-to Wiring Plan.md).
   No DOM. Loaded by the Feature Graph and by feature-graph.test.html.
   Mirrors graph.ts where it exists (normalizeTag, asKey, reqKeys, matchCount, affectedBy, auditNode's
   target rules); everything else is the plan's D1–D24. One predicate — holds() — decides every match. */
(function(root){
'use strict';

/* graph.ts L439, verbatim. */
function normalizeTag(raw){return String(raw).trim().toLowerCase().replace(/\s+/g,'_')}
/* graph.ts asKey: tags normalised, everything else verbatim. */
const asKey=t=>(t.startsWith('tag:')?'tag:'+normalizeTag(t.slice(4)):t);
const GID_KINDS=['feature','spell','item','weapon','shardnode'];
function selKind(sel){if(sel.startsWith('tag:'))return 'tag';if(sel.startsWith('roll:'))return 'roll';const k=sel.split(':')[0];return GID_KINDS.includes(k)?'thing':'unknown'}
const rollBody=sel=>sel.slice(5);
const rollKindOf=sel=>rollBody(sel).split('.')[0];

/* THE predicate (D22). Engine and editor count both call this and nothing else. */
let holdsCalls={count:0,engine:0};
function holds(sel,keys,who){holdsCalls.count++;if(who)holdsCalls[who]=(holdsCalls[who]||0)+1;return keys.has(asKey(sel))}

const isD20=k=>k==='check'||k==='save'||k==='attack';
/* graph.ts reqKeys, ported. */
function reqKeys(req){return [req.subject,...(req.tags||[]).map(t=>'tag:'+normalizeTag(t)),req.kind?'roll:'+req.kind:null,req.kind&&isD20(req.kind)?'roll:d20':null,req.kind&&req.sub?'roll:'+req.kind+'.'+req.sub:null,req.kind&&req.ability?'roll:'+req.kind+'.'+req.ability:null].filter(Boolean)}

/* Engine port: does this effect apply to this roll? resolve()'s match, including §54's `and`. */
function applies(eff,owner,req){
  const keys=new Set(reqKeys(req));
  const ts=(eff.target&&eff.target.length)?eff.target:[owner];
  return eff.match==='and'?ts.every(t=>holds(t,keys,'engine')):ts.some(t=>holds(t,keys,'engine'));
}

/* ---------- the catalog (fixture standing in for useCatalogNodes + the projection) ---------- */
const W=(id,name,tags,kind)=>({gid:(kind||'item')+':'+id,name,tags,kind:kind==='weapon'?'Weapon':kind==='spell'?'Spell':kind==='feature'?'Feature':'Item'});
const CATALOG_NODES=[
  W('arbiter','Judgement',['judgement','radiant'],'feature'),
  W('brutal','Brutal Strike',['class','barbarian','brutal_strike'],'feature'),
  W('second','Second Wind',['martial','healing'],'feature'),
  W('ember','Ember Ward',['fire'],'feature'),
  W('reckless','Reckless Attack',['barbarian'],'feature'),
  W('radiant_soul','Radiant Soul',['radiant'],'feature'),
  W('sacred_flame','Sacred Flame',['radiant','cantrip'],'spell'),
  W('searing_smite','Searing Smite',['fire','smite'],'spell'),
  W('fire_bolt','Fire Bolt',['fire','cantrip'],'spell'),
  W('sunblade','Sunblade',['radiant','judgements_edge','weapon']),W('sunblade','Sunblade',['radiant','judgements_edge','weapon'],'weapon'),
  W('oathbound','Oathbound Longsword',['judgements_edge','weapon']),W('oathbound','Oathbound Longsword',['judgements_edge','weapon'],'weapon'),
  W('ashen_brand','Ashen Brand',['fire','weapon','judgements_edge']),W('ashen_brand','Ashen Brand',['fire','weapon','judgements_edge'],'weapon'),
  W('ember_charm','Ember Charm',['fire'])
];
const namesByGid=new Map(CATALOG_NODES.map(n=>[n.gid,{name:n.name,kind:n.kind}]));
/* Rolls a thing can raise — what "applies to some roll of that thing" enumerates. The null-kind baseline is
   the thing itself, so a lone tag/gid selector counts exactly as the old matchCount did. */
function rollsOf(n){
  const base={subject:n.gid,tags:n.tags};const k=n.gid.split(':')[0];
  const out=[{...base}];
  if(k==='weapon')out.push({...base,kind:'attack',sub:'melee',ability:'str'},{...base,kind:'damage',sub:'melee'});
  if(k==='spell')out.push({...base,kind:'attack',sub:'spell'},{...base,kind:'damage',sub:'spell'},{...base,kind:'save'});
  if(k==='feature')out.push({...base,kind:'feature'});
  return out;
}
/* D22: one count function. A single selector is the one-selector case; roll-only lists are ∞ (graph.ts L1421). */
function matchCount(selectors,mode,nodes){
  nodes=nodes||CATALOG_NODES;mode=mode||'or';
  const sels=[...new Set(selectors.map(asKey))];
  if(!sels.length)return 0;
  if(sels.every(s=>s.startsWith('roll:')))return Infinity;
  return nodes.filter(n=>rollsOf(n).some(req=>{const keys=new Set(reqKeys(req));return mode==='and'?sels.every(s=>holds(s,keys,'count')):sels.some(s=>holds(s,keys,'count'))})).length;
}
function fmtCount(c){return c===Infinity?'every roll':c+(c===1?' thing':' things')}

/* Other features' contributions — the D14 projection. Only what the builder needs. */
const OTHER_PROJECTION=[
  {owner:'feature:radiant_soul',name:'Radiant Soul',effects:[{id:'rs1',label:'Radiant Soul',op:'add',target:['tag:radiant'],when:true,ask:false}]},
  {owner:'feature:reckless',name:'Reckless Attack',effects:[{id:'ra1',label:'Reckless Attack',op:'adv',target:['roll:attack.str'],when:true,ask:false}]},
  {owner:'spell:searing_smite',name:'Searing Smite',effects:[{id:'ss1',label:'Searing Smite',op:'add',target:['roll:damage.melee'],when:false,ask:true}]},
  {owner:'item:sunblade',name:'Sunblade',effects:[{id:'sb1',label:'Sunblade radiance',op:'add',target:['tag:judgements_edge'],when:false,ask:false}]}
];
const fetchSpy={calls:0};
/* Fetched once when the graph view opens, never at load (D14, T-C2). `live` = projections of in-editor features. */
function fetchProjection(live){fetchSpy.calls++;return new Promise(r=>setTimeout(()=>r(OTHER_PROJECTION.concat(live||[])),120))}

/* ---------- shared index builder (D2) ---------- */
function indexEffects(sources){
  const index=new Map(),byOwner=new Map();
  const push=(k,e)=>{const a=index.get(k)||[];if(!a.includes(e))a.push(e);index.set(k,a)};
  for(const s of sources){for(const eff of s.effects){
    const e={eff,owner:s.owner,name:s.name};
    byOwner.set(s.owner,[...(byOwner.get(s.owner)||[]),e]);
    const ts=(eff.target&&eff.target.length)?eff.target:[s.owner];
    for(const t of ts)push(asKey(t),e);
  }}
  return {index,byOwner};
}
/* graph.ts affectedBy, over the catalog index, minus `and` effects (D17 — they affect the intersection, listed on the junction). */
function affectedBy(idx,key,nodes){
  nodes=nodes||CATALOG_NODES;const keys=[key];
  if(selKind(key)==='thing'){const n=nodes.find(x=>x.gid===key);if(n)(n.tags||[]).forEach(t=>keys.push('tag:'+normalizeTag(t)))}
  const seen=new Set(),out=[];
  for(const k of keys)for(const e of idx.index.get(k)||[]){if(e.owner===key||seen.has(e.eff)||e.eff.match==='and')continue;seen.add(e.eff);out.push(e)}
  return out;
}

/* ---------- target legality, declared once (D19). Picker, ports and audit all read this. ---------- */
const ALL=['thing','tag','roll'];
const TARGETS={
  add:{kinds:ALL,empty:'own',armable:true},adv:{kinds:ALL,empty:'own',armable:true},dis:{kinds:ALL,empty:'own',armable:true},
  note:{kinds:ALL,empty:'own',armable:true},cancelAdv:{kinds:ALL,empty:'own',armable:true},crit:{kinds:ALL,empty:'own',armable:true},
  floor:{kinds:['roll'],rolls:['check','save'],empty:'error',why:'A floor needs a check or a save'},
  reroll:{kinds:['roll'],families:true,empty:'error',why:'Reroll needs a roll target'},
  resist:{kinds:['tag'],empty:'error',why:'Damage flag targets a tag'},vuln:{kinds:['tag'],empty:'error',why:'Damage flag targets a tag'},immune:{kinds:['tag'],empty:'error',why:'Damage flag targets a tag'},
  grant:{kinds:['roll'],empty:'error',why:'Grant needs a roll target'},
  addUses:{kinds:['thing'],things:['feature'],empty:'own',ownLabel:'own uses',why:'addUses targets a feature'}
};
const OP_NAME={cancelAdv:'cancel adv',add:'add',adv:'adv',dis:'dis',note:'note',crit:'crit',floor:'floor',reroll:'reroll',resist:'resist',vuln:'vuln',immune:'immune',grant:'grant',addUses:'addUses'};
const hasPort=op=>!!TARGETS[op];
const d20Family=r=>['d20','attack','save','check'].includes(rollKindOf(r));
/* null = legal. Otherwise {rule,msg}. `others` = the effect's other targets, for family rules. */
function accepts(eff,sel,others){
  const d=TARGETS[eff.op];const k=selKind(sel);const op=OP_NAME[eff.op]||eff.op;
  if(!d)return {rule:op+' takes no target',msg:`${op} changes the sheet or runs on the press — it has nothing to point at.`};
  if(k==='unknown')return {rule:'Unknown selector',msg:`"${sel}" names no namespace. Use a thing, tag:, or roll:.`};
  if(!d.kinds.includes(k))return {rule:d.why||op+' can’t target a '+k,msg:`${op} accepts ${d.kinds.map(x=>x==='thing'?'a specific thing':x==='tag'?'a tag':'a roll kind').join(' or ')} — not ${k==='thing'?'a specific thing':k==='tag'?'a tag':'a roll kind'}.`};
  if(k==='thing'&&d.things&&!d.things.includes(sel.split(':')[0]))return {rule:d.why,msg:`Only a ${d.things.join(' or ')} has a use counter.`};
  if(k==='roll'&&d.rolls&&!d.rolls.includes(rollKindOf(sel)))return {rule:d.why,msg:`Only a check or a save has a total a floor can raise. ${sel} ${rollKindOf(sel)==='d20'?'includes attack rolls':'is not one'}.`};
  if(k==='roll'&&d.families){const o=(others||[]).filter(t=>t.startsWith('roll:'));if(o.some(t=>d20Family(t)!==d20Family(sel)))return {rule:'Reroll spans two kinds of die',msg:'A reroll re-runs a d20 or damage dice — one or the other, never both in one effect.'}}
  if(eff.once&&d.armable&&k!=='roll')return {rule:'Armed modifier needs a roll target',msg:'Arms once waits for the next matching roll — “your next attack”, not “anything fiery”. Target a roll kind, or turn off Arms once.'};
  return null;
}
/* Destination refusals that don't depend on the op (P2, P3). */
function refuseDestination(kind){
  if(kind==='contrib')return {rule:'A contribution is never a destination',msg:'A contribution never modifies another contribution. Point it at a thing, a tag or a roll kind.'};
  if(kind==='var')return {rule:'Applies-to can’t land on a variable',msg:'Variables are state. Applies-to points at what a rule affects — a thing, a tag or a roll kind.'};
  if(kind==='data')return {rule:'That’s a data port',msg:'Data ports take values. Applies-to points at a thing, a tag or a roll kind.'};
  return {rule:'Not a target',msg:'Applies-to lands on a thing, a tag or a roll kind.'};
}

/* ---------- write path (D6, D7, D15). Rendering calls none of these. ---------- */
function dedupe(ts){const seen=new Set(),out=[];for(const t of ts||[]){const k=asKey(t);if(!seen.has(k)){seen.add(k);out.push(k)}}return out}
function isTargeted(eff,sel){return (eff.target||[]).some(t=>asKey(t)===asKey(sel))}
function connect(eff,sel){if(isTargeted(eff,sel))return false;eff.target=dedupe([...(eff.target||[]),sel]);return true}
function disconnect(eff,key){eff.target=dedupe((eff.target||[]).filter(t=>asKey(t)!==key));}
function setMatch(eff,m){if(m==='and')eff.match='and';else delete eff.match}

/* ---------- derived view (D4, D8, D9) ---------- */
function viewTargets(eff,owner){
  const raw=eff.target||[];const keys=[];for(const t of raw){const k=asKey(t);if(k!==owner&&!keys.includes(k))keys.push(k)}
  const self=raw.some(t=>asKey(t)===owner);
  return {keys,self,own:!keys.length,and:eff.match==='and'&&keys.length>1};
}
function gateStyle(eff){return eff.ask&&String(eff.ask).trim()?'ask':eff.when&&String(eff.when).trim()?'when':'none'}

/* ---------- audit (auditNode's target rules, reading TARGETS) ---------- */
const GRANT_SENTENCE=(label,n)=>`${label} names ${n} rolls, which places ${n} separate bonuses on the recipient — they can use every one. For “their next D20 Test”, target roll:d20 alone.`;
function auditEffect(eff,owner,opts){
  opts=opts||{};const ready=opts.ready!==false;const nodes=opts.nodes||CATALOG_NODES;const out=[];const id=eff.id;const L=eff.label||eff.id;
  const d=TARGETS[eff.op];const raw=eff.target||[];const v=viewTargets(eff,owner);
  if(!d){if(raw.length)out.push({sev:'err',id,t:'Target on '+eff.op,s:`${L} carries a target, but ${eff.op} takes none.`});return out}
  const keysSeen=new Map();raw.forEach(t=>{const k=asKey(t);keysSeen.set(k,(keysSeen.get(k)||0)+1)});
  for(const [k,c] of keysSeen)if(c>1)out.push({sev:'warn',id,t:'Duplicate target',s:`${L} lists ${k} ${c} times (${raw.filter(t=>asKey(t)===k).join(', ')}). The next edit saves one.`});
  if(v.self)out.push({sev:'warn',id,t:'Redundant self-target',s:`${L} names its own feature, which is what an empty target already means.`});
  if(v.own&&d.empty==='error')out.push({sev:'err',id,t:d.why||eff.op+' needs a target',s:`${L} has no target. For ${eff.op}, “no selector = own roll” says nothing.`});
  for(const k of v.keys){
    const r=accepts(eff,k,v.keys.filter(x=>x!==k));if(r)out.push({sev:'err',id,key:k,t:r.rule,s:L+': '+r.msg});
    if(selKind(k)==='thing'&&ready&&!namesByGid.has(k))out.push({sev:'err',id,key:k,t:'Dangling target',s:`${L} targets ${k}, which no catalog row has.`});
    if(selKind(k)==='tag'&&matchCount([k],'or',nodes)===0)out.push({sev:'warn',id,key:k,t:'Zero live matches',s:`${k} matches nothing in the catalog. Correct if nothing carries it yet; a typo otherwise.`});
  }
  if(v.and){const rolls=v.keys.filter(k=>k.startsWith('roll:')),things=v.keys.filter(k=>selKind(k)==='thing');
    const kinds=[...new Set(rolls.map(rollKindOf))];
    if(kinds.length>1)out.push({sev:'err',id,t:'and can never match',s:`${L} requires ${rolls.join(' and ')} on one roll — a roll has one kind.`});
    else if(things.length>1)out.push({sev:'err',id,t:'and can never match',s:`${L} requires ${things.join(' and ')} as one roll’s subject — a roll has one.`});}
  const rolls=v.keys.filter(k=>k.startsWith('roll:'));
  if(eff.once&&!eff.oneOf&&d.armable&&v.keys.length>1)out.push({sev:'warn',id,t:'Arms once per selector',s:`${L} arms once, but ${v.keys.length} targets mint ${v.keys.length} separate armed bonuses for one use.`,fix:'oneOf'});
  if(eff.op==='grant'&&rolls.length>1)out.push({sev:'warn',id,t:'Grant hands out one bonus per target',s:GRANT_SENTENCE(L,rolls.length)});
  return out;
}
/* The inline notice reads the same audit rule it anticipates (E15). */
function connectNotice(eff,owner){const a=auditEffect(eff,owner).find(x=>x.t==='Arms once per selector'||x.t==='Grant hands out one bonus per target');return a?{text:a.s,fix:a.fix||null,t:a.t}:null}

/* ---------- three-valued expressions (plan 7b) ---------- */
const U={u:true};const isU=v=>v===U;
function tokenize(s){
  s=String(s).replace(/≥/g,'>=').replace(/≤/g,'<=').replace(/≠/g,'!=').replace(/−/g,'-').replace(/×/g,'*');
  const re=/\s*(\d+d\d+|\d+(?:\.\d+)?|[A-Za-z_]\w*|>=|<=|==|!=|&&|\|\||[()?:!<>+\-*/|,])/y;const out=[];let m;re.lastIndex=0;
  while(re.lastIndex<s.length){const i=re.lastIndex;m=re.exec(s);if(!m){if(/^\s*$/.test(s.slice(i)))break;throw new Error('bad token at '+i)}out.push(m[1])}
  return out;
}
function parse(src){
  const t=tokenize(src);let i=0;const pk=()=>t[i],nx=()=>t[i++],eat=x=>{if(t[i]!==x)throw new Error('expected '+x);i++};
  const tern=()=>{const c=or();if(pk()==='?'){nx();const a=tern();eat(':');const b=tern();return {op:'?',c,a,b}}return c};
  const or=()=>{let l=and();while(pk()==='||'||pk()==='or'){nx();l={op:'||',l,r:and()}}return l};
  const and=()=>{let l=not();while(pk()==='&&'||pk()==='and'){nx();l={op:'&&',l,r:not()}}return l};
  const not=()=>{if(pk()==='!'||pk()==='not'){nx();return {op:'!',x:not()}}return cmp()};
  const cmp=()=>{const l=add();if(['>=','<=','==','!=','>','<'].includes(pk())){const o=nx();return {op:o,l,r:add()}}return l};
  const add=()=>{let l=mul();while(pk()==='+'||pk()==='-'){const o=nx();l={op:o,l,r:mul()}}return l};
  const mul=()=>{let l=un();while(pk()==='*'||pk()==='/'){const o=nx();l={op:o,l,r:un()}}return l};
  const un=()=>{if(pk()==='-'){nx();return {op:'neg',x:un()}}return prim()};
  const prim=()=>{const x=nx();if(x===undefined)throw new Error('eof');
    if(x==='('){const e=tern();eat(')');return e}
    if(x==='|'){const e=tern();eat('|');return {op:'abs',x:e}}
    if(/^\d+d\d+$/.test(x))return {v:x};
    if(/^\d/.test(x))return {v:+x};
    if(x==='true'||x==='false')return {v:x==='true'};
    if(pk()==='('){nx();const a=[];if(pk()!==')'){a.push(tern());while(pk()===','){nx();a.push(tern())}}eat(')');return {fn:x,a}}
    return {id:x}};
  const e=tern();if(i<t.length)throw new Error('trailing');return e;
}
function ev(n,look){
  if('v' in n)return n.v;
  if(n.id)return look(n.id);
  if(n.fn){const a=n.a.map(x=>ev(x,look));if(a.some(isU))return U;if(n.fn==='floor')return Math.floor(a[0]);if(n.fn==='max')return Math.max(...a);if(n.fn==='min')return Math.min(...a);return U}
  switch(n.op){
    case '?':{const c=ev(n.c,look);if(isU(c)){const a=ev(n.a,look),b=ev(n.b,look);return !isU(a)&&a===b?a:U}return c?ev(n.a,look):ev(n.b,look)}
    case '&&':{const l=ev(n.l,look);if(l===false)return false;const r=ev(n.r,look);if(r===false)return false;return isU(l)||isU(r)?U:true}
    case '||':{const l=ev(n.l,look);if(l===true)return true;const r=ev(n.r,look);if(r===true)return true;return isU(l)||isU(r)?U:false}
    case '!':{const x=ev(n.x,look);return isU(x)?U:!x}
    case 'neg':{const x=ev(n.x,look);return isU(x)||typeof x!=='number'?U:-x}
    case 'abs':{const x=ev(n.x,look);return isU(x)||typeof x!=='number'?U:Math.abs(x)}
  }
  const l=ev(n.l,look),r=ev(n.r,look);if(isU(l)||isU(r))return U;
  if(typeof l==='string'||typeof r==='string')return U;
  switch(n.op){case '+':return l+r;case '-':return l-r;case '*':return l*r;case '/':return r===0?U:Math.floor(l/r);
    case '>=':return l>=r;case '<=':return l<=r;case '>':return l>r;case '<':return l<r;case '==':return l===r;case '!=':return l!==r}
  return U;
}
/* Class progression (D20): a class grant is a pure function of level. */
const CLASSES={
  Barbarian:{levels:[9,13,17],grants:{9:['Brutal Strike'],13:['Improved Brutal Strike'],17:['Improved Brutal Strike (Enhanced)']}},
  Arbiter:{levels:[3,7,11],grants:{3:['Judgement'],7:['Merciful Strike']}}
};
const hasIdent=name=>'has_'+String(name).toLowerCase().replace(/[()]/g,'').trim().replace(/\s+/g,'_');
/* preview = {cls, lv} or null. derived = {name: formula} for the feature's derived variables. */
function previewScope(preview,derived){
  const c=CLASSES[preview.cls];const has={};
  if(c)for(const [lv,names] of Object.entries(c.grants))for(const nm of names)has[hasIdent(nm)]=+lv<=preview.lv;
  const memo=new Map(),visiting=new Set();
  const look=id=>{
    if(id==='level')return preview.lv;
    if(id in has)return has[id];
    if(derived&&derived[id]!=null){if(memo.has(id))return memo.get(id);if(visiting.has(id))return U;visiting.add(id);let v=U;try{v=ev(parse(derived[id]),look)}catch(_){v=U}visiting.delete(id);memo.set(id,v);return v}
    return U;
  };
  return look;
}
function evalPreview(expr,preview,derived){if(!preview||!String(expr||'').trim())return U;try{return ev(parse(expr),previewScope(preview,derived))}catch(_){return U}}
/* 'active' | 'off' | 'undetermined'. An ask is never decidable (D21); no preview decides nothing (D10). */
function previewState(gate,preview,derived){
  if(!preview)return 'undetermined';
  if(gate.ask&&String(gate.ask).trim()){const w=gate.when?evalPreview(gate.when,preview,derived):U;return w===false?'off':'undetermined'}
  if(!gate.when||!String(gate.when).trim())return 'active';
  const v=evalPreview(gate.when,preview,derived);return v===true?'active':v===false?'off':'undetermined';
}
/* {…} in labels: resolved only where the preview decides it; otherwise the raw expression stays. */
function interpolate(text,preview,derived){return String(text||'').replace(/\{([^}]+)\}/g,(m,e)=>{const v=evalPreview(e,preview,derived);return isU(v)?m:String(v)})}

root.AppliesTo={normalizeTag,asKey,selKind,holds,holdsCalls,reqKeys,applies,rollsOf,matchCount,fmtCount,
  CATALOG_NODES,namesByGid,OTHER_PROJECTION,fetchProjection,fetchSpy,indexEffects,affectedBy,
  TARGETS,hasPort,accepts,refuseDestination,dedupe,isTargeted,connect,disconnect,setMatch,viewTargets,gateStyle,
  auditEffect,connectNotice,GRANT_SENTENCE,parse,evalPreview,previewState,interpolate,CLASSES,hasIdent,U,isU};
})(typeof window!=='undefined'?window:globalThis);
