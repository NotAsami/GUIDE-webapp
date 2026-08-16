/* G.U.I.D.E. — Roll Context Panel
   Post-roll receipt rail. Every die, every modifier, every contributor.

   Rider states (from the graph engine):
     resolved   — engine decided it applies; renders as a breakdown line, never a control
     unresolved — depends on something only the player knows; renders as a toggle
     na         — renders nothing at all
   Rider kinds: 'value' (dice/flat) or 'flag' (grants ADVANTAGE / CRIT / DISADVANTAGE).
   Rolled unresolved riders LOCK: the value is fixed, toggling reuses it.
   State lives in memory; nothing is persisted. */
(() => {
"use strict";

const body = document.getElementById('rail-body');
const tip  = document.getElementById('tip');
const rnd  = n => 1 + Math.floor(Math.random() * n);
const esc  = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sgn  = n => (n < 0 ? '− ' + Math.abs(n) : '+ ' + n);

let rolls = [];   // newest first
let uid = 0;

/* ---------------- dice helpers ---------------- */
const die = (sides, v, extra) => Object.assign({ sides, v: v ?? rnd(sides), dropped:false, rerolled:false, crit:false }, extra || {});
const rollFormula = f => { const [n, s] = f.toLowerCase().split('d').map(Number); return Array.from({length:n}, () => die(s)); };

/* ---------------- math ---------------- */
const kept = L => L.dice.filter(d => !d.dropped).reduce((a,d) => a + d.v, 0);
const modSum = L => (L.mods||[]).reduce((a,m) => a + m.v, 0);
const lineTotal = L => kept(L) + modSum(L);
const riderValue = r => r.flat != null ? r.flat : r.dice.reduce((a,d) => a + d.v, 0);
/* not-applicable riders never reach the panel */
const shown = R => (R.riders||[]).filter(r => r.state !== 'na');
const resolvedRiders   = R => shown(R).filter(r => r.state === 'resolved');
const unresolvedRiders = R => shown(R).filter(r => r.state === 'unresolved');
/* a rider is contributing when the engine resolved it, or the player confirmed it */
const riderLive = r => r.state === 'resolved' || (r.on && (r.kind === 'flag' || r.rolled));
const flagIcon = f => f === 'CRIT' ? 'fa-burst' : f === 'DISADVANTAGE' ? 'fa-angles-down' : 'fa-angles-up';

function totals(R) {
  const atkLine = R.lines.find(l => l.kind === 'attack');
  let atk = atkLine ? lineTotal(atkLine) : null;
  const dmg = {};
  R.lines.filter(l => l.kind === 'damage').forEach(l => { dmg[l.type] = (dmg[l.type]||0) + lineTotal(l); });
  const flags = [];
  shown(R).forEach(r => {
    if (!riderLive(r)) return;
    if (r.kind === 'flag') { if (!flags.includes(r.grants)) flags.push(r.grants); return; }
    if (r.target === 'attack') { if (atk != null) atk += riderValue(r); }
    else dmg[r.dtype] = (dmg[r.dtype]||0) + riderValue(r);
  });
  const dmgTotal = Object.values(dmg).reduce((a,b) => a+b, 0);
  const pending = unresolvedRiders(R).filter(r => !(r.on && (r.kind === 'flag' || r.rolled))).length;
  return { atk, dmg, dmgTotal, pending, flags, hasDamage: Object.keys(dmg).length > 0 };
}

/* ---------------- render ---------------- */
function dieHTML(R, li, di, d, locked) {
  const cls = ['die'];
  if (d.dropped) cls.push('dropped');
  else if (d.v === d.sides) cls.push('max');
  else if (d.v === 1) cls.push('min');
  if (d.crit) cls.push('critdie');
  if (d.rerolled) cls.push('rerolled');
  if (locked) cls.push('locked');
  const inert = d.dropped || locked;
  return `<button class="${cls.join(' ')}" data-die="${R.id}:${li}:${di}"${inert?' tabindex="-1"':''}>${d.v}</button>`;
}

function mathHTML(R, li, L) {
  const parts = [];
  if (L.dice.length) {
    const join = L.mode ? '<span class="op">vs</span>' : '<span class="op">+</span>';
    parts.push(`<span class="form">${esc(L.formula)}</span>`);
    parts.push(L.dice.map((d,i) => dieHTML(R, li, i, d)).join(join));
  }
  const m = modSum(L);
  if (m) parts.push(`${parts.length ? `<span class="op">${m<0?'−':'+'}</span>` : ''}<span class="mod" data-mod="${R.id}:${li}">${m<0 && !parts.length ? '−' : ''}${Math.abs(m)}</span>`);
  parts.push(`<span class="eq">=</span><span class="res">${lineTotal(L)}</span>`);
  return parts.join('');
}

function lineHTML(R, li, L) {
  const isAtk = L.kind === 'attack';
  const mode = L.mode ? `<span class="l-type" data-t="${L.mode}">${L.mode === 'adv' ? 'Advantage' : 'Disadvantage'}</span>` : '';
  const type = !isAtk ? `<span class="l-type" data-t="${L.type}">${esc(L.type)}</span>` : '';
  return `<section class="line${L.crit ? ' crit-line' : ''}">
    <div class="l-head"><span class="l-tag${isAtk?'':' dmg'}">${esc(isAtk ? (L.label || 'Attack') : 'Damage')}</span>${type}${mode}${L.crit?'<span class="l-type" data-t="radiant">Crit ×2</span>':''}<span class="l-sum">${lineTotal(L)}</span></div>
    <div class="l-math">${mathHTML(R, li, L)}</div>
  </section>`;
}

/* RESOLVED — a contribution line. No switch, no button, nothing to decide. */
function contribHTML(R, r) {
  const t = r.target === 'attack' ? 'atk' : r.dtype;
  const right = r.kind === 'flag'
    ? `<span class="flag" data-f="${r.grants.toLowerCase()}"><i class="fa-solid ${flagIcon(r.grants)}"></i>${r.grants}</span>`
    : `${r.formula && r.formula !== 'flat' ? `<span class="c-form">${esc(r.formula)} →</span>` : ''}<span class="c-val" data-t="${t}">+${riderValue(r)}${r.target === 'attack' ? ' atk' : ' ' + r.dtype}</span>`;
  return `<div class="contrib" data-contrib="${R.id}:${r.id}">
    <span class="c-name">${esc(r.name)}</span><span class="c-src">${esc(r.src)}</span>
    <span class="c-right">${right}</span>
  </div>`;
}

/* UNRESOLVED — the toggle. Formula, never a pre-rolled number, until the player says yes. */
function askHTML(R, r) {
  const ri = R.riders.indexOf(r);
  const locked = r.kind === 'value' && r.rolled;
  const cls = ['rider'];
  cls.push(!r.on ? 'off' : (locked ? 'locked' : 'on'));
  if (r.folded) cls.push('folded');

  let val = '';
  if (r.kind === 'flag') {
    val = r.on
      ? `<span class="flag" data-f="${r.grants.toLowerCase()}"><i class="fa-solid ${flagIcon(r.grants)}"></i>${r.grants}</span>`
      : `<span class="flag ghost">${r.grants}</span>`;
  } else if (r.on && r.rolled) {
    val = `<span class="rd-val">+${riderValue(r)}${r.target === 'attack' ? ' atk' : ' ' + r.dtype}</span>`;
  }

  let run = '';
  if (r.kind === 'flag') {
    run = r.on
      ? `<div class="rd-grant"><span class="flag" data-f="${r.grants.toLowerCase()}"><i class="fa-solid ${flagIcon(r.grants)}"></i>${r.grants}</span>granted to this roll</div>`
      : `<div class="rd-cond"><i class="fa-solid fa-diamond"></i>Condition is yours to judge · grants ${r.grants}</div>`;
  } else if (locked) {
    run = `<div class="rd-result"><span class="form" style="color:var(--beige)">${esc(r.formula)}</span>${r.dice.map((d,i)=>dieHTML(R,'r'+ri,i,d,true)).join('<span class="op">+</span>')}<span class="eq" style="color:var(--beige-dim)">=</span><span class="res" style="color:var(--beige)">${riderValue(r)}</span>${r.dtype?`<span class="l-type" data-t="${r.dtype}" style="margin-left:4px">${esc(r.dtype)}</span>`:''}</div>
      <div class="rd-grant"><span class="rd-lock"><i class="fa-solid fa-lock"></i>Rolled · locked</span>toggling reuses this value</div>`;
  } else if (r.on) {
    run = `<div class="rd-cond"><i class="fa-solid fa-diamond"></i>Condition is yours to judge</div>
      <div class="rd-run"><span class="rd-form">${esc(r.formula)}${r.dtype ? ' ' + esc(r.dtype) : ''}</span>
      <button class="rd-btn" data-roll="${R.id}:${ri}"><span class="b-frame"></span><span class="b-in"><i class="fa-solid fa-dice-d20"></i>Roll it</span></button></div>`;
  } else {
    run = `<div class="rd-run"><span class="rd-form">${esc(r.formula)}${r.dtype ? ' ' + esc(r.dtype) : ''}</span></div>
      <div class="rd-hint"><i class="fa-solid fa-diamond"></i>Toggle on if it applies, then roll</div>`;
  }

  return `<div class="${cls.join(' ')}" data-rider="${R.id}:${ri}">
    <div class="rd-head"><span class="rd-sw" data-sw="${R.id}:${ri}"></span><span class="rd-name">${esc(r.name)}</span><span class="rd-src">${esc(r.src)}</span>${val}<span class="rd-fold"><i class="fa-solid fa-chevron-down"></i></span></div>
    <div class="rd-body"><div class="rd-text">${r.text}</div>${run}</div>
  </div>`;
}

function problemsHTML(R) {
  const p = R.problems || [];
  if (!p.length) return '';
  return `<div class="probs" role="alert">
    <div class="probs-h"><i class="fa-solid fa-triangle-exclamation"></i>Problems<span class="n">${p.length} contribution${p.length>1?'s':''} dropped</span></div>
    ${p.map(x => `<div class="prob">
      <div class="p-top"><span class="p-name">${esc(x.name)}</span><span class="p-src">${esc(x.src)} · ${esc(x.fault)}</span><span class="p-drop">Not applied</span></div>
      <div class="p-why">${esc(x.why)}</div>
    </div>`).join('')}
  </div>`;
}

function entryHTML(R) {
  const t = totals(R);
  const cls = ['entry'];
  if (R.folded) cls.push('folded');
  if (R.crit) cls.push('crit');
  if (R.fumble) cls.push('fumble');
  const tag = R.crit ? '<span class="e-tag">Critical</span>' : R.fumble ? '<span class="e-tag">Fumble</span>' : '';
  const dmgSplit = Object.entries(t.dmg).map(([k,v]) => `<span data-t="${k}">${k} <b>${v}</b></span>`).join('');
  const res = resolvedRiders(R), ask = unresolvedRiders(R);

  const foot = `<footer class="e-foot">
      ${t.atk != null ? `<div class="tot atk"><span class="k">Total ${esc((R.lines.find(l => l.kind === 'attack') || {}).label || 'Attack')}</span><span class="v">${t.atk}</span></div>` : '<div></div>'}
      ${t.hasDamage ? `<div class="tot"><span class="k">Total Damage</span><span class="v">${t.dmgTotal}</span><div class="split">${dmgSplit}</div></div>` : '<div></div>'}
    </footer>
    ${t.flags.length ? `<div class="granted-row"><span class="k">Granted</span>${t.flags.map(f => `<span class="flag" data-f="${f.toLowerCase()}"><i class="fa-solid ${flagIcon(f)}"></i>${f}</span>`).join('')}</div>` : ''}
    ${t.pending ? `<div class="pending-note" data-pending="${R.id}"><i class="fa-solid fa-circle-question"></i>${t.pending} rider${t.pending>1?'s':''} still waiting on you</div>` : ''}`;

  return `<article class="${cls.join(' ')}" data-entry="${R.id}">
    ${tag}<span class="e-frame"></span>
    <div class="e-inner">
      <header class="e-head" data-head="${R.id}">
        <span class="e-glyph"><i class="fa-solid ${R.icon}"></i></span>
        <div><div class="e-name" data-cat="${esc(R.cat || '')}" title="Open catalog entry">${esc(R.name)}<i class="fa-solid fa-book-open bk"></i></div><div class="e-flavor">${esc(R.flavor)}</div></div>
        <span class="e-right"><span class="e-stamp">${R.stamp}</span><span class="e-fold"><i class="fa-solid fa-chevron-down"></i></span></span>
      </header>
      <div class="e-body">
        ${R.lines.map((L,i) => lineHTML(R, i, L)).join('')}
        ${res.length ? `<div class="contribs">${res.map(r => contribHTML(R, r)).join('')}</div>` : ''}
        ${ask.length ? `<div class="ask-h"><i class="fa-solid fa-diamond"></i>Your call<span class="sep"></span><span>${ask.length}</span></div>
          <div class="riders">${ask.map(r => askHTML(R, r)).join('')}</div>` : ''}
        ${foot}
        ${problemsHTML(R)}
      </div>
    </div>
  </article>`;
}

function render(freshId) {
  body.innerHTML = rolls.map(entryHTML).join('');
  [...body.children].forEach((el, i) => {
    if (i === 0) el.classList.add('latest'); else el.classList.add('stale');
    if (el.dataset.entry === String(freshId)) el.classList.add('fresh');
  });
  document.getElementById('rc-count').textContent = rolls.length + (rolls.length === 1 ? ' roll' : ' rolls');
}
const find = id => rolls.find(r => r.id === String(id));

/* ---------------- interactions ---------------- */
body.addEventListener('click', e => {
  const nm = e.target.closest('[data-cat]');
  if (nm) {
    const R = find(nm.closest('[data-entry]').dataset.entry);
    // collapsed entry: first click expands, only a second opens the catalog
    if (R.folded) { R.folded = false; render(); return; }
    openCat(nm.dataset.cat); return;
  }

  const sw = e.target.closest('[data-sw]');
  if (sw) { const [id, ri] = sw.dataset.sw.split(':'); const R = find(id); R.riders[ri].on = !R.riders[ri].on; render(); return; }

  // rolling is one-time: the value is fixed from here on
  const rb = e.target.closest('[data-roll]');
  if (rb) {
    const [id, ri] = rb.dataset.roll.split(':'); const R = find(id); const r = R.riders[ri];
    if (r.rolled) return;
    r.dice = rollFormula(r.formula); r.rolled = true; r.folded = false; render();
    const el = body.querySelector(`[data-rider="${id}:${ri}"]`);
    if (el) el.querySelectorAll('.die').forEach(d => d.classList.add('spin'));
    return;
  }

  const d = e.target.closest('[data-die]');
  if (d && !d.classList.contains('dropped') && !d.classList.contains('locked')) {
    const [id, li, di] = d.dataset.die.split(':'); const R = find(id);
    const L = String(li).startsWith('r') ? R.riders[li.slice(1)] : R.lines[li];
    const t = L.dice[di];
    if (t.orig == null) t.orig = t.v;
    t.v = rnd(t.sides); t.rerolled = true;
    render();
    const nd = body.querySelector(`[data-die="${id}:${li}:${di}"]`);
    if (nd) nd.classList.add('spin');
    return;
  }

  const rh = e.target.closest('.rd-head');
  if (rh) { const [id, ri] = rh.parentElement.dataset.rider.split(':'); const R = find(id); R.riders[ri].folded = !R.riders[ri].folded; render(); return; }

  const h = e.target.closest('[data-head]');
  if (h) { const R = find(h.dataset.head); R.folded = !R.folded; render(); }
});

/* hover readouts */
body.addEventListener('mouseover', e => {
  const d = e.target.closest('[data-die]');
  if (d) {
    const [id, li, di] = d.dataset.die.split(':'); const R = find(id);
    const L = String(li).startsWith('r') ? R.riders[li.slice(1)] : R.lines[li];
    const t = L.dice[di];
    const rows = [`natural <b style="color:var(--cyan-hot)">${t.v}</b> on a d${t.sides}`, `range 1–${t.sides}`];
    if (t.dropped) rows.push(`dropped — ${L.mode === 'dis' ? 'disadvantage keeps the low die' : 'advantage keeps the high die'}`);
    if (t.crit) rows.push('extra die from critical hit');
    if (t.rerolled) rows.push(`rerolled from <b>${t.orig}</b>`);
    const lock = d.classList.contains('locked');
    return showTip(d, `d${t.sides}`, rows.join('<br>'), lock ? 'Locked — rolled riders keep their value' : (t.dropped ? null : 'Click to reroll this die'));
  }
  const c = e.target.closest('[data-contrib]');
  if (c) {
    const [id, rid] = c.dataset.contrib.split(':'); const R = find(id);
    const r = shown(R).find(x => x.id === rid);
    const rows = ['<b style="color:var(--cyan-hot)">Resolved by the engine</b>', `condition met from your own state`];
    if (r.dice && r.dice.length) rows.push(`${esc(r.formula)} → ${r.dice.map(x => x.v).join(' + ')}`);
    return showTip(c, r.name, rows.join('<br>'), 'Nothing to decide');
  }
  const m = e.target.closest('[data-mod]');
  if (m) {
    const [id, li] = m.dataset.mod.split(':'); const R = find(id); const L = R.lines[li];
    return showTip(m, 'Modifiers', L.mods.map(x => `${esc(x.k)} <b style="color:var(--beige)">${sgn(x.v)}</b>`).join('<br>'), null);
  }
  const pn = e.target.closest('[data-pending]');
  if (pn) {
    const R = find(pn.dataset.pending);
    const rows = unresolvedRiders(R).filter(r => !(r.on && (r.kind === 'flag' || r.rolled)))
      .map(r => `<b style="color:var(--cyan-hot)">${esc(r.name)}</b> ${r.on ? 'not rolled' : 'not confirmed'}<br><span style="color:var(--beige-dim)">${esc(r.src)} · ${esc(r.kind === 'flag' ? 'grants ' + r.grants : r.formula + (r.dtype ? ' ' + r.dtype : ''))}</span>`);
    return showTip(pn, 'Your call', rows.join('<br><br>'), 'Answer them on the riders above');
  }
  hideTip();
});
body.addEventListener('mouseout', e => { if (!e.relatedTarget || !e.relatedTarget.closest('[data-die],[data-mod],[data-pending],[data-contrib]')) hideTip(); });
body.addEventListener('scroll', hideTip);

function showTip(anchor, k, v, hint) {
  tip.innerHTML = `<div class="t-k">${esc(k)}</div><div class="t-v">${v}</div>${hint ? `<div class="t-hint">${hint}</div>` : ''}`;
  tip.classList.add('show');
  const r = anchor.getBoundingClientRect(), t = tip.getBoundingClientRect();
  let top = r.top - t.height - 8; if (top < 8) top = r.bottom + 8;
  tip.style.top = top + 'px';
  tip.style.left = Math.max(8, Math.min(r.left - 6, window.innerWidth - t.width - 12)) + 'px';
}
function hideTip() { tip.classList.remove('show'); }

document.getElementById('rc-fold').addEventListener('click', e => {
  const anyOpen = rolls.some(r => !r.folded);
  rolls.forEach(r => r.folded = anyOpen);
  e.target.textContent = anyOpen ? 'Expand all' : 'Collapse all';
  render();
});
document.getElementById('rc-clear').addEventListener('click', () => { rolls = []; render(); });

/* ---------------- catalog sheet ---------------- */
const CATALOG = {
  greatsword: {
    name:'Greatsword', kind:'Martial Weapon · Heavy, Two-Handed', icon:'fa-khanda',
    stats:[['Attack','Melee · STR'],['Reach','5 ft'],['Weight','6 lb'],['Properties','Heavy, Two-Handed']],
    damage:[['1d12','slashing']],
    desc:'<p>A blade long enough to need both hands and heavy enough to punish anyone who lets it build momentum. Attacks are made with <em>Strength</em>; its weight makes it unwieldy for small creatures.</p>',
    riders:[
      ['Condemning Strike','Oath · Lv 5','If this attack hits a creature affected by a <em>Curse</em>, add <em>+1d4 radiant</em> to the weapon’s damage roll.'],
      ['Sworn Grip','Fighting Style','While wielding a two-handed weapon in both hands, add <em>+2</em> to its damage roll.'],
      ['Marked Quarry','Oath · Lv 3','You have <em>advantage</em> on attacks against a creature you have sworn against.']
    ],
    dm:'Ros carries her father’s sword. The pommel is stamped with a sigil no one in the party has been able to read.'
  },
  flame: {
    name:'Sacred Flame', kind:'Cantrip · Level 0', icon:'fa-fire-flame-curved', school:'Evocation',
    stats:[['Casting Time','1 Action'],['Range','60 ft'],['Duration','Instantaneous'],['Save','DEX · half on success'],['Components','V, S'],['Target','One creature']],
    damage:[['1d8','radiant'],['1d6','fire']],
    desc:'<p>Radiance falls on a target you can see, and the air around it takes light. Because the flame is <em>called</em> rather than kindled, it burns in two ways at once — the judgement itself is <em>radiant</em>, while what it sets alight deals <em>fire</em>.</p><p>Cover offers no protection. A creature that succeeds on its save takes half of both damage types.</p>',
    riders:[
      ['Zealot’s Ember','Shard · Tier II','Your <em>fire</em> damage is increased by <em>+2</em> while at least one Shard is attuned.'],
      ['Scourge of the Grave','Feat','If the target is <em>Undead</em> or a <em>Fiend</em>, add <em>+2d6 radiant</em> and it cannot regain hit points until your next turn.'],
      ['Verdict','Shard · Tier III','If the target is <em>judged</em>, this spell is treated as a <em>critical hit</em>.'],
      ['Radiant Empowerment','Shard · Tier II','Radiant damage is scaled by <em>shards spent ÷ shards held</em>.']
    ],
    dm:'The two-type split is intentional — it lets the cantrip stay relevant against fire-immune undead without becoming the answer to everything.'
  },
  stealth: {
    name:'Stealth', kind:'Skill · Dexterity', icon:'fa-user-ninja',
    stats:[['Ability','Dexterity'],['Proficiency','Not proficient'],['Armor','Heavy — disadvantage'],['Contest','vs passive Perception']],
    damage:[],
    desc:'<p>An attempt to move, hide, or act unnoticed. Heavy armor imposes <em>disadvantage</em> unless you are proficient with it — plate is not a subtle garment, and the GUIDE will not pretend otherwise.</p>',
    riders:[
      ['Lucky','Feat · 2 left','Spend a luck point to roll a third d20 and choose which one to use.'],
      ['Drawn Eye','Party · Nyx','If an ally is actively drawing attention elsewhere, you have <em>advantage</em> on this check.']
    ],
    dm:''
  }
};
const catEl = document.getElementById('cat'), catBody = document.getElementById('cat-body');

function openCat(key) {
  const c = CATALOG[key];
  if (!c) return;
  catBody.innerHTML = `
    <div class="cat-name">${esc(c.name)}</div>
    <div class="cat-line"><span class="school"><i class="fa-solid ${c.icon}"></i>${esc(c.kind)}</span>${c.school ? `<span class="sep">·</span><span>${esc(c.school)}</span>` : ''}</div>
    <div class="cat-grid">${c.stats.map(([k,v]) => `<div class="cat-cell"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}
      ${c.damage.length ? `<div class="cat-cell span2"><span class="k">Damage</span><div class="cat-dmg">${c.damage.map(([d,t]) => `<span data-t="${t}">${d} ${t}</span>`).join('')}</div></div>` : ''}
    </div>
    <span class="cat-lbl">Description</span><div class="cat-desc">${c.desc}</div>
    ${c.riders.length ? `<span class="cat-lbl">Interacts With</span>${c.riders.map(([n,s,t]) => `<div class="cat-rider"><div class="rn">${esc(n)}<span>${esc(s)}</span></div><div class="rt">${t}</div></div>`).join('')}` : ''}
    ${c.dm ? `<div class="cat-dm"><div class="k"><i class="fa-solid fa-feather"></i>DM Note</div><div class="v">${esc(c.dm)}</div></div>` : ''}`;
  catBody.scrollTop = 0;
  catEl.classList.add('open');
}
function closeCat() { catEl.classList.remove('open'); }
document.getElementById('cat-close').addEventListener('click', closeCat);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCat(); });

/* ---------------- roll builders ---------------- */
const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12:false });

function greatsword() {
  const a = die(20);
  const crit = a.v === 20, fumble = a.v === 1;
  const dmg = [die(12)];
  if (crit) { const x = die(12); x.crit = true; dmg.push(x); }
  return {
    id: String(++uid), name:'Greatsword', cat:'greatsword', flavor:'A two-handed cut, driven from the shoulder.',
    icon:'fa-khanda', stamp: stamp(), crit, fumble,
    lines: [
      { kind:'attack', formula:'1d20', dice:[a], mods:[{k:'Strength',v:3},{k:'Proficiency',v:2}] },
      { kind:'damage', type:'slashing', formula: crit ? '2d12' : '1d12', dice: dmg, mods:[{k:'Strength',v:2}], crit }
    ],
    riders: [
      { id:'grip', name:'Sworn Grip', src:'Fighting Style', state:'resolved', kind:'value', target:'damage',
        formula:'flat', dtype:'slashing', flat:2, on:true, rolled:true, dice:[], folded:true,
        text:'While wielding a two-handed weapon in both hands, add <em>+2</em> to its damage roll.' },
      { id:'condemn', name:'Condemning Strike', src:'Oath · Lv 5', state:'unresolved', kind:'value', target:'damage',
        formula:'1d4', dtype:'radiant', flat:null, on:true, rolled:false, dice:[], folded:false,
        text:'If this attack hits a creature affected by a <em>Curse</em>, add <em>+1d4 radiant</em> to the weapon\u2019s damage roll.' },
      { id:'fury', name:'Bloodied Fury', src:'Oath · Lv 9', state:'na', kind:'value', target:'damage',
        formula:'1d8', dtype:'slashing', flat:null, on:false, rolled:false, dice:[], folded:true,
        text:'Never rendered — you are above half hit points, so the engine drops it entirely.' }
    ]
  };
}

function sacredFlame() {
  const d1 = die(8), d2 = die(6);
  return {
    id: String(++uid), name:'Sacred Flame', cat:'flame', flavor:'Radiance falls on the target like a verdict.',
    icon:'fa-fire-flame-curved', stamp: stamp(), saveDC:true,
    lines: [
      { kind:'attack', label:'Save DC', formula:'', dice:[], mods:[{k:'Base DC',v:8},{k:'Proficiency',v:3},{k:'Charisma',v:4}] },
      { kind:'damage', type:'radiant', formula:'1d8', dice:[d1], mods:[] },
      { kind:'damage', type:'fire',    formula:'1d6', dice:[d2], mods:[] }
    ],
    riders: [
      { id:'zeal', name:'Zealot\u2019s Ember', src:'Shard · Tier II', state:'resolved', kind:'value', target:'damage',
        formula:'flat', dtype:'fire', flat:2, on:true, rolled:true, dice:[], folded:true,
        text:'Your fire damage is increased by <em>+2</em> while at least one Shard is attuned.' },
      { id:'undead', name:'Scourge of the Grave', src:'Feat', state:'unresolved', kind:'value', target:'damage',
        formula:'2d6', dtype:'radiant', flat:null, on:true, rolled:false, dice:[], folded:false,
        text:'If the target is <em>Undead</em> or a <em>Fiend</em>, add <em>+2d6 radiant</em> and it cannot regain hit points until your next turn.' },
      { id:'verdict', name:'Verdict', src:'Shard · Tier III', state:'unresolved', kind:'flag', grants:'CRIT', target:'attack',
        formula:'', dtype:'', flat:null, on:false, rolled:false, dice:[], folded:false,
        text:'If the target is <em>judged</em>, this spell is treated as a <em>critical hit</em>.' }
    ],
    problems: [
      { name:'Radiant Empowerment', src:'Shard · Tier II', fault:'formula failed',
        why:'1d6 × (SHARDS_SPENT ÷ SHARDS_HELD) — division by zero, SHARDS_HELD = 0' }
    ]
  };
}

function stealth() {
  const a = die(20), b = die(20);
  (a.v <= b.v ? b : a).dropped = true;
  const lo = Math.min(a.v, b.v);
  return {
    id: String(++uid), name:'Stealth', cat:'stealth', flavor:'Plate mail is not a subtle garment.',
    icon:'fa-user-ninja', stamp: stamp(), crit: lo === 20, fumble: lo === 1,
    lines: [{ kind:'attack', label:'Check', formula:'2d20', dice:[a,b], mode:'dis', mods:[{k:'Dexterity',v:2},{k:'Armor (heavy)',v:-4}] }],
    riders: [
      { id:'drawn', name:'Drawn Eye', src:'Party · Nyx', state:'unresolved', kind:'flag', grants:'ADVANTAGE', target:'attack',
        formula:'', dtype:'', flat:null, on:false, rolled:false, dice:[], folded:false,
        text:'If an ally is actively drawing attention elsewhere, you have <em>advantage</em> on this check.' },
      { id:'lucky', name:'Lucky', src:'Feat · 2 left', state:'unresolved', kind:'value', target:'attack',
        formula:'1d20', dtype:'', flat:null, on:false, rolled:false, dice:[], folded:false,
        text:'Spend a luck point to roll a third d20 and choose which one to use.' }
    ]
  };
}

const BUILD = { greatsword, flame: sacredFlame, stealth };
function push(fn) {
  const R = fn();
  R.riders = R.riders || [];
  R.problems = R.problems || [];
  rolls.unshift(R);
  if (rolls.length > 12) rolls.pop();
  render(R.id);
  body.scrollTop = 0;
}
document.querySelectorAll('.act').forEach(b => b.addEventListener('click', () => push(BUILD[b.dataset.act])));

/* ---------------- seed: the worked example, verbatim ---------------- */
(function seed() {
  push(stealth);
  push(sacredFlame);
  rolls[0].folded = true; rolls[1].folded = true;
  const g = greatsword();
  g.crit = false; g.fumble = false;
  g.lines[0].dice = [die(20, 17)];
  g.lines[1] = { kind:'damage', type:'slashing', formula:'1d12', dice:[die(12, 8)], mods:[{k:'Strength',v:2}] };
  g.flavor = 'Stab an enemy with your sword.';
  g.riders.splice(1, 0, { id:'quarry', name:'Marked Quarry', src:'Oath · Lv 3', state:'resolved', kind:'flag', grants:'ADVANTAGE',
    target:'attack', formula:'', dtype:'', flat:null, on:true, rolled:true, dice:[], folded:true,
    text:'You have <em>advantage</em> on attacks against a creature you have sworn against.' });
  rolls.unshift(g);
  render(g.id);
})();
})();
