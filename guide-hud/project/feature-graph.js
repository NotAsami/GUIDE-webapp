/* G.U.I.D.E. Feature Graph — the reserved "02 · Dependency Graph" view over ONE feature object.
   Aligned to the Feature Editor surface reference: one press per feature (activation), rules in three op groups
   (passive / sheet / activation), target selectors (thing · tag: · roll:, or/and), the two gates (when / ask),
   once + ask = an armed offer, feature-level picks. Nodes/edges are a projection of that data; the form
   is re-derived from the same objects, so editing either updates the other. */
(function(){
const HDR=30;
const KIND={
  event:{label:'Event',sub:'the press · or proposed',icon:'fa-hand-pointer',c:'var(--amber)'},
  cond:{label:'Condition',sub:'when · app decides',icon:'fa-code-branch',c:'var(--beige)'},
  ask:{label:'Ask',sub:'ask · a human decides',icon:'fa-user',c:'var(--cyan)'},
  action:{label:'Activation outcome',sub:'writes on press',icon:'fa-pen',c:'var(--text)'},
  contrib:{label:'Contribution',sub:'modifies a roll',icon:'fa-infinity',c:'var(--violet)'},
  sheet:{label:'Sheet rule',sub:'moves a sheet number',icon:'fa-file-lines',c:'#bfae80'},
  var:{label:'Variable',sub:'stored / derived',icon:'fa-database',c:'var(--good)'},
  picks:{label:'Picks',sub:'take N of the offers',icon:'fa-list-check',c:'var(--amber)'}
};
const TYPE={f:'flow',n:'number',b:'boolean',t:'target',x:'roll context'};
const P=(id,t,l)=>({id,t,l});
const DMG=['—','acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'];
const ABIL=['STR','DEX','CON','INT','WIS','CHA'];
/* op catalog — src/lib/opSchema.ts, reduced to what the graph needs to render and edit */
const OPS={
  add:{g:'passive',icon:'fa-plus',f:[['amount','Amount'],['dtype','Damage type',DMG]],sum:n=>n.amount+(n.dtype&&n.dtype!=='—'?' '+n.dtype:'')},
  adv:{g:'passive',icon:'fa-angles-up',f:[],sum:()=>'advantage'},
  cancelAdv:{g:'passive',icon:'fa-ban',f:[],prop:true,sum:()=>'cancel advantage'},
  dis:{g:'passive',icon:'fa-angles-down',f:[],sum:()=>'disadvantage'},
  crit:{g:'passive',icon:'fa-burst',f:[['crits','Crits on']],sum:n=>'crits on '+n.crits},
  floor:{g:'passive',icon:'fa-arrow-up-from-bracket',f:[['atLeast','At least']],sum:n=>'at least '+n.atLeast},
  reroll:{g:'passive',icon:'fa-rotate',f:[['rr','The new roll is',['advantage','new','better']]],sum:n=>'reroll · '+n.rr},
  note:{g:'passive',icon:'fa-comment',f:[['text','Note text']],sum:n=>'“'+n.text+'”'},
  resist:{g:'passive',icon:'fa-shield-halved',f:[],sum:()=>'resist'},
  vuln:{g:'passive',icon:'fa-heart-crack',f:[],sum:()=>'vulnerable'},
  immune:{g:'passive',icon:'fa-shield',f:[],sum:()=>'immune'},
  boost:{g:'sheet',icon:'fa-arrow-trend-up',f:[['stat','Stat',ABIL],['amount','Amount'],['cap','Up to a maximum of']],sum:n=>n.stat+' +'+n.amount},
  useability:{g:'sheet',icon:'fa-right-left',f:[['ability','Ability',ABIL]],sum:n=>'may use '+n.ability},
  unarmored:{g:'sheet',icon:'fa-shirt',f:[['base','Base'],['plus','Plus besides DEX',ABIL]],sum:n=>'AC '+n.base+' + DEX + '+n.plus},
  setVar:{g:'activation',icon:'fa-equals',f:[['variable','Variable','var'],['value','Value']],sum:n=>n.variable+' ← '+n.value},
  addVar:{g:'activation',icon:'fa-plus-minus',f:[['variable','Variable','var'],['value','Change by']],sum:n=>n.variable+' += '+n.value},
  addUses:{g:'activation',icon:'fa-battery-half',f:[['value','Change by']],sum:n=>'uses '+n.value},
  addSlot:{g:'activation',icon:'fa-layer-group',f:[['value','Change by'],['level','Slot level']],sum:n=>'slot '+n.value},
  setHp:{g:'activation',icon:'fa-heart-pulse',f:[['value','Hit Points become']],sum:n=>'hp ← '+n.value},
  grant:{g:'activation',icon:'fa-hand-holding-heart',f:[['value','Amount']],sum:n=>'grant '+n.value}
};
const OPGROUP={passive:'Contributions',sheet:'On the sheet',activation:'Activation outcomes'};
const KIND_OF_GROUP={passive:'contrib',sheet:'sheet',activation:'action'};
const ACTS=['None (passive)','Action','Bonus action','Reaction','Free action'];
const RESETS=['Manual (DM)','Start of your turn','Short rest','Long rest'];
const VRESETS=['Never','Start of your turn','Short rest','Long rest'];
const SOURCES=['class','feat','racial','background','sense','other'];
/* the schema has ONE trigger — the press. Everything else is drawn so it can be discussed, and badged proposed. */
const EVENTS={
  press:{l:'Press · the Use button',src:'press',params:[]},
  roll:{l:'Roll made',src:'sheet',params:[{k:'kind',l:'Roll kind',d:'roll:attack'},{k:'out',l:'Outcome',o:['Any','Hit','Miss','Critical','Failed save','Passed save']}],sum:p=>p.kind+(p.out!=='Any'?' · '+p.out.toLowerCase():'')},
  varChange:{l:'Variable changes',src:'sheet',params:[{k:'v',l:'Variable',o:()=>F().nodes.filter(n=>n.kind==='var').map(n=>n.title)},{k:'dir',l:'Direction',o:['Any change','Rises','Falls']}],sum:p=>p.v+' · '+p.dir.toLowerCase()},
  hpZero:{l:'You reach 0 HP',src:'sheet',params:[],sum:()=>'your sheet'},
  turnStart:{l:'Turn starts',src:'bridge',params:[{k:'who',l:'Whose turn',o:['Yours','Any creature’s','An enemy’s']}],sum:p=>p.who.toLowerCase()+' turn'},
  targetSel:{l:'Target selected',src:'bridge',params:[],sum:()=>'GM client target'},
  reduced0:{l:'Creature reduced to 0 HP',src:'bridge',params:[{k:'by',l:'Reduced by',o:['You','An ally','Anyone']}],sum:p=>'by '+p.by.toLowerCase()}
};
function pressSub(f){return f.act==='None (passive)'?'passive · no button':f.act+' · '+(f.uses?f.uses+' / '+f.reset.toLowerCase():'at-will')}
function evSync(n,f){f=f||F();const E=EVENTS[n.ev];n.p=n.p||{};E.params.forEach(q=>{const o=typeof q.o==='function'?q.o():q.o;if(n.p[q.k]==null)n.p[q.k]=o?o[0]:q.d||''});n.sub=n.ev==='press'?pressSub(f):E.sum(n.p);n.ext=E.src==='bridge';n.prop=E.src!=='press'}
/* applies-to: targets live ON the rule (model C). Destinations are derived per render — see applies-to.js. */
const AT=window.AppliesTo;
const ROLL_SELECTORS=['d20','attack','attack.melee','attack.ranged','attack.spell','attack.str','attack.dex','attack.con','attack.int','attack.wis','attack.cha','damage','damage.melee','damage.ranged','damage.spell','save','save.str','save.dex','save.con','save.int','save.wis','save.cha','check','check.athletics','check.stealth','check.perception','check.initiative','feature'].map(r=>'roll:'+r);
function selSync(){}
function destLabel(k){const kind=AT.selKind(k);if(kind==='tag')return k.slice(4);if(kind==='roll')return k.slice(5).replace('.',' · ');const nm=AT.namesByGid.get(k);return nm?nm.name:k}
function destSub(k){const kind=AT.selKind(k);if(kind==='tag')return AT.fmtCount(AT.matchCount([k],'or'));if(kind==='roll')return 'every roll of this kind';const nm=AT.namesByGid.get(k);return nm?nm.kind:'no catalog row'}

function arbiter(){
  const nodes=[
    {id:'mercy',kind:'var',store:'stored',x:60,y:80,w:190,title:'mercy',vtype:'Number',init:'0',vreset:'Never',scope:'Player',vlabel:'Mercy',rows:[[null,P('out','n','value')]]},
    {id:'condemn',kind:'var',store:'stored',x:60,y:220,w:190,title:'condemnation',vtype:'Number',init:'0',vreset:'Never',scope:'Player',vlabel:'Condemnation',rows:[[null,P('out','n','value')]]},
    {id:'delta',kind:'var',store:'derived',x:320,y:130,w:220,title:'judgementDelta',formula:'mercy − condemnation',rows:[[P('a','n','mercy'),P('out','n','value')],[P('b','n','condemnation'),null],[P('c','n','nextJudgementState'),null,'demo']]},
    {id:'tier',kind:'var',store:'derived',x:320,y:300,w:220,title:'mercyTier',formula:'floor(mercy / 2)',rows:[[P('a','n','mercy'),P('out','n','value')]]},
    {id:'isM',kind:'var',store:'derived',x:610,y:60,w:210,title:'isMerciful',formula:'judgementDelta ≥ 3',rows:[[P('a','n','delta'),P('out','b','value')]]},
    {id:'isB',kind:'var',store:'derived',x:610,y:175,w:210,title:'isBalanced',formula:'|judgementDelta| < 3',rows:[[P('a','n','delta'),P('out','b','value')]]},
    {id:'isC',kind:'var',store:'derived',x:610,y:290,w:210,title:'isCondemning',formula:'judgementDelta ≤ −3',rows:[[P('a','n','delta'),P('out','b','value')]]},
    {id:'next',kind:'var',store:'derived',x:890,y:120,w:240,title:'nextJudgementState',formula:'isMerciful ? 1 : isCondemning ? −1 : 0',rows:[[P('m','b','isMerciful'),P('out','n','value')],[P('bal','b','isBalanced'),null],[P('c','b','isCondemning'),null]]},
    {id:'jstate',kind:'var',store:'stored',x:890,y:300,w:240,title:'judgementState',vtype:'Number',init:'0',vreset:'Never',scope:'Player',vlabel:'Path',rows:[[null,P('out','n','value')]]},
    {id:'spell',kind:'ctx',demo:true,ghost:true,x:60,y:350,w:190,title:'roll · spellLevel',sub:'only during a cast',rows:[[null,P('out','x','level')]]},
    {id:'left',kind:'var',store:'derived',counter:true,uses:'Judgement',demo:true,ghost:true,x:320,y:420,w:220,title:'judgementsLeft',rows:[[null,P('out','n','value')]]},
    {id:'press',kind:'event',ev:'press',x:1210,y:190,w:180,title:'Press · Judgement',rows:[]},
    {id:'cond',kind:'cond',x:1440,y:60,w:220,title:'Path would change',expr:'nextJudgementState ≠ judgementState',rows:[[P('a','n','next'),P('t','f','True')],[P('b','n','current'),P('fa','f','False')]]},
    {id:'setState',kind:'action',op:'setVar',x:1710,y:60,w:200,title:'Recalculate Path',variable:'judgementState',value:'nextJudgementState',rows:[[P('val','n','value'),null]]},
    {id:'ask',kind:'ask',x:1440,y:240,w:230,title:'Mercy',prompt:'At least one creature failed the save',rows:[[null,P('y','f','then')]]},
    {id:'thp',kind:'action',op:'setHp',x:1720,y:220,w:200,title:'Mercy’s mend',value:'hp + mercyTier × 3',rows:[[P('amt','n','mercyTier'),null]]},
    {id:'addM',kind:'action',op:'addVar',x:1720,y:335,w:200,title:'Mercy shown',variable:'mercy',value:'1',rows:[]},
    {id:'strike',kind:'contrib',op:'add',x:640,y:630,w:250,title:'Merciful Strike',amount:'1d6',dtype:'radiant',when:'mercyTier ≥ 2',ask:'',target:['tag:judgements_edge'],rows:[[P('w1','n','mercyTier'),null]]},
    {id:'offA',kind:'contrib',op:'note',x:1210,y:520,w:240,title:'Drive back',text:'Push the target 15 ft',once:true,ask:'Drive them back?',when:'',target:['roll:attack.melee'],rows:[]},
    {id:'offB',kind:'contrib',op:'note',x:1210,y:680,w:240,title:'Break footing',text:'The target falls prone',once:true,ask:'Break their footing?',when:'',target:['roll:attack.melee'],rows:[]},
    {id:'picks',kind:'picks',x:1560,y:760,w:170,title:'Picks',rows:[]},
    {id:'evKill',kind:'event',ev:'reduced0',p:{by:'You'},x:60,y:890,w:230,title:'Creature reduced to 0 HP',rows:[]},
    {id:'addCond',kind:'action',op:'addVar',x:350,y:880,w:220,title:'Condemnation mounts',variable:'condemnation',value:'1',rows:[]}
  ];
  const edges=[
    ['mercy.out','delta.a'],['condemn.out','delta.b'],['mercy.out','tier.a'],
    ['delta.out','isM.a'],['delta.out','isB.a'],['delta.out','isC.a'],
    ['isM.out','next.m'],['isB.out','next.bal'],['isC.out','next.c'],
    ['press.hout','cond.hin'],['cond.t','setState.hin'],['next.out','cond.a'],['jstate.out','cond.b'],['next.out','setState.val'],
    ['press.hout','ask.hin'],['ask.y','thp.hin'],['ask.y','addM.hin'],['tier.out','thp.amt'],
    ['tier.out','strike.w1'],
    ['evKill.hout','addCond.hin'],
    ['next.out','delta.c','cycle']
  ].map(([a,b,f])=>({from:a,to:b,flag:f}));
  const refused=[
    {from:'spell.out',to:'tier.a',at:[70,445]},
    {from:'left.out',to:'isC.a',at:[560,470]}
  ];
  return {id:'arbiter',name:'Judgement',srcKind:'class',detail:'Arbiter 3',act:'Action',uses:'wis',reset:'Long rest',picks:'1',short:'',tags:['judgement','radiant'],fit:'graph',icon:'fa-scale-balanced',
    groups:[
      {m:['mercy','condemn','delta','tier','isM','isB','isC','next','jstate','spell','left'],l:'Judgement track',s:'variables · derived chain'},
      {m:['press','cond','setState','ask','thp','addM'],l:'On press',s:'activation outcomes · all fire on the same press'},
      {m:['strike'],l:'Merciful Strike',s:'contribution · applies to tag:judgements_edge'},
      {m:['offA','offB','picks'],l:'Brutal Strike',s:'two armed offers · picks 1'},
      {m:['evKill','addCond'],l:'Condemnation',s:'proposed trigger · bridge'}],
    destPos:{'tag:judgements_edge':[960,660],'roll:attack.melee':[1560,590]},
    nodes,edges,refused};
}
function secondWind(){
  return {id:'second',name:'Second Wind',srcKind:'class',detail:'Fighter 1',act:'Bonus action',uses:'1',reset:'Short rest',picks:'',short:'',tags:['martial','healing'],fit:'form',icon:'fa-lungs',
    groups:[{m:['ev','heal'],l:'Second Wind',s:'one press · one write'}],
    nodes:[
      {id:'ev',kind:'event',ev:'press',x:60,y:80,w:200,title:'Press · Second Wind',rows:[]},
      {id:'heal',kind:'action',op:'setHp',x:330,y:70,w:230,title:'Second Wind healing',value:'hp + 1d10 + level',rows:[]}
    ],
    edges:[{from:'ev.hout',to:'heal.hin'}],refused:[]};
}
function brutal(){
  const R='brutalStrikeReady';
  const ext=(id,x,y,title,vtype,decl,note,w=280)=>({id,kind:'var',store:'external',decl,note,x,y,w,title,vtype,rows:[[null,P('out',vtype==='Boolean'?'b':'n','value')]]});
  const gate=(extra)=>[[P('w1','b',R),null]].concat(extra?[[P('w2','b',extra),null]]:[]);
  const blow=(id,y,title,text,lv13)=>({id,kind:'contrib',op:'note',x:780,y,w:300,title,text,ask:'',offer:true,once:true,when:R+(lv13?' && has_improved_brutal_strike':''),target:['roll:damage.melee'],rows:gate(lv13?'has_improved_brutal_strike':null)});
  const nodes=[
    ext('rA',60,60,'recklessAttack','Boolean','Reckless Attack','stored · player · resets each turn'),
    ext('aT',60,180,'attacksThisTurn','Number','engine','turn-tracker counter · VAR_IDENTS'),
    {id:'ready',kind:'var',store:'derived',x:420,y:100,w:260,title:R,formula:'recklessAttack && attacksThisTurn == 0',rows:[[P('a','b','recklessAttack'),P('out','b','value')],[P('b','n','attacksThisTurn'),null]]},
    ext('hE',60,330,'has_improved_brutal_strike_enhanced','Boolean','has_*','true once you have the Enhanced version',300),
    ext('hI',60,800,'has_improved_brutal_strike','Boolean','has_*','true once you have Improved Brutal Strike',300),
    {id:'press',kind:'event',ev:'press',x:420,y:520,w:240,title:'Press · Brutal Strike',rows:[]},
    {id:'dis',kind:'contrib',op:'cancelAdv',prop:true,x:780,y:40,w:300,title:'Remove Advantage',once:true,when:R,ask:'',target:['roll:attack.str'],rows:gate()},
    {id:'add',kind:'contrib',op:'add',x:780,y:210,w:300,title:'Add {has_improved_brutal_strike_enhanced ? 2d10 : 1d10} to Damage Roll',amount:'has_improved_brutal_strike_enhanced ? 2d10 : 1d10',dtype:'—',once:true,when:R,ask:'',target:['roll:damage.melee'],rows:gate('has_improved_brutal_strike_enhanced')},
    blow('fb',430,'Forceful Blow','The target is pushed 15 feet straight away from you. You can then move up to half your Speed toward it without provoking Opportunity Attacks.'),
    blow('hb',600,'Hamstring Blow','The target’s Speed is reduced by 15 feet until the start of your next turn.'),
    blow('sb',770,'Staggering Blow','The target has Disadvantage on the next saving throw it makes, and can’t make Opportunity Attacks until the start of your next turn.',true),
    blow('sub',962,'Sundering Blow','Before the start of your next turn, the next attack roll made by another creature against the target gains a +5 bonus.',true),
    {id:'picks',kind:'picks',x:1150,y:1010,w:250,title:'Picks',rows:[[P('w1','b','enhanced'),null]]}
  ];
  const cs=['dis','add','fb','hb','sb','sub'];
  const edges=[['rA.out','ready.a'],['aT.out','ready.b'],...cs.map(c=>['ready.out',c+'.w1']),
    ['hE.out','add.w2'],['hE.out','picks.w1'],['hI.out','sb.w2'],['hI.out','sub.w2']].map(([a,b])=>({from:a,to:b}));
  return {id:'brutal',name:'Brutal Strike',srcKind:'class',detail:'Barbarian 9',prereq:'Level 9+, Reckless Attack Feature',act:'Free action',uses:'1',reset:'Start of your turn',picks:'has_improved_brutal_strike_enhanced ? 2 : 1',short:'',tags:['class','barbarian','brutal_strike','level:9'],fit:'graph',icon:'fa-hammer',
    destPos:{'roll:attack.str':[1460,40],'roll:damage.melee':[1460,560]},
    groups:[
      {m:['rA','aT'],l:'Declared elsewhere',s:'another feature · the engine'},
      {m:['hE','hI'],l:'Class grants',s:'has_* · level decides'},
      {m:['ready'],l:'Shared gate',s:'one derived variable'},
      {m:['press'],l:'The press',s:'free · 1 / turn · arms all six'},
      {m:['dis','add'],l:'Taken',s:'armed · applies on its own'},
      {m:['fb','hb','sb','sub','picks'],l:'Offered',s:'armed offers · the pick is the answer'}],
    nodes,edges,refused:[]};
}
/* Every audit case the applies-to plan names, on real-looking legacy content. Nothing here is rewritten on load. */
function ember(){
  return {id:'ember',name:'Ember Ward',srcKind:'feat',detail:'Feat · legacy content',act:'Bonus action',uses:'1',reset:'Long rest',picks:'',short:'',tags:['fire'],fit:'graph',icon:'fa-fire-flame-curved',
    groups:[
      {m:['k1','k2','k3'],l:'Legacy targets',s:'duplicates · dangling · self'},
      {m:['k4','k5','k6'],l:'Target rules',s:'floor · and · zero matches'},
      {m:['ev','gr','au'],l:'On press',s:'grant · addUses'}],
    destPos:{},
    nodes:[
      {id:'k1',kind:'contrib',op:'add',x:60,y:60,w:250,title:'Kindled Blade',amount:'1',dtype:'fire',when:'',ask:'',target:['tag:Fire','tag:fire','roll:damage'],rows:[]},
      {id:'k2',kind:'contrib',op:'note',x:60,y:200,w:250,title:'Ashen Ward',text:'Ash settles on the blade.',when:'',ask:'',target:['spell:removed_spell'],rows:[]},
      {id:'k3',kind:'contrib',op:'adv',x:60,y:340,w:250,title:'Ember Sight',when:'',ask:'',target:['feature:ember'],rows:[]},
      {id:'k4',kind:'contrib',op:'floor',x:60,y:500,w:250,title:'Steady Flame',atLeast:'10',when:'',ask:'',target:['roll:d20'],rows:[]},
      {id:'k5',kind:'contrib',op:'add',x:60,y:640,w:250,title:'Cinder Oath',amount:'1',dtype:'fire',match:'and',when:'',ask:'Did you swear it this turn?',target:['tag:fire','tag:weapon'],rows:[]},
      {id:'k6',kind:'contrib',op:'add',x:60,y:800,w:250,title:'Smoulder',amount:'2',dtype:'fire',when:'level >= 5',ask:'',target:['tag:smoulder'],rows:[]},
      {id:'ev',kind:'event',ev:'press',x:760,y:120,w:200,title:'Press · Ember Ward',rows:[]},
      {id:'gr',kind:'action',op:'grant',x:1020,y:60,w:220,title:'Kindle an Ally',value:'1d6',target:['roll:check','roll:attack'],rows:[]},
      {id:'au',kind:'action',op:'addUses',x:1020,y:220,w:220,title:'Rekindle',value:'1',target:[],rows:[]}
    ],
    edges:[{from:'ev.hout',to:'gr.hin'},{from:'ev.hout',to:'au.hin'}],refused:[]};
}
/* Class-progression preview (D10–D13, D20): opt-in, only level and class grants are decided; everything else stays undetermined. */
function derivedOf(f){const o={};(f||F()).nodes.forEach(n=>{if(n.kind==='var'&&n.store==='derived'&&!n.counter&&n.formula)o[n.title]=n.formula});return o}
function interp(s){return AT.interpolate(s,S.pv,derivedOf())}
function pvState(n){return n.kind==='contrib'?AT.previewState({when:n.when,ask:n.ask},S.pv,derivedOf()):'undetermined'}
function liveAt(n){return pvState(n)!=='off'}
function amtOf(n){const v=S.pv?AT.evalPreview(n.amount,S.pv,derivedOf()):AT.U;return AT.isU(v)?n.amount:String(v)}
function pvLabel(){return S.pv?'Class progression · '+S.pv.cls+' '+S.pv.lv:''}
function inferType(f){return /(≥|≤|<|>|==|!=|≠|&&|\|\||\band\b|\bor\b|\bnot\b|\btrue\b|\bfalse\b)/i.test((f||'').replace(/\?[^:]*:/g,''))?'b':'n'}
function varType(n){return n.store==='external'?(n.vtype==='Boolean'?'b':'n'):n.counter?'n':n.store==='derived'?inferType(n.formula):(n.vtype==='Boolean'?'b':'n')}
function varSync(n){if(n.kind!=='var')return;const t=varType(n);n.rows.forEach(r=>{if(r[1]&&r[1].id==='out'){r[1].t=t;r[1].l='value'}})}
const FEATS={arbiter:arbiter(),brutal:brutal(),ember:ember(),second:secondWind()};
Object.values(FEATS).forEach(f=>f.nodes.forEach(n=>{varSync(n);selSync(n);if(n.kind==='event')evSync(n,f)}));

const LS='guide.featureGraph.v3';
const saved=JSON.parse(localStorage.getItem(LS)||'{}');
const S={multi:new Set(),selG:null,insp:saved.insp!==false,feat:FEATS[saved.feat]?saved.feat:'arbiter',mode:saved.mode||'graph',split:!!saved.split,fails:!!saved.fails,sel:null,z:1,zl:'normal',zt:0,pair:saved.pair||'form',px:0,py:0,pv:saved.pv&&AT.CLASSES[saved.pv.cls]?saved.pv:null,proj:null,ready:false,notice:null,peek:null,flash:null};
const persist=()=>localStorage.setItem(LS,JSON.stringify({insp:S.insp,feat:S.feat,mode:S.mode,split:S.split,pair:S.pair,fails:S.fails,pv:S.pv}));
const F=()=>FEATS[S.feat];
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- geometry ---------- */
function vis(n){return !n.demo||S.fails}
function rowsOf(n){return n.rows.filter(r=>r[2]!=='demo'||S.fails)}
function hasHin(n){return ['cond','ask','action'].includes(n.kind)}
function hasHout(n){return n.kind==='event'}
function bodyH(n){return bodyH0(n)+(S.zt>0?(()=>{const k=detailLines(n).length;return k?Math.round((k*15+2)*S.zt):0})():0)}
const shortT=s=>String(s??'').replace(/\{[^}]*\}/g,'{…}');
const wrapN=(len,w,cw)=>Math.max(1,Math.ceil(len/Math.max(8,Math.floor(w/cw))));
function longAmt(n){return n.op==='add'&&String(amtOf(n)).length>9}
function bodyH0(n){if(n.kind==='contrib'){const a=longAmt(n)?(wrapN(String(amtOf(n)).length,n.w-40,6.6)-1)*14:0;const wl=wrapN(('when '+(n.when||'always')).length,n.w-48,5.9)-1;const al=n.ask?wrapN(('ask '+n.ask).length,n.w-48,6)-1:0;return 52+a+wl*13+(n.ask?16+al*13:0)}
  if(n.kind==='picks'){const e=String(S.pv?AT.evalPreview(F().picks,S.pv,derivedOf()):F().picks||'—');const t=('may take '+e+' of 4 offers').length;return Math.max(46,14+wrapN(t,n.w-24,6.9)*18)}if(n.kind==='ask'){const per=Math.max(10,Math.floor((n.w-34)/6.6)),lines=Math.max(1,Math.ceil(((n.prompt||'').length+2)/per));return 16+lines*18+7+16+4}return {event:22,cond:30,ask:62,action:26,sheet:26,var:26,ctx:22,picks:46}[n.kind]||0}
function rowH(){return 22}
function nodeH(n){return HDR+bodyH(n)+rowsOf(n).length*22+8}
function node(id){return F().nodes.find(n=>n.id===id)}
function split(ref){const i=ref.indexOf('.');return [ref.slice(0,i),ref.slice(i+1)]}
function portSpec(n,pid){
  if(pid==='hin')return {id:'hin',t:'f',dir:'in',l:'in'};
  if(pid==='hout')return {id:'hout',t:'f',dir:'out',l:'fires'};
  const rs=rowsOf(n);
  for(let i=0;i<rs.length;i++){if(rs[i][0]&&rs[i][0].id===pid)return {...rs[i][0],dir:'in',i};if(rs[i][1]&&rs[i][1].id===pid)return {...rs[i][1],dir:'out',i}}
  return null;
}
function portXY(n,pid){
  const h=nodeH(n);
  if(pid==='hin')return [n.x,n.y+(n.kind==='cond'?h/2:15)];
  if(pid==='hout')return [n.x+n.w,n.y+h/2];
  const p=portSpec(n,pid);if(!p)return [n.x,n.y];
  return [p.dir==='in'?n.x:n.x+n.w,n.y+HDR+bodyH(n)+p.i*22+11];
}
function edgeVisible(e){const[a]=split(e.from),[b]=split(e.to);const A=node(a),B=node(b);return A&&B&&vis(A)&&vis(B)&&(!e.flag||S.fails)&&portSpec(A,split(e.from)[1])&&portSpec(B,split(e.to)[1])}
function curve(x1,y1,x2,y2){const gx=x2-x1,gy=Math.abs(y2-y1);const dx=gx>=0?Math.min(160,Math.max(gx*.5,Math.min(gy*.35,60),8)):Math.max(60,-gx*.5+gy*.25);return `M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`}
function offers(){return F().nodes.filter(n=>n.kind==='contrib'&&n.once&&(n.ask||n.offer)&&vis(n))}
function liveOffers(){return offers().filter(liveAt)}

/* ---------- rules the ports enforce ---------- */
function reach(fromId,toId,edges){const seen=new Set(),st=[fromId];while(st.length){const c=st.pop();if(c===toId)return true;if(seen.has(c))continue;seen.add(c);edges.forEach(e=>{const[a]=split(e.from),[b]=split(e.to);if(a===c&&TYPE_OF(e)!=='f')st.push(b)})}return false}
function TYPE_OF(e){const[a,p]=split(e.from);const n=node(a);const s=n&&portSpec(n,p);return s?s.t:'n'}
function check(srcN,src,dstN,dst){
  if(srcN.id===dstN.id)return {rule:'Same node',msg:'A node can’t wire to itself.'};
  if(src.t==='f'&&dst.t!=='f')return {rule:'Flow into a value',msg:`Flow wires carry the press. “${dst.l}” takes a ${TYPE[dst.t]}.`};
  if(src.t!=='f'&&dst.t==='f')return {rule:'Value into flow',msg:`A ${TYPE[src.t]} can’t fire anything. Wire it into a Condition’s input to branch on it.`};
  if(dstN.kind==='var'&&src.t==='x')return {rule:'Variable reads roll context',msg:`${dstN.title} is read between rolls. ${srcN.title.replace('roll · ','')} only exists while a roll is being made.`};
  if(dstN.kind==='var'&&srcN.counter)return {rule:'Use-counter in a formula',msg:`${srcN.title} counts uses left, and resolves after every other variable — no formula may read it. Use it in a when, a value, or a note.`};
  if(dstN.kind==='var'&&srcN.kind==='var'&&reach(dstN.id,srcN.id,F().edges.filter(edgeVisible)))return {rule:'Cycle',msg:`${srcN.title} already depends on ${dstN.title}. Derived variables must bottom out in stored ones.`};
  if(src.t!==dst.t)return {rule:'Type mismatch',msg:`“${dst.l}” takes a ${TYPE[dst.t]}; this port carries a ${TYPE[src.t]}.`};
  return null;
}

/* ---------- audit (auditNode vocabulary where it exists) ---------- */
function mismatches(){return F().edges.filter(edgeVisible).filter(e=>{if(e.flag)return false;const[b,bp]=split(e.to);const d=portSpec(node(b),bp);return d&&d.t!=='f'&&TYPE_OF(e)!==d.t})}
function audit(){
  const f=F(),out=[];if(window.__FGS)out.push(...window.__FGS.extraAudit(f));
  if(S.fails&&f.id==='arbiter'){
    out.push({sev:'err',t:'Variable cycle · judgementDelta ↔ nextJudgementState',s:'judgementDelta reads nextJudgementState, which reads judgementDelta. Blocks Publish.',node:'delta'});
    out.push({sev:'err',t:'Refused · roll context → variable',s:'roll·spellLevel → mercyTier. Wire not created.',node:'tier'});
    out.push({sev:'err',t:'Refused · use-counter → formula',s:'judgementsLeft → isCondemning. Wire not created.',node:'left'});
  }
  mismatches().forEach(e=>{const[a]=split(e.from),[b,bp]=split(e.to);const A=node(a),B=node(b),d=portSpec(B,bp);out.push({sev:'err',t:'Type changed · '+A.title+' → '+B.title,s:A.title+' now carries a '+TYPE[TYPE_OF(e)]+'; “'+d.l+'” takes a '+TYPE[d.t]+'.',node:b})});
  f.nodes.filter(n=>['contrib','action','sheet'].includes(n.kind)&&vis(n)&&!n.title.trim()).forEach(n=>out.push({sev:'err',t:'No label',s:'An unlabelled number in a breakdown is the bug the roll panel exists to prevent.',node:n.id}));
  f.nodes.filter(n=>n.kind==='action'&&vis(n)&&!upstream(n).ev).forEach(n=>out.push({sev:'err',t:'Outcome never runs · '+n.title,s:'Activation outcomes run on the press. Wire it from the Press, a Condition or an Ask.',node:n.id}));
  f.nodes.filter(n=>n.kind==='contrib'&&n.op==='note'&&n.ask&&!n.once&&vis(n)).forEach(n=>out.push({sev:'err',t:'Toggle that only hides prose · '+n.title,s:'A non-armed note with an ask is refused — that should have been a when. Armed (once), the toggle commits a choice.',node:n.id}));
  const own='feature:'+f.id;f.nodes.filter(n=>OPS[n.op]&&vis(n)).forEach(n=>AT.auditEffect({...n,label:n.title},own,{ready:S.ready}).forEach(a=>out.push({sev:a.sev,t:a.t+' · '+(n.title||n.id),s:a.s,node:n.id,key:a.key,fix:a.fix})));
  const ext=f.nodes.filter(n=>n.decl);if(ext.length)out.push({sev:'info',t:'Reads '+ext.length+' identifiers declared elsewhere',s:ext.map(n=>n.title+' ← '+n.decl).join(' · '),node:ext[0].id});
  const pk=f.nodes.find(n=>n.kind==='picks');if(pk&&offers().length<2)out.push({sev:'err',t:'picks with nothing to choose between',s:'Picks needs two or more armed offers — a once effect carrying an ask.',node:pk.id});
  f.nodes.filter(n=>n.kind==='event'&&n.prop&&vis(n)).forEach(n=>out.push({sev:'warn',t:'Proposed trigger · '+EVENTS[n.ev].l,s:'The schema’s only trigger is the press. Drafts only; nothing fires.'+(n.ext?' Also needs the Foundry bridge.':''),node:n.id}));
  if(!S.fails||f.id!=='arbiter'){const vars=f.nodes.filter(n=>n.kind==='var'&&vis(n));if(vars.length)out.push({sev:'ok',t:'No variable cycles',s:`${vars.length} variable${vars.length>1?'s':''} resolve.`})}
  return out;
}
function badNodes(){const o=S.fails&&F().id==='arbiter'?{delta:'Cycle',next:'Cycle'}:{};mismatches().forEach(e=>{o[split(e.to)[0]]=o[split(e.to)[0]]||'Type'});audit().filter(a=>a.sev==='err'&&a.node&&!o[a.node]&&!a.t.startsWith('Refused')).forEach(a=>o[a.node]=a.t.startsWith('No label')?'No label':a.t.startsWith('picks')?'Picks':'Error');return o}

/* ---------- render: graph ---------- */
const wc=$('wc'),pad=$('pad');
function nodeHTML(n,bad){
  const K=KIND[n.kind]||{label:'Roll context',icon:'fa-dice-d20'};
  const h=nodeH(n);
  const icon=OPS[n.op]?OPS[n.op].icon:n.kind==='var'?(n.decl?'fa-link':n.counter?'fa-battery-half':n.store==='derived'?'fa-square-root-variable':'fa-database'):n.kind==='event'&&n.ext?'fa-tower-broadcast':K.icon;
  const kl=n.kind==='var'?(n.decl?'external':n.counter?'use-counter':n.store):n.kind==='event'?(n.prop?'proposed':'press'):n.kind==='cond'?'when':n.kind==='ask'?'ask':OPS[n.op]?n.op:n.kind==='picks'?'feature':n.kind==='ctx'?'roll ctx':K.label;
  let body='';
  if(n.kind==='event')body=`<span class="fx" style="color:var(--muted)">${esc(n.sub)}</span>`;
  else if(n.kind==='cond')body=`<span class="fx">${esc(n.expr)}</span>`;
  else if(n.kind==='ask'){const k=F().edges.filter(e=>e.from===n.id+'.y').length;body=`<div class="ask-q">“${esc(n.prompt)}”</div><div class="ask-tog${n.on?' on':''}" data-tog="${n.id}"><span class="sw2"></span>one checkbox · ${k} outcome${k===1?'':'s'}</div>`}
  else if(n.kind==='action'||n.kind==='sheet')body=`<span class="fx"><b>${esc(OPS[n.op].sum(n))}</b></span>`;
  else if(n.kind==='contrib'){const s=OPS[n.op].sum(n);body=`<div class="ca-row"><span class="contrib-amt${n.op==='add'?(longAmt(n)?' expr':''):' sm'}">${n.op==='add'?(longAmt(n)?'':'')+esc(amtOf(n))+`<small>${esc(n.dtype&&n.dtype!=='—'?n.dtype:'')}</small>`:esc(s)}</span>${n.once?'<span class="armed">armed by the press</span>':'<span class="always">always on</span>'}</div><div class="when-strip"><span class="hx"></span>when <b>${n.when?esc(n.when):'always'}</b></div>${n.ask?`<div class="when-strip ask"><span class="hx"></span>ask <b>${esc(n.ask)}</b></div>`:''}`}
  else if(n.kind==='var'&&n.decl)body=`<span class="fx" style="color:var(--muted)">${esc(n.note)}</span>`;
  else if(n.kind==='var')body=`<span class="fx">${n.counter?'uses of <b>'+esc(n.uses)+'</b> left':n.store==='derived'?'ƒ = <b>'+esc(n.formula)+'</b>':esc(n.vtype)+' · init <b>'+esc(n.init)+'</b>'+(n.scope==='DM-only'?' · <b>DM</b>':'')}</span>`;
  else if(n.kind==='ctx')body=`<span class="fx" style="color:var(--muted)">${esc(n.sub)}</span>`;
  else if(n.kind==='picks'){const f=F();if(S.pv){const k=liveOffers().length,v0=AT.evalPreview(f.picks,S.pv,derivedOf()),v=AT.isU(v0)?f.picks:v0;body=`<div class="pk${String(v??'').length>4?' long':''}">may take <b>${esc(v??'?')}</b> of ${k} live offer${k===1?'':'s'}</div>`}else{const k=offers().length;body=`<div class="pk${String(f.picks||'').length>4?' long':''}">may take <b>${esc(f.picks||'—')}</b> of ${k} offer${k===1?'':'s'}</div>`}}
  const rs=rowsOf(n);
  const rows=rs.map(r=>`<div class="grow-r" style="height:22px"><span title="${r[0]?esc(r[0].l):''}">${r[0]?esc(r[0].l):''}</span><span class="rr">${r[1]?esc(r[1].l):''}</span></div>`).join('');
  const conn=new Set();F().edges.filter(edgeVisible).forEach(e=>{conn.add(e.from);conn.add(e.to)});
  const ports=[];
  const pp=(pid,t)=>{const[x,y]=portXY(n,pid);ports.push(`<span class="port ${t==='f'?'flow':'data'} t-${t}${conn.has(n.id+'.'+pid)?' on':''}" data-n="${n.id}" data-p="${pid}" style="left:${x-n.x}px;top:${y-n.y}px" title="${TYPE[t]}"></span>`)};
  if(hasHin(n))pp('hin','f');if(hasHout(n))pp('hout','f');
  rs.forEach(r=>{r[0]&&pp(r[0].id,r[0].t);r[1]&&pp(r[1].id,r[1].t)});
  let badge=bad?`<span class="gbadge"><i class="fa-solid fa-triangle-exclamation"></i>${bad}</span>`:'';
  if(!bad&&n.prop)badge=`<span class="gbadge prop"><i class="fa-solid fa-flask"></i>Proposed</span>`+(n.ext?`<span class="gbadge ext"><i class="fa-solid fa-tower-broadcast"></i>Bridge</span>`:'');
  const off=!liveAt(n);
  if(!bad&&n.decl)badge=`<span class="gbadge decl"><i class="fa-solid fa-arrow-up-right-from-square"></i>${esc(n.decl)}</span>`;
  if(!bad&&off)badge=`<span class="gbadge off" title="Inactive in ${esc(pvLabel())}. It may still be had another way — feats, shards, DM grants.">Not at ${esc(S.pv.cls)} ${S.pv.lv}</span>`;
  if(!bad&&n.ghost)badge=`<span class="gbadge" style="color:var(--muted);border-color:var(--muted);background:#111">Drag demo</span>`;
  const ov=ovHTML(kl,shortT(interp(n.title))||n.id,n.kind==='var'&&n.store==='derived'&&!n.counter?n.formula:n.kind==='contrib'?OPS[n.op].sum(n):'',n.w,h);
  let endmark='';
  if(OPS[n.op]&&AT.hasPort(n.op)){const v=AT.viewTargets(n,'feature:'+F().id),T=AT.TARGETS[n.op];
    endmark=`<span class="port at${v.keys.length?' on':''}" data-at="${n.id}" style="left:${n.w}px;top:15px" title="applies to — drag to a thing, tag or roll kind"></span>`;
    if(v.own)endmark+=T.empty==='error'?`<span class="own-mk err">no target</span>`:`<span class="own-mk">${T.ownLabel||'own roll'}</span>`;
    if(v.keys.length>1)endmark+=`<button class="mt${v.and?' and':''}" data-mt="${n.id}" title="How these targets combine — click to switch">${v.and?'and':'or'}</button>`;}
  return `<div class="gn k-${n.kind}${n.store?' '+n.store:''}${off?' off':''}${n.decl?' decl':''}${n.ext?' ext':''}${n.prop?' prop':''}${n.ghost?' ghost':''}${bad?' bad':''}${S.sel===n.id?' sel':''}${S.multi.has(n.id)?' msel':''}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${h}px">
<div class="gf"></div><div class="gi"><div class="gh"><i class="fa-solid ${icon}"></i><span class="gt" title="${esc(interp(n.title))}">${esc(shortT(interp(n.title)))||'<span style="color:var(--danger-hot)">no label</span>'}</span>${n.once?'<span class="gflag">once</span>':''}${n.oneOf?'<span class="gflag">one of</span>':''}${n.offer?'<span class="gflag">offer</span>':''}<span class="gk">${kl}</span></div><div class="gb" style="height:${bodyH0(n)}px">${body}</div>${detailHTML(n)}${rows}</div>${ov}${ports.join('')}${badge}${endmark}</div>`;
}
function renderGraph(){
  const f=F(),bad=badNodes();
  let html=f.groups.map((g,i)=>{const b=groupBox(g);return b?`<div class="grp${S.selG===i?' sel':''}" data-g="${i}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><span class="gl" data-gl="${i}" title="Drag to move the group · click to rename">${esc(g.l)}${g.s?`<span class="gs">${esc(g.s)}</span>`:''}</span></div>`:''}).join('');
  html+=`<svg class="wsvg" id="wsvg" width="1" height="1"></svg>`;
  html+=f.nodes.filter(vis).map(n=>nodeHTML(n,bad[n.id])).join('');
  const M=S.m=atModel();
  html+=M.dests.map(destHTML).join('')+M.juncs.map(juncHTML).join('')+noticeHTML()+peekHTML();
  if(S.fails)(f.refused||[]).forEach(r=>{
    const[bn,bp]=split(r.to),B=node(bn),[x,y]=portXY(B,bp);const[an,ap]=split(r.from),A=node(an);
    const c=check(A,portSpec(A,ap),B,portSpec(B,bp));if(!c)return;
    html+=`<span class="deny-x" style="left:${x}px;top:${y}px"><i class="fa-solid fa-ban"></i></span><div class="refuse-tip" style="left:${r.at[0]}px;top:${r.at[1]}px"><div class="rt"><i class="fa-solid fa-ban"></i>Refused · ${esc(c.rule)}</div><div class="rs">${esc(c.msg)}</div></div>`;
  });
  wc.innerHTML=html;
  drawWires();
  applyView();
  const pb=$('probe');pb.style.display='flex';pb.innerHTML=(S.pv?'':'<span>Class progression</span>')+'<div class="seg2"><button data-pvc="" class="'+(S.pv?'':'on')+'">Off</button>'+Object.keys(AT.CLASSES).map(c=>`<button data-pvc="${c}" class="${S.pv&&S.pv.cls===c?'on':''}">${c}</button>`).join('')+'</div>'+(S.pv?'<div class="seg2">'+AT.CLASSES[S.pv.cls].levels.map(l=>`<button data-pvl="${l}" class="${l===S.pv.lv?'on':''}">${l}</button>`).join('')+'</div><span class="pv-on" id="pvChip">Previewing '+esc(S.pv.cls)+' '+S.pv.lv+'</span>':'');
  const gn=$('graphNote');
  if(f.fit==='form'){gn.style.display='flex';gn.innerHTML=`<i class="fa-solid fa-circle-info"></i><span class="gt2"><b>The form fits this feature</b>One press, one write, nothing derived. The graph shows the same thing in more space.</span><button class="btn ghost sm" id="toForm"><span class="bf"></span><span class="bi"><i class="fa-solid fa-list"></i>Back to form</span></button>`;$('toForm').onclick=()=>setMode('form')}
  else gn.style.display='none';
}
function drawWires(){
  const svg=$('wsvg');if(!svg)return;const f=F();let s='<defs><marker id="atHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 L3,5 Z" style="fill:#d08a3c"/></marker></defs>';
  const offSet=new Set(S.pv?f.nodes.filter(n=>vis(n)&&pvState(n)==='off').map(n=>n.id):[]);
  const arrows=[];
  f.edges.filter(edgeVisible).forEach(e=>{
    const[a,ap]=split(e.from),[b,bp]=split(e.to);const A=node(a),B=node(b);
    const[x1,y1]=portXY(A,ap),[x2,y2]=portXY(B,bp);const d=curve(x1+(ap==='hout'?6:0),y1,x2-(bp==='hin'?6:0),y2);
    const t=TYPE_OF(e);const selRel=S.sel&&(a===S.sel||b===S.sel);const dim=(S.sel&&!selRel?' dim':'')+(offSet.has(a)||offSet.has(b)?' off':'');
    const q=portSpec(B,bp);const mis=t!=='f'&&q&&q.t!==t;
    if(e.flag==='cycle'||mis)s+=`<path class="w-bad" d="${d}"/>`;
    else if(t==='f'){s+=`<path class="w-flow${dim}" d="${d}" data-arrow="1"/><path class="w-flow-core" d="${d}" style="opacity:${dim?.12:.8}"/>${dim?'':`<path class="w-flow-run" d="${d}"/>`}`}
    else s+=`<path class="w-data${dim}" d="${d}" style="stroke:var(--pc)" data-t="${t}"/>`;
  });
  if(S.fails)(f.refused||[]).forEach(r=>{const[a,ap]=split(r.from),[b,bp]=split(r.to);const[x1,y1]=portXY(node(a),ap),[x2,y2]=portXY(node(b),bp);s+=`<path class="w-bad" d="${curve(x1,y1,x2,y2)}"/>`});
  const pr=f.nodes.find(n=>n.kind==='event'&&n.ev==='press'&&vis(n));
  if(pr)f.nodes.filter(n=>n.kind==='contrib'&&n.once&&vis(n)).forEach(c=>{const x1=pr.x+pr.w+10,y1=pr.y+nodeH(pr)/2+14,x2=c.x-4,y2=c.y+15;s+=`<path class="w-arm${S.sel&&S.sel!==c.id&&S.sel!==pr.id?' dim':''}${offSet.has(c.id)?' off':''}" d="${curve(x1,y1,x2,y2)}"/>`});
  const pk=f.nodes.find(n=>n.kind==='picks');
  if(pk)offers().forEach(o=>{const x1=o.x+o.w+50,y1=o.y+15,x2=pk.x,y2=pk.y+nodeH(pk)/2;const dm=S.sel&&S.sel!==o.id&&S.sel!==pk.id;s+=`<path class="w-offer${dm?' dim':''}" d="${curve(x1,y1,x2,y2)}"/>`});
  const m=S.m=atModel();
  m.dests.forEach(d=>{const el=wc.querySelector('.gn[data-dest="'+CSS.escape(d.key)+'"]');if(el){el.style.left=d.x+'px';el.style.top=d.y+'px'}});
  m.juncs.forEach(jn=>{const el=wc.querySelector('.junc[data-j="'+jn.id+'"]');if(el){el.style.left=(jn.src.x+jn.src.w+46)+'px';el.style.top=(jn.src.y+15)+'px'}});
  const hiKey=S.sel&&S.sel.startsWith('d:')?S.sel.slice(2):null,hiW=S.sel&&S.sel.startsWith('w:')?S.sel.slice(2):null,hiJ=S.sel&&S.sel.startsWith('j:')?S.sel.slice(2):null;
  m.juncs.forEach(jn=>{const x0=jn.src.x+jn.src.w+7,y0=jn.src.y+15,jx=jn.src.x+jn.src.w+46;const g=AT.gateStyle(jn.src);const jd=S.sel&&S.sel!==jn.src.id&&S.sel!=='j:'+jn.id;s+=`<path class="w-at${g==='when'?' g-when':g==='ask'?' g-ask':''}${jn.off?' off':''}${jd?' dim':''}" d="M${x0},${y0} L${jx-7},${y0}"/>`});
  m.wires.forEach(w=>{const d=m.byKey.get(w.key);const x0=w.src.x+w.src.w+7,y0=w.src.y+15,x2=d.x-6,y2=d.y+d.h/2,jx=w.src.x+w.src.w+46;
    const id=w.src.id+'|'+w.key;const hi=hiKey===w.key||hiW===id||hiJ===w.src.id||S.sel===w.src.id;const anySel=S.sel&&(hiKey||hiW||hiJ||node(S.sel));
    const cls='w-at'+(w.style==='draft'?' draft':'')+(w.style==='when'?' g-when':w.style==='ask'?' g-ask':'')+(w.off?' off':'')+(hi&&anySel?' hi':'')+(anySel&&!hi?' dim':'');
    const p=w.and?curve(jx+7,y0,x2,y2):curve(x0,y0,x2,y2);
    s+=`<path class="${cls}" d="${p}" marker-end="url(#atHead)"/><path class="w-hit" data-w="${esc(id)}" d="${p}"/>`});
  svg.innerHTML=s;
  svg.querySelectorAll('.w-data').forEach(p=>p.classList.add('t-'+p.dataset.t));
  svg.querySelectorAll('path[data-arrow]').forEach(p=>{const L=p.getTotalLength();const n=Math.max(1,Math.floor(L/170));for(let i=1;i<=n;i++){const at=L*i/(n+1),a=p.getPointAtLength(at),b=p.getPointAtLength(at+1);const ang=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;arrows.push(`<path class="w-arrow" style="opacity:${p.classList.contains('dim')?.2:1}" d="M-7,-7 L6,0 L-7,7 L-3,0 Z" transform="translate(${a.x},${a.y}) rotate(${ang})"/>`)}});
  svg.insertAdjacentHTML('beforeend',arrows.join(''));
}
function applyView(){wc.style.transform=`translate(${S.px}px,${S.py}px) scale(${S.z})`;wc.style.setProperty('--inv',(1/S.z).toFixed(3));const l=zlOf(S.z);wc.classList.toggle('zl-over',l==='over');wc.classList.toggle('zl-detail',l==='detail');if(l!==S.zl){const was=S.zl;S.zl=l;if(was==='detail'||l==='detail')animZt(l==='detail'?1:0)}zlChip();if(l==='over'){cancelAnimationFrame(applyView.r);applyView.r=requestAnimationFrame(fitOv)}}
function animZt(to){const from=S.zt,t0=performance.now(),D=240;cancelAnimationFrame(animZt.r);const step=now=>{const p=Math.min(1,(now-t0)/D),e=1-Math.pow(1-p,3);S.zt=from+(to-from)*e;renderGraph();if(p<1)animZt.r=requestAnimationFrame(step)};animZt.r=requestAnimationFrame(step)}
/* ---------- semantic zoom: overview · normal · detail ---------- */
function zlOf(z){return z<=.5?'over':z>=1.15?'detail':'normal'}
function detailLines(n){
  const f=F(),L=[];
  if(n.kind==='contrib'&&/\{/.test(interp(n.title)))L.push('label · '+interp(n.title));
  if(n.kind==='contrib'){const v=AT.viewTargets(n,'feature:'+f.id);L.push('targets · '+(v.keys.length?v.keys.join(v.and?' + ':' | '):'own roll'));
    const fl=[n.once&&'once',n.oneOf&&'one of',n.offer&&'offer · picks',n.prop&&'proposed op'].filter(Boolean);if(fl.length)L.push(fl.join(' · '));
    if(n.op==='note'&&n.text)L.push('“'+n.text+'”')}
  else if(n.kind==='var'){if(n.decl)L.push('declared in '+n.decl);else if(n.counter)L.push('reads a use counter');else if(n.store==='derived')L.push('type · '+(varType(n)==='b'?'Boolean':'Number')+' · inferred');else L.push('resets '+(n.vreset||'never').toLowerCase()+' · '+(n.scope||'Player'))}
  else if(n.kind==='event')L.push(n.prop?'proposed · nothing fires yet':f.act+' · '+(f.uses?f.uses+' / '+String(f.reset).toLowerCase():'at-will'));
  else if(n.kind==='action')L.push((n.variable?'writes '+n.variable:'runs on the press')+(n.value?' ← '+n.value:''));
  else if(n.kind==='cond')L.push('the app decides · true / false');
  else if(n.kind==='ask')L.push('a player answers · never previewed');
  else if(n.kind==='picks')L.push(offers().map(o=>o.title).join(' · ')||'no offers');
  else if(n.kind==='sheet')L.push('no target · changes the sheet');
  return L.slice(0,3);
}
function detailHTML(n){if(!(S.zt>0))return '';const L=detailLines(n);return L.length?`<div class="gdet" style="height:${Math.round((L.length*15+2)*S.zt)}px;opacity:${S.zt.toFixed(2)}">${L.map(l=>`<div class="dl">${esc(l)}</div>`).join('')}</div>`:''}
function ovFit(name,w,h,sub){const L=Math.max(1,String(name).length);for(const withSub of sub?[true,false]:[false])for(let fs=28;fs>=9;fs--){const cpl=Math.max(4,Math.floor((w-34)/(fs*.62))),lines=Math.ceil(L/cpl);if(lines>3)continue;const need=lines*fs*1.18+fs*.5*1.4+6+(withSub?fs*.58*1.3+3:0)+18;if(need<=h)return {fs,lines,sub:withSub}}return {fs:9,lines:2,sub:false}}
const wb=s=>esc(s).replace(/_/g,'_<wbr>').replace(/([a-z0-9])([A-Z])/g,'$1<wbr>$2').replace(/([.·:])/g,'$1<wbr>');
function ovHTML(kind,name,sub,w,h){if(sub&&String(sub).length>34)sub='';const o=ovFit(name,w||200,h||80,!!sub);return `<div class="ov" style="--fmax:${o.fs}px;--lc:3"><span class="ok">${esc(kind)}</span><span class="on">${wb(name)}</span>${o.sub?`<span class="os">${esc(sub)}</span>`:''}</div>`}
/* after layout: shrink any overview label that still overflows its node (long unbreakable ids, tight shapes) */
function fitOv(){if(S.zl!=='over')return;wc.querySelectorAll('.gn .ov').forEach(o=>{let f=parseFloat(o.style.getPropertyValue('--fmax'))||12,g=0;const on=o.querySelector('.on');while(g++<30&&f>6&&(o.scrollHeight>o.clientHeight+1||(on&&(on.scrollWidth>on.clientWidth+1||on.scrollHeight>on.clientHeight+1)))){f-=1;o.style.setProperty('--fmax',f+'px')}})}
function zlChip(){const c=$('zlChip');if(!c)return;const lab={over:'Overview',normal:'Normal',detail:'Detail'}[S.zl];c.innerHTML=`<span class="zl-l">${lab}</span><span class="zl-p">${Math.round(S.z*100)}%</span>`;c.querySelectorAll?.('.zl-b');document.querySelectorAll('#zlSeg button').forEach(b=>b.classList.toggle('on',b.dataset.zl===S.zl))}
function zoomToLevel(l){const r=pad.getBoundingClientRect();const k=({over:.45,normal:.85,detail:1.3}[l])/S.z;zoomAt(k,r.width/2,r.height/2)}

function fit(){
  const f=F();let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  f.groups.map(groupBox).filter(Boolean).forEach(g=>{x0=Math.min(x0,g.x);y0=Math.min(y0,g.y);x1=Math.max(x1,g.x+g.w);y1=Math.max(y1,g.y+g.h)});
  f.nodes.filter(vis).forEach(n=>{x0=Math.min(x0,n.x-20);y0=Math.min(y0,n.y-20);x1=Math.max(x1,n.x+n.w+(n.kind==='contrib'?60:20));y1=Math.max(y1,n.y+nodeH(n)+20)});(S.m||atModel()).dests.forEach(d=>{x1=Math.max(x1,d.x+d.w+20);y1=Math.max(y1,d.y+d.h+20)});if(x0>x1)return;
  const r=pad.getBoundingClientRect();if(!r.width)return;
  const top=f.fit==='form'?110:56,bot=44,cover=52;
  S.z=Math.min((r.width-cover-32)/(x1-x0),(r.height-top-bot)/(y1-y0),1.15);
  S.px=(r.width-cover-(x1-x0)*S.z)/2-x0*S.z;S.py=top+((r.height-top-bot)-(y1-y0)*S.z)/2-y0*S.z;applyView();
}

/* ---------- form: the Feature Editor's own sections, re-derived from the same objects ---------- */
function upstream(n){
  const f=F(),g=[];let cur=n,ev=null,guard=0;
  while(cur&&guard++<20){
    const e=f.edges.find(e=>e.to===cur.id+'.hin'&&edgeVisible(e));if(!e)break;
    const[a,ap]=split(e.from);const A=node(a);
    if(A.kind==='event'){ev=A;break}
    if(A.kind==='ask')g.push({k:'ask',n:A});
    if(A.kind==='cond')g.push({k:'when',n:A,neg:ap==='fa'});
    cur=A;
  }
  return {ev,g};
}
function inSrc(n,pid){const e=F().edges.find(e=>e.to===n.id+'.'+pid&&!e.flag);return e?node(split(e.from)[0]):null}
const opt=(arr,v)=>arr.map(o=>`<option${o===v?' selected':''}>${esc(o)}</option>`).join('');
const selF=(attr,arr,v,dis)=>`<span class="selw"><select class="in" ${attr}${dis?' disabled':''}>${opt(arr,v)}</select></span>`;
function targetChips(n){const v=AT.viewTargets(n,'feature:'+F().id),T=AT.TARGETS[n.op]||{};if(v.own)return T.empty==='error'?'<span class="chip" style="color:var(--danger-hot)">no target</span>':`<span class="chip">${T.ownLabel||'own roll'}</span>`;return v.keys.map((k,i)=>`${i?`<span style="color:var(--muted)">${v.and?'+':'|'}</span>`:''}<span class="chip t">${esc(AT.selKind(k)==='thing'?destLabel(k):k)} <span style="color:var(--muted)">${esc(destSub(k))}</span></span>`).join('')}
function formHTML(){
  const f=F(),bad=badNodes();
  const vars=f.nodes.filter(n=>n.kind==='var'&&!n.demo&&!n.decl),extv=f.nodes.filter(n=>n.decl);
  const rules=f.nodes.filter(n=>OPS[n.op]&&!n.demo);
  const nOff=offers().length;
  let h=`<div class="fv">`;
  if(f.fit==='graph')h+=`<div class="fv-hint"><i class="fa-solid fa-diagram-project"></i><span>${extv.length?`Six effects share one gate over ${extv.length} identifiers declared elsewhere. The coupling is easier to see as a graph.`:`${vars.filter(v=>v.store==='derived').length} derived variables feed each other here. The chain is easier to read as a graph.`}</span><button class="btn amber sm" data-go="graph"><span class="bf"></span><span class="bi">Open graph</span></button></div>`;
  h+=`<div class="sec"><span class="num">01</span><span class="field-lab">Identity</span></div><div class="grid2"><div><span class="field-lab">Name</span><input class="in" data-ff="name" value="${esc(f.name)}"></div><div><span class="field-lab">Source</span>${selF('data-ff="srcKind"',SOURCES,f.srcKind)}</div><div><span class="field-lab">Source detail</span><input class="in" data-ff="detail" value="${esc(f.detail)}"></div>${f.prereq!=null?`<div><span class="field-lab">Prerequisite</span><input class="in" data-ff="prereq" value="${esc(f.prereq)}"></div>`:''}</div>`;
  h+=`<div class="sec"><span class="num">··</span><span class="field-lab">Activation, uses, and the press</span></div><div class="grid2"><div><span class="field-lab">Activation</span>${selF('data-ff="act"',ACTS,f.act)}</div><div><span class="field-lab">Max uses · formula</span><input class="in" data-ff="uses" value="${esc(f.uses)}" placeholder="blank = at-will"></div><div><span class="field-lab">Resets on</span>${selF('data-ff="reset"',RESETS,f.reset,!f.uses)}</div>${nOff>=2?`<div><span class="field-lab">Of its ${nOff} offers, the player may take</span><input class="in" data-ff="picks" value="${esc(f.picks)}"></div>`:''}${f.reset==='Long rest'&&f.uses?`<div><span class="field-lab">…and on a short rest, give back</span><input class="in" data-ff="short" value="${esc(f.short)}" placeholder="—"></div>`:''}</div>`;
  h+=`<div class="sec"><span class="num">02</span><span class="field-lab">Tags</span></div><div class="fl" style="grid-template-columns:1fr"><span class="v">${f.tags.map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</span></div>`;
  h+=`<div class="sec"><span class="num">03</span><span class="field-lab">Variables · ${vars.length}</span></div>`;
  h+=vars.map(v=>`<div class="vrow${S.sel===v.id?' sel':''}${bad[v.id]?' bad':''}" data-sel="${v.id}"><span class="vn">${esc(v.title)}</span><span class="vk">${v.counter?'uses of '+esc(v.uses):v.store+' · '+(varType(v)==='b'?'Boolean':'Number')}${v.scope==='DM-only'?' · DM':''}</span>${v.counter?'<input class="in ro" readonly value="feature uses">':v.store==='derived'?`<input class="in" data-b="${v.id}:formula" value="${esc(v.formula)}">`:`<input class="in" data-b="${v.id}:init" value="${esc(v.init)}">`}</div>`).join('');
  if(!vars.length)h+=`<div class="fl" style="grid-template-columns:1fr"><span class="v" style="color:var(--muted)">None declared here.${extv.length?' Reads:':''} ${extv.map(v=>`<span class="chip" style="color:var(--good)">${esc(v.title)} <span style="color:var(--muted)">← ${esc(v.decl)}</span></span>`).join('')}</span></div>`;
  h+=`<div class="sec"><span class="num">04</span><span class="field-lab">Rules · ${rules.length}</span></div>`;
  ['passive','sheet','activation'].forEach(g=>{
    const rs=rules.filter(n=>OPS[n.op].g===g);if(!rs.length)return;
    h+=`<div class="grp-h">${OPGROUP[g]}</div>`;
    h+=rs.map(n=>{
      const kc=KIND[n.kind].c;let lines='';
      if(g==='passive'||AT.hasPort(n.op))lines+=`<div class="fl"><span class="k">Target</span><span class="v">${targetChips(n)}</span></div>`;
      if(g==='sheet')lines+=`<div class="fl"><span class="k">Target</span><span class="v" style="color:var(--muted)">none — changes the sheet itself</span></div>`;
      else if(g==='activation'){const u=upstream(n);lines+=`<div class="fl"><span class="k">Runs</span><span class="v">${u.ev?(u.ev.prop?`<span class="chip ext">${u.ev.ext?'<i class="fa-solid fa-tower-broadcast"></i>':''}proposed · ${esc(EVENTS[u.ev.ev].l)}</span>`:'<span class="chip">on press</span>'):'<span class="chip" style="color:var(--danger-hot)">never — not wired</span>'}</span></div>`;
        n._u=u}
      OPS[n.op].f.forEach(([k,l,o])=>{if(o)lines+=`<div class="fl"><span class="k">${l}</span><span class="v">${o==='var'?`<span class="chip" style="color:var(--good)">${esc(n[k])}</span>`:esc(n[k])}</span></div>`;else lines+=`<div class="fl"><span class="k">${l}</span><span class="v"><input class="in" data-b="${n.id}:${k}" value="${esc(n[k])}"></span></div>`});
      if(g==='passive'){
        lines+=`<div class="fl"><span class="k be">when</span><span class="v"><input class="in when" data-b="${n.id}:when" value="${esc(n.when||'')}" placeholder="always"></span></div>`;
        lines+=`<div class="fl"><span class="k cy">ask</span><span class="v"><input class="in cy" data-b="${n.id}:ask" value="${esc(n.ask||'')}" placeholder="—"></span></div>`;
      }else if(g==='activation'){
        const w=n._u.g.filter(x=>x.k==='when'),a=n._u.g.filter(x=>x.k==='ask');
        lines+=`<div class="fl"><span class="k be">when</span><span class="v">${w.length?w.map(x=>(x.neg?'<span style="color:var(--muted)">not</span>':'')+`<input class="in when" data-b="${x.n.id}:expr" value="${esc(x.n.expr)}">`).join(''):'<span style="color:var(--muted)">always</span>'}</span></div>`;
        lines+=`<div class="fl"><span class="k cy">ask</span><span class="v">${a.length?a.map(x=>`<input class="in cy" data-b="${x.n.id}:prompt" value="${esc(x.n.prompt)}">`).join(''):'<span style="color:var(--muted)">—</span>'}</span></div>`;
      }
      const tags=(n.prop?'<span class="tag new">proposed op</span>':'')+(n.once&&(n.ask||n.offer)?'<span class="tag new">offer</span>':'')+(n.once?'<span class="tag">once</span>':'')+(n.oneOf?'<span class="tag">one of</span>':'');
      return `<div class="fcard${S.sel===n.id?' sel':''}${bad[n.id]?' bad':''}" style="--kc:${kc}" data-sel="${n.id}"><div class="fc-h"><span class="op">${n.op}</span><input class="in" style="flex:1;min-width:0;font-family:var(--font-prose);font-size:15px;padding:4px 8px" data-b="${n.id}:title" value="${esc(n.title)}" placeholder="Label (required)">${tags}</div>${lines}</div>`;
    }).join('');
  });
  return h+`</div>`;
}
function renderForm(){$('formPane').innerHTML=formHTML()}

/* ---------- inspector ---------- */
function renderInspTypeOnly(n){const b=[...document.querySelectorAll('#insp .iblk b')].find(x=>x.textContent.startsWith('Type ·'));if(n.store==='derived'&&b){const t=varType(n);b.textContent='Type · '+(t==='b'?'Boolean':'Number')+' · inferred';b.parentElement.style.setProperty('--bc','var(--'+(t==='b'?'beige':'good')+')')}}
function renderInsp(){if(window.__FGS)window.__FGS.onSel();const any=!(S.split&&S.pair==='script')&&(!!S.sel||S.selG!=null||S.multi.size>1);if(!S.insp&&S.auto!==any){S.auto=any;if(typeof renderInspOpen==='function')renderInspOpen()}if($('railSel')){const s=S.sel&&node(S.sel);$('railSel').textContent=s?s.title:''}
  const el=$('insp');
  if(S.selG!=null&&F().groups[S.selG]){const g=F().groups[S.selG];$('inspMeta').textContent='group';
    el.innerHTML='<div class="ih" style="--kc:var(--beige)"><span class="sw picks isw" style="--kc:var(--beige)"></span><div class="it"><div class="t">'+esc(g.l)+'</div><div class="k">Group · '+g.m.length+' nodes</div></div></div><div class="iblk"><b>Layout only</b>Groups are for reading the canvas. The engine and the form never see them — ungrouping changes nothing about the feature.</div><span class="field-lab">Name</span><input class="in" data-g-f="l" value="'+esc(g.l)+'"><span class="field-lab">Subtitle</span><input class="in" data-g-f="s" value="'+esc(g.s||'')+'" placeholder="optional"><span class="field-lab">Members · '+g.m.length+'</span><div class="conns">'+g.m.map(id=>{const m=node(id);return m?'<div class="conn" data-sel="'+id+'" style="--pc:'+(KIND[m.kind]||{c:'var(--cyan-hot)'}).c+'"><span class="cp"></span><b>'+esc(m.title)+'</b><span style="margin-left:auto">'+(KIND[m.kind]||{label:'ctx'}).label+'</span></div>':''}).join('')+'</div><div style="display:flex;gap:8px"><button class="btn ghost" id="ungroupBtn"><span class="bf"></span><span class="bi"><i class="fa-solid fa-object-ungroup"></i>Ungroup</span></button></div>';
    $('ungroupBtn').onclick=()=>ungroup(S.selG);return}
  if(S.multi.size>1){$('inspMeta').textContent=S.multi.size+' selected';const ms=[...S.multi].map(node).filter(Boolean);
    el.innerHTML='<div class="insp-empty" style="padding-top:4px"><div class="t">'+ms.length+' nodes selected</div><div class="d">Drag any one of them to move them together, or group them to label a section of the canvas.</div></div><div class="conns">'+ms.map(m=>'<div class="conn" data-sel="'+m.id+'" style="--pc:'+(KIND[m.kind]||{c:'var(--cyan-hot)'}).c+'"><span class="cp"></span><b>'+esc(m.title)+'</b></div>').join('')+'</div><div style="display:flex;gap:8px"><button class="btn amber" id="groupBtn"><span class="bf"></span><span class="bi"><i class="fa-solid fa-object-group"></i>Group · G</span></button></div>';
    $('groupBtn').onclick=makeGroup;return}
  if(S.draft&&S.sel!=='d:'+S.draft.key){const f=F();if(f.destPos)delete f.destPos[S.draft.key];S.draft=null;renderGraph()}
  if(S.sel&&/^[dwj]:/.test(S.sel)){renderInspAt(el);return}
  const n=S.sel&&node(S.sel);
  if(!n){
    $('inspMeta').textContent='';
    el.innerHTML=`<div class="insp-empty"><div class="t">No node selected</div><div class="d">Select a node to edit its fields. They’re the same fields the form shows for that rule.</div>
<div class="qa"><div class="q"><i class="fa-solid fa-play"></i><span><b>Thick pale wires</b> carry the press to the outcomes it runs. They fan out, never chain — every outcome fires on the same press.</span></div><div class="q"><i class="fa-solid fa-circle"></i><span><b>Thin coloured wires</b> are values. Round ports, coloured by type. They mirror the identifiers a formula reads.</span></div><div class="q"><i class="fa-solid fa-ban"></i><span>Drag from any port. Ports that can’t take it dim; hover one to see why.</span></div><div class="q"><i class="fa-solid fa-plus"></i><span><b>Add a node:</b> drag a kind from the left, double-click the canvas, or press <b>A</b>. Drop a wire on empty canvas to add a node already connected.</span></div><div class="q"><i class="fa-solid fa-crosshairs"></i><span><b>Orange wires</b> are applies-to: a rule pointing at what it affects. Drag from the square port on a rule’s right edge. Dashed = gated by a when; dotted cyan = gated by an ask.</span></div><div class="q"><i class="fa-solid fa-object-group"></i><span><b>Group:</b> Shift-click or Shift-drag, then <b>G</b>. Groups are layout only.</span></div></div></div>`;return}
  const K=KIND[n.kind]||{label:'Roll context',c:'var(--cyan-hot)'};const bad=badNodes()[n.id];
  $('inspMeta').textContent=n.id;
  let h=`<div class="ih" style="--kc:${K.c}"><span class="sw ${n.kind==='ctx'?'target':n.kind} isw"></span><div class="it"><div class="t">${esc(n.title)}</div><div class="k">${K.label}${n.store?' · '+(n.counter?'use-counter':n.store):''}${OPS[n.op]?' · '+OPGROUP[OPS[n.op].g]:''}</div></div></div>`;
  const errs=audit().filter(a=>a.sev==='err'&&a.node===n.id);
  if(bad==='Cycle')h+=`<div class="iblk err"><b>Variable cycle</b>judgementDelta reads nextJudgementState, which reads judgementDelta. Remove one of the two wires. Publish is blocked.</div>`;
  errs.filter(a=>!a.t.startsWith('Variable cycle')).forEach(a=>h+=`<div class="iblk err"><b>${esc(a.t)}</b>${esc(a.s)}</div>`);
  const fld=(lab,f,cls='',ph='')=>`<span class="field-lab">${lab}</span><input class="in ${cls}" data-b="${n.id}:${f}" value="${esc(n[f])}"${ph?` placeholder="${ph}"`:''}>`;
  const sel=(lab,f,arr)=>`<span class="field-lab">${lab}</span>${selF(`data-b="${n.id}:${f}"`,arr,n[f])}`;
  const cb=(f,lab,s)=>`<label class="cbx"><input type="checkbox" data-bc="${n.id}:${f}"${n[f]?' checked':''}>${lab}<span class="s">${s}</span></label>`;
  if(n.kind==='event'){
    const hasPress=F().nodes.some(m=>m.kind==='event'&&m.ev==='press'&&m.id!==n.id);
    h+=fld('Label','title');
    h+='<span class="field-lab">Fires on</span><span class="selw"><select class="in" data-ev="'+n.id+'"><optgroup label="In the schema"><option value="press"'+(n.ev==='press'?' selected':'')+(hasPress?' disabled':'')+'>'+EVENTS.press.l+(hasPress?' — already on this feature':'')+'</option></optgroup>'+[['sheet','Proposed · from the sheet'],['bridge','Proposed · Foundry bridge']].map(([g,l])=>'<optgroup label="'+l+'">'+Object.entries(EVENTS).filter(([,E])=>E.src===g).map(([k,E])=>'<option value="'+k+'"'+(k===n.ev?' selected':'')+'>'+E.l+'</option>').join('')+'</optgroup>').join('')+'</select></span>';
    if(n.ev==='press'){const f=F();h+='<div class="iblk" style="--bc:var(--amber)"><b>The press · one per feature</b>These are the feature’s own Activation fields. Every outcome wired from here runs on the same press — outcomes have no order.</div><span class="field-lab">Activation</span>'+selF('data-ff="act"',ACTS,f.act)+'<span class="field-lab">Max uses · formula</span><input class="in" data-ff="uses" value="'+esc(f.uses)+'" placeholder="blank = at-will"><span class="field-lab">Resets on</span>'+selF('data-ff="reset"',RESETS,f.reset,!f.uses)}
    else{EVENTS[n.ev].params.forEach(q=>{const o=typeof q.o==='function'?q.o():q.o;h+='<span class="field-lab">'+q.l+'</span>'+(o?'<span class="selw"><select class="in" data-evp="'+n.id+':'+q.k+'">'+opt(o,n.p[q.k])+'</select></span>':'<input class="in" data-evp="'+n.id+':'+q.k+'" value="'+esc(n.p[q.k])+'">')});
      h+='<div class="iblk new"><b><i class="fa-solid fa-flask"></i> Proposed trigger</b>The schema has one trigger: the press. This saves as a draft note and nothing fires until the engine supports it.'+(n.ext?' It would also need a live Foundry GM client.':'')+'</div>'}
  }
  if(n.kind==='var'&&n.decl){h+=`<div class="iblk" style="--bc:var(--good)"><b>Declared by ${esc(n.decl)} · read-only here</b>${n.decl==='engine'?'An engine identifier (VAR_IDENTS), maintained by the turn tracker.':n.decl==='has_*'?'Derived from a feature’s name: true once the character has it. This is how a later feature enables an earlier one without either editing the other.':'A variable another feature declares. Legal to read — the audit resolves it through the catalog’s type index.'}</div><span class="field-lab">Identifier</span><input class="in ro" readonly value="${esc(n.title)}"><span class="field-lab">Type</span><input class="in ro" readonly value="${esc(n.vtype)} · ${esc(n.note)}">`}
  else if(n.kind==='var'){
    h+=fld('Name · identifier','title');
    if(n.counter){h+=`<div class="iblk" style="--bc:var(--good)"><b>Use-counter · Number</b>Uses left of ${esc(n.uses)}. Resolves after every other variable, so no formula may read it — use it in a when, a value, or a note.</div>`+sel('Feature uses','uses',Object.values(FEATS).map(f=>f.name))}
    else if(n.store==='derived'){const t=varType(n);h+=fld('Formula','formula')+'<div class="iblk" style="--bc:var(--'+(t==='b'?'beige':'good')+')"><b>Type · '+(t==='b'?'Boolean':'Number')+' · inferred</b>Derived variables are never stored, so there is no type to pick — it’s read from the formula.</div>'}
    else{h+=sel('Type','vtype',['Number','Boolean'])+fld('Initial value','init')+sel('Resets on','vreset',VRESETS)+sel('Scope','scope',['Player','DM-only'])+fld('Display label','vlabel')}
  }
  if(n.kind==='cond'){h+=`<div class="iblk kind" style="--kc:${K.c}"><b>when · the app decides</b>Compiles to the <code>when</code> on every outcome it gates. True passes it as written; False compiles to <code>not(…)</code>.</div>`+fld('Label','title')+fld('when — formula','expr','when')}
  if(n.kind==='ask'){const k=F().edges.filter(e=>e.from===n.id+'.y').length;h+=`<div class="iblk kind" style="--kc:${K.c}"><b>ask · a human decides</b>Written onto every outcome it gates. Effects sharing one ask become a single checkbox — ${k} here. There is no “no” branch: unticked, they simply don’t resolve.</div>`+fld('Label','title')+fld('ask — the checkbox text','prompt','cy')}
  if(OPS[n.op]){
    const g=OPS[n.op].g;
    h+=`<span class="field-lab">Op</span><span class="selw"><select class="in" data-b="${n.id}:op">${Object.keys(OPS).filter(k=>OPS[k].g===g).map(k=>`<option${k===n.op?' selected':''}>${k}</option>`).join('')}</select></span>`;
    h+=fld('Label · required','title','','e.g. Merciful Strike');if(S.pv&&/\{/.test(n.title))h+=`<div class="iblk" style="--bc:var(--amber)"><b>Reads under ${esc(pvLabel())}</b>${esc(interp(n.title))}</div>`;if(S.pv&&n.kind==='contrib'){const st=pvState(n);h+=`<div class="iblk"><b>${st==='off'?'Inactive':st==='active'?'Active':'Undetermined'} · ${esc(pvLabel())}</b>${st==='off'?'Its when is false for this class at this level. It may still be had another way — feats, shards, DM grants.':st==='active'?'Its gate depends only on level and class grants, and it holds.':'Its gate reads something the preview doesn’t control'+(n.ask?' — an ask is only ever answered by a player':'')+'.'}</div>`}
    OPS[n.op].f.forEach(([k,l,o])=>{if(o==='var')h+=sel(l,k,F().nodes.filter(m=>m.kind==='var'&&m.store==='stored').map(m=>m.title));else if(o)h+=sel(l,k,o);else h+=fld(l,k)});
    if(AT.hasPort(n.op)){const v=AT.viewTargets(n,'feature:'+F().id),T=AT.TARGETS[n.op];
      h+=`<span class="field-lab">Applies to · ${v.keys.length?(v.and?'all of (and)':'any of (or)'):(T.empty==='error'?'none — required':T.ownLabel||'own roll')}</span><div class="conns">${v.keys.map(k=>`<div class="conn" data-sel="d:${esc(k)}" style="--pc:var(--orange)"><span class="cp"></span><b>${esc(destLabel(k))}</b><span style="margin-left:auto">${esc(destSub(k))}</span><button class="x" data-atrm="${n.id}|${esc(k)}" title="Remove this target"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}</div>`;
      if(v.keys.length>1)h+=`<div class="seg2"><button data-mts="${n.id}:or" class="${v.and?'':'on'}">or</button><button data-mts="${n.id}:and" class="${v.and?'on':''}">and</button></div>`+(v.and?`<div class="iblk"><b>and · ${esc(AT.fmtCount(AT.matchCount(v.keys,'and')))}</b>Every target must hold of the same roll. It affects the intersection only.</div>`:'');}
    if(g==='passive'){h+=fld('when — formula · the app decides','when','when','always')+fld('ask — prose · a human decides','ask','cy','—')+cb('once','Arms once','spent when used')+cb('oneOf','One across all targets','');if(n.once&&n.ask)h+=`<div class="iblk" style="--bc:var(--amber)"><b>Armed offer</b>once + ask. Counts toward this feature’s Picks.</div>`}
    if(g==='sheet')h+=`<div class="iblk kind" style="--kc:${K.c}"><b>No target</b>Answers “what is this number on the sheet”, not “what does this roll add”.</div>`;
    if(g==='activation')h+=`<div class="iblk kind" style="--kc:${K.c}"><b>Runs on the press</b>Its when and ask come from the Condition and Ask it’s wired through.</div>`;
  }
  if(n.kind==='picks'){const o=offers();h+=`<div class="iblk kind" style="--kc:${K.c}"><b>Feature-level · picks</b>Not wired: every contribution carrying <code>once</code> and marked as an <code>offer</code> is an offer, automatically. The dashed tethers show which.</div><span class="field-lab">Of its ${o.length} offers, the player may take</span><input class="in" data-ff="picks" value="${esc(F().picks)}"><span class="field-lab">Offers · ${o.length}</span><div class="conns">${o.map(m=>`<div class="conn" data-sel="${m.id}" style="--pc:var(--violet)"><span class="cp"></span><b>${esc(m.title)}</b><span style="margin-left:auto">${esc(m.ask)}</span></div>`).join('')}</div>`}
  const f=F(),cs=f.edges.filter(edgeVisible).filter(e=>e.from.startsWith(n.id+'.')||e.to.startsWith(n.id+'.'));
  if(cs.length){h+=`<span class="field-lab">Wires · ${cs.length}</span><div class="conns">`+cs.map(e=>{const out=e.from.startsWith(n.id+'.');const[o,op]=split(out?e.to:e.from);const O=node(o);const t=TYPE_OF(e);const mine=portSpec(n,split(out?e.from:e.to)[1]);const their=portSpec(O,op);return `<div class="conn t-${t}" data-sel="${o}"><span class="cp${t==='f'?' f':''}"></span>${out?'→':'←'} <b>${esc(O.title)}</b><span style="margin-left:auto">${esc(mine.l)}${their.l?' · '+esc(their.l):''}</span></div>`}).join('')+`</div>`}
  if(OPS[n.op]||n.kind==='var')h+=`<div style="display:flex;gap:8px"><button class="btn ghost" data-go="form"><span class="bf"></span><span class="bi"><i class="fa-solid fa-list"></i>Show in form</span></button></div>`;
  el.innerHTML=h;
}

/* ---------- library / kinds / audit ---------- */
function renderLeft(){
  $('lib').innerHTML=Object.values(FEATS).map(f=>`<button class="lib-row${f.id===S.feat?' sel':''}" data-feat="${f.id}"><span class="lr-ic"><i class="fa-solid ${f.icon}"></i></span><span class="lr-tx"><span class="lr-t">${esc(f.name)}</span><span class="lr-s">${esc(f.srcKind)} · ${esc(f.detail)}</span><span class="lr-fit ${f.fit}">${f.fit==='graph'?'graph helps':'form fits'}</span></span></button>`).join('');
  $('kinds').innerHTML=Object.entries(KIND).map(([k,v])=>`<div class="kind-row" data-kind="${k}" style="--kc:${v.c}"><span class="sw ${k}"></span>${v.label}<span class="s">${v.sub}</span></div>`).join('')+`<div class="kind-row derived" style="--kc:var(--orange)" title="Not placed from here — a target appears when a rule’s applies-to wire points at it. Drag from the square port on a rule’s right edge."><span class="sw target"></span>Target<span class="s">tag · roll · thing · from a wire</span></div>`;
  const a=audit();const e=a.filter(x=>x.sev==='err').length,w=a.filter(x=>x.sev==='warn').length;
  $('auditN').textContent=e?`${e} error${e>1?'s':''}`:w?`${w} warning${w>1?'s':''}`:'clean';
  $('audit').innerHTML=a.map(x=>`<button class="audit-item ${x.sev}"${x.node?` data-sel="${x.node}"`:''}><i class="fa-solid ${x.sev==='err'?'fa-circle-xmark':x.sev==='warn'?'fa-triangle-exclamation':x.sev==='info'?'fa-tower-broadcast':'fa-circle-check'}"></i><span class="ai-tx"><span class="ai-t">${esc(x.t)}</span><span class="ai-s">${esc(x.s)}</span></span></button>`).join('');
  $('statusPill').classList.toggle('bad',!!e);$('statusTx').textContent=e?e+' error'+(e>1?'s':'')+' — publish blocked':w?w+' warning'+(w>1?'s':'')+' — publishable':'Draft valid · publishable';if(S.pv)$('statusTx').textContent+=' · '+pvLabel();
  $('crumb').textContent=F().name;
}
function renderMode(){
  const v=$('views');v.className='views '+(S.split?'m-split pair-'+S.pair:'m-'+S.mode)+(window.__FGS&&__FGS.stale()?' stale':'');
  document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('on',S.split?(b.dataset.m==='graph'||b.dataset.m===S.pair):b.dataset.m===S.mode));
  $('splitBtn').title=S.split?'Back to one view':'Graph beside '+(S.mode==='graph'?S.pair:S.mode);if(S.split&&S.pair==='script'&&S.insp){S.insp=false;S.auto=false;if(typeof renderInspOpen==='function')renderInspOpen()}if(window.__FGS)__FGS.onMode();
  $('splitBtn').classList.toggle('on',S.split);$('failBtn').classList.toggle('on',S.fails);$('failBtn').classList.toggle('red',S.fails);
}
function all(){if(window.__FGS)window.__FGS.onData('load');renderLeft();renderMode();renderForm();renderGraph();renderInsp();requestAnimationFrame(fit);ensureProj()}
function setMode(m){if(S.split&&m!=='graph'){S.pair=m;persist();renderMode();requestAnimationFrame(fit);return}S.mode=m;if(m!=='graph')S.pair=m;S.split=false;persist();renderMode();requestAnimationFrame(fit);ensureProj()}
function select(id,pan){S.sel=id;S.selG=null;S.multi=new Set();renderGraph();renderInsp();document.querySelectorAll('#formPane [data-sel]').forEach(el=>el.classList.toggle('sel',el.dataset.sel===id));
  if(pan&&id){const n=node(id);const d=!n&&id.startsWith('d:')&&S.m?S.m.byKey.get(id.slice(2)):null;const b=n&&vis(n)?{x:n.x,y:n.y,w:n.w,h:nodeH(n)}:d;if(b){const r=pad.getBoundingClientRect();S.px=r.width/2-(b.x+b.w/2)*S.z;S.py=r.height/2-(b.y+b.h/2)*S.z;applyView()}}
  if(id&&(S.mode==='form'||S.split)){const t=document.querySelector(`#formPane [data-sel="${id}"]`);if(t){const fp=$('formPane');fp.scrollTo({top:t.offsetTop-fp.clientHeight/3,behavior:'smooth'})}}
}
function flashSync(from){const s=$('syncTx');s.innerHTML=`<i class="fa-solid fa-rotate"></i>${from} → ${['form','graph','script'].filter(x=>x!==from).join(' · ')}`;s.classList.add('flash');clearTimeout(flashSync.t);flashSync.t=setTimeout(()=>{s.classList.remove('flash');s.innerHTML='<i class="fa-solid fa-link"></i>one object · three views'},900)}
function refresh(from,keepInsp){F().nodes.forEach(n=>{if(n.kind==='event')evSync(n)});if(window.__FGS)window.__FGS.onData(from);renderGraph();renderLeft();if(from==='form'){renderInsp()}else{renderForm();if(!keepInsp)renderInsp()}flashSync(from)}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const ft=e.target.closest('[data-feat]');if(ft){S.feat=ft.dataset.feat;S.sel=null;persist();all();return}
  const go=e.target.closest('[data-go]');if(go){const id=S.sel;setMode(go.dataset.go);if(id)setTimeout(()=>select(id,true),30);return}
  const tg=e.target.closest('[data-tog]');if(tg){const n=node(tg.dataset.tog);n.on=!n.on;renderGraph();return}
  const pvc=e.target.closest('[data-pvc]');if(pvc){const c=pvc.dataset.pvc;S.pv=c?{cls:c,lv:AT.CLASSES[c].levels[0]}:null;persist();renderGraph();renderInsp();renderLeft();return}
  const pvl=e.target.closest('[data-pvl]');if(pvl){S.pv.lv=+pvl.dataset.pvl;persist();renderGraph();renderInsp();renderLeft();return}
  const mt=e.target.closest('[data-mt]');if(mt){const n=node(mt.dataset.mt);AT.setMatch(n,n.match==='and'?'or':'and');refresh('graph');return}
  const mts=e.target.closest('[data-mts]');if(mts){const[id,m]=mts.dataset.mts.split(':');AT.setMatch(node(id),m);refresh('graph');return}
  const atr=e.target.closest('[data-atrm]');if(atr){const v=atr.dataset.atrm,i=v.indexOf('|');AT.disconnect(node(v.slice(0,i)),v.slice(i+1));if(S.sel==='w:'+v)S.sel=null;refresh('graph');return}
  const fxo=e.target.closest('[data-fixoneof]');if(fxo){node(fxo.dataset.fixoneof).oneOf=true;S.notice=null;refresh('graph');return}
  const ndis=e.target.closest('[data-ndis]');if(ndis){S.notice=null;renderGraph();return}
  const pk=e.target.closest('[data-peek]');if(pk){S.peek=pk.dataset.peek;renderGraph();return}
  const pkx=e.target.closest('[data-peekx]');if(pkx){S.peek=null;renderGraph();return}
  if(e.target.closest('input,select'))return;
  const s=e.target.closest('[data-sel]');if(s&&!s.closest('#wc')){select(s.dataset.sel,true);return}
});
$('modeSeg').onclick=e=>{const b=e.target.closest('button');if(b)setMode(b.dataset.m)};
$('splitBtn').onclick=()=>{S.split=!S.split;if(S.split&&S.mode!=='graph')S.pair=S.mode;if(S.split&&S.pair==='script'&&S.insp){S.insp=false;S.auto=false;renderInspOpen()}persist();renderMode();requestAnimationFrame(fit);ensureProj()};
$('failBtn').onclick=()=>{S.fails=!S.fails;if(S.fails&&S.feat!=='arbiter')S.feat='arbiter';persist();all()};
document.addEventListener('change',e=>{const t=e.target;
  if(t.dataset.ev){const n=node(t.dataset.ev);n.ev=t.value;n.p={};evSync(n);refresh('graph');return}
  if(t.dataset.evp&&t.tagName==='SELECT'){const[id,k]=t.dataset.evp.split(':');node(id).p[k]=t.value;refresh('graph');return}
  if(t.dataset.bc){const[id,k]=t.dataset.bc.split(':');node(id)[k]=t.checked;refresh(t.closest('#formPane')?'form':'graph');return}
});
document.addEventListener('input',e=>{const t=e.target;const inForm=!!t.closest('#formPane');
  if(t.dataset.evp&&t.tagName==='INPUT'){const[id,k]=t.dataset.evp.split(':');node(id).p[k]=t.value;refresh('graph',true);return}
  if(t.dataset.ff){F()[t.dataset.ff]=t.value;refresh(inForm?'form':'graph',t.tagName!=='SELECT');if(inForm&&t.tagName==='SELECT')renderForm();return}
  const b=t.dataset.b;if(!b)return;const[id,f]=b.split(':');const n=node(id);if(!n)return;n[f]=t.value;
  if(f==='op'&&OPS[n.op]){OPS[n.op].f.forEach(([k,,o])=>{if(n[k]==null)n[k]=Array.isArray(o)?o[0]:o==='var'?(F().nodes.find(m=>m.kind==='var'&&m.store==='stored')||{}).title||'':''})}
  varSync(n);
  renderGraph();renderLeft();
  if(inForm){renderInsp();flashSync('form')}else{renderForm();if(t.tagName==='SELECT')renderInsp();else if(n.kind==='var')renderInspTypeOnly(n);flashSync('graph')}
});
$('zlSeg').onclick=e=>{const b=e.target.closest('[data-zl]');if(b)zoomToLevel(b.dataset.zl)};
$('zin').onclick=()=>zoomAt(1.2);$('zout').onclick=()=>zoomAt(1/1.2);$('zfit').onclick=fit;
function zoomAt(k,cx,cy){const r=pad.getBoundingClientRect();cx=cx??r.width/2;cy=cy??r.height/2;const z=Math.min(2.2,Math.max(.25,S.z*k));S.px=cx-(cx-S.px)*z/S.z;S.py=cy-(cy-S.py)*z/S.z;S.z=z;applyView()}
pad.addEventListener('wheel',e=>{e.preventDefault();const r=pad.getBoundingClientRect();zoomAt(e.deltaY<0?1.1:1/1.1,e.clientX-r.left,e.clientY-r.top)},{passive:false});
const toWorld=(cx,cy)=>{const r=pad.getBoundingClientRect();return [(cx-r.left-S.px)/S.z,(cy-r.top-S.py)/S.z]};

let drag=null;
pad.addEventListener('mousedown',e=>{
  if(e.button!==0||e.target.closest('input,[data-tog]'))return;
  const atp=e.target.closest('.port.at');if(atp){e.preventDefault();startApplies(node(atp.dataset.at),e);return}
  if(e.target.closest('[data-mt],.at-notice,.peek'))return;
  const port=e.target.closest('.port');
  if(port){e.preventDefault();startWire(port.dataset.n,port.dataset.p,e);return}
  const[wx,wy]=toWorld(e.clientX,e.clientY);
  const jn=e.target.closest('.junc');if(jn){selectAt('j:'+jn.dataset.j);return}
  const dn=e.target.closest('.gn[data-dest]');if(dn){const k=dn.dataset.dest;const d=S.m.byKey.get(k);drag={k:'dest',key:k,ox:wx-d.x,oy:wy-d.y,moved:false};return}
  const wh=e.target.closest('.w-hit');if(wh){selectAt('w:'+wh.dataset.w);return}
  const gl=e.target.closest('[data-gl]');
  if(gl){const i=+gl.dataset.gl;const g=F().groups[i];drag={k:'node',list:g.m.map(node).filter(Boolean).map(n=>({n,ox:wx-n.x,oy:wy-n.y})),moved:false,g:i};return}
  const gn=e.target.closest('.gn');
  if(gn){const n=node(gn.dataset.id);
    if(e.shiftKey){if(!S.multi.size&&S.sel)S.multi.add(S.sel);S.multi.has(n.id)?S.multi.delete(n.id):S.multi.add(n.id);S.sel=S.multi.size===1?[...S.multi][0]:null;S.selG=null;if(S.multi.size<2&&S.sel)S.multi=new Set();renderGraph();renderInsp();return}
    const grp=S.multi.has(n.id)?[...S.multi].map(node):[n];
    drag={k:'node',list:grp.map(m=>({n:m,ox:wx-m.x,oy:wy-m.y})),moved:false};if(!S.multi.has(n.id)&&S.sel!==n.id)select(n.id);return}
  if(e.shiftKey){const mq=document.createElement('div');mq.className='marq';wc.appendChild(mq);drag={k:'marq',x0:wx,y0:wy,mq};return}
  drag={k:'pan',sx:e.clientX,sy:e.clientY,px:S.px,py:S.py,moved:false};pad.classList.add('grabbing');
});
window.addEventListener('mousemove',e=>{
  if(!drag)return;
  if(drag.k==='pan'){S.px=drag.px+e.clientX-drag.sx;S.py=drag.py+e.clientY-drag.sy;if(Math.abs(e.clientX-drag.sx)+Math.abs(e.clientY-drag.sy)>3)drag.moved=true;applyView()}
  else if(drag.k==='node'){const[wx,wy]=toWorld(e.clientX,e.clientY);drag.moved=true;drag.list.forEach(({n,ox,oy})=>{n.x=Math.round(wx-ox);n.y=Math.round(wy-oy);const el=wc.querySelector('.gn[data-id="'+n.id+'"]');if(el){el.style.left=n.x+'px';el.style.top=n.y+'px'}});updateGroups();drawWires()}
  else if(drag.k==='marq'){const[wx,wy]=toWorld(e.clientX,e.clientY);const x=Math.min(wx,drag.x0),y=Math.min(wy,drag.y0),w=Math.abs(wx-drag.x0),h=Math.abs(wy-drag.y0);Object.assign(drag.mq.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});drag.box={x,y,w,h}}
  else if(drag.k==='wire')moveWire(e);
  else if(drag.k==='dest'){const[wx,wy]=toWorld(e.clientX,e.clientY);const f=F();f.destPos=f.destPos||{};f.destPos[drag.key]=[Math.round(wx-drag.ox),Math.round(wy-drag.oy)];drag.moved=true;drawWires()}
  else if(drag.k==='at')moveApplies(e);
});
window.addEventListener('mouseup',e=>{
  if(!drag)return;const d=drag;drag=null;pad.classList.remove('grabbing');
  if(d.k==='pan'&&!d.moved&&(S.sel||S.selG!=null||S.multi.size)){select(null)}
  if(d.k==='node'&&d.g!=null&&!d.moved){S.sel=null;S.multi=new Set();S.selG=d.g;renderGraph();renderInsp();setTimeout(()=>{const i=document.querySelector('[data-g-f="l"]');if(i){i.focus();i.select()}},0)}
  if(d.k==='marq'){d.mq.remove();const b=d.box;if(b){const hit=F().nodes.filter(vis).filter(n=>n.x<b.x+b.w&&n.x+n.w>b.x&&n.y<b.y+b.h&&n.y+nodeH(n)>b.y).map(n=>n.id);S.selG=null;S.multi=new Set(hit);S.sel=hit.length===1?hit[0]:null;if(hit.length<2)S.multi=new Set();renderGraph();renderInsp()}}
  if(d.k==='wire')endWire(e,d);
  if(d.k==='dest'&&!d.moved){selectAt('d:'+d.key);if(AT.selKind(d.key)==='thing'&&AT.namesByGid.has(d.key)){S.peek=d.key;renderGraph()}}
  if(d.k==='at')endApplies(e,d);
});

/* wire drag: compatible ports pulse, incompatible dim; hovering one says why */
function startWire(nid,pid,e){
  const f=F();let n=node(nid),p=portSpec(n,pid);
  if(p.dir==='in'){const ex=f.edges.find(x=>x.to===nid+'.'+pid&&!x.flag);if(!ex)return;f.edges.splice(f.edges.indexOf(ex),1);[nid,pid]=split(ex.from);n=node(nid);p=portSpec(n,pid);renderGraph()}
  const[x,y]=portXY(n,pid);
  const g=document.createElementNS('http://www.w3.org/2000/svg','path');g.setAttribute('class','w-ghost'+(p.t==='f'?' flow':''));$('wsvg').appendChild(g);
  if(p.t!=='f'){const probe=document.querySelector('.t-'+p.t);if(probe)g.style.stroke=getComputedStyle(probe).getPropertyValue('--pc')}
  pad.classList.add('wiring');
  wc.querySelectorAll('.port').forEach(pe=>{const N=node(pe.dataset.n),Q=portSpec(N,pe.dataset.p);if(Q.dir!=='in'){pe.classList.add('no');return}const c=check(n,p,N,Q);pe.classList.add(c?'no':'can');pe._why=c});
  const tip=document.createElement('div');tip.className='refuse-tip float';tip.style.display='none';document.body.appendChild(tip);
  drag={k:'wire',n,p,x,y,g,tip};moveWire(e);
}
function moveWire(e){
  const d=drag;const[wx,wy]=toWorld(e.clientX,e.clientY);
  const pe=document.elementFromPoint(e.clientX,e.clientY)?.closest('.port');
  wc.querySelectorAll('.port.deny').forEach(x=>x.classList.remove('deny'));
  let tx=wx,ty=wy,why=null;
  if(pe&&pe._why!==undefined&&pe.classList.contains('no')&&pe._why){why=pe._why;pe.classList.add('deny')}
  else if(pe&&pe.classList.contains('can')){const N=node(pe.dataset.n);[tx,ty]=portXY(N,pe.dataset.p)}
  d.g.setAttribute('d',curve(d.x,d.y,tx,ty));d.g.classList.toggle('refuse',!!why);
  if(why){d.tip.style.display='block';d.tip.innerHTML=`<div class="rt"><i class="fa-solid fa-ban"></i>Refused · ${esc(why.rule)}</div><div class="rs">${esc(why.msg)}</div>`;d.tip.style.left=(e.clientX+16)+'px';d.tip.style.top=(e.clientY+14)+'px'}
  else d.tip.style.display='none';
}
function endWire(e,d){
  pad.classList.remove('wiring');
  const pe=document.elementFromPoint(e.clientX,e.clientY)?.closest('.port');
  wc.querySelectorAll('.port').forEach(x=>{x.classList.remove('can','no','deny');delete x._why});
  if(pe&&pe.dataset.n){
    const N=node(pe.dataset.n),Q=portSpec(N,pe.dataset.p);
    if(Q.dir==='in'){const c=check(d.n,d.p,N,Q);
      if(!c){const f=F();const to=N.id+'.'+Q.id;if(Q.t!=='f')f.edges=f.edges.filter(x=>x.to!==to||x.flag);f.edges.push({from:d.n.id+'.'+d.p.id,to});d.tip.remove();refresh('graph');return}
      d.g.classList.add('w-snap');d.tip.classList.add('fade');setTimeout(()=>{d.tip.remove();drawWires()},1600);return}
  }
  d.tip.remove();d.g.remove();
  const over=document.elementFromPoint(e.clientX,e.clientY);
  if(over&&over.closest('#pad')&&!over.closest('.gn'))openQuick(e.clientX,e.clientY,{n:d.n,p:d.p});
}

/* ---------- adding nodes ---------- */
const hasPress=()=>F().nodes.some(n=>n.kind==='event'&&n.ev==='press');
const DEF={
  event:()=>hasPress()?{title:'Roll made',ev:'roll',rows:[]}:{title:'Press · '+F().name,ev:'press',rows:[]},
  cond:()=>({title:'Condition',expr:'true',rows:[[P('a','n','reads'),P('t','f','True')],[null,P('fa','f','False')]]}),
  ask:()=>({title:'Ask',prompt:'Did it happen?',rows:[[null,P('y','f','then')]]}),
  action:()=>({op:'setVar',title:'',variable:(F().nodes.find(m=>m.kind==='var'&&m.store==='stored')||{}).title||'',value:'0',rows:[[P('val','n','reads'),null]]}),
  contrib:()=>({op:'add',title:'',amount:'1',dtype:'—',when:'',ask:'',target:[],rows:[[P('w1','n','reads'),null]]}),
  sheet:()=>({op:'boost',title:'',stat:'DEX',amount:'2',cap:'',rows:[]}),
  var:()=>({store:'derived',title:'newVariable',formula:'0',rows:[[P('a','n','reads'),P('out','n','value')]]}),
  picks:()=>({title:'Picks',rows:[]})
};
const W={event:200,cond:230,ask:240,action:210,contrib:240,sheet:200,var:210,picks:160};
let seq=1;
function makeNode(kind,wx,wy){
  const f=F();let id;do{id=kind+(seq++)}while(f.nodes.some(n=>n.id===id));
  const n={id,kind,x:Math.round(wx),y:Math.round(wy),w:W[kind],...DEF[kind]()};if(kind==='event')evSync(n);selSync(n);varSync(n);
  f.nodes.push(n);return n;
}
function kindAllowed(k){return !(k==='picks'&&F().nodes.some(n=>n.kind==='picks'))}
function compatPorts(src,kind){const tmp={id:'__tmp',kind,x:0,y:0,w:W[kind],...DEF[kind]()};const ins=[];if(hasHin(tmp))ins.push('hin');tmp.rows.forEach(r=>r[0]&&ins.push(r[0].id));return ins.filter(pid=>!check(src.n,src.p,tmp,portSpec(tmp,pid)))}
function addNode(kind,cx,cy,src){
  const[wx,wy]=toWorld(cx,cy);const n=makeNode(kind,wx,wy-15);
  if(src){const pid=compatPorts(src,kind)[0];if(pid)F().edges.push({from:src.n.id+'.'+src.p.id,to:n.id+'.'+pid})}
  S.sel=n.id;refresh('graph');
}
const qa=document.createElement('div');qa.className='qadd';qa.style.display='none';document.body.appendChild(qa);
function openQuick(cx,cy,src){
  qa.classList.remove('at');
  const kinds=Object.keys(KIND).filter(k=>kindAllowed(k)&&(!src||compatPorts(src,k).length));
  if(!kinds.length){closeQuick();const tip=document.createElement('div');tip.className='refuse-tip float fade';tip.innerHTML='<div class="rt"><i class="fa-solid fa-ban"></i>Nothing to add</div><div class="rs">No node kind has an input for a '+esc(TYPE[src.p.t])+'.</div>';tip.style.left=(cx+14)+'px';tip.style.top=(cy+12)+'px';document.body.appendChild(tip);setTimeout(()=>tip.remove(),1700);return}
  qa.innerHTML=`<div class="qa-h">${src?`<i class="fa-solid fa-plug"></i>Accepts a ${TYPE[src.p.t]}`:'<i class="fa-solid fa-plus"></i>Add node'}</div><input class="in qa-in" placeholder="Search kinds…"><div class="qa-l"></div>${src?`<div class="qa-f">${Object.keys(KIND).length-kinds.length} kinds hidden — they can’t take this wire</div>`:''}`;
  const list=qa.querySelector('.qa-l'),inp=qa.querySelector('input');
  const draw=()=>{const q=inp.value.toLowerCase();list.innerHTML=kinds.filter(k=>KIND[k].label.toLowerCase().includes(q)).map((k,i)=>`<button class="qa-i${i?'':' hot'}" data-k="${k}" style="--kc:${KIND[k].c}"><span class="sw ${k}"></span>${KIND[k].label}<span class="s">${KIND[k].sub}</span></button>`).join('')};
  draw();inp.oninput=draw;
  inp.onkeydown=e=>{if(e.key==='Escape')closeQuick();if(e.key==='Enter'){const b=list.querySelector('.qa-i');if(b){closeQuick();addNode(b.dataset.k,cx,cy,src)}}};
  list.onclick=e=>{const b=e.target.closest('.qa-i');if(b){closeQuick();addNode(b.dataset.k,cx,cy,src)}};
  qa.style.display='block';qa.style.left=Math.min(cx,innerWidth-230)+'px';qa.style.top=Math.min(cy,innerHeight-qa.offsetHeight-10)+'px';
  setTimeout(()=>inp.focus(),0);
}
function closeQuick(){qa.style.display='none'}
document.addEventListener('mousedown',e=>{if(qa.style.display!=='none'&&!e.target.closest('.qadd'))closeQuick()},true);
pad.addEventListener('dblclick',e=>{if(e.target.closest('.gn'))return;openQuick(e.clientX,e.clientY,null)});
window.addEventListener('keydown',e=>{
  if(e.target.closest('input,textarea,select'))return;
  if(e.key==='a'&&!e.metaKey&&!e.ctrlKey&&$('graphPane').offsetParent){const r=pad.getBoundingClientRect();openQuick(r.left+r.width/2-100,r.top+r.height/2-80,null);e.preventDefault()}
  if(e.key==='g'&&!e.metaKey&&!e.ctrlKey&&(S.multi.size>1||S.sel)){makeGroup();e.preventDefault();return}
  if((e.key==='Delete'||e.key==='Backspace')&&S.selG!=null){ungroup(S.selG);return}
  if(e.key==='Escape'&&S.peek){S.peek=null;renderGraph();return}
  if((e.key==='Delete'||e.key==='Backspace')&&S.sel&&S.sel.startsWith('w:')){const v=S.sel.slice(2),i=v.indexOf('|');AT.disconnect(node(v.slice(0,i)),v.slice(i+1));S.sel=null;refresh('graph');return}
  if((e.key==='Delete'||e.key==='Backspace')&&S.sel&&!/^[dj]:/.test(S.sel)){const f=F();f.nodes=f.nodes.filter(n=>n.id!==S.sel);f.edges=f.edges.filter(x=>!x.from.startsWith(S.sel+'.')&&!x.to.startsWith(S.sel+'.'));S.sel=null;refresh('graph')}
  if(e.key==='i'&&!e.metaKey&&!e.ctrlKey){toggleInsp();e.preventDefault()}
});
let pal=null;
$('kinds').addEventListener('mousedown',e=>{const r=e.target.closest('.kind-row');if(!r||e.button!==0)return;e.preventDefault();const k=r.dataset.kind;if(!kindAllowed(k))return;const g=document.createElement('div');g.className='kind-drag';g.style.setProperty('--kc',KIND[k].c);g.innerHTML=`<span class="sw ${k}"></span>${KIND[k].label}`;document.body.appendChild(g);pal={k,g};movePal(e)});
function movePal(e){pal.g.style.left=e.clientX+12+'px';pal.g.style.top=e.clientY+8+'px';pal.g.classList.toggle('ok',!!document.elementFromPoint(e.clientX,e.clientY)?.closest('#pad'))}
window.addEventListener('mousemove',e=>{if(pal)movePal(e)});
window.addEventListener('mouseup',e=>{if(!pal)return;const p=pal;pal=null;p.g.remove();if(document.elementFromPoint(e.clientX,e.clientY)?.closest('#pad'))addNode(p.k,e.clientX,e.clientY,null)});

/* ---------- inspector open state: collapsed = auto (opens on select, closes on deselect) ---------- */
function renderInspOpen(){document.querySelector('.editor').classList.toggle('insp-closed',!(S.insp||S.auto));const n=S.sel&&node(S.sel);$('railSel').textContent=n?n.title:''}
function toggleInsp(v){const open=S.insp||S.auto;S.insp=v??!open;S.auto=false;persist();renderInspOpen()}
$('inspTog').onclick=()=>toggleInsp(false);$('inspRail').onclick=()=>toggleInsp(true);

/* ---------- groups: layout-only frames, sized to their members ---------- */
function groupBox(g){const ms=g.m.map(node).filter(n=>n&&vis(n));if(!ms.length)return null;let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;ms.forEach(n=>{x0=Math.min(x0,n.x);y0=Math.min(y0,n.y);x1=Math.max(x1,n.x+n.w+(n.kind==='contrib'?44:0));y1=Math.max(y1,n.y+nodeH(n))});return {x:x0-28,y:y0-34,w:x1-x0+56,h:y1-y0+58}}
function updateGroups(){F().groups.forEach((g,i)=>{const el=wc.querySelector('.grp[data-g="'+i+'"]'),b=groupBox(g);if(el&&b)Object.assign(el.style,{left:b.x+'px',top:b.y+'px',width:b.w+'px',height:b.h+'px'})})}
function makeGroup(){const ids=S.multi.size>1?[...S.multi]:S.sel?[S.sel]:[];if(!ids.length)return;const f=F();f.groups.forEach(g=>g.m=g.m.filter(id=>!ids.includes(id)));f.groups=f.groups.filter(g=>g.m.length);f.groups.push({m:ids,l:'New group',s:''});S.sel=null;S.multi=new Set();S.selG=f.groups.length-1;renderGraph();renderInsp();setTimeout(()=>{const i=document.querySelector('[data-g-f="l"]');if(i){i.focus();i.select()}},0)}
function ungroup(i){F().groups.splice(i,1);S.selG=null;renderGraph();renderInsp()}
document.addEventListener('input',e=>{const k=e.target.dataset.gF;if(!k||S.selG==null)return;F().groups[S.selG][k]=e.target.value;renderGraph();const t=document.querySelector('#insp .ih .t');if(t&&k==='l')t.textContent=e.target.value});
/* ---------- applies-to: derived destinations, junctions, drag, picker (docs/Applies-to Wiring Plan.md) ---------- */
const DEST_H=66;
function atModel(){
  const f=F(),own='feature:'+f.id;f.destPos=f.destPos||{};
  const srcs=f.nodes.filter(n=>vis(n)&&OPS[n.op]&&AT.hasPort(n.op));
  const dests=new Map(),wires=[],juncs=[];
  srcs.forEach(n=>{const v=AT.viewTargets(n,own);const style=AT.gateStyle(n),off=S.pv?pvState(n)==='off':false;
    if(v.and)juncs.push({id:n.id,src:n,keys:v.keys,off});
    v.keys.forEach(k=>{if(!dests.has(k))dests.set(k,{key:k,srcs:[]});dests.get(k).srcs.push(n);wires.push({src:n,key:k,style,off,and:v.and})})});
  const dr=S.draft&&node(S.draft.src);if(dr&&vis(dr)){const k=S.draft.key;dests.set(k,{key:k,srcs:[dr],draft:true});wires.push({src:dr,key:k,style:'draft',off:false,and:false})}
  const auto=[];
  for(const d of dests.values()){d.w=210;d.h=DEST_H;const p=f.destPos[d.key];if(p){d.x=p[0];d.y=p[1]}else{d.x=Math.max(...d.srcs.map(s=>s.x+s.w))+(juncs.some(j=>j.keys.includes(d.key))?150:110);d.y=Math.round(d.srcs.reduce((a,s)=>a+s.y,0)/d.srcs.length);auto.push(d)}}
  auto.sort((a,b)=>a.y-b.y);const boxes=f.nodes.filter(vis).map(n=>({x:n.x,y:n.y,w:n.w+50,h:nodeH(n)})).concat([...dests.values()].filter(d=>!auto.includes(d)));
  auto.forEach(d=>{let g=0;while(g++<60&&boxes.some(o=>d.x<o.x+o.w+12&&d.x+d.w+12>o.x&&d.y<o.y+o.h+12&&d.y+d.h+12>o.y))d.y+=30;boxes.push(d)});
  return {dests:[...dests.values()],wires,juncs,byKey:dests};
}
function destHTML(d){if(d.draft)return draftHTML(d);const k=d.key,kind=AT.selKind(k);const broken=kind==='thing'&&S.ready&&!AT.namesByGid.has(k),loading=kind==='thing'&&!S.ready;
  const zero=kind==='tag'&&AT.matchCount([k],'or')===0;const sel=S.sel==='d:'+k;const off=S.pv&&d.srcs.every(s=>pvState(s)==='off');
  const dk=kind==='tag'?'set':kind==='roll'?'roll':'ref';const icon=dk==='set'?'fa-tags':dk==='roll'?'fa-dice-d20':broken?'fa-link-slash':'fa-arrow-up-right-from-square';
  const sub=loading?'loading catalog…':broken?'no catalog row · dangling':destSub(k);
  const badge=broken?'<span class="gbadge"><i class="fa-solid fa-triangle-exclamation"></i>Dangling</span>':zero?'<span class="gbadge zero"><i class="fa-solid fa-circle-exclamation"></i>0 matches</span>':'';
  return `<div class="gn k-dest dk-${dk}${broken?' broken':''}${zero?' zero':''}${sel?' sel':''}${off?' off':''}${loading?' loading':''}" data-dest="${esc(k)}" style="left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px"><div class="gf"></div><div class="gi"><div class="gh"><i class="fa-solid ${icon}"></i><span class="gt" title="${esc(k)}">${esc(loading?k:destLabel(k))}</span><span class="gk">${dk==='set'?'tag':dk==='roll'?'roll kind':'reference'}</span></div><div class="gb" style="height:${d.h-HDR-8}px"><span class="fx">${esc(sub)}</span><span class="fan">${d.srcs.length} in</span></div></div>${ovHTML(dk==='set'?'tag':dk==='roll'?'roll kind':'reference',loading?k:destLabel(k),'',d.w,d.h)}<span class="atin" style="left:0;top:15px"></span>${badge}</div>`}
function juncHTML(jn){const bad=AT.auditEffect({...jn.src,label:jn.src.title},'feature:'+F().id).some(a=>a.t==='and can never match');const c=AT.matchCount(jn.keys,'and');
  return `<div class="junc${S.sel==='j:'+jn.id?' sel':''}${bad?' bad':''}${jn.off?' off':''}" data-j="${jn.id}" style="left:${jn.src.x+jn.src.w+46}px;top:${jn.src.y+15}px" title="and — every target must hold of one roll"><span class="jd"></span><span class="jc">${bad?'never matches':'and · '+esc(AT.fmtCount(c))}</span></div>`}
function noticeHTML(){const nt=S.notice;const n=nt&&node(nt.id);if(!n)return '';return `<div class="at-notice" style="left:${n.x+n.w+30}px;top:${n.y-74}px"><div class="an-t"><i class="fa-solid fa-triangle-exclamation"></i>${esc(nt.t)}</div><div class="an-s">${esc(nt.text)}</div><div class="an-b">${nt.fix==='oneOf'?`<button class="btn amber sm" data-fixoneof="${n.id}"><span class="bf"></span><span class="bi">Make it one across all targets</span></button>`:''}<button class="btn ghost sm" data-ndis="1"><span class="bf"></span><span class="bi">${nt.fix?'Keep separate':'Understood'}</span></button></div></div>`}
function peekHTML(){const k=S.peek;const d=k&&S.m&&S.m.byKey.get(k);const nm=k&&AT.namesByGid.get(k);if(!d||!nm)return '';const row=AT.CATALOG_NODES.find(x=>x.gid===k);const aff=S.ready?AT.affectedBy(catIdx(),k):[];
  return `<div class="peek" style="left:${d.x+d.w+16}px;top:${d.y-10}px"><div class="pk-h"><i class="fa-solid fa-eye"></i>${esc(nm.kind)} · read-only peek<button class="x" data-peekx="1" title="Close · Esc"><i class="fa-solid fa-xmark"></i></button></div><div class="pk-n">${esc(nm.name)}</div><div class="pk-g">${esc(k)}</div><div class="pk-t">${(row&&row.tags||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</div><div class="pk-a">Affected by ${aff.length} rule${aff.length===1?'':'s'} across the catalog. Edit it in its own editor — this canvas never writes to it.</div></div>`}
function liveSources(){return Object.values(FEATS).map(f=>({owner:'feature:'+f.id,name:f.name,effects:f.nodes.filter(n=>OPS[n.op]&&AT.hasPort(n.op)).map(n=>({id:n.id,label:n.title,op:n.op,target:n.target||[],match:n.match,when:!!(n.when&&n.when.trim()),ask:!!(n.ask&&n.ask.trim()),_n:n,_f:f.id}))})).filter(s=>s.effects.length)}
function catIdx(){const live=liveSources();const lo=new Set(live.map(s=>s.owner));return AT.indexEffects((S.proj||[]).filter(s=>!lo.has(s.owner)).concat(live))}
function ensureProj(){if(S.proj||S.projPending||!(S.mode==='graph'||S.split))return;S.projPending=true;AT.fetchProjection(liveSources().map(s=>({owner:s.owner,name:s.name,effects:s.effects.map(({_n,_f,...e})=>e)}))).then(p=>{S.proj=p;S.ready=true;S.projPending=false;renderGraph();renderLeft();renderInsp()})}
function selectAt(id){S.sel=id;S.selG=null;S.multi=new Set();renderGraph();renderInsp()}
function renderInspAt(el){
  const p=S.sel[0],v=S.sel.slice(2);
  if(p==='d'&&S.draft&&v===S.draft.key){renderInspDraft(el);return}
  if(p==='d'&&v.startsWith('draft:')){S.sel=null;el.innerHTML='';return}
  if(p==='d'){const k=v,kind=AT.selKind(k);const wn=(S.m&&S.m.byKey.get(k)||{srcs:[]}).srcs;const aff=S.ready?AT.affectedBy(catIdx(),k):null;
    let h=`<div class="ih" style="--kc:${KC[kind]||'var(--orange)'}"><span class="sw target isw"></span><div class="it"><div class="t">${esc(destLabel(k))}</div><div class="k">${kind==='tag'?'Tag set':kind==='roll'?'Roll kind':'Reference · read-only'}</div></div></div>`;
    h+=`<div class="iblk" style="--bc:var(--orange)"><b>${esc(k)}</b>${kind==='tag'?esc(AT.fmtCount(AT.matchCount([k],'or')))+' in the catalog carry this tag.':kind==='roll'?'Every roll of this kind, on anything.':AT.namesByGid.has(k)?'A catalog row, drawn here as a proxy. Edit it in its own editor.':S.ready?'':'Waiting for the catalog.'}</div>`;
    if(kind==='tag'&&AT.matchCount([k],'or')===0)h+=`<div class="iblk" style="--bc:var(--amber)"><b>Zero live matches · not blocking</b>Correct if nothing carries this tag yet; a typo otherwise.</div>`;
    if(kind==='thing'&&S.ready&&!AT.namesByGid.has(k))h+=`<div class="iblk err"><b>Dangling target · blocks publish</b>No catalog row is called ${esc(k)}. Retarget or remove the wire.</div>`;
    h+=chooserHTML(kind,'Retarget · '+wn.length+' wire'+(wn.length===1?'':'s'));
    if(kind==='thing'&&AT.namesByGid.has(k))h+=`<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn ghost" data-peek="${esc(k)}"><span class="bf"></span><span class="bi"><i class="fa-solid fa-eye"></i>Peek</span></button></div>`;
    h+=`<span class="field-lab">Affected by · ${aff?aff.length+' · whole catalog':'loading catalog…'}</span>`;
    if(aff)h+=`<div class="conns">${aff.map(e=>{const here=e.eff._f===F().id;const st=e.eff._n&&S.pv?pvState(e.eff._n):null;const g=e.eff.ask?'ask-gated':e.eff.when?'when-gated':'always';return `<div class="conn"${here?` data-sel="${e.eff.id}"`:''} style="--pc:var(--violet)"><span class="cp"></span><b>${esc(e.eff._n?interp(e.eff._n.title):(e.eff.label||e.eff.id))}</b><span class="cs">${esc(e.name)}${here?'':' · off-canvas'} · ${st?(st==='off'?'inactive':st==='active'?'active':'undetermined'):g}</span></div>`}).join('')||'<div class="conn">Nothing in the catalog</div>'}</div><div class="iblk"><b>Catalog scope</b>What could affect this, across every feature — not what does for one character. <code>and</code> rules are listed on their junction instead.</div>`;
    el.innerHTML=h;$('inspMeta').textContent='applies-to';bindChooser(el,kind,wn,c=>retarget(k,c),k);return}
  if(p==='j'){const n=node(v);if(!n){el.innerHTML='';return}const vt=AT.viewTargets(n,'feature:'+F().id);
    el.innerHTML=`<div class="ih" style="--kc:var(--orange)"><span class="sw target isw"></span><div class="it"><div class="t">and · ${esc(n.title)}</div><div class="k">Junction · intersection</div></div></div><div class="iblk" style="--bc:var(--orange)"><b>${esc(AT.fmtCount(AT.matchCount(vt.keys,'and')))}</b>Things for which some roll holds every target below — counted with the same check the roll engine uses.</div><div class="conns">${vt.keys.map(k=>`<div class="conn" data-sel="d:${esc(k)}" style="--pc:var(--orange)"><span class="cp"></span><b>${esc(destLabel(k))}</b><span style="margin-left:auto">${esc(destSub(k))}</span></div>`).join('')}</div><span class="field-lab">Affected by · 1</span><div class="conns"><div class="conn" data-sel="${n.id}" style="--pc:var(--violet)"><span class="cp"></span><b>${esc(n.title)}</b><span style="margin-left:auto">${esc(F().name)}</span></div></div><div class="seg2"><button data-mts="${n.id}:or">or</button><button data-mts="${n.id}:and" class="on">and</button></div>`;$('inspMeta').textContent='junction';return}
  if(p==='w'){const i=v.indexOf('|'),id=v.slice(0,i),k=v.slice(i+1);const n=node(id);
    el.innerHTML=`<div class="ih" style="--kc:var(--orange)"><span class="sw target isw"></span><div class="it"><div class="t">${esc(n?n.title:id)} → ${esc(destLabel(k))}</div><div class="k">Applies-to wire</div></div></div><div class="iblk"><b>One entry in target</b>Stored as <code>${esc(k)}</code> on ${esc(n?n.title:id)}. Removing the wire removes that entry, plus any legacy spelling that normalises to it.</div><div style="display:flex;gap:8px"><button class="btn ghost" data-atrm="${esc(v)}"><span class="bf"></span><span class="bi"><i class="fa-solid fa-link-slash"></i>Remove wire · Del</span></button></div>`;$('inspMeta').textContent='wire';return}
}
function startApplies(n,e){
  const own='feature:'+F().id,x=n.x+n.w+7,y=n.y+15,others=AT.viewTargets(n,own).keys;
  const g=document.createElementNS('http://www.w3.org/2000/svg','path');g.setAttribute('class','w-ghost at');$('wsvg').appendChild(g);
  pad.classList.add('wiring');
  wc.querySelectorAll('.gn[data-dest]').forEach(el=>{const k=el.dataset.dest;const why=AT.isTargeted(n,k)?{rule:'Already targeted',msg:`${n.title||n.op} already applies to ${k}. That wire is highlighted — no duplicate entry is written.`,dup:k}:AT.accepts(n,k,others.filter(o=>o!==k));el.classList.add(why?'no':'can');el._why=why});
  wc.querySelectorAll('.gn[data-id]').forEach(el=>{const N=node(el.dataset.id);el.classList.add('no');el._why=AT.refuseDestination(N.kind==='contrib'?'contrib':N.kind==='var'?'var':'other')});
  wc.querySelectorAll('.port').forEach(pe=>{if(!pe.classList.contains('at'))pe._why=AT.refuseDestination(pe.classList.contains('data')?'data':'other')});
  const tip=document.createElement('div');tip.className='refuse-tip float';tip.style.display='none';document.body.appendChild(tip);
  drag={k:'at',n,x,y,g,tip};moveApplies(e);
}
function atTargetAt(e){const el=document.elementFromPoint(e.clientX,e.clientY);if(!el)return null;return el.closest('.port:not(.at)')||el.closest('.gn[data-dest]')||el.closest('.gn[data-id]')}
function moveApplies(e){const d=drag;const[wx,wy]=toWorld(e.clientX,e.clientY);const t=atTargetAt(e);const why=t?t._why:null;let tx=wx,ty=wy;
  wc.querySelectorAll('.deny').forEach(x=>x.classList.remove('deny'));wc.querySelectorAll('.w-at.flash').forEach(p=>p.classList.remove('flash'));
  if(t&&t.dataset.dest&&!why){const m=S.m.byKey.get(t.dataset.dest);tx=m.x-6;ty=m.y+m.h/2}
  if(t&&why){t.classList.add('deny');if(why.dup){const hp=wc.querySelector('.w-hit[data-w="'+CSS.escape(d.n.id+'|'+why.dup)+'"]');if(hp&&hp.previousElementSibling)hp.previousElementSibling.classList.add('flash')}}
  d.g.setAttribute('d',curve(d.x,d.y,tx,ty));d.g.classList.toggle('refuse',!!why);
  if(why){d.tip.style.display='block';d.tip.innerHTML=`<div class="rt"><i class="fa-solid fa-ban"></i>Refused · ${esc(why.rule)}</div><div class="rs">${esc(why.msg)}</div>`;d.tip.style.left=(e.clientX+16)+'px';d.tip.style.top=(e.clientY+14)+'px'}else d.tip.style.display='none'}
function endApplies(e,d){pad.classList.remove('wiring');const t=atTargetAt(e);const why=t&&t._why;
  wc.querySelectorAll('.gn').forEach(x=>{x.classList.remove('can','no','deny');delete x._why});wc.querySelectorAll('.port').forEach(x=>delete x._why);
  if(why){d.g.classList.add('w-snap');d.tip.classList.add('fade');setTimeout(()=>{d.tip.remove();drawWires()},1600);return}
  d.tip.remove();d.g.remove();
  if(t&&t.dataset.dest){doConnect(d.n,t.dataset.dest);return}
  const over=document.elementFromPoint(e.clientX,e.clientY);if(over&&over.closest('#pad')&&!t)openAtKinds(e.clientX,e.clientY,d.n);
}
function doConnect(n,sel,pos){const k=AT.asKey(sel);if(!AT.connect(n,k))return false;const f=F();f.destPos=f.destPos||{};if(pos&&!f.destPos[k])f.destPos[k]=pos;
  const nt=AT.connectNotice({...n,label:n.title},'feature:'+f.id);S.notice=nt?{id:n.id,...nt}:null;refresh('graph');return true}
const KC={tag:'var(--orange)',roll:'var(--roll-c)',thing:'var(--beige)'};
const KLAB={tag:['Tag','fa-tags','a set — everything carrying it'],roll:['Roll kind','fa-dice-d20','every roll of one kind'],thing:['Thing','fa-arrow-up-right-from-square','one specific catalog row']};
function legalKinds(n){const T=AT.TARGETS[n.op];return ['tag','roll','thing'].filter(k=>T.kinds.includes(k)&&!(n.once&&T.armable&&k!=='roll'))}
function openAtKinds(cx,cy,n){
  const ks=legalKinds(n);const[wx,wy]=toWorld(cx,cy);
  const make=k=>{closeQuick();const key='draft:'+k;const f=F();f.destPos=f.destPos||{};f.destPos[key]=[Math.round(wx),Math.round(wy-15)];S.draft={src:n.id,kind:k,key};S.notice=null;selectAt('d:'+key);setTimeout(()=>{const q=$('atQ');if(q)q.focus()},0)};
  if(ks.length===1){make(ks[0]);return}
  qa.classList.remove('at');
  qa.innerHTML=`<div class="qa-h"><i class="fa-solid fa-crosshairs"></i>${esc(n.op)} applies to a…</div><div class="qa-l">${['tag','roll','thing'].map(k=>{const ok=ks.includes(k);return `<button class="qa-i${ok?'':' dup'}" data-k="${k}"${ok?'':' disabled'} style="--kc:${KC[k]}"><i class="fa-solid ${KLAB[k][1]}" style="width:14px;color:var(--kc)"></i>${KLAB[k][0]}<span class="s">${ok?KLAB[k][2]:AT.TARGETS[n.op].kinds.includes(k)?'armed → rolls only':'not for '+esc(n.op)}</span></button>`}).join('')}</div><div class="qa-f">Choose which one in the inspector.</div>`;
  qa.querySelector('.qa-l').onclick=e=>{const b=e.target.closest('.qa-i');if(b&&!b.disabled)make(b.dataset.k)};
  qa.style.display='block';qa.style.left=Math.min(cx,innerWidth-240)+'px';qa.style.top=Math.max(10,Math.min(cy,innerHeight-qa.offsetHeight-10))+'px';
}
function draftHTML(d){const k=S.draft.kind;const sel=S.sel==='d:'+d.key;
  return `<div class="gn k-dest dk-${k==='tag'?'set':k==='roll'?'roll':'ref'} draft${sel?' sel':''}" data-dest="${esc(d.key)}" style="left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px"><div class="gf"></div><div class="gi"><div class="gh"><i class="fa-solid ${KLAB[k][1]}"></i><span class="gt">Choose a ${KLAB[k][0].toLowerCase()}…</span><span class="gk">unset</span></div><div class="gb" style="height:${d.h-HDR-8}px"><span class="fx">in the inspector · nothing saved yet</span></div></div><span class="atin" style="left:0;top:15px"></span></div>`}
function candidates(kind){if(kind==='tag'){const t=new Set();AT.CATALOG_NODES.forEach(x=>(x.tags||[]).forEach(v=>t.add(AT.normalizeTag(v))));return [...t].sort().map(v=>'tag:'+v)}if(kind==='roll')return ROLL_SELECTORS;const own='feature:'+F().id;return [...AT.namesByGid.keys()].filter(g=>g!==own)}
/* legal for every rule wired here; `cur` is the key being replaced */
function legalFor(c,srcs,cur){return srcs.every(n=>{const o=AT.viewTargets(n,'feature:'+F().id).keys.filter(x=>x!==cur);return !AT.accepts(n,c,o)&&!o.includes(AT.asKey(c))})}
function chooserHTML(kind,label){if(!KLAB[kind])return '';return `<span class="field-lab" style="color:${KC[kind]}">${esc(label)}</span><input class="in" id="atQ" placeholder="${kind==='tag'?'Search, or type a new tag…':'Search '+KLAB[kind][0].toLowerCase()+'s…'}" autocomplete="off"><div class="qa-l at-vals" id="atVals" style="--kc:${KC[kind]}"></div>`}
function bindChooser(el,kind,srcs,onPick,cur){
  const inp=el.querySelector('#atQ'),list=el.querySelector('#atVals');if(!inp)return;
  const all=candidates(kind).filter(c=>c===cur||legalFor(c,srcs,cur));
  const lab=c=>kind==='tag'?c.slice(4):kind==='roll'?c.slice(5):destLabel(c);
  const draw=()=>{const q=inp.value.trim().toLowerCase();let it=all.filter(c=>!q||c.toLowerCase().includes(q)||lab(c).toLowerCase().includes(q));
    if(kind==='tag'&&q){const nt='tag:'+AT.normalizeTag(q);if(!all.includes(nt)&&legalFor(nt,srcs,cur))it.unshift(nt)}
    let html='',fam='';it.forEach(c=>{if(kind==='roll'&&!q){const f=c.slice(5).split('.')[0];if(f!==fam){fam=f;html+=`<div class="qa-g">${esc(f)}</div>`}}
      const on=c===cur,isNew=kind==='tag'&&!all.includes(c);html+=`<button class="qa-i${on?' on':''}" data-c="${esc(c)}"><span class="sw target"></span>${esc(lab(c))}<span class="s">${on?'current':isNew?'new tag · 0 things':esc(destSub(c))}</span></button>`});
    list.innerHTML=html||'<div class="qa-f" style="border:0">Nothing legal matches.</div>'};
  draw();inp.oninput=draw;
  inp.onkeydown=e=>{if(e.key==='Enter'){const b=list.querySelector('.qa-i:not(.on)');if(b)onPick(b.dataset.c)}};
  list.onclick=e=>{const b=e.target.closest('.qa-i');if(b&&b.dataset.c!==cur)onPick(b.dataset.c)};
}
function renderInspDraft(el){const d=S.draft,n=node(d.src);
  el.innerHTML=`<div class="ih" style="--kc:${KC[d.kind]}"><span class="sw target isw"></span><div class="it"><div class="t">Choose a ${KLAB[d.kind][0].toLowerCase()}</div><div class="k">New target · ${esc(n.title||n.op)}</div></div></div>${chooserHTML(d.kind,KLAB[d.kind][0]+' · only what '+n.op+' can target')}<div class="iblk"><b>Nothing is saved yet</b>Picking one writes a single entry to ${esc(n.title||n.op)}’s target. Click away to discard.</div>`;
  $('inspMeta').textContent='new target';
  bindChooser(el,d.kind,[n],c=>{const f=F(),pos=f.destPos[d.key];delete f.destPos[d.key];S.draft=null;const k=AT.asKey(c);S.sel='d:'+k;if(!doConnect(n,k,pos))selectAt(null)},null);
}
function retarget(oldK,c){const f=F(),k=AT.asKey(c);const srcs=(S.m.byKey.get(oldK)||{srcs:[]}).srcs;
  srcs.forEach(n=>{n.target=AT.dedupe((n.target||[]).map(t=>AT.asKey(t)===oldK?k:t))});
  f.destPos=f.destPos||{};if(f.destPos[oldK]&&!f.destPos[k])f.destPos[k]=f.destPos[oldK];delete f.destPos[oldK];
  S.sel='d:'+k;refresh('graph');}
window.__FG={varSync:n=>varSync(n),F:()=>F(),select:(id,p)=>select(id,p),FEATS,OPS,KIND,EVENTS,ROLL_SELECTORS,esc,interp,offers,badNodes,renderLeft,fit,persist,destSub,destLabel,derivedOf,varType,S,AT,atModel,renderGraph,renderInsp,renderForm,audit,formHTML,select,selectAt,setMode,doConnect,refresh,pvState,catIdx,node:id=>node(id),
  setFeat:id=>{S.feat=id;S.sel=null;S.notice=null;S.peek=null;all()},setPv:pv=>{S.pv=pv;renderGraph();renderInsp();renderLeft()}};
renderInspOpen();
window.addEventListener('resize',()=>fit());
all();
})();
