/* G.U.I.D.E. Feature Graph — SCRIPT view (third view of the same feature object).
   THE SYNTAX IS A PLACEHOLDER. Nothing here specifies the language; it exists so the layout, cross-linking,
   error states and last-valid behaviour can be judged. Parser = a line validator + a handful of write-backs
   (derived formulas, when gates, add amounts, if expressions, pick counts). */
(function(){
const FG=window.__FG,AT=window.AppliesTo;if(!FG)return;
const S=FG.S,esc=FG.esc,$=id=>document.getElementById(id);
const LH=20,PADL=14,PADT=10;let CW=7.52;
const ST={feat:null,text:'',map:[],valid:true,err:null,lastValid:'',orig:{},store:{},newLines:new Set(),caretLine:-1,fromCaret:false,ac:null,t:null,unknown:new Map()};
const BUILTIN={level:'character level',hp:'current hit points',proficiency:'proficiency bonus'};
const FUNCS=new Set(['floor','max','min','uses']);
const WORDOPS=new Set(['and','or','not','true','false']);
const CONTRIB=new Set(['add','adv','dis','cancel','note','crit','floor','reroll','resist','vuln','immune']);
const ACTION=new Set(['set','addVar','setHp','addUses','addSlot','grant']);
const TOPK=new Set(['source','tags','activation','external','stored','derived','sheet','on']);
const DMG=new Set(['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder']);
const SEL=/^(own|tag:[a-z0-9_]+|roll:[a-z0-9]+(\.[a-z0-9]+)?|(spell|item|weapon|feature|shardnode):[a-z0-9_]+)$/;
const vis=n=>!n.demo||S.fails;
const amt=x=>{x=String(x??'');return /\s/.test(x)?'('+x+')':x};
const actW=a=>({'Action':'action','Bonus action':'bonus','Reaction':'reaction','Free action':'free'}[a]||'action');
const resetW=r=>({'Start of your turn':'turnStart','Short rest':'shortRest','Long rest':'longRest','Manual (DM)':'manual','Never':'never'}[r]||String(r||'never').replace(/\s+/g,''));

/* ---------- data → text ---------- */
function ser(f){
  const L=[],P=(t,id)=>L.push({t,id:id||null});
  const own='feature:'+f.id;
  const rule=(n,ind,armed)=>{const v=AT.viewTargets(n,own);const tg=v.keys.length?v.keys.join(v.and?' & ':', '):'own';
    const op=n.op==='add'?'add '+amt(n.amount)+(n.dtype&&n.dtype!=='—'?' '+n.dtype:''):n.op==='cancelAdv'?'cancel adv':n.op==='floor'?'floor '+(n.atLeast||''):n.op;
    P(`${ind}${op} "${n.title}" -> ${tg}${!armed&&n.once?' once':''}${n.oneOf?' oneOf':''}`,n.id);
    if(n.when)P(`${ind}  when ${n.when}`,n.id);if(n.ask)P(`${ind}  ask "${n.ask}"`,n.id)};
  const walk=(id,port,ind,d)=>{if(d>12)return;f.edges.filter(e=>e.from===id+'.'+port&&e.to.endsWith('.hin')).forEach(e=>{const c=FG.node(e.to.split('.')[0]);if(!c||!vis(c))return;
    if(c.kind==='cond'){P(`${ind}if ${c.expr}:`,c.id);const b=L.length;walk(c.id,'t',ind+'  ',d+1);if(L.length===b)P(ind+'  pass',c.id);if(f.edges.some(x=>x.from===c.id+'.fa')){P(`${ind}else:`,c.id);walk(c.id,'fa',ind+'  ',d+1)}}
    else if(c.kind==='ask'){P(`${ind}ask "${c.prompt}":`,c.id);const b=L.length;walk(c.id,'y',ind+'  ',d+1);if(L.length===b)P(ind+'  pass',c.id)}
    else if(c.kind==='action'){const hp=AT.hasPort(c.op),v=hp?AT.viewTargets(c,own):null;
      const body=c.op==='setVar'?`set ${c.variable} = ${c.value}`:c.op==='addVar'?`addVar ${c.variable} + ${c.value}`:`${c.op} ${c.value||''}`.trim();
      P(`${ind}${body} "${c.title}"${hp?' -> '+(v.keys.length?v.keys.join(', '):'own'):''}`,c.id)}})};
  P('# placeholder syntax — illustrative, not a spec');
  P(`feature "${f.name}"`);
  P(`  source ${f.srcKind} "${f.detail}"`);
  if(f.tags&&f.tags.length)P('  tags '+f.tags.join(', '));
  const press=f.nodes.find(n=>n.kind==='event'&&n.ev==='press'&&vis(n));
  if(f.act&&f.act!=='None (passive)')P(`  activation ${actW(f.act)} uses ${f.uses||'unlimited'} reset ${resetW(f.reset)}`,press&&press.id);
  const vars=f.nodes.filter(n=>n.kind==='var'&&vis(n));
  if(vars.length)P('');
  vars.filter(n=>n.decl).forEach(n=>P(`  external ${n.title} from ${/^[\w*]+$/.test(n.decl)?n.decl:'"'+n.decl+'"'}`,n.id));
  vars.filter(n=>!n.decl&&n.store==='stored').forEach(n=>P(`  stored ${n.title}: ${(n.vtype||'Number').toLowerCase()} = ${n.init||0}${n.vreset&&n.vreset!=='Never'?' reset '+resetW(n.vreset):''}`,n.id));
  vars.filter(n=>!n.decl&&n.store==='derived').forEach(n=>P(`  derived ${n.title} = ${n.counter?'uses("'+n.uses+'")':n.formula}`,n.id));
  const cs=f.nodes.filter(n=>n.kind==='contrib'&&vis(n)),passive=cs.filter(n=>!n.once),sheet=f.nodes.filter(n=>n.kind==='sheet'&&vis(n));
  if(passive.length||sheet.length)P('');
  passive.forEach(n=>rule(n,'  '));
  sheet.forEach(n=>P('  sheet '+[n.op,n.stat,n.amount&&('+'+n.amount)].filter(Boolean).join(' ')+` "${n.title}"`,n.id));
  f.nodes.filter(n=>n.kind==='event'&&vis(n)).forEach(ev=>{P('');P(`  on ${ev.ev}:${ev.prop?'  # proposed — nothing fires yet':''}`,ev.id);const b=L.length;
    walk(ev.id,'hout','    ',0);
    if(ev.ev==='press'){const take=cs.filter(n=>n.once&&!n.ask&&!n.offer),off=FG.offers(),pk=f.nodes.find(n=>n.kind==='picks'&&vis(n));
      if(take.length){P('    take:');take.forEach(n=>rule(n,'      ',true))}
      if(off.length){P(`    pick ${amt(f.picks||'1')} of:`,pk&&pk.id);off.forEach(n=>rule(n,'      ',true))}}
    if(L.length===b)P('    pass',ev.id)});
  return L;
}

/* ---------- text → validation + write-back entries ---------- */
function stripComment(s){let q=false;for(let i=0;i<s.length;i++){if(s[i]==='"')q=!q;if(s[i]==='#'&&!q)return s.slice(0,i)}return s}
function parse(text){
  const lines=text.split('\n'),out={ok:true,err:null,entries:[]};
  const E=(i,col,len,msg)=>{out.ok=false;out.err={line:i,col:Math.max(0,col),len:Math.max(1,len),msg};return out};
  const X=(expr,i,col)=>{try{AT.parse(expr);return true}catch(e){E(i,col,expr.length,'Can’t read this expression'+(e.message?' — '+e.message:''));return false}};
  let seen=false,prev=null,lastRule=null;const stack=[];
  for(let i=0;i<lines.length;i++){
    const code=stripComment(lines[i]).replace(/\s+$/,'');if(!code.trim())continue;
    const ind=code.match(/^ */)[0].length,body=code.slice(ind);
    if(ind%2)return E(i,0,ind,'Indent by two spaces');
    const q=[...body.matchAll(/"/g)];if(q.length%2){const k=q[q.length-1].index;return E(i,ind+k,body.length-k,'Unterminated string — add a closing "')}
    const nos=body.replace(/"[^"]*"/g,m=>' '.repeat(m.length));let d=0;
    for(let k=0;k<nos.length;k++){if(nos[k]==='(')d++;if(nos[k]===')'&&--d<0)return E(i,ind+k,1,'Unexpected )')}
    if(d>0)return E(i,ind+nos.lastIndexOf('('),1,'Unclosed ( — add a )');
    const w=(nos.match(/^[A-Za-z_]\w*/)||[''])[0];
    if(!seen){if(ind!==0||!/^feature\s+"[^"]+"$/.test(body))return E(i,ind,body.length,'A script starts with feature "Name"');seen=true;stack.push({ind:0,w:'feature'});prev={ind:0,colon:true,i};continue}
    const isCont=(w==='when'||w==='once'||w==='oneOf'||(w==='ask'&&!body.endsWith(':')))&&lastRule&&ind===lastRule.ind+2;
    if(prev.colon&&ind!==prev.ind+2)return E(i,ind,body.length,`Expected a block indented two spaces under line ${prev.i+1}`);
    if(!prev.colon&&ind>prev.ind&&!isCont)return E(i,0,ind,'Unexpected indent');
    if(isCont){
      if(w==='when'){const m=body.match(/^when\s+(.+)$/);if(!m)return E(i,ind,body.length,'Expected when <expression>');if(!X(m[1],i,ind+5))return out;lastRule.e.when=m[1]}
      else if(w==='ask'){if(!/^ask\s+"[^"]*"$/.test(body))return E(i,ind,body.length,'Expected ask "question"');lastRule.e.ask=body.match(/"([^"]*)"/)[1]}
      lastRule.e.lines.push(i);prev={ind,colon:false,i};continue}
    if(w==='when'||w==='once'||w==='oneOf')return E(i,ind,w.length,`${w} belongs two spaces under a rule`);
    while(stack.length&&stack[stack.length-1].ind>=ind)stack.pop();
    const parent=(stack[stack.length-1]||{w:'feature'}).w;lastRule=null;
    const colon=body.endsWith(':');
    const inFlow=['on','if','else','ask'].includes(parent),inArm=parent==='take'||parent==='pick';
    const ent=(kind,extra)=>{const e={kind,lines:[i],...extra};out.entries.push(e);return e};
    if(parent==='feature'){
      if(!TOPK.has(w)&&!CONTRIB.has(w))return E(i,ind,w.length||body.length,w?(ACTION.has(w)?`${w} runs on a press — put it under on press:`:`Unknown keyword “${w}”`):'Expected a keyword');
    }else if(inFlow){
      if(CONTRIB.has(w))return E(i,ind,w.length,'Armed effects go under take: or pick N of:');
      if(!ACTION.has(w)&&!['if','else','ask','take','pick','pass'].includes(w))return E(i,ind,w.length||1,`Unknown keyword “${w}”`);
      if((w==='take'||w==='pick')&&parent!=='on')return E(i,ind,w.length,`${w} sits directly under on press:`);
    }else if(inArm){
      if(!CONTRIB.has(w)&&w!=='pass')return E(i,ind,w.length||1,`Only contributions go under ${parent}`);
    }
    if(w==='on'){const m=body.match(/^on\s+([A-Za-z_]\w*):$/);if(!m)return E(i,ind,body.length,'Expected on <event>:');ent('on',{key:m[1]})}
    else if(w==='if'){const m=body.match(/^if\s+(.+):$/);if(!m)return E(i,ind+body.length-1,1,'Expected if <expression>: — missing :');if(!X(m[1],i,ind+3))return out;ent('cond',{expr:m[1]})}
    else if(w==='else'){if(body!=='else:')return E(i,ind,body.length,'Expected else:')}
    else if(w==='ask'){if(!/^ask\s+"[^"]*":$/.test(body))return E(i,ind,body.length,'Expected ask "question":');ent('ask',{key:body.match(/"([^"]*)"/)[1]})}
    else if(w==='take'){if(body!=='take:')return E(i,ind,body.length,'Expected take:')}
    else if(w==='pick'){const m=body.match(/^pick\s+(.+?)\s+of:$/);if(!m)return E(i,ind,body.length,'Expected pick <count> of:');let x=m[1];if(/^\(.*\)$/.test(x))x=x.slice(1,-1);if(!X(x,i,ind+5))return out;ent('pick',{expr:x})}
    else if(w==='derived'){const m=body.match(/^derived\s+([A-Za-z_]\w*)(\s*=\s*(.+))?$/);if(!m)return E(i,ind,body.length,'Expected derived <name> = <formula>');
      if(!m[2]){const k=body.indexOf(m[1])+m[1].length;return E(i,ind+k,Math.max(1,body.length-k),'Expected = after the variable name')}
      const fx=m[3];if(!/^uses\(/.test(fx)&&!X(fx,i,ind+body.indexOf(fx)))return out;ent('var',{key:m[1],formula:fx})}
    else if(w==='stored'){if(!/^stored\s+[A-Za-z_]\w*\s*:\s*(number|boolean)\s*=\s*\S+/.test(body))return E(i,ind,body.length,'Expected stored <name>: number|boolean = <init>');ent('var',{key:body.match(/^stored\s+(\w+)/)[1]})}
    else if(w==='external'){if(!/^external\s+[A-Za-z_]\w*\s+from\s+\S+/.test(body))return E(i,ind,body.length,'Expected external <name> from <source>');ent('var',{key:body.match(/^external\s+(\w+)/)[1]})}
    else if(w==='sheet'){if(!/^sheet\s+\w+.*"[^"]*"$/.test(body))return E(i,ind,body.length,'Expected sheet <op> … "label"');ent('rule',{key:body.match(/"([^"]*)"/)[1]})}
    else if(CONTRIB.has(w)||ACTION.has(w)){
      const qi=body.indexOf('"');if(qi<0)return E(i,ind+body.length,1,'Expected a quoted label — every number in a breakdown needs one');
      if(w==='cancel'&&!/^cancel\s+adv\s/.test(body))return E(i,ind+7,Math.max(1,qi-7),'cancel takes adv — the proposed op');
      const qe=body.indexOf('"',qi+1),title=body.slice(qi+1,qe),rest=body.slice(qe+1).trim();
      const e=ent('rule',{key:title});
      if(w==='add'){let a=body.slice(4,qi).trim();const parts=a.split(/\s+/);if(parts.length>1&&DMG.has(parts[parts.length-1]))a=parts.slice(0,-1).join(' ');if(/^\(.*\)$/.test(a))a=a.slice(1,-1);if(a&&!X(a,i,ind+4))return out;e.amount=a}
      if(rest){if(!rest.startsWith('->'))return E(i,ind+qe+1,rest.length+1,'Expected -> and a selector after the label');
        const sels=rest.slice(2).replace(/\s+(once|oneOf)\b/g,'').trim();if(!sels)return E(i,ind+body.length,1,'Expected a selector after -> — tag:, roll:, a thing, or own');
        let col=ind+body.indexOf(sels,qe);for(const s of sels.split(/\s*[,&]\s*/)){if(!SEL.test(s))return E(i,col+Math.max(0,sels.indexOf(s)),s.length||1,`“${s}” isn’t a selector — use tag:, roll:, a thing id, or own`)}}
      else if(CONTRIB.has(w))return E(i,ind+body.length,1,'Expected -> and what it applies to');
      lastRule={ind,e}}
    else if(!['source','tags','activation','pass'].includes(w))return E(i,ind,w.length||1,`Unknown keyword “${w}”`);
    if(colon)stack.push({ind,w});
    if(colon&&!['on','if','else','ask','take','pick'].includes(w))return E(i,ind+body.length-1,1,'Unexpected : — only on, if, else, ask, take and pick open a block');
    prev={ind,colon,i};
  }
  if(prev&&prev.colon)return E(prev.i,0,lines[prev.i].length,'This block is empty — add a line, or pass');
  return out;
}
function apply(p){
  const f=FG.F(),map=new Array(ST.text.split('\n').length).fill(null);ST.newLines=new Set();let ch=false;
  const conds=f.nodes.filter(n=>n.kind==='cond'&&vis(n)),asks=f.nodes.filter(n=>n.kind==='ask'&&vis(n));let ci=0,ai=0;
  const press=f.nodes.find(n=>n.kind==='event'&&n.ev==='press');
  ST.text.split('\n').forEach((t,i)=>{if(/^\s+activation\s/.test(t)&&press)map[i]=press.id});
  p.entries.forEach(e=>{let n=null;
    if(e.kind==='var')n=f.nodes.find(x=>x.kind==='var'&&x.title===e.key);
    else if(e.kind==='rule')n=f.nodes.find(x=>x.kind!=='var'&&x.title===e.key);
    else if(e.kind==='cond')n=conds[ci++];else if(e.kind==='ask')n=asks[ai++];
    else if(e.kind==='on')n=f.nodes.find(x=>x.kind==='event'&&x.ev===e.key);
    else if(e.kind==='pick')n=f.nodes.find(x=>x.kind==='picks');
    e.lines.forEach(li=>map[li]=n?n.id:null);
    if(!n){if(e.kind==='rule'||e.kind==='var')ST.newLines.add(e.lines[0]);return}
    if(e.kind==='var'&&n.store==='derived'&&!n.counter&&e.formula!=null&&e.formula!==n.formula){n.formula=e.formula;FG.varSync&&FG.varSync(n);ch=true}
    if(e.kind==='rule'&&n.kind==='contrib'){const w=e.when||'';if(w!==(n.when||'')){n.when=w;ch=true}if(e.amount!=null&&n.op==='add'&&e.amount!==n.amount){n.amount=e.amount;ch=true}}
    if(e.kind==='cond'&&e.expr!==n.expr){n.expr=e.expr;ch=true}
    if(e.kind==='pick'&&e.expr!==String(f.picks)){f.picks=e.expr;ch=true}});
  ST.map=map;return ch;
}

/* ---------- a rule, not a syntax error: identifiers nothing declares. Lives in the audit, so graph + form see it too. ---------- */
function idents(expr){const s=String(expr||'').replace(/"[^"]*"/g,'');const out=[];s.replace(/[A-Za-z_]\w*/g,(m,off)=>{if(off&&/[\w.]/.test(s[off-1]))return m;if(/^\s*\(/.test(s.slice(off+m.length)))return m;if(!WORDOPS.has(m))out.push(m);return m});return out}
function extraAudit(f){
  const known=new Set(Object.keys(BUILTIN));f.nodes.forEach(n=>{if(n.kind==='var')known.add(n.title)});
  const out=[];ST.unknown=new Map();
  f.nodes.filter(vis).forEach(n=>{const ex=[n.kind==='contrib'&&n.when,n.kind==='contrib'&&n.op==='add'&&n.amount,n.kind==='var'&&n.store==='derived'&&!n.counter&&n.formula,n.kind==='cond'&&n.expr,n.kind==='picks'&&f.picks].filter(Boolean);
    const bad=[...new Set(ex.flatMap(idents))].filter(x=>!known.has(x));
    bad.forEach(x=>{ST.unknown.set(x,n.id);out.push({sev:'err',t:'Unknown identifier · '+x,s:`${n.title||n.id} reads ${x}, which nothing declares — not this feature, another feature, the engine, or has_*.`,node:n.id,ident:x})})});
  return out;
}

/* ---------- highlighting ---------- */
function lex(t){const re=/(#.*$)|("[^"]*"?)|(->)|((?:tag|roll):[\w.]*|(?:spell|item|weapon|feature|shardnode):\w*)|(\d+d\d+|\d+(?:\.\d+)?)|([A-Za-z_]\w*\*?)|(\s+)|([\s\S])/g;const out=[];let m;
  while((m=re.exec(t))){out.push({type:m[1]?'com':m[2]?'str':m[3]?'arrow':m[4]?'sel':m[5]?'num':m[6]?'word':m[7]?'ws':'op',v:m[0],s:m.index,e:m.index+m[0].length});if(!m[0])re.lastIndex++}return out}
function varNames(){return new Set(FG.F().nodes.filter(n=>n.kind==='var').map(n=>n.title))}
function classify(toks,vn){let first=null,prevW=null,arrow=false;return toks.map(k=>{let c='';
  if(k.type==='com')c='c-com';else if(k.type==='str')c=prevW==='ask'?'c-ask-s':prevW==='feature'?'c-feat':'c-str';
  else if(k.type==='arrow'){c='c-arrow';arrow=true}
  else if(k.type==='sel')c=k.v.startsWith('tag:')?'c-tag':k.v.startsWith('roll:')?'c-roll':'c-thing';
  else if(k.type==='num')c='c-num';
  else if(k.type==='word'){const w=k.v;
    if(first===null){first=w;c=w==='on'?'c-ev':(w==='if'||w==='else'||w==='when')?'c-cond':w==='ask'?'c-ask':w==='cancel'?'c-con prop':CONTRIB.has(w)?'c-con':ACTION.has(w)?'c-act':['external','stored','derived'].includes(w)?'c-var':(w==='take'||w==='pick')?'c-pk':w==='pass'?'c-mut':'c-meta'}
    else if(prevW==='on')c='c-ev';else if(prevW==='cancel'&&w==='adv')c='c-con prop';else if(w==='of'&&first==='pick')c='c-pk';
    else if(['from','reset','uses','once','oneOf'].includes(w))c='c-meta';else if(w==='own'&&arrow)c='c-thing';
    else if(vn.has(w))c='c-var';else if(BUILTIN[w])c='c-bi';else if(WORDOPS.has(w))c='c-op';else if(FUNCS.has(w))c='c-fn';else c='c-id';
    prevW=w}
  else if(k.type==='op')c='c-op';return c})}
function hlLine(t,vn){const toks=lex(t),cls=classify(toks,vn);return toks.map((k,i)=>cls[i]?`<span class="${cls[i]}">${esc(k.v)}</span>`:esc(k.v)).join('')}

/* ---------- which lines light up for the current selection ---------- */
function hlLines(){const s=S.sel,out=new Set();if(!s)return out;const lines=ST.text.split('\n');
  if(/^d:/.test(s)){const k=s.slice(2);lines.forEach((t,i)=>{if(lex(t).some(x=>x.type==='sel'&&x.v===k))out.add(i)})}
  else{const id=/^[wj]:/.test(s)?s.slice(2).split('|')[0]:s;ST.map.forEach((m,i)=>{if(m===id)out.add(i)})}
  return out}
function auditLines(){const m=new Map();(FG.audit()||[]).forEach(a=>{if(!a.node||(a.sev!=='err'&&a.sev!=='warn'))return;const i=ST.map.indexOf(a.node);if(i<0)return;
  let li=i;if(a.ident){const lines=ST.text.split('\n');for(let k=i;k<lines.length&&ST.map[k]===a.node;k++)if(lex(lines[k]).some(x=>x.type==='word'&&x.v===a.ident)){li=k;break}}
  const cur=m.get(li);if(!cur||cur.sev!=='err'&&a.sev==='err')m.set(li,a)});return m}

/* ---------- render ---------- */
function render(){
  const ta=$('scTa');if(!ta)return;
  if(ta.value!==ST.text){const a=ta.selectionStart,b=ta.selectionEnd,foc=document.activeElement===ta;ta.value=ST.text;if(foc)ta.setSelectionRange(a,b)}
  const lines=ST.text.split('\n'),vn=varNames(),hl=hlLines(),au=ST.valid?auditLines():new Map(),er=ST.err;
  let pre='',gut='',deco='',maxLen=0;
  lines.forEach((t,i)=>{maxLen=Math.max(maxLen,t.length);const a=au.get(i);
    const cls=[hl.has(i)&&'sel',er&&er.line===i&&'syn',a&&'rule-'+a.sev,i===ST.caretLine&&'cur',ST.newLines.has(i)&&'new'].filter(Boolean).join(' ');
    pre+=`<div class="sl ${cls}">${hlLine(t,vn)||' '}</div>`;
    const mk=er&&er.line===i?'<i class="fa-solid fa-xmark"></i>':a?'<i class="fa-solid fa-scale-balanced"></i>':ST.newLines.has(i)?'<i class="fa-solid fa-circle"></i>':'';
    gut+=`<div class="gl ${cls}"${ST.map[i]?` data-node="${ST.map[i]}"`:''}><span class="mk">${mk}</span><span class="n">${i+1}</span></div>`;
    if(a){const x=PADL+(t.length+3)*CW,y=PADT+i*LH;deco+=`<div class="rule-msg ${a.sev}" data-node="${a.node}" style="left:${x}px;top:${y}px" title="Parses fine — breaks an engine rule. Listed in the Audit."><i class="fa-solid fa-scale-balanced"></i><b>Rule</b>${esc(a.t.split(' · ')[0])}${a.ident?' · '+esc(a.ident):''}</div>`;
      if(a.ident){const tk=lex(t).find(x=>x.type==='word'&&x.v===a.ident);if(tk)deco+=`<span class="rule-u ${a.sev}" style="left:${PADL+tk.s*CW}px;top:${y+LH-4}px;width:${a.ident.length*CW}px"></span>`}}
    if(ST.newLines.has(i))deco+=`<div class="new-msg" style="left:${PADL+(t.length+3)*CW}px;top:${PADT+i*LH}px">not in the graph · the mock doesn’t create nodes from text</div>`;
  });
  if(er){const t=lines[er.line]||'',y=PADT+er.line*LH;deco+=`<span class="squig" style="left:${PADL+er.col*CW}px;top:${y+LH-5}px;width:${Math.max(1,Math.min(er.len,Math.max(1,t.length-er.col)))*CW}px"></span><div class="syn-msg" style="left:${PADL+(Math.max(t.length,er.col+1)+3)*CW}px;top:${y}px"><b>Syntax</b>${esc(er.msg)}</div>`}
  $('scHl').innerHTML=pre;$('scGut').innerHTML=gut;$('scDeco').innerHTML=deco;
  const h=lines.length*LH+PADT*2+60;ta.style.height=h+'px';$('scCode').style.minWidth=(PADL*2+(maxLen+70)*CW)+'px';
  const st=$('scSt');if(st){st.className='sc-st'+(ST.valid?'':' bad');st.innerHTML=ST.valid?'<i class="fa-solid fa-circle-check"></i>Parsed · same object as graph &amp; form':`<i class="fa-solid fa-xmark"></i>Syntax error · line ${er.line+1} · not data yet`}
  const eb=$('scErr');if(eb){eb.style.display=er?'flex':'none';if(er)eb.innerHTML=`<b>Syntax</b><span>Line ${er.line+1}, col ${er.col+1} — ${esc(er.msg)}</span><button class="sbtn" data-sgo="1">Go to error</button>`}
  pos();
}
function scrollToLines(set){const sc=$('scScroll');if(!sc||!set.size||!sc.offsetParent)return;const a=Math.min(...set),b=Math.max(...set);const top=PADT+a*LH,bot=PADT+(b+1)*LH;if(top<sc.scrollTop+10||bot>sc.scrollTop+sc.clientHeight-10)sc.scrollTo({top:Math.max(0,top-sc.clientHeight/3),behavior:'smooth'})}
function caret(){const ta=$('scTa'),b=ta.value.slice(0,ta.selectionStart);const line=b.split('\n').length-1;return {line,col:b.length-b.lastIndexOf('\n')-1}}
function pos(){const el=$('scPos');if(!el)return;const ta=$('scTa');if(document.activeElement!==ta&&ST.caretLine<0){el.textContent='Click a line to select its node';return}const c=caret();const id=ST.map[c.line];const n=id&&FG.node(id);el.innerHTML=`Ln ${c.line+1} · Col ${c.col+1}${n?` <span class="pn">→ ${esc(FG.interp(n.title)||n.id)}</span>`:''}`}

/* ---------- stale: the text isn't data, so graph + form hold the last valid version ---------- */
function staleBanner(){const l=ST.err?ST.err.line+1:0;return `<i class="fa-solid fa-lock"></i><span><b>Showing the last valid version</b>Script line ${l} has a syntax error, so it isn’t data yet. This is the version from before that edit — read-only until the script parses.</span><span class="sb-b"><button class="sbtn" data-sgo="1">Go to error</button><button class="sbtn ghost" data-srev="1">Revert script</button></span>`}
function setStale(on){
  const v=$('views');v.classList.toggle('stale',on);document.querySelector('.editor').classList.toggle('script-stale',on);
  const g=$('staleG');if(g)g.innerHTML=on?staleBanner():'';
  const fp=$('formPane');fp.querySelectorAll('.stale-bn').forEach(x=>x.remove());if(on)fp.insertAdjacentHTML('afterbegin',`<div class="stale-bn in-form">${staleBanner()}</div>`);
  pill();if(!on)FG.renderLeft();
}
function pill(){if(ST.valid)return;const p=$('statusPill'),t=$('statusTx');if(p)p.classList.add('bad');if(t)t.textContent='Script doesn’t parse · last valid version shown'}
new MutationObserver(()=>{const fp=$('formPane');if(!ST.valid&&!fp.querySelector('.stale-bn'))fp.insertAdjacentHTML('afterbegin',`<div class="stale-bn in-form">${staleBanner()}</div>`)}).observe($('formPane'),{childList:true});

function regen(){const L=ser(FG.F());ST.text=L.map(l=>l.t).join('\n');ST.map=L.map(l=>l.id);ST.valid=true;ST.err=null;ST.lastValid=ST.text;ST.newLines=new Set()}
function doParse(){
  const p=parse(ST.text);
  if(!p.ok){const was=ST.valid;ST.valid=false;ST.err=p.err;if(was)setStale(true);else{const g=$('staleG');if(g)g.innerHTML=staleBanner();document.querySelectorAll('#formPane .stale-bn').forEach(x=>x.innerHTML=staleBanner());pill()}render();return}
  const was=ST.valid;ST.err=null;ST.valid=true;ST.lastValid=ST.text;const ch=apply(p);if(!was)setStale(false);
  if(ch)FG.refresh('script',true);else if(!was){FG.renderGraph();FG.renderForm()}
  render();
}
function schedule(){clearTimeout(ST.t);ST.t=setTimeout(doParse,220)}

/* ---------- hooks called by feature-graph.js ---------- */
function onData(from){
  const f=FG.F();
  if(from==='load'){if(ST.feat!==f.id){if(ST.feat)ST.store[ST.feat]={text:ST.text,valid:ST.valid,err:ST.err,lastValid:ST.lastValid,map:ST.map};ST.feat=f.id;const s=ST.store[f.id];
      if(s&&!s.valid){Object.assign(ST,s)}else regen();setStale(!ST.valid)}else if(ST.valid)regen()}
  else if(from!=='script'&&ST.valid)regen();
  if(!ST.orig[f.id]&&ST.valid)ST.orig[f.id]=ST.text;
  render();
}
function onSel(){if(!ST.valid)pill();render();if(!ST.fromCaret)scrollToLines(hlLines())}
function onMode(){requestAnimationFrame(()=>{measure();render()})}

/* ---------- caret → node ---------- */
function caretSync(){const ta=$('scTa');const c=caret();if(c.line!==ST.caretLine){ST.caretLine=c.line;const id=ST.map[c.line];
  if(id&&S.sel!==id&&ST.valid){ST.fromCaret=true;FG.select(id,true);ST.fromCaret=false}else render()}else pos()}

/* ---------- hover ---------- */
const KW={on:['Event','something happens. The press is the only real trigger today.','var(--amber)'],when:['Condition','the app decides, from variables it already knows.','var(--beige)'],if:['Condition','the app decides which branch runs.','var(--beige)'],else:['Condition','runs when the if is false.','var(--beige)'],
  ask:['Ask','only a player can answer. Never decided by a preview.','var(--cyan-hot)'],take:['Taken','armed effects that apply on their own when the next matching roll comes.','var(--amber-hot)'],pick:['Picks','the player takes N of these offers. Choosing one is the answer — no separate ask.','var(--amber-hot)'],
  cancel:['cancel adv · proposed op','Removes advantage instead of adding disadvantage. They differ when another source of disadvantage is present. Not in the schema yet.','var(--violet)'],
  derived:['Variable · derived','computed from other variables and stats. Never reads roll context.','var(--good)'],stored:['Variable · stored','kept on the sheet.','var(--good)'],external:['Variable · declared elsewhere','read here, owned by another feature, the engine, or has_*.','var(--good)']};
function info(tok){
  const f=FG.F();
  if(tok.type==='sel'){const k=tok.v,kind=AT.selKind(k);if(k==='own')return {h:'own',b:'This feature’s own roll — what an empty target means.',c:'var(--beige)'};
    return {h:k,b:kind==='tag'?`${AT.fmtCount(AT.matchCount([k],'or'))} in the catalog carry this tag. Same live count as the tag node.`:kind==='roll'?'Roll kind · every roll of this kind, on anything.':AT.namesByGid.get(k)?AT.namesByGid.get(k).name+' · a reference to a catalog row':'No catalog row has this id · dangling',c:kind==='tag'?'var(--orange)':kind==='roll'?'var(--roll-c)':'var(--beige)'}}
  if(tok.type!=='word')return null;const w=tok.v;
  const n=f.nodes.find(x=>x.kind==='var'&&x.title===w);
  if(n){if(n.decl)return {h:w,b:`Declared elsewhere · ${n.decl}. ${n.note||''}`,c:'var(--good)'};const li=ST.map.indexOf(n.id);
    return {h:w,b:(n.store==='derived'?(n.counter?'Derived here · reads a use counter':'Derived here · ƒ = '+n.formula+' · '+(FG.varType(n)==='b'?'Boolean':'Number')):'Stored here · '+(n.vtype||'')+' · init '+n.init)+(li>=0?` · line ${li+1}`:''),c:'var(--good)'}}
  if(BUILTIN[w])return {h:w,b:'Engine · '+BUILTIN[w]+'. Always available.',c:'#9fd6b0'};
  if(KW[w])return {h:KW[w][0],b:KW[w][1],c:KW[w][2]};
  if(ST.unknown.has(w))return {h:w,b:'Nothing declares this. It parses — the text is fine — but it breaks a rule, so it’s in the Audit.',c:'var(--danger-hot)'};
  return null;
}
function hover(e){const ta=$('scTa'),tip=$('scTip');const r=ta.getBoundingClientRect();const line=Math.floor((e.clientY-r.top-PADT)/LH),col=Math.floor((e.clientX-r.left-PADL)/CW);
  const t=ST.text.split('\n')[line];const tok=t!=null&&lex(t).find(k=>col>=k.s&&col<k.e);const I=tok&&info(tok);
  if(!I||ST.ac){tip.style.display='none';return}
  tip.style.setProperty('--kc',I.c);tip.innerHTML=`<div class="h">${esc(I.h)}</div><div class="b">${esc(I.b)}</div>`;tip.style.display='block';
  tip.style.left=Math.min(e.clientX+14,innerWidth-340)+'px';tip.style.top=(e.clientY+18)+'px'}

/* ---------- autocomplete ---------- */
function candidates(pre,lineBefore){
  const f=FG.F(),C=[];const lo=pre.toLowerCase();
  if(pre.startsWith('tag:')){const t=new Set();AT.CATALOG_NODES.forEach(x=>(x.tags||[]).forEach(v=>t.add(AT.normalizeTag(v))));[...t].sort().forEach(v=>C.push({v:'tag:'+v,k:'tag',d:AT.fmtCount(AT.matchCount(['tag:'+v],'or')),c:'var(--orange)'}))}
  else if(pre.startsWith('roll:'))FG.ROLL_SELECTORS.forEach(v=>C.push({v,k:'roll',d:'every roll of this kind',c:'var(--roll-c)'}));
  else{
    f.nodes.filter(n=>n.kind==='var').forEach(n=>C.push({v:n.title,k:n.decl?'external':n.store,d:n.decl?'declared elsewhere · '+n.decl:n.store==='derived'?'derived here':'stored here',c:'var(--good)'}));
    Object.keys(BUILTIN).forEach(v=>C.push({v,k:'engine',d:BUILTIN[v],c:'#9fd6b0'}));
    if(/->\s*[\w:,\s&]*$/.test(lineBefore)){C.push({v:'tag:',k:'tag',d:'a set — everything carrying it',c:'var(--orange)'},{v:'roll:',k:'roll',d:'every roll of one kind',c:'var(--roll-c)'},{v:'own',k:'own',d:'this feature’s own roll',c:'var(--beige)'});[...AT.namesByGid.keys()].forEach(v=>C.push({v,k:'thing',d:AT.namesByGid.get(v).name,c:'var(--beige)'}))}
    if(lineBefore.trim()===pre){['when','ask','take:','pick','if','else:','set','addVar','setHp','grant','add','adv','dis','cancel adv','note','derived','stored','external','on press:'].forEach(v=>C.push({v,k:'keyword',d:(KW[v.split(/[ :]/)[0]]||[''])[0],c:'var(--beige-dim)'}))}
  }
  return C.filter(c=>c.v.toLowerCase().startsWith(lo)&&c.v!==pre).slice(0,8);
}
function acUpdate(){const ta=$('scTa');const p=ta.selectionStart;const before=ta.value.slice(0,p);const ls=before.lastIndexOf('\n')+1,lb=before.slice(ls);
  if((lb.match(/"/g)||[]).length%2||lb.trimStart().startsWith('#')){acClose();return}
  const m=lb.match(/(?:tag:|roll:)?[A-Za-z_][\w.]*$|(?:tag:|roll:)$/);if(!m){acClose();return}
  const pre=m[0],C=candidates(pre,lb);if(!C.length){acClose();return}
  ST.ac={pre,C,i:0,start:p-pre.length};const line=before.split('\n').length-1,col=lb.length-pre.length;const el=$('scAc');
  el.style.left=(PADL+col*CW)+'px';el.style.top=(PADT+(line+1)*LH+2)+'px';acDraw()}
function acDraw(){const el=$('scAc'),A=ST.ac;el.style.display='block';el.innerHTML=`<div class="hd">${A.pre.startsWith('tag:')||A.pre.startsWith('roll:')?'Selectors · live match counts':'Identifiers · where they come from'}</div>`+A.C.map((c,i)=>`<div class="it${i===A.i?' on':''}" data-i="${i}" style="--kc:${c.c}"><span class="k">${esc(c.k)}</span><span class="v">${esc(c.v)}</span><span class="d">${esc(c.d)}</span></div>`).join('')+'<div class="ft">↑↓ choose · Tab / Enter insert · Esc</div>'}
function acClose(){ST.ac=null;const el=$('scAc');if(el)el.style.display='none'}
function acPick(i){const A=ST.ac,ta=$('scTa');if(!A)return;const c=A.C[i];ta.setRangeText(c.v,A.start,ta.selectionStart,'end');ST.text=ta.value;acClose();render();schedule();if(/:$/.test(c.v)&&/^(tag|roll):$/.test(c.v))acUpdate()}

/* ---------- demos (illustrative) ---------- */
function demo(k){
  const f=FG.F(),L=ST.text.split('\n');
  if(k==='reset'){ST.text=ST.orig[f.id]||ST.text;doParse();return}
  if(k==='syntax'){let i=L.findIndex(t=>/^\s+derived \w+ = /.test(t));if(i>=0)L[i]=L[i].replace(' = ',' ');else{i=L.findIndex(t=>/"[^"]+"\s*->/.test(t));if(i>=0)L[i]=L[i].replace(/"(\s*->)/,'$1')}}
  if(k==='rule'){let i=L.findIndex(t=>/^\s+when /.test(t));if(i>=0)L[i]+=' && hasMomentum';else{i=L.findIndex(t=>/^\s+derived \w+ = (?!uses)/.test(t));if(i>=0)L[i]+=' + momentum'}}
  ST.text=L.join('\n');doParse();goTo(k==='syntax'&&ST.err?ST.err:null);
}
function goTo(err){const ta=$('scTa');if(!err)return;if(!(S.mode==='script'||S.split&&S.pair==='script'))FG.setMode('script');
  requestAnimationFrame(()=>{const L=ST.text.split('\n');let p=0;for(let i=0;i<err.line;i++)p+=L[i].length+1;p+=err.col;ta.focus();ta.setSelectionRange(p,p);ST.caretLine=err.line;scrollToLines(new Set([err.line]));render()})}

/* ---------- wiring ---------- */
function measure(){const s=document.createElement('span');s.className='sc-measure';s.textContent='x'.repeat(100);$('scCode').appendChild(s);const w=s.getBoundingClientRect().width/100;s.remove();if(w>0)CW=w}
function init(){
  const ta=$('scTa');
  ta.addEventListener('input',()=>{ST.text=ta.value;render();schedule();acUpdate()});
  ta.addEventListener('keydown',e=>{
    if(ST.ac){if(e.key==='ArrowDown'){ST.ac.i=(ST.ac.i+1)%ST.ac.C.length;acDraw();e.preventDefault();return}if(e.key==='ArrowUp'){ST.ac.i=(ST.ac.i-1+ST.ac.C.length)%ST.ac.C.length;acDraw();e.preventDefault();return}
      if(e.key==='Enter'||e.key==='Tab'){acPick(ST.ac.i);e.preventDefault();return}if(e.key==='Escape'){acClose();e.preventDefault();return}}
    if(e.key==='Tab'){ta.setRangeText('  ',ta.selectionStart,ta.selectionEnd,'end');ST.text=ta.value;render();schedule();e.preventDefault()}});
  ta.addEventListener('keyup',e=>{if(/^Arrow|Home|End|Page/.test(e.key)){acClose();caretSync()}else caretSync()});
  ta.addEventListener('click',()=>{acClose();caretSync()});
  ta.addEventListener('blur',()=>setTimeout(acClose,150));
  ta.addEventListener('mousemove',hover);ta.addEventListener('mouseleave',()=>{$('scTip').style.display='none'});
  $('scAc').addEventListener('mousedown',e=>{const it=e.target.closest('.it');if(it){e.preventDefault();acPick(+it.dataset.i)}});
  $('scGut').addEventListener('click',e=>{const g=e.target.closest('.gl[data-node]');if(g&&ST.valid)FG.select(g.dataset.node,true)});
  $('scDeco').addEventListener('click',e=>{const r=e.target.closest('.rule-msg');if(r)FG.select(r.dataset.node,true)});
  document.addEventListener('click',e=>{const d=e.target.closest('[data-demo]');if(d){demo(d.dataset.demo);return}
    if(e.target.closest('[data-sgo]')){goTo(ST.err);return}
    if(e.target.closest('[data-srev]')){ST.text=ST.lastValid;doParse();return}});
  $('pad').addEventListener('dblclick',e=>{if(!ST.valid)e.stopImmediatePropagation()},true);
  (document.fonts?document.fonts.ready:Promise.resolve()).then(()=>{measure();render()});
  window.__FGS={onData,onSel,onMode,extraAudit,stale:()=>!ST.valid,ST,parse,ser};
  ST.feat=null;onData('load');FG.renderGraph();FG.renderLeft();FG.renderForm();
  const v=$('views');document.querySelectorAll('#modeSeg button').forEach(b=>b.classList.toggle('on',S.split?(b.dataset.m==='graph'||b.dataset.m===S.pair):b.dataset.m===S.mode));
  v.className='views '+(S.split?'m-split pair-'+S.pair:'m-'+S.mode);
}
init();
})();
