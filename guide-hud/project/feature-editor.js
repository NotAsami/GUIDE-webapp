/* ============================================================================
   FEATURE EDITOR — DM node-authoring logic.

   THE FORM RENDERS FROM SCHEMA. OPS[op].fields drives every field an effect
   shows; a new op is a new entry here, not a new branch in the renderer.
   Field types are a closed set: formula | text | selector | enum | boolean |
   reference | array. Each field carries desc + example, which is where the
   help panel and the inline per-field help both come from.
   ============================================================================ */

/* ---- catalog the selectors resolve against (names only in the UI) ---- */
const THINGS = [
  { id:'stat_str', name:'Strength', kind:'Stat', tags:['ability'] },
  { id:'stat_dex', name:'Dexterity', kind:'Stat', tags:['ability'] },
  { id:'stat_con', name:'Constitution', kind:'Stat', tags:['ability'] },
  { id:'stat_wis', name:'Wisdom', kind:'Stat', tags:['ability'] },
  { id:'stat_ac', name:'Armor Class', kind:'Stat', tags:['defence'] },
  { id:'stat_hp', name:'Maximum HP', kind:'Stat', tags:['defence','vitality'] },
  { id:'stat_speed', name:'Speed', kind:'Stat', tags:['movement'] },
  { id:'sp_firebolt', name:'Fire Bolt', kind:'Spell', tags:['fire_damage','cantrip','spell_attack'] },
  { id:'sp_burnhands', name:'Burning Hands', kind:'Spell', tags:['fire_damage','aoe'] },
  { id:'sp_fireball', name:'Fireball', kind:'Spell', tags:['fire_damage','aoe'] },
  { id:'sp_sacflame', name:'Sacred Flame', kind:'Spell', tags:['radiant'] },
  { id:'sp_cure', name:'Cure Wounds', kind:'Spell', tags:['healing'] },
  { id:'it_castellan', name:'Castellan Longsword', kind:'Item', tags:['weapon','slashing','magic_weapon'] },
  { id:'it_ember', name:'Ember Brand', kind:'Item', tags:['weapon','fire_damage','magic_weapon'] },
  { id:'it_wardring', name:"Warden's Ward", kind:'Item', tags:['defence','magic_item'] },
  { id:'ft_secondwind', name:'Second Wind', kind:'Feature', tags:['healing'] },
  { id:'ft_darkvision', name:'Darkvision', kind:'Feature', tags:['senses'] },
  { id:'ft_rage', name:'Rage', kind:'Feature', tags:['martial'] }
];
const ROLLS = ['attack','attack.melee','attack.ranged','attack.spell','save','save.str','save.dex','save.con','save.int','save.wis','save.cha','check','check.athletics','check.stealth','check.perception','initiative','death'];
const EFFECT_LIB = [
  { id:'blessed', name:'Blessed' }, { id:'burning', name:'Burning' }, { id:'hasted', name:'Hasted' },
  { id:'shielded', name:'Shielded' }, { id:'frightened', name:'Frightened' }, { id:'braced', name:'Braced' }
];
const SOURCES = { class:'Class', subclass:'Subclass', racial:'Racial', feat:'Feat', background:'Background' };
const RESETS = ['Short rest', 'Long rest', 'Dawn', 'Per turn', 'Per encounter'];
/* identity glyph + colour — same palette the console runs on */
const COLORS = ['#d4bf7d','#e2b021','#00a6d6','#a07ad6','#b93a3a','#4fae6b'];
const ICONS = ['fa-lungs','fa-bolt','fa-burst','fa-eye','fa-leaf','fa-hammer','fa-fire','fa-shield-halved','fa-heart-pulse','fa-hand-fist','fa-dumbbell','fa-anchor','fa-mountain','fa-shoe-prints','fa-feather','fa-wind','fa-droplet','fa-snowflake','fa-sun','fa-moon','fa-star','fa-gem','fa-diamond','fa-khanda','fa-shield','fa-helmet-safety','fa-crosshairs','fa-bullseye','fa-dice-d20','fa-wand-sparkles','fa-hat-wizard','fa-book','fa-scroll','fa-brain','fa-signal','fa-tower-broadcast','fa-wave-square','fa-skull','fa-ghost','fa-dragon','fa-paw','fa-spider','fa-crow','fa-tree','fa-seedling','fa-flask','fa-vial','fa-mortar-pestle','fa-key','fa-lock','fa-door-open','fa-bridge','fa-compass','fa-map','fa-clock','fa-hourglass-half','fa-link','fa-shuffle','fa-arrows-rotate','fa-explosion','fa-radiation','fa-biohazard','fa-dna','fa-microscope','fa-music','fa-masks-theater','fa-comment','fa-handshake','fa-coins','fa-utensils'];

/* ---- OP SCHEMA — the whole reason this form is one form ---- */
const F = {
  amount: { key:'amount', type:'formula', label:'Amount', required:true,
    desc:'Number or expression contributed to every matched target.', example:'2 + floor(level / 4)' },
  dice: { key:'amount', type:'formula', label:'Amount', required:true,
    desc:'Rolled or flat healing applied on activation.', example:'1d10 + level' }
};
const OPS = {
  add: { label:'add', group:'passive', icon:'fa-plus', blurb:'Adds a numeric contribution to every matched target. Stacks with other add nodes.',
    fields:[ F.amount,
      { key:'byLevel', type:'array', label:'By level', wide:true,
        desc:'Level-indexed progression. When any slot is filled it overrides Amount. Index 0 is unused — character levels start at 1.',
        example:'slot 1 = 2, slot 5 = 3, slot 11 = 4' } ] },
  adv: { label:'adv', group:'passive', icon:'fa-angles-up', blurb:'Grants advantage on the matched rolls. No parameters — the target list is the whole statement.', fields:[] },
  dis: { label:'dis', group:'passive', icon:'fa-angles-down', blurb:'Imposes disadvantage on the matched rolls.', fields:[] },
  crit: { label:'crit', group:'passive', icon:'fa-burst', blurb:'Lowers the critical-hit threshold on the matched attack rolls.',
    fields:[ { key:'threshold', type:'formula', label:'Crits on', required:true,
      desc:'Lowest d20 face that counts as a critical hit.', example:'19' } ] },
  note: { label:'note', group:'passive', icon:'fa-comment', blurb:'Surfaces rules text on the target without changing a number.',
    fields:[ { key:'text', type:'text', label:'Note text', required:true, wide:true,
      desc:'Player-facing sentence attached to the matched targets.', example:'Ignores half cover.' } ] },
  resist: { label:'resist', group:'passive', icon:'fa-shield-halved', blurb:'Halves incoming damage of the matched kind.', fields:[] },
  vuln: { label:'vuln', group:'passive', icon:'fa-heart-crack', blurb:'Doubles incoming damage of the matched kind.', fields:[] },
  immune: { label:'immune', group:'passive', icon:'fa-shield', blurb:'Nullifies the matched damage kind or condition.', fields:[] },
  tempHp: { label:'tempHp', group:'activation', icon:'fa-shield-heart', blurb:'On activation, grants temporary HP.',
    fields:[ F.dice, { key:'stacks', type:'boolean', label:'Stacks with existing temporary HP',
      desc:'Off means the larger pool wins, as normal.', example:'usually off' } ] },
  heal: { label:'heal', group:'activation', icon:'fa-heart-pulse', blurb:'On activation, restores hit points.', fields:[ F.dice ] },
  grantEffect: { label:'grantEffect', group:'activation', icon:'fa-wand-sparkles', blurb:'On activation, applies a catalog effect to the matched targets.',
    fields:[ { key:'effect', type:'reference', ref:'effect', label:'Effect', required:true,
        desc:'An effect from the catalog. Shown by name — the id is written on save.', example:'Braced' },
      { key:'duration', type:'enum', label:'Duration', options:['1 round','1 minute','10 minutes','1 hour','Until rest','Concentration'],
        desc:'How long the effect rides on the target.', example:'1 minute' } ] },
  setVar: { label:'setVar', group:'activation', icon:'fa-equals', blurb:'On activation, writes a value into one of this feature\u2019s variables.',
    fields:[ { key:'variable', type:'reference', ref:'variable', label:'Variable', required:true,
        desc:'A variable declared in this feature\u2019s Variables block.', example:'stance' },
      { key:'value', type:'formula', label:'Value', required:true,
        desc:'Expression evaluated at activation and stored.', example:'true' } ] },
  addVar: { label:'addVar', group:'activation', icon:'fa-plus-minus', blurb:'On activation, increments one of this feature\u2019s variables.',
    fields:[ { key:'variable', type:'reference', ref:'variable', label:'Variable', required:true,
        desc:'A variable declared in this feature\u2019s Variables block.', example:'charges' },
      { key:'delta', type:'formula', label:'Change by', required:true,
        desc:'Signed expression added to the current value.', example:'-1' } ] }
};
const OP_ORDER = ['add','adv','dis','crit','note','resist','vuln','immune','tempHp','heal','grantEffect','setVar','addVar'];
/* palette order — what the author reaches for first, and what hides behind MORE */
const PAL_CONTRIB = ['add','adv','dis','crit','resist'];
const PAL_CONTRIB_MORE = ['vuln','immune','note'];
const PAL_ACT = ['heal','tempHp','grantEffect','setVar','addVar'];
const OP_TITLE = { add:'Add', adv:'Adv', dis:'Dis', crit:'Crit', note:'Note', resist:'Resist', vuln:'Vuln', immune:'Immune',
  tempHp:'Temp HP', heal:'Heal', grantEffect:'Grant Effect', setVar:'Set Var', addVar:'Add Var' };
/* activation model — replaces the old passive toggle. Uses are independent. */
const ACTIVATIONS = {
  none:   { label:'None (passive)', note:'No button on the player\u2019s Features screen — this feature simply applies.', color:'var(--beige-dim)', icon:'fa-infinity' },
  action: { label:'Action', note:'A button on the Features screen, spending the player\u2019s action.', color:'var(--amber)', icon:'fa-hand' },
  bonus:  { label:'Bonus action', note:'A button, spending the player\u2019s bonus action.', color:'var(--amber)', icon:'fa-bolt' },
  reaction:{ label:'Reaction', note:'A button. Mechanically an action — the label is what tells the player when it fires.', color:'var(--cyan)', icon:'fa-reply' },
  free:   { label:'Free action', note:'A button that costs nothing. Uses, if any, are the only limit.', color:'var(--good)', icon:'fa-feather' }
};
const ACT_ORDER = ['none','action','bonus','reaction','free'];

/* shared field help for the two concepts most likely to confuse */
const HELP_WHEN = { t:'when \u2014 the app decides',
  b:'<p><code>when</code> is a condition the app evaluates. If it reads false, the node contributes nothing and the player never sees it mentioned.</p><p class="mono">Written over this feature\u2019s variables and the character sheet. No prose, no prompt, no choice.</p><div class="dl"><span class="k">Example</span><span class="v">hp &lt; maxHp / 2</span><span class="k">Example</span><span class="v">stance == "guarded" and charges &gt; 0</span><span class="k">Empty</span><span class="v">Always true \u2014 the node always contributes.</span></div>' };
const HELP_ASK = { t:'ask \u2014 a human decides',
  b:'<p><code>ask</code> turns the node into a toggle the <em>player</em> flips at the table. The text you write is the label on that toggle.</p><p class="mono">Orthogonal to <code>when</code>. A node can have both: the app checks whether the choice is legal, the player chooses whether to spend it.</p><div class="dl"><span class="k">Example</span><span class="v">Spend a use to press the attack?</span><span class="k">Empty</span><span class="v">No prompt \u2014 the node applies on its own.</span></div>' };
const HELP_TARGET = { t:'Target selectors',
  b:'<p>A target list is a set of selectors, OR\u2019d together. Three kinds, and they resolve differently:</p><div class="dl"><span class="k">Thing</span><span class="v">One named entity from the catalog \u2014 a stat, spell, item or feature. Picked by name; stored as an id.</span><span class="k">Tag</span><span class="v">Every entity carrying the tag. <code>tag:fire_damage</code> follows the catalog as it grows.</span><span class="k">Roll kind</span><span class="v">A class of roll rather than a thing. <code>roll:save.dex</code>, or <code>roll:save</code> for all of them.</span><span class="k">Empty</span><span class="v">The node\u2019s own roll \u2014 the feature acting on itself.</span></div><p class="mono">The match count beside the list is the only thing that tells a typo from a selector that correctly matches nothing yet. Read it every time.</p>' };

/* ---- seed catalog ---- */
const FOLDERS = [
  { id:'fl_fighter', name:'Fighter Chassis' },
  { id:'fl_ancestry', name:'Ancestry' },
  { id:'fl_feats', name:'Feats & Backgrounds' },
  { id:'fl_draft', name:'Drafts' }
];
function blankArr() { return new Array(21).fill(''); }
let FEATURES = [
  { id:'second_wind', folder:'fl_fighter', name:'Second Wind', source:'class', detail:'Fighter 1', icon:'fa-lungs', color:'#00a6d6', activation:'bonus',
    summary:'You catch your breath and close a wound by will alone.',
    desc:'A reserve of grit the soldier draws on mid-fight \u2014 a moment to breathe, set the feet, and close a wound by will alone.',
    maxUses:'1', reset:'Short rest', tags:['martial','healing'],
    vars:[ { name:'used_this_fight', kind:'stored', type:'boolean', scope:'player', init:'false', label:'Spent' } ],
    effects:[
      { op:'heal', targets:[], label:'Second Wind healing', when:'', ask:'Spend Second Wind?', amount:'1d10 + level' },
      { op:'setVar', targets:[], label:'Mark as spent', when:'', ask:'', variable:'used_this_fight', value:'true' }
    ] },
  { id:'action_surge', folder:'fl_fighter', name:'Action Surge', source:'class', detail:'Fighter 2', icon:'fa-bolt', color:'#e2b021', activation:'free',
    summary:'Take one additional action on your turn.',
    desc:'For one breath the world holds still long enough for you to move twice through it. The cost is paid afterwards, in shaking hands.',
    maxUses:'1', reset:'Short rest', tags:['martial'],
    vars:[], effects:[] },
  { id:'improved_crit', folder:'fl_fighter', name:'Improved Critical', source:'subclass', detail:'Champion 3', icon:'fa-burst', color:'#b93a3a', activation:'none',
    summary:'Your weapon attacks crit on a 19 or 20.',
    desc:'You have learned where armour stops being armour.',
    maxUses:'', reset:'Short rest', tags:['martial','critical'],
    vars:[],
    effects:[ { op:'crit', targets:[{ kind:'roll', value:'attack' }], label:'Champion crit range', when:'', ask:'', threshold:'19' } ] },
  { id:'darkvision', folder:'fl_ancestry', name:'Darkvision', source:'racial', detail:'Half-Elf', icon:'fa-eye', color:'#a07ad6', activation:'none',
    summary:'See 60 ft in darkness, in greyscale.',
    desc:'Darkness is a colour to you, and not a deep one. You see sixty feet of it as though it were dusk.',
    maxUses:'', reset:'Long rest', tags:['senses'],
    vars:[],
    effects:[ { op:'note', targets:[], label:'Darkvision 60 ft', when:'', ask:'', text:'You see in dim light within 60 ft as if it were bright light, and in darkness as if it were dim light \u2014 in greyscale.' } ] },
  { id:'fey_ancestry', folder:'fl_ancestry', name:'Fey Ancestry', source:'racial', detail:'Half-Elf', icon:'fa-leaf', color:'#4fae6b', activation:'none',
    summary:'Advantage on saves against being charmed.',
    desc:'Something in the blood declines to be told what to feel.',
    maxUses:'', reset:'Long rest', tags:['charm','senses'],
    vars:[],
    effects:[ { op:'adv', targets:[{ kind:'roll', value:'save.wis' }, { kind:'tag', value:'charm' }], label:'Advantage vs charm', when:'', ask:'' } ] },
  { id:'savage_attacker', folder:'fl_feats', name:'Savage Attacker', source:'feat', detail:'Level 4 feat', icon:'fa-hammer', color:'#d4bf7d', activation:'none',
    summary:'Your weapon damage grows with your level.',
    desc:'You hit the way a falling tree hits \u2014 once, and completely.',
    maxUses:'', reset:'Long rest', tags:['martial','weapon'],
    vars:[ { name:'weapon_bonus', kind:'derived', type:'', scope:'dm', formula:'floor(level / 4) + 1', init:'', label:'Weapon bonus' } ],
    effects:[ (function(){ const a = blankArr(); a[1]='1'; a[5]='2'; a[11]='3'; a[17]='4';
      return { op:'add', targets:[{ kind:'tag', value:'weapon' }], label:'Savage damage bonus', when:'', ask:'', amount:'1', byLevel:a }; })() ] },
  { id:'elemental_adept', folder:'fl_feats', name:'Elemental Adept (Fire)', source:'feat', detail:'Level 8 feat', icon:'fa-fire', color:'#b93a3a', activation:'none',
    summary:'Your fire damage ignores resistance.',
    desc:'Fire has stopped arguing with you about what it is allowed to burn.',
    maxUses:'', reset:'Long rest', tags:['fire_damage','caster'],
    vars:[],
    effects:[
      { op:'note', targets:[{ kind:'tag', value:'fire_damage' }], label:'Ignores fire resistance', when:'', ask:'', text:'Your fire damage ignores resistance, and each damage die of 1 counts as a 2.' },
      { op:'add', targets:[{ kind:'tag', value:'fire_damage' }], label:'Adept fire bonus', when:'', ask:'', amount:'1', byLevel:blankArr() }
    ] },
  { id:'ember_ward', folder:'fl_draft', name:'Ember Ward', source:'background', detail:'Ashfall survivor \u2014 DRAFT', icon:'fa-shield-halved', color:'#e2b021', activation:'reaction',
    summary:'Spend a charge to shrug off fire.',
    desc:'',
    maxUses:'', reset:'Long rest', tags:['fire_damage'],
    vars:[ { name:'ward_charges', kind:'stored', type:'number', scope:'dm', init:'3', label:'Ward charges' },
           { name:'', kind:'derived', type:'', scope:'dm', formula:'', init:'', label:'' } ],
    effects:[
      { op:'resist', targets:[{ kind:'tag', value:'fire_damge' }], label:'', when:'ward_charges > 0', ask:'' },
      { op:'addVar', targets:[], label:'Burn a charge', when:'', ask:'Spend a ward charge?', variable:'charges', delta:'-1' }
    ] }
];

/* ---- state ---- */
let selId = 'second_wind';
let draft = null;
let dirty = false;
let helpOn = false;
let query = '';
let open = { vars:false, effects:false };
let openEffect = null;   /* index of the one expanded effect node */
let moreOps = false;     /* palette overflow revealed */
let openFolders = { fl_fighter:true, fl_ancestry:true, fl_feats:true, fl_draft:true };
let tagAcOpen = false;

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const norm = s => String(s || '').toLowerCase().trim().replace(/\s+/g,'_').replace(/[^a-z0-9_.\-]/g,'');
const clone = o => JSON.parse(JSON.stringify(o));
const IDENT = /^[a-z_][a-z0-9_]*$/;

function allTags() {
  const set = new Set();
  FEATURES.forEach(f => (f.tags || []).forEach(t => set.add(t)));
  THINGS.forEach(t => t.tags.forEach(x => set.add(x)));
  return [...set].sort();
}
function tagUse(t) {
  return THINGS.filter(x => x.tags.includes(t)).length;
}
function thingName(id) { const t = THINGS.find(x => x.id === id); return t ? t.name : null; }

/* ---- selector resolution — the match count ---- */
function selMatch(sel) {
  if (sel.kind === 'thing') return thingName(sel.value) ? 1 : 0;
  if (sel.kind === 'tag') { const t = norm(sel.value); return t ? THINGS.filter(x => x.tags.includes(t)).length : 0; }
  const v = norm((sel.value || '').replace(/^roll:/,''));
  return v ? ROLLS.filter(r => r === v || r.indexOf(v + '.') === 0).length : 0;
}
function targetSummary(ef) {
  const ts = ef.targets || [];
  if (!ts.length) return { own:true, text:'this node\u2019s own roll' };
  let things = 0, rolls = 0;
  ts.forEach(s => { const n = selMatch(s); if (s.kind === 'roll') rolls += n; else things += n; });
  const parts = [];
  if (things || !rolls) parts.push('targets ' + things + ' thing' + (things === 1 ? '' : 's'));
  if (rolls) parts.push(rolls + ' roll kind' + (rolls === 1 ? '' : 's'));
  return { own:false, zero:(things + rolls) === 0, text:parts.join(' \u00b7 ') };
}

/* ---- audit — same severity vocabulary as the Lattice Audit ---- */
function auditFeature(f) {
  const out = [];
  if (!String(f.name || '').trim()) out.push({ s:'err', t:'Unnamed feature', d:'A feature needs a name before it can be granted.' });
  if (!String(f.summary || '').trim()) out.push({ s:'warn', t:'No summary line', d:'The collapsed card in play will have nothing to scan.' });
  if (!String(f.desc || '').trim()) out.push({ s:'warn', t:'No player-facing prose', d:'The expanded card will be empty.' });
  if (String(f.maxUses || '').trim() && !String(f.reset || '').trim()) out.push({ s:'warn', t:'Uses never reset', d:'Max uses is set but no reset was chosen.' });
  const names = [];
  (f.vars || []).forEach((v, i) => {
    const n = String(v.name || '').trim();
    if (!n) out.push({ s:'err', t:'Variable ' + (i + 1) + ' unnamed', d:'Every variable needs an identifier.' });
    else {
      if (!IDENT.test(n)) out.push({ s:'warn', t:'Odd identifier \u00b7 ' + n, d:'Use lowercase letters, digits and underscores.' });
      if (names.indexOf(n) >= 0) out.push({ s:'err', t:'Duplicate variable \u00b7 ' + n, d:'Two variables share one name; formulas cannot resolve it.' });
      names.push(n);
    }
    if (v.kind === 'derived' && !String(v.formula || '').trim()) out.push({ s:'err', t:'Derived variable has no formula', d:(n || 'variable ' + (i + 1)) + ' is derived but its formula is empty.' });
    if (v.kind === 'stored' && !v.type) out.push({ s:'err', t:'Stored variable has no type', d:(n || 'variable ' + (i + 1)) + ' needs Number or Boolean.' });
  });
  (f.effects || []).forEach((ef, i) => {
    const cfg = OPS[ef.op] || { fields:[] };
    const tag = (ef.op || '?') + ' \u00b7 node ' + (i + 1);
    if (!String(ef.label || '').trim()) out.push({ s:'err', t:'Node ' + (i + 1) + ' has no label', d:'Label is required \u2014 it is what the player sees in the roll breakdown.' });
    cfg.fields.forEach(fd => {
      if (!fd.required) return;
      const val = ef[fd.key];
      if (fd.type === 'array') return;
      if (val == null || String(val).trim() === '') out.push({ s:'err', t:tag + ' \u00b7 ' + fd.label.toLowerCase() + ' empty', d:'Required by the ' + ef.op + ' schema.' });
      if (fd.type === 'reference' && fd.ref === 'variable' && val && names.indexOf(String(val)) < 0)
        out.push({ s:'err', t:tag + ' \u00b7 unknown variable', d:'"' + val + '" is not declared in this feature.' });
    });
    (ef.targets || []).forEach(sel => {
      const n = selMatch(sel);
      if (n === 0 && String(sel.value || '').trim()) {
        if (sel.kind === 'tag') out.push({ s:'warn', t:tag + ' \u00b7 tag matches nothing', d:'tag:' + norm(sel.value) + ' resolves to 0 things. Typo, or a tag nothing carries yet.' });
        else if (sel.kind === 'roll') out.push({ s:'warn', t:tag + ' \u00b7 unknown roll kind', d:'roll:' + norm(sel.value) + ' is not a roll the app raises.' });
        else out.push({ s:'err', t:tag + ' \u00b7 broken reference', d:'The referenced thing is no longer in the catalog.' });
      }
      if (n === 0 && !String(sel.value || '').trim()) out.push({ s:'warn', t:tag + ' \u00b7 empty selector', d:'A selector row with no value matches nothing. Remove it, or fill it in.' });
    });
  });
  if (!out.length) out.push({ s:'ok', t:'Clean', d:'No errors, no warnings. Save writes the template.' });
  return out;
}
const errCount = f => auditFeature(f).filter(a => a.s === 'err').length;
const hasErr = f => errCount(f) > 0;

/* ---- search: plain text vs selector query ---- */
function parseQuery(q) {
  const s = String(q || '').trim();
  const m = /^(tag|roll):(.*)$/i.exec(s);
  if (m) return { mode:m[1].toLowerCase(), value:norm(m[2]) };
  return { mode:'text', value:s.toLowerCase() };
}
function featMatches(f, pq) {
  if (!pq.value && pq.mode === 'text') return { hit:true };
  if (pq.mode === 'text') {
    const v = pq.value;
    if (String(f.name).toLowerCase().indexOf(v) >= 0) return { hit:true };
    if ((f.tags || []).some(t => t.indexOf(v) >= 0)) return { hit:true, via:'tag ' + v };
    return { hit:false };
  }
  let n = 0;
  (f.effects || []).forEach(ef => (ef.targets || []).forEach(sel => {
    if (pq.mode === 'tag' && sel.kind === 'tag' && norm(sel.value) === pq.value) n++;
    if (pq.mode === 'roll' && sel.kind === 'roll' && norm(sel.value).indexOf(pq.value) === 0) n++;
  }));
  if (n) return { hit:true, via:n + ' target' + (n === 1 ? '' : 's') };
  if (pq.mode === 'tag' && (f.tags || []).indexOf(pq.value) >= 0) return { hit:true, via:'carries tag' };
  return { hit:false };
}

/* ============================ RENDER: LEFT LIST ========================== */
function renderList() {
  const pq = parseQuery(query);
  const isSel = pq.mode !== 'text';
  $('#srchWrap').classList.toggle('sel', isSel);
  $('#srchHint').classList.toggle('sel', isSel);
  $('#srchClr').style.display = query ? 'block' : 'none';
  $('#srchIcon').className = isSel ? 'fa-solid fa-crosshairs' : 'fa-solid fa-magnifying-glass';
  $('#srchHint').innerHTML = isSel
    ? '<i class="fa-solid fa-crosshairs"></i><span>Selector query \u2014 matching features whose <b>effects target</b> ' + esc(pq.mode) + ':' + esc(pq.value || '\u2026') + '</span>'
    : '<i class="fa-solid fa-circle-info"></i><span>Plain text matches names. <b>tag:</b> or <b>roll:</b> matches what effects target. <b>Drag</b> a feature into a folder to refile it.</span>';

  let html = '', shown = 0;
  FOLDERS.forEach(fl => {
    const rows = FEATURES.map((f, i) => ({ f, i, m:featMatches(f, pq) })).filter(o => o.f.folder === fl.id && o.m.hit);
    if (!rows.length && (query || FEATURES.some(f => f.folder === fl.id))) return;
    shown += rows.length;
    const isOpen = openFolders[fl.id] !== false || isSel;
    html += '<div class="fold" data-fold="' + fl.id + '"><button class="fold-head' + (isOpen ? '' : ' closed') + '" data-a="fold" data-f="' + fl.id + '">' +
      '<i class="fa-solid fa-chevron-down ch"></i><i class="fa-solid fa-folder fi"></i>' +
      '<span class="ft">' + esc(fl.name) + '</span><span class="fc">' + rows.length + '</span></button>';
    if (isOpen) {
      html += '<div class="fold-rows">' + (rows.length ? rows.map(({ f, m }) => {
        const bad = hasErr(f);
        return '<button class="frow' + (f.id === selId ? ' sel' : '') + '" draggable="true" data-a="sel" data-id="' + f.id + '" style="--fc:' + (f.color || '#d4bf7d') + '">' +
          '<span class="fr-ic"><i class="fa-solid ' + esc(f.icon || 'fa-star') + '"></i></span>' +
          '<span class="fr-tx"><span class="fr-n">' + esc(f.name || 'Untitled') + '</span>' +
          '<span class="fr-m"><span class="fr-src">' + esc(SOURCES[f.source] || f.source) + '</span>' +
          (m.via ? '<span class="fr-src fr-hit">' + esc(m.via) + '</span>' : '') +
          (hasDraft(f.id) ? '<span class="fr-src fr-drf">draft</span>' : '') + '</span></span>' +
          '<span class="fr-dot' + (bad ? ' err' : '') + '" title="' + (bad ? 'Unresolved audit errors' : '') + '"></span></button>';
      }).join('') : '<div class="fl-none" style="padding:12px 8px">Empty folder</div>') + '</div>';
    }
    html += '</div>';
  });
  if (!shown) html = '<div class="fl-none">No match' + (isSel ? '<br><span style="color:#6c6449">nothing targets ' + esc(pq.mode + ':' + pq.value) + '</span>' : '') + '</div>';
  $('#folders').innerHTML = html;
  $('#listCount').textContent = FEATURES.length;
}

/* ============================ RENDER: AUDIT ============================== */
function renderAudit() {
  const items = draft ? auditFeature(draft) : [];
  const e = items.filter(i => i.s === 'err').length, w = items.filter(i => i.s === 'warn').length;
  $('#auditN').textContent = e || w ? (e + ' err \u00b7 ' + w + ' warn') : 'clean';
  $('#audit').innerHTML = items.map(i =>
    '<div class="audit-item ' + i.s + '"><i class="fa-solid ' + (i.s === 'err' ? 'fa-circle-exclamation' : i.s === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check') + '"></i>' +
    '<span class="ai-tx"><span class="ai-t">' + esc(i.t) + '</span><span class="ai-s">' + esc(i.d) + '</span></span></div>').join('');

  const st = $('#valStatus');
  st.className = 'status' + (e ? ' bad' : w ? ' warn' : '');
  $('#valText').textContent = e ? (e + ' error' + (e === 1 ? '' : 's') + ' \u2014 invalid \u00b7 publish blocked')
    : w ? (w + ' warning' + (w === 1 ? '' : 's') + ' \u2014 valid \u00b7 publishable')
    : (draft ? 'Draft valid \u00b7 publishable' : 'Feature clean');
  $('#saveBtn').disabled = e > 0 || !draft;
  $('#revertBtn').disabled = !draft || !dirty;
  $('#statIssues').textContent = FEATURES.reduce((n, f) => n + errCount(f), 0);
  $('#statIssues').className = 'v' + (FEATURES.some(hasErr) ? ' warn' : '');
  $('#statFeats').textContent = FEATURES.length;
  $('#statNodes').textContent = FEATURES.reduce((n, f) => n + (f.effects || []).length, 0);
  $('#dirty').classList.toggle('on', dirty);
}

/* ====================== RENDER: SCHEMA FIELD TYPES ======================= */
function helpHtml(fd) {
  return '<div class="hlp"><span class="d">' + esc(fd.desc || '') + '</span>' +
    (fd.example ? '<span class="e"><b>e.g.</b>' + esc(fd.example) + '</span>' : '') + '</div>';
}
function fieldHtml(fd, val, ei, vars) {
  const id = 'data-a="fld" data-e="' + ei + '" data-k="' + fd.key + '"';
  const lab = '<span class="field-lab">' + esc(fd.label) + (fd.required ? '<span class="req">*</span>' : '') +
    ' <span style="color:#5f5741;letter-spacing:.14em">' + fd.type + '</span></span>';
  let ctl = '';
  if (fd.type === 'formula')
    ctl = '<input class="in" ' + id + ' value="' + esc(val) + '" placeholder="' + esc(fd.example || '') + '" spellcheck="false">';
  else if (fd.type === 'text')
    ctl = '<textarea class="prose" style="min-height:70px;font-family:var(--font-prose);font-size:15px" ' + id + ' placeholder="' + esc(fd.example || '') + '">' + esc(val) + '</textarea>';
  else if (fd.type === 'enum')
    ctl = '<select class="in" ' + id + '>' + fd.options.map(o => '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  else if (fd.type === 'boolean')
    ctl = '<div class="bfield' + (val ? ' on' : '') + '" ' + id + '><span class="bx"><i class="fa-solid fa-check"></i></span><label>' + esc(fd.label) + '</label></div>';
  else if (fd.type === 'reference' && fd.ref === 'variable') {
    const opts = ['<option value="">\u2014 pick a variable \u2014</option>'].concat(vars.filter(v => v.name).map(v =>
      '<option value="' + esc(v.name) + '"' + (v.name === val ? ' selected' : '') + '>' + esc(v.name) + (v.label ? '  \u00b7  ' + esc(v.label) : '') + '</option>'));
    if (val && !vars.some(v => v.name === val)) opts.push('<option value="' + esc(val) + '" selected>' + esc(val) + '  \u00b7  UNDECLARED</option>');
    ctl = '<select class="in' + (val && !vars.some(v => v.name === val) ? ' bad' : '') + '" ' + id + '>' + opts.join('') + '</select>';
  } else if (fd.type === 'reference') {
    const nm = (EFFECT_LIB.find(x => x.id === val) || {}).name;
    ctl = '<select class="in" ' + id + '><option value="">\u2014 pick an effect \u2014</option>' +
      EFFECT_LIB.map(x => '<option value="' + x.id + '"' + (x.id === val ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>';
    if (nm) { /* name shown, id stored */ }
  } else if (fd.type === 'array') {
    const arr = Array.isArray(val) ? val : blankArr();
    const filled = arr.filter((x, i) => i > 0 && String(x).trim()).length;
    ctl = '<div class="arr"><div class="arr-grid">' + arr.map((x, i) =>
      '<div class="arr-slot' + (i === 0 ? ' zero' : '') + '"><span class="ix">' + i + '</span>' +
      '<input ' + (i === 0 ? 'disabled value="\u2014"' : 'data-a="arr" data-e="' + ei + '" data-k="' + fd.key + '" data-i="' + i + '" value="' + esc(x) + '"') + '></div>').join('') +
      '</div><div class="arr-note"><i class="fa-solid fa-hashtag"></i>21 slots \u00b7 <b>index 0 unused</b> \u00b7 levels 1\u201320 \u00b7 ' + filled + ' filled' +
      (filled ? ' \u00b7 overrides Amount' : '') + '</div></div>';
  }
  return lab + helpHtml(fd) + ctl;
}

/* ====================== RENDER: TARGETS + WHEN/ASK ====================== */
const KINDS = [
  { k:'thing', ic:'fa-crosshairs', l:'Thing' },
  { k:'tag', ic:'fa-tag', l:'Tag' },
  { k:'roll', ic:'fa-dice-d20', l:'Roll kind' }
];
function targetRow(sel, ei, ti) {
  const n = selMatch(sel);
  let val;
  if (sel.kind === 'thing') {
    const nm = thingName(sel.value);
    val = '<button class="pickbtn' + (nm ? '' : ' none') + '" data-a="pick" data-e="' + ei + '" data-t="' + ti + '">' +
      (nm ? esc(nm) + '<span class="k">' + esc((THINGS.find(x => x.id === sel.value) || {}).kind || '') + '</span>'
          : '<i class="fa-solid fa-magnifying-glass"></i> Search the catalog\u2026') + '</button>';
  } else if (sel.kind === 'tag') {
    val = '<span class="pfx">tag:</span><input data-a="tval" data-e="' + ei + '" data-t="' + ti + '" value="' + esc(sel.value) + '" placeholder="fire_damage" spellcheck="false" list="tagList">';
  } else {
    val = '<span class="pfx">roll:</span><select data-a="tval" data-e="' + ei + '" data-t="' + ti + '">' +
      '<option value="">\u2014 pick \u2014</option>' + ROLLS.map(r => '<option value="' + r + '"' + (r === norm(sel.value) ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>';
  }
  return '<div class="tgt k-' + sel.kind + '"><span class="seg tiny kseg">' + KINDS.map(K =>
      '<button class="' + (K.k === sel.kind ? 'on ' + K.k : '') + '" data-a="tkind" data-e="' + ei + '" data-t="' + ti + '" data-kind="' + K.k + '" title="' + K.l + '"><i class="fa-solid ' + K.ic + '"></i> ' + K.l + '</button>').join('') +
    '</span><span class="tval">' + val + '</span>' +
    '<span class="n' + (n === 0 ? ' zero' : '') + '" data-n="' + ei + '-' + ti + '">' + n + ' match' + (n === 1 ? '' : 'es') + '</span>' +
    '<i class="fa-solid fa-xmark dx" data-a="deltgt" data-e="' + ei + '" data-t="' + ti + '"></i></div>';
}
function targetsHtml(ef, ei) {
  const sum = targetSummary(ef);
  const cls = sum.own ? ' own' : sum.zero ? ' zero' : '';
  return '<div class="subsec"><span class="sl">Target</span><span class="qm" data-a="help" data-h="target">?</span>' +
    '<span class="cnt' + cls + '" data-sum="' + ei + '"><i class="fa-solid ' + (sum.own ? 'fa-arrow-turn-down' : 'fa-crosshairs') + '"></i>' + esc(sum.text) + '</span></div>' +
    (ef.targets || []).map((s, ti) => targetRow(s, ei, ti)).join('') +
    (!(ef.targets || []).length ? '<div class="tgt-own"><i class="fa-solid fa-arrow-turn-down"></i><span>No selectors \u2014 this node applies to its own roll. Add one to reach out at other things. Multiple selectors are OR.</span></div>' : '') +
    '<button class="addmini" data-a="addtgt" data-e="' + ei + '"><i class="fa-solid fa-plus"></i> Add selector</button>';
}
function waHtml(ef, ei) {
  return '<div class="wa when"><span class="tagl"><span class="k"><i class="fa-solid fa-code-branch"></i> when</span><span class="who">formula \u00b7 the app decides</span></span>' +
    '<input data-a="fld" data-e="' + ei + '" data-k="when" value="' + esc(ef.when) + '" placeholder="hp &lt; maxHp / 2" spellcheck="false">' +
    '<span class="qm" data-a="help" data-h="when">?</span></div>' +
    '<div class="wa ask"><span class="tagl"><span class="k"><i class="fa-regular fa-square-check"></i> ask</span><span class="who">prose \u00b7 a human decides</span></span>' +
    '<span class="askbox"><i class="fa-regular fa-square"></i></span>' +
    '<input data-a="fld" data-e="' + ei + '" data-k="ask" value="' + esc(ef.ask) + '" placeholder="No checkbox \u2014 applies on its own">' +
    '<span class="qm" data-a="help" data-h="ask">?</span></div>';
}

/* collapsed effect node: one scannable row */
function selLabel(sel) {
  if (sel.kind === 'thing') return thingName(sel.value) || '?';
  if (sel.kind === 'tag') return 'tag:' + (norm(sel.value) || '?');
  return 'roll:' + (norm(sel.value) || '?');
}
function opValueBit(ef) {
  const v = k => String(ef[k] == null ? '' : ef[k]).trim();
  switch (ef.op) {
    case 'add': {
      const byL = Array.isArray(ef.byLevel) && ef.byLevel.some((x, i) => i > 0 && String(x).trim());
      return byL ? 'by level' : (v('amount') ? '+' + v('amount') : '');
    }
    case 'heal': case 'tempHp': return v('amount');
    case 'crit': return v('threshold') ? 'on ' + v('threshold') + '+' : '';
    case 'note': { const t = v('text'); return t.length > 46 ? t.slice(0, 46) + '\u2026' : t; }
    case 'grantEffect': { const e = (EFFECT_LIB.find(x => x.id === ef.effect) || {}).name; return [e, v('duration')].filter(Boolean).join(' \u00b7 '); }
    case 'setVar': return v('variable') ? v('variable') + ' = ' + (v('value') || '?') : '';
    case 'addVar': return v('variable') ? v('variable') + ' ' + (v('delta') || '?') : '';
    default: return '';
  }
}
function effectRow(ef, ei, cfg, badLab) {
  const ts = ef.targets || [];
  const tgt = ts.length ? ts.map(selLabel).join(' | ') : 'own roll';
  const val = opValueBit(ef);
  const flags = [];
  if (String(ef.when || '').trim()) flags.push('when');
  if (String(ef.ask || '').trim()) flags.push('ask');
  return '<div class="efrow' + (cfg.group === 'activation' ? ' act' : '') + (badLab ? ' bad' : '') + '" data-a="efopen" data-e="' + ei + '">' +
    '<i class="fa-solid fa-chevron-right ch"></i>' +
    '<span class="gl"><i class="fa-solid ' + (cfg.icon || 'fa-circle') + '"></i></span>' +
    '<span class="op">' + esc(cfg.label) + '</span>' +
    '<span class="lab' + (badLab ? ' miss' : '') + '">' + (badLab ? 'no label' : esc(ef.label)) + '</span>' +
    '<span class="sum">' + (val ? '<span class="v">' + esc(val) + '</span><span class="sep">\u00b7</span>' : '') +
    '<span class="tg' + (ts.length ? '' : ' own') + '">' + esc(tgt) + '</span>' +
    (flags.length ? '<span class="sep">\u00b7</span><span class="fl">' + flags.join(' + ') + '</span>' : '') + '</span>' +
    '<i class="fa-solid fa-trash dx" data-a="deleff" data-e="' + ei + '"></i></div>';
}

/* ============================ RENDER: EDITOR ============================ */
function renderEditor() {
  const d = draft;
  const box = $('#edit');
  box.classList.toggle('helpon', helpOn);
  const hb = $('#helpBtn'); if (hb) hb.classList.toggle('on', helpOn);
  if (!d) {
    box.innerHTML = '<div class="insp-empty"><div class="ic-big"><i class="fa-solid fa-diagram-project"></i></div>' +
      '<div class="t">No Feature Selected</div><div class="d">Pick a feature from the list, or start a new one.</div></div>';
    $('#editMeta').innerHTML = '<span class="idtag"><span class="k">Id</span><span class="v pend">—</span></span>';
    return;
  }
  $('#editMeta').innerHTML = '<span class="idtag"><i class="fa-solid fa-lock lk"></i><span class="k">Id</span>' +
    (d.id ? '<span class="v">' + esc(d.id) + '</span>' : '<span class="v pend">on first publish</span>') +
    '<button class="idq" data-a="idhelp" title="Why the id never changes">?</button></span>';
  const hc = d.color || '#d4bf7d', head = $('#edHead');
  head.style.background = 'linear-gradient(90deg,' + hc + '22, ' + hc + '0a 55%, transparent)';
  head.style.borderBottomColor = hc + '66';
  head.querySelector('.rh-num').style.color = hc;

  /* --- 01 identity: always visible, always sufficient --- */
  let h = '';
  h += '<div class="sec"><span class="num">01</span><span class="field-lab">Identity</span></div>';
  h += '<div class="namerow"><div><span class="field-lab">Name<span class="req">*</span></span>' +
    '<input class="in name" data-a="top" data-k="name" value="' + esc(d.name) + '" placeholder="Name the feature\u2026"></div>' +
    '<div><span class="field-lab">Icon</span><button class="nbtn" data-a="iconpick" style="--nc:' + esc(d.color || '#d4bf7d') + '" title="Pick an icon"><i class="fa-solid ' + esc(d.icon || 'fa-star') + '"></i></button></div>' +
    '<div><span class="field-lab">Colour</span><button class="cbtn" data-a="colorpick" style="--nc:' + esc(d.color || '#d4bf7d') + '" title="Pick a colour"><span class="d"></span></button></div></div>';
  h += '<div class="grid3"><div><span class="field-lab">Source</span><select class="in" data-a="topsel" data-k="source">' +
    Object.keys(SOURCES).map(k => '<option value="' + k + '"' + (k === d.source ? ' selected' : '') + '>' + SOURCES[k] + '</option>').join('') +
    '</select></div><div><span class="field-lab">Source detail</span><input class="in" data-a="top" data-k="detail" value="' + esc(d.detail) + '" placeholder="Fighter 1"></div>' +
    '<div><span class="field-lab">Folder</span><select class="in" data-a="topsel" data-k="folder">' +
    FOLDERS.map(fl => '<option value="' + fl.id + '"' + (fl.id === d.folder ? ' selected' : '') + '>' + esc(fl.name) + '</option>').join('') + '</select></div></div>';
  h += '<div class="sec"><span class="field-lab">Summary</span><span class="facing"><i class="fa-solid fa-eye"></i> Player-facing</span></div>' +
    '<input class="in sumline" data-a="top" data-k="summary" value="' + esc(d.summary || '') + '" placeholder="One line \u2014 what the player reads while scanning the card\u2026" maxlength="120">' +
    '<div class="sub-hint">One line, on the collapsed card in play.</div>' +
    '<div class="sec"><span class="field-lab">Description</span><span class="facing"><i class="fa-solid fa-eye"></i> Player-facing</span></div>' +
    '<textarea class="prose" data-a="top" data-k="desc" placeholder="The full prose the player reads when the card is expanded\u2026">' + esc(d.desc) + '</textarea>' +
    '<div class="sub-hint">The detail, on the expanded card.</div>';
  const act = ACTIVATIONS[d.activation] || ACTIVATIONS.none;
  h += '<div class="grid2"><div><span class="field-lab">Activation <span style="color:#5f5741;letter-spacing:.14em">enum</span></span>' +
    '<select class="in" data-a="topsel" data-k="activation">' +
    ACT_ORDER.map(k => '<option value="' + k + '"' + (k === (d.activation || 'none') ? ' selected' : '') + '>' + esc(ACTIVATIONS[k].label) + '</option>').join('') +
    '</select></div><div></div></div>';
  h += '<div class="act-note" style="--an:' + act.color + '"><i class="fa-solid ' + act.icon + '"></i><span>' + esc(act.note) + '</span></div>';
  h += '<div class="grid2" style="margin-bottom:2px"><div><span class="field-lab">Max uses <span style="color:#5f5741;letter-spacing:.14em">formula</span></span>' +
    '<input class="in" data-a="top" data-k="maxUses" value="' + esc(d.maxUses) + '" placeholder="blank = at-will"></div>' +
    '<div><span class="field-lab">Resets on</span><select class="in" data-a="topsel" data-k="reset">' +
    RESETS.map(r => '<option' + (r === d.reset ? ' selected' : '') + '>' + esc(r) + '</option>').join('') + '</select></div></div>';
  h += '<div class="act-note" style="--an:var(--beige-dim);margin-top:-2px"><i class="fa-solid fa-rotate"></i><span>Uses are independent of activation \u2014 <b>blank means at-will</b>, and a passive feature can still track uses.</span></div>';

  /* --- 02 tags --- */
  h += '<div class="sec"><span class="num">02</span><span class="field-lab">Tags</span></div>';
  h += '<div class="chips">' + ((d.tags || []).length
    ? d.tags.map((t, i) => '<span class="chip">' + esc(t) + ' <i class="fa-solid fa-xmark x" data-a="deltag" data-i="' + i + '"></i></span>').join('')
    : '<span class="chip empty">no tags</span>') + '</div>';
  h += '<div class="tagbox"><input class="in" id="tagIn" placeholder="Add a tag \u2014 lowercased on save" autocomplete="off" spellcheck="false"><div class="ac" id="tagAc"></div></div>';

  /* --- 03 variables (collapsed) --- */
  const vErr = (d.vars || []).some((v, i) => !String(v.name || '').trim() || (v.kind === 'derived' && !String(v.formula || '').trim()));
  h += '<div class="blk' + (open.vars ? ' open' : '') + '"><button class="blk-head" data-a="blk" data-b="vars">' +
    '<i class="fa-solid fa-chevron-right ch"></i><span class="bnum">03</span><span class="bt">Variables</span>' +
    '<span class="bs">' + (open.vars ? 'state this feature carries' : 'optional \u00b7 leave closed for prose features') + '</span>' +
    '<span class="bcount' + (vErr ? ' bad' : (d.vars || []).length ? ' hot' : '') + '">' + (d.vars || []).length + '</span></button><div class="blk-body">';
  h += '<div class="blk-optin"><i class="fa-solid fa-circle-info"></i><span>Only needed when an effect must read or write state. Stored variables are saved on the character; derived ones are recomputed from a formula on every read.</span></div>';
  (d.vars || []).forEach((v, vi) => {
    const stored = v.kind !== 'derived';
    h += '<div class="card' + (!String(v.name || '').trim() ? ' err' : '') + '"><div class="card-head">' +
      '<input class="vname" data-a="var" data-v="' + vi + '" data-k="name" value="' + esc(v.name) + '" placeholder="identifier" spellcheck="false">' +
      '<span class="seg"><button class="' + (stored ? 'on' : '') + '" data-a="vkind" data-v="' + vi + '" data-kind="stored"><i class="fa-solid fa-database"></i> Stored</button>' +
      '<button class="' + (stored ? '' : 'on') + '" data-a="vkind" data-v="' + vi + '" data-kind="derived"><i class="fa-solid fa-function"></i> Derived</button></span>' +
      '<i class="fa-solid fa-trash dx" data-a="delvar" data-v="' + vi + '"></i></div>';
    if (stored) {
      h += '<div class="kindnote">Stored \u2014 written on the character sheet and read back. Needs a type.</div>';
      h += '<div class="grid2"><div><span class="field-lab">Type<span class="req">*</span> <span style="color:#5f5741;letter-spacing:.14em">enum</span></span>' +
        '<select class="in' + (v.type ? '' : ' bad') + '" data-a="var" data-v="' + vi + '" data-k="type"><option value=""' + (v.type ? '' : ' selected') + '>\u2014 required \u2014</option>' +
        '<option value="number"' + (v.type === 'number' ? ' selected' : '') + '>Number</option><option value="boolean"' + (v.type === 'boolean' ? ' selected' : '') + '>Boolean</option></select></div>' +
        '<div><span class="field-lab">Initial value <span style="color:#5f5741;letter-spacing:.14em">formula</span></span>' +
        '<input class="in" data-a="var" data-v="' + vi + '" data-k="init" value="' + esc(v.init) + '" placeholder="optional \u2014 e.g. 0"></div></div>';
      const dmOnly = v.scope === 'dm';
      h += '<div class="perm' + (dmOnly ? '' : ' player') + '"><i class="fa-solid ' + (dmOnly ? 'fa-lock' : 'fa-user-pen') + '"></i>' +
        '<span><span class="pt">' + (dmOnly ? 'DM-only' : 'Player-writable') + '</span><br><span class="ps">' +
        (dmOnly ? 'permission \u00b7 hidden from the player sheet, only this console writes it' : 'permission \u00b7 the player can change this from their sheet') + '</span></span>' +
        '<span class="seg tiny"><button class="' + (dmOnly ? '' : 'on cy') + '" data-a="vscope" data-v="' + vi + '" data-scope="player">Player</button>' +
        '<button class="' + (dmOnly ? 'on' : '') + '" data-a="vscope" data-v="' + vi + '" data-scope="dm"><i class="fa-solid fa-lock"></i> DM-only</button></span></div>';
    } else {
      h += '<div class="kindnote">Derived \u2014 never stored. Its type comes from the formula, so there is no type to pick.</div>';
      h += '<span class="field-lab">Formula<span class="req">*</span> <span style="color:#5f5741;letter-spacing:.14em">formula</span></span>' +
        '<input class="in' + (String(v.formula || '').trim() ? '' : ' bad') + '" data-a="var" data-v="' + vi + '" data-k="formula" value="' + esc(v.formula || '') + '" placeholder="floor(level / 4) + 1" spellcheck="false">';
    }
    h += '<span class="field-lab">Display label <span style="color:#5f5741;letter-spacing:.14em">text</span></span>' +
      '<input class="in" data-a="var" data-v="' + vi + '" data-k="label" value="' + esc(v.label) + '" placeholder="optional \u2014 what the sheet calls it" style="margin-bottom:2px"></div>';
  });
  h += '<button class="addbtn" data-a="addvar"><i class="fa-solid fa-plus"></i> Add variable</button></div></div>';

  /* --- 04 effects (collapsed) --- */
  const eErr = (d.effects || []).some(ef => !String(ef.label || '').trim());
  h += '<div class="blk' + (open.effects ? ' open' : '') + '"><button class="blk-head" data-a="blk" data-b="effects">' +
    '<i class="fa-solid fa-chevron-right ch"></i><span class="bnum">04</span><span class="bt">Effects</span>' +
    '<span class="bs">' + (open.effects ? 'contributions this feature makes' : 'optional \u00b7 prose-only features need none') + '</span>' +
    '<span class="bcount' + (eErr ? ' bad' : (d.effects || []).length ? ' hot' : '') + '">' + (d.effects || []).length + '</span></button><div class="blk-body">';
  h += '<div class="blk-optin"><i class="fa-solid fa-circle-info"></i><span>One op per node, collapsed by default \u2014 each row says what it does and where it goes. Click a row to edit it. Pick an op below to add a node.</span></div>';
  h += '<div class="oppal"><div class="oppal-grp"><span class="gl">Contributions</span></div><div class="oppal-row">' +
    PAL_CONTRIB.map(o => '<button class="opb" data-a="addop" data-op="' + o + '"><i class="fa-solid fa-plus"></i>' + esc(OP_TITLE[o]) + '</button>').join('') +
    (moreOps ? PAL_CONTRIB_MORE.map(o => '<button class="opb" data-a="addop" data-op="' + o + '"><i class="fa-solid fa-plus"></i>' + esc(OP_TITLE[o]) + '</button>').join('')
      : '<button class="opb more" data-a="moreops"><i class="fa-solid fa-ellipsis"></i>More</button>') +
    '</div><div class="oppal-grp"><span class="gl act">Activation outcomes</span></div><div class="oppal-row">' +
    PAL_ACT.map(o => '<button class="opb act" data-a="addop" data-op="' + o + '"><i class="fa-solid fa-plus"></i>' + esc(OP_TITLE[o]) + '</button>').join('') +
    '</div></div>';
  (d.effects || []).forEach((ef, ei) => {
    const cfg = OPS[ef.op] || { label:ef.op, icon:'fa-question', blurb:'Unknown op \u2014 no schema entry.', fields:[] };
    const badLab = !String(ef.label || '').trim();
    if (openEffect !== ei) { h += effectRow(ef, ei, cfg, badLab); return; }
    h += '<div class="card' + (badLab ? ' err' : '') + '"><div class="card-head">' +
      '<i class="fa-solid fa-chevron-down ch" data-a="efopen" data-e="-1" style="font-size:9px;color:var(--amber);cursor:pointer"></i>' +
      '<span class="cix">NODE ' + String(ei + 1).padStart(2, '0') + '</span>' +
      '<span class="op-pick"><select class="op-sel" data-a="op" data-e="' + ei + '">' +
      OP_ORDER.map(o => '<option value="' + o + '"' + (o === ef.op ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></span>' +
      '<span class="grp-pill' + (cfg.group === 'activation' ? ' act' : '') + '"><i class="fa-solid ' + (cfg.group === 'activation' ? 'fa-bolt' : 'fa-infinity') + '"></i>' +
      (cfg.group === 'activation' ? 'Activation outcome' : 'Passive contribution') + '</span>' +
      '<i class="fa-solid fa-trash dx" data-a="deleff" data-e="' + ei + '"></i></div>';
    h += '<div class="op-blurb">' + esc(cfg.blurb) + '</div>';
    h += targetsHtml(ef, ei);
    if (cfg.fields.length) {
      h += '<div class="subsec"><span class="sl">' + esc(cfg.label) + ' parameters</span></div>';
      const wide = cfg.fields.filter(f => f.wide), narrow = cfg.fields.filter(f => !f.wide);
      if (narrow.length) h += '<div class="' + (narrow.length > 1 ? 'grid2' : '') + '">' + narrow.map(fd => '<div>' + fieldHtml(fd, ef[fd.key], ei, d.vars || []) + '</div>').join('') + '</div>';
      wide.forEach(fd => { h += fieldHtml(fd, ef[fd.key], ei, d.vars || []); });
    } else {
      h += '<div class="subsec"><span class="sl">' + esc(cfg.label) + ' parameters</span></div>' +
        '<div class="blk-optin" style="margin-bottom:12px"><i class="fa-solid fa-minus"></i><span>None \u2014 this op is fully described by its target list.</span></div>';
    }
    h += '<div class="subsec"><span class="sl">Statement</span></div>';
    h += '<span class="field-lab">Label<span class="req">*</span> <span style="color:#5f5741;letter-spacing:.14em">text</span></span>' +
      '<div class="hlp"><span class="d">What the player sees for this node in a roll breakdown. Required on every effect.</span><span class="e"><b>e.g.</b>Savage damage bonus</span></div>' +
      '<input class="in' + (String(ef.label || '').trim() ? '' : ' bad') + '" data-a="fld" data-e="' + ei + '" data-k="label" value="' + esc(ef.label) + '" placeholder="required \u2014 shown in the roll breakdown">';
    h += waHtml(ef, ei);
    h += '</div>';
  });
  h += '</div></div>';

  h += '<datalist id="tagList">' + allTags().map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>';
  box.innerHTML = h;
}

/* ============================== ACTIONS ================================= */
/* ---------------------------------------------------------------------------
   DRAFT / PUBLISH — same model as the shard editor. FEATURES holds the LIVE
   published templates; DRAFTS holds sandboxed edits, autosaved on every
   keystroke. Nothing a draft contains reaches a player until PUBLISH, which
   the audit blocks on errors. REVERT throws the draft away.
   --------------------------------------------------------------------------- */
const DRAFTS = {};
const NEW_KEY = '__new__';
const draftKey = () => selId || NEW_KEY;
function autosave() {
  if (!draft) return;
  DRAFTS[draftKey()] = clone(draft);
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  $('#autoSv').textContent = 'Draft autosaved ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function hasDraft(id) { return !!DRAFTS[id]; }
function touch() { dirty = true; autosave(); renderAudit(); renderList(); }
function selectFeature(id) {
  selId = id;
  const f = FEATURES.find(x => x.id === id);
  draft = DRAFTS[id] ? clone(DRAFTS[id]) : f ? clone(f) : null;
  openEffect = null;
  dirty = hasDraft(id);
  renderAll();
  $('#editScroll').scrollTop = 0;
}
function newFeature() {
  draft = { id:'', folder:FOLDERS[0].id, name:'', source:'class', detail:'', summary:'', desc:'', activation:'none', icon:'fa-star', color:'#d4bf7d',
    maxUses:'', reset:'Short rest', tags:[], vars:[], effects:[] };
  selId = null; dirty = true; open = { vars:false, effects:false }; openEffect = null;
  autosave();
  renderAll();
  $('#editScroll').scrollTop = 0;
}
function blankEffect(op) {
  const ef = { op:op, targets:[], label:'', when:'', ask:'' };
  (OPS[op] || { fields:[] }).fields.forEach(fd => { ef[fd.key] = fd.type === 'array' ? blankArr() : fd.type === 'boolean' ? false : fd.type === 'enum' ? fd.options[0] : ''; });
  return ef;
}
function addTag(raw) {
  const t = norm(raw);
  if (!t) return;
  draft.tags = draft.tags || [];
  if (draft.tags.indexOf(t) < 0) draft.tags.push(t);
  renderEditor(); touch();
  const inp = $('#tagIn'); if (inp) inp.focus();
}
function updateCounts(ei) {
  const ef = draft.effects[ei];
  (ef.targets || []).forEach((s, ti) => {
    const el = document.querySelector('[data-n="' + ei + '-' + ti + '"]');
    if (!el) return;
    const n = selMatch(s);
    el.textContent = n + ' match' + (n === 1 ? '' : 'es');
    el.className = 'n' + (n === 0 ? ' zero' : '');
  });
  const sum = targetSummary(ef), el = document.querySelector('[data-sum="' + ei + '"]');
  if (el) { el.className = 'cnt' + (sum.own ? ' own' : sum.zero ? ' zero' : ''); el.innerHTML = '<i class="fa-solid ' + (sum.own ? 'fa-arrow-turn-down' : 'fa-crosshairs') + '"></i>' + esc(sum.text); }
}
function toast(msg, bad) {
  const t = $('#toast');
  $('#toastTx').textContent = msg;
  t.className = 'toast on' + (bad ? ' badv' : '');
  t.querySelector('i').className = 'fa-solid ' + (bad ? 'fa-circle-exclamation' : 'fa-circle-check');
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast' + (bad ? ' badv' : ''); }, 2200);
}
function publishFeature() {
  if (!draft) return;
  if (hasErr(draft)) { toast('Publish blocked \u2014 resolve errors', true); return; }
  draft.tags = (draft.tags || []).map(norm).filter(Boolean);
  (draft.vars || []).forEach(v => { v.name = norm(v.name); });
  /* the id is generated ONCE, at first publish, and never again \u2014 other
     features target this one by id, so renaming must not touch it */
  const wasNew = !draft.id;
  if (wasNew) {
    let base = norm(draft.name) || ('feature_' + Date.now()), id = base, n = 2;
    while (FEATURES.some(f => f.id === id)) id = base + '_' + n++;
    draft.id = id;
  }
  draft.published = true;
  const i = FEATURES.findIndex(f => f.id === draft.id);
  if (i >= 0) FEATURES[i] = clone(draft); else FEATURES.push(clone(draft));
  delete DRAFTS[NEW_KEY]; delete DRAFTS[draft.id];
  selId = draft.id; dirty = false;
  $('#autoSv').textContent = '';
  renderAll(); toast('Published to players \u00b7 ' + draft.id);
}
function revertAsk() {
  if (!draft) return;
  const pub = FEATURES.find(f => f.id === selId);
  openPop('<div class="pop-head"><i class="fa-solid fa-rotate-left" style="color:var(--amber)"></i><span class="pt">Discard draft</span><i class="fa-solid fa-xmark px" data-a="closepop"></i></div>' +
    '<div class="pop-body"><div class="mono" style="margin-bottom:8px">' +
    (pub ? 'Every unpublished edit to <b style="color:var(--text)">' + esc(pub.name) + '</b> is thrown away and the editor reloads the published template. Players never saw the draft, so nothing about their sheets changes.'
         : 'This feature was never published \u2014 discarding the draft removes it entirely.') +
    '</div><div class="btnrow" style="display:flex;gap:8px">' +
    '<button class="btn danger" data-a="revyes" style="height:34px"><span class="bf"></span><span class="bi"><i class="fa-solid fa-rotate-left"></i> Discard draft</span></button>' +
    '<button class="btn ghost" data-a="closepop" style="height:34px"><span class="bf"></span><span class="bi">Keep editing</span></button></div></div>', 'small');
}
function revertDraft() {
  closePop();
  const key = draftKey();
  delete DRAFTS[key];
  $('#autoSv').textContent = '';
  if (selId) { selectFeature(selId); toast('Draft discarded \u00b7 published version restored'); }
  else { draft = null; dirty = false; renderAll(); toast('Draft discarded'); }
}

/* ============================== POPOVERS ================================ */
function openPop(html, cls) {
  $('#pop').className = 'pop' + (cls ? ' ' + cls : '');
  $('#pop').innerHTML = html;
  $('#scrim').classList.add('on');
}
function closePop() { $('#scrim').classList.remove('on'); }
function helpPop(kind) {
  const H = kind === 'when' ? HELP_WHEN : kind === 'ask' ? HELP_ASK : HELP_TARGET;
  openPop('<div class="pop-head"><i class="fa-regular fa-circle-question" style="color:var(--cyan-hot)"></i><span class="pt">' + H.t + '</span><i class="fa-solid fa-xmark px" data-a="closepop"></i></div>' +
    '<div class="pop-body">' + H.b + '</div>', 'small');
}
let pickCtx = null;
function iconPicker(q) {
  const v = String(q || '').toLowerCase().trim();
  const rows = ICONS.filter(i => !v || i.replace('fa-','').replace(/-/g,' ').indexOf(v) >= 0);
  openPop('<div class="pop-head"><i class="fa-solid ' + esc(draft.icon || 'fa-star') + '" style="color:' + esc(draft.color || '#d4bf7d') + '"></i><span class="pt">Pick an icon</span><i class="fa-solid fa-xmark px" data-a="closepop"></i></div>' +
    '<div class="pop-body"><input class="in" id="icq" placeholder="Search icons \u2014 fire, shield, brain\u2026" value="' + esc(q || '') + '" autocomplete="off">' +
    '<div class="mono" style="margin:-4px 0 10px">' + rows.length + ' of ' + ICONS.length + ' glyphs</div>' +
    '<div class="icongrid">' + (rows.length ? rows.map(i =>
      '<button class="' + (i === draft.icon ? 'on' : '') + '" data-a="icset" data-ic="' + i + '" title="' + i.replace('fa-','') + '"><i class="fa-solid ' + i + '"></i></button>').join('')
      : '<div class="pk-none">No glyph by that name.</div>') + '</div></div>');
  const q2 = $('#icq');
  q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length);
  q2.oninput = () => iconPicker(q2.value);
}
function colorPicker() {
  const cur = draft.color || '#d4bf7d';
  openPop('<div class="pop-head"><span class="pt" style="margin-left:2px">Pick a colour</span><i class="fa-solid fa-xmark px" data-a="closepop"></i></div>' +
    '<div class="pop-body"><div class="mono" style="margin-bottom:4px">Tints the feature\u2019s glyph, its list row and the editor header.</div>' +
    '<div class="swrow">' + COLORS.map(c =>
      '<button class="' + (c.toLowerCase() === cur.toLowerCase() ? 'on' : '') + '" data-a="colset" data-c="' + c + '" style="--c:' + c + '" title="' + c + '"><span class="d"></span></button>').join('') +
    '</div><div class="hexrow"><input type="color" id="colFree" value="' + esc(cur) + '"><input class="in" id="colHex" value="' + esc(cur) + '" spellcheck="false"></div>' +
    '<div class="mono" style="margin-top:8px">Console palette above \u00b7 anything else below.</div></div>', 'small');
  const free = $('#colFree'), hex = $('#colHex');
  const set = v => { draft.color = v; renderEditor(); touch(); colorPicker(); };
  free.oninput = () => { hex.value = free.value; draft.color = free.value; renderEditor(); touch(); };
  free.onchange = () => set(free.value);
  hex.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { free.value = hex.value; draft.color = hex.value; renderEditor(); touch(); } };
}
function folderPop() {
  openPop('<div class="pop-head"><i class="fa-solid fa-folder-plus" style="color:var(--amber)"></i><span class="pt">New folder</span><i class="fa-solid fa-xmark px" data-a="closepop"></i></div>' +
    '<div class="pop-body"><span class="field-lab">Folder name</span><input class="in" id="flq" placeholder="Warlock Pact\u2026" autocomplete="off">' +
    '<div class="btnrow" style="display:flex;gap:8px"><button class="btn amber" data-a="flmake" style="height:34px"><span class="bf"></span><span class="bi"><i class="fa-solid fa-check"></i> Create folder</span></button></div></div>', 'small');
  const i = $('#flq');
  i.focus();
  i.onkeydown = e => { if (e.key === 'Enter') makeFolder(i.value); };
}
function makeFolder(name) {
  const n = String(name || '').trim();
  if (!n) { toast('Folder needs a name', true); return; }
  const id = 'fl_' + (norm(n) || Date.now());
  FOLDERS.push({ id, name:n });
  openFolders[id] = true;
  closePop();
  if (draft) draft.folder = id;
  renderAll(); toast('Folder created · ' + n);
}
function thingPicker(ei, ti) {
  pickCtx = { ei, ti };
  drawPicker('');
}
function drawPicker(q) {
  const v = q.toLowerCase();
  const rows = THINGS.filter(t => !v || t.name.toLowerCase().indexOf(v) >= 0 || t.kind.toLowerCase().indexOf(v) >= 0);
  openPop('<div class="pop-head"><i class="fa-solid fa-crosshairs" style="color:var(--beige)"></i><span class="pt">Pick a thing</span><i class="fa-solid fa-xmark px" data-a="closepop"></i></div>' +
    '<div class="pop-body"><input class="in" id="pkq" placeholder="Search the catalog by name\u2026" value="' + esc(q) + '" autocomplete="off">' +
    '<div class="mono" style="margin:-4px 0 10px">One named entity. Names only \u2014 the id is written on save.</div>' +
    '<div class="pk-list">' + (rows.length ? rows.map(t =>
      '<button class="pk-row" data-a="pkpick" data-id="' + t.id + '"><span class="n">' + esc(t.name) + '</span>' +
      '<span class="tg">' + t.tags.slice(0, 2).map(x => 'tag:' + x).join(' ') + '</span><span class="k">' + esc(t.kind) + '</span></button>').join('')
      : '<div class="pk-none">Nothing in the catalog matches that.</div>') + '</div></div>');
  const q2 = $('#pkq');
  q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length);
  q2.oninput = () => drawPicker(q2.value);
}

/* ============================== WIRING ================================== */
function renderAll() { renderList(); renderEditor(); renderAudit(); }

document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]');
  if (!t) { const ac = $('#tagAc'); if (ac) ac.classList.remove('on'); return; }
  const a = t.dataset.a, ei = +t.dataset.e, vi = +t.dataset.v, ti = +t.dataset.t;
  if (a === 'sel') { selectFeature(t.dataset.id); return; }
  if (a === 'fold') { openFolders[t.dataset.f] = openFolders[t.dataset.f] === false; renderList(); return; }
  if (a === 'blk') { open[t.dataset.b] = !open[t.dataset.b]; renderEditor(); return; }
  if (a === 'efopen') { const n = +t.dataset.e; openEffect = (n < 0 || openEffect === n) ? null : n; renderEditor(); return; }
  if (a === 'moreops') { moreOps = true; renderEditor(); return; }
  if (a === 'addop') { draft.effects = draft.effects || []; draft.effects.push(blankEffect(t.dataset.op)); openEffect = draft.effects.length - 1; open.effects = true; renderEditor(); touch(); return; }
  if (a === 'deltag') { draft.tags.splice(+t.dataset.i, 1); renderEditor(); touch(); return; }
  if (a === 'addvar') { draft.vars = draft.vars || []; draft.vars.push({ name:'', kind:'stored', type:'number', scope:'player', init:'', formula:'', label:'' }); open.vars = true; renderEditor(); touch(); return; }
  if (a === 'delvar') { draft.vars.splice(vi, 1); renderEditor(); touch(); return; }
  if (a === 'vkind') { const v = draft.vars[vi]; v.kind = t.dataset.kind; if (v.kind === 'derived') v.type = ''; else if (!v.type) v.type = 'number'; renderEditor(); touch(); return; }
  if (a === 'vscope') { draft.vars[vi].scope = t.dataset.scope; renderEditor(); touch(); return; }
  if (a === 'deleff') { e.stopPropagation(); draft.effects.splice(ei, 1); if (openEffect === ei) openEffect = null; else if (openEffect > ei) openEffect--; renderEditor(); touch(); return; }
  if (a === 'addtgt') { draft.effects[ei].targets.push({ kind:'tag', value:'' }); renderEditor(); touch(); return; }
  if (a === 'deltgt') { draft.effects[ei].targets.splice(ti, 1); renderEditor(); touch(); return; }
  if (a === 'tkind') { const s = draft.effects[ei].targets[ti]; if (s.kind !== t.dataset.kind) { s.kind = t.dataset.kind; s.value = ''; } renderEditor(); touch(); return; }
  if (a === 'pick') { thingPicker(ei, ti); return; }
  if (a === 'pkpick') { const c = pickCtx; draft.effects[c.ei].targets[c.ti].value = t.dataset.id; closePop(); renderEditor(); touch(); return; }
  if (a === 'delyes') { delFeature(); return; }
  if (a === 'revyes') { revertDraft(); return; }
  if (a === 'idhelp') { openPop('<div class="pop-head"><i class="fa-solid fa-lock" style="color:var(--beige)"></i><span class="pt">Why the id is fixed</span><i class="fa-solid fa-xmark px" data-a="closepop"></i></div>' +
    '<div class="pop-body"><div class="mono" style="line-height:1.7">The id is generated from the name <b style="color:var(--text)">once</b>, at first publish, and never changes again \u2014 renaming the feature does not touch it.<br><br>Other features target this one <b style="color:var(--text)">by id</b>. If the id moved with the name, every effect, gate and reverse lookup pointing here would break silently.</div></div>', 'small'); return; }
  if (a === 'iconpick') { iconPicker(''); return; }
  if (a === 'icset') { draft.icon = t.dataset.ic; closePop(); renderEditor(); touch(); return; }
  if (a === 'colorpick') { colorPicker(); return; }
  if (a === 'colset') { draft.color = t.dataset.c; closePop(); renderEditor(); touch(); return; }
  if (a === 'flmake') { makeFolder(($('#flq') || {}).value); return; }
  if (a === 'help') { helpPop(t.dataset.h); return; }
  if (a === 'closepop') { closePop(); return; }
  if (a === 'fld' && t.classList.contains('bfield')) { const ef = draft.effects[ei]; ef[t.dataset.k] = !ef[t.dataset.k]; renderEditor(); touch(); return; }
});

document.addEventListener('input', e => {
  const t = e.target.closest('[data-a]');
  if (!t) return;
  const a = t.dataset.a, ei = +t.dataset.e, vi = +t.dataset.v, ti = +t.dataset.t, k = t.dataset.k;
  if (a === 'top') { draft[k] = t.value; if (k === 'name') { renderList(); } touch(); return; }
  if (a === 'var') { draft.vars[vi][k] = t.value; touch(); return; }
  if (a === 'fld') { draft.effects[ei][k] = t.value; touch(); return; }
  if (a === 'arr') { draft.effects[ei][k][+t.dataset.i] = t.value; touch(); return; }
  if (a === 'tval') { draft.effects[ei].targets[ti].value = t.value; updateCounts(ei); touch(); return; }
});

document.addEventListener('change', e => {
  const t = e.target.closest('[data-a]');
  if (!t) return;
  const a = t.dataset.a, ei = +t.dataset.e, vi = +t.dataset.v, ti = +t.dataset.t, k = t.dataset.k;
  if (a === 'topsel') { draft[k] = t.value; renderEditor(); touch(); return; }
  if (a === 'var' && t.tagName === 'SELECT') { draft.vars[vi][k] = t.value; renderEditor(); touch(); return; }
  if (a === 'fld' && t.tagName === 'SELECT') { draft.effects[ei][k] = t.value; renderEditor(); touch(); return; }
  if (a === 'tval' && t.tagName === 'SELECT') { draft.effects[ei].targets[ti].value = t.value; renderEditor(); touch(); return; }
  if (a === 'op') {
    const old = draft.effects[ei], fresh = blankEffect(t.value);
    fresh.targets = old.targets; fresh.label = old.label; fresh.when = old.when; fresh.ask = old.ask;
    /* carry any field the new op shares with the old one — op switching should
       feel like changing a verb, not losing your work */
    (OPS[t.value] || { fields:[] }).fields.forEach(fd => { if (old[fd.key] !== undefined) fresh[fd.key] = old[fd.key]; });
    draft.effects[ei] = fresh;
    renderEditor(); touch(); return;
  }
});

/* tag input: autocomplete over tags already in use */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePop(); setGraph(false); setGuide(false); }
  if (e.target.id !== 'tagIn') return;
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(e.target.value); e.target.value = ''; $('#tagAc').classList.remove('on'); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'tagIn') return;
  const v = norm(e.target.value), ac = $('#tagAc');
  const hits = allTags().filter(t => t.indexOf(v) >= 0 && (draft.tags || []).indexOf(t) < 0).slice(0, 10);
  if (!v || !hits.length) { ac.classList.remove('on'); return; }
  ac.innerHTML = '<div class="hd">In use already</div>' + hits.map(t =>
    '<button data-a="pickTag" data-t2="' + esc(t) + '"><i class="fa-solid fa-tag" style="font-size:8px;color:var(--amber-dim)"></i>' + esc(t) +
    '<span class="n">' + tagUse(t) + (tagUse(t) === 1 ? ' thing' : ' things') + '</span></button>').join('');
  ac.classList.add('on');
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a="pickTag"]');
  if (!b) return;
  addTag(b.dataset.t2);
  const inp = $('#tagIn'); if (inp) inp.value = '';
  $('#tagAc').classList.remove('on');
});

$('#srch').addEventListener('input', e => { query = e.target.value; renderList(); });
$('#srchClr').addEventListener('click', () => { query = ''; $('#srch').value = ''; renderList(); });
$('#helpBtn').addEventListener('click', () => { helpOn = !helpOn; renderEditor(); });$('#newFeat').addEventListener('click', newFeature);

/* ---- drag a feature into a folder ---- */
let dragId = null;
document.addEventListener('dragstart', e => {
  const row = e.target.closest('.frow');
  if (!row) return;
  dragId = row.dataset.id;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragId); } catch (x) {}
});
document.addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.frow.dragging').forEach(el => el.classList.remove('dragging'));
  clearDropMarks();
});
function clearDropMarks() {
  document.querySelectorAll('.fold.drop').forEach(el => el.classList.remove('drop'));
  document.querySelectorAll('.frow.dropbefore,.frow.dropafter').forEach(el => el.classList.remove('dropbefore', 'dropafter'));
}
document.addEventListener('dragover', e => {
  const fold = e.target.closest('.fold');
  if (!dragId || !fold) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  fold.classList.add('drop');
  /* row-level insertion point: above or below the row under the cursor */
  const row = e.target.closest('.frow');
  if (row && row.dataset.id !== dragId) {
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'dropbefore' : 'dropafter');
  }
});
document.addEventListener('drop', e => {
  const fold = e.target.closest('.fold');
  if (!dragId || !fold) return;
  e.preventDefault();
  const fid = fold.dataset.fold, moved = dragId;
  const row = e.target.closest('.frow');
  const after = row ? row.classList.contains('dropafter') : false;
  const overId = row && row.dataset.id !== moved ? row.dataset.id : null;
  dragId = null;
  clearDropMarks();
  const from = FEATURES.findIndex(x => x.id === moved);
  if (from < 0) { renderList(); return; }
  const f = FEATURES[from];
  if (!overId && f.folder === fid) { renderList(); return; }
  FEATURES.splice(from, 1);
  f.folder = fid;
  let at;
  if (overId) {
    const oi = FEATURES.findIndex(x => x.id === overId);
    at = oi + (after ? 1 : 0);
  } else {
    /* dropped on folder body — land at the end of that folder's run */
    at = FEATURES.reduce((n, x, i) => (x.folder === fid ? i + 1 : n), FEATURES.length);
  }
  FEATURES.splice(at, 0, f);
  if (draft && draft.id === moved) draft.folder = fid;
  openFolders[fid] = true;
  renderAll();
  toast(overId ? f.name + ' reordered' : f.name + ' → ' + (FOLDERS.find(x => x.id === fid) || {}).name);
});
$('#newFolder').addEventListener('click', folderPop);
$('#saveBtn').addEventListener('click', publishFeature);
$('#revertBtn').addEventListener('click', revertAsk);
$('#backBtn').addEventListener('click', () => { location.href = 'G.U.I.D.E. Operator Console.html'; });
$('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closePop(); });
function setGraph(on) {
  $('#graphPanel').classList.toggle('on', on);
  $('#graphBtn').classList.toggle('on', on);
  if (on) setGuide(false);
}
function setGuide(on) {
  $('#guidePanel').classList.toggle('on', on);
  $('#guideBtn').classList.toggle('on', on);
  if (on) { $('#graphPanel').classList.remove('on'); $('#graphBtn').classList.remove('on'); }
}
$('#graphBtn').addEventListener('click', () => setGraph(!$('#graphPanel').classList.contains('on')));
$('#graphClose').addEventListener('click', () => setGraph(false));
$('#guideBtn').addEventListener('click', () => setGuide(!$('#guidePanel').classList.contains('on')));
$('#guideClose').addEventListener('click', () => setGuide(false));
$('#audit').addEventListener('click', () => { open.effects = true; open.vars = true; renderEditor(); });

/* ==================== FEATURE ACTIONS: DUPLICATE / DELETE ================
   Same pair the shard editor establishes (DUPLICATE SHARD / DELETE), moved
   into a kebab menu beside the id tag. Deletion is confirmed and NAMES what
   breaks: every reference here becomes a dangling one the audit flags later.
   ======================================================================== */
function thingIdForFeature(f) {
  const t = THINGS.find(x => x.kind === 'Feature' && x.name.toLowerCase() === String(f.name || '').toLowerCase());
  return t ? t.id : null;
}
/* reverse lookup: what points AT this feature */
function refsTo(f) {
  const out = [];
  const tid = thingIdForFeature(f);
  const mine = (f.tags || []).map(norm).filter(Boolean);
  const vars = (f.vars || []).map(v => norm(v.name)).filter(Boolean);
  FEATURES.forEach(o => {
    if (o.id === f.id) return;
    (o.effects || []).forEach(ef => {
      (ef.targets || []).forEach(s => {
        if (s.kind === 'thing' && tid && s.value === tid) out.push({ name:o.name, how:'targets it directly' });
        else if (s.kind === 'tag' && mine.indexOf(norm(s.value)) >= 0) out.push({ name:o.name, how:'tag:' + norm(s.value) });
      });
      const w = String(ef.when || '');
      vars.forEach(v => { if (w && new RegExp('\\b' + v + '\\b').test(w)) out.push({ name:o.name, how:'gate reads ' + v }); });
    });
  });
  const seen = {};
  return out.filter(r => { const k = r.name + '|' + r.how; if (seen[k]) return false; seen[k] = 1; return true; });
}
function savedFeature() { return FEATURES.find(x => x.id === selId) || null; }
function setMenu(on) {
  const m = $('#edMenu'), b = $('#edMenuBtn');
  if (on) {
    const saved = savedFeature();
    $('#edDup').disabled = !draft;
    $('#edDel').disabled = !saved;
    const note = $('#edMenuNote');
    note.textContent = !draft ? 'Select a feature first.' : !saved ? 'Unsaved draft — save it before it can be deleted.' : '';
    note.classList.toggle('on', !!note.textContent);
  }
  m.classList.toggle('on', on);
  b.classList.toggle('on', on);
  b.setAttribute('aria-expanded', on ? 'true' : 'false');
}
function dupFeature() {
  if (!draft) return;
  const src = clone(draft);
  const base = (src.id || norm(src.name) || 'feature') + '_copy';
  let id = base, i = 2;
  while (FEATURES.some(x => x.id === id)) id = base + i++;
  src.id = id;
  src.name = (src.name || 'Untitled') + ' (copy)';
  FEATURES.push(src);
  openFolders[src.folder] = true;
  selectFeature(id);
  renderAll();
  toast('Duplicated · ' + src.name);
}
function delAsk() {
  const f = savedFeature();
  if (!f) return;
  const refs = refsTo(f);
  openPop('<div class="pop-head"><i class="fa-solid fa-triangle-exclamation" style="color:var(--danger-hot)"></i><span class="pt">Delete feature</span><i class="fa-solid fa-xmark px" data-a="closepop"></i></div>' +
    '<div class="pop-body"><div class="mono" style="margin-bottom:6px">Deleting <b style="color:var(--text)">' + esc(f.name) + '</b> · <span style="color:var(--amber)">' + esc(f.id) + '</span> removes its tags, variables, effect nodes and gates. This cannot be undone.</div>' +
    (refs.length
      ? '<div class="brk"><div class="bh"><i class="fa-solid fa-link-slash"></i> ' + refs.length + ' reference' + (refs.length === 1 ? '' : 's') + ' will break</div>' +
        refs.map(r => '<div class="br"><span class="n">' + esc(r.name) + '</span><span class="h">' + esc(r.how) + '</span></div>').join('') +
        '<div class="bf2">These become dangling references — the audit will flag them on the features listed above.</div></div>'
      : '<div class="mono" style="color:var(--beige-dim)">Nothing currently targets this feature — no references break.</div>') +
    '<div class="btnrow" style="display:flex;gap:8px;margin-top:12px">' +
    '<button class="btn danger" data-a="delyes" style="height:34px"><span class="bf"></span><span class="bi"><i class="fa-solid fa-trash"></i> Delete' + (refs.length ? ' anyway' : '') + '</span></button>' +
    '<button class="btn ghost" data-a="closepop" style="height:34px"><span class="bf"></span><span class="bi">Cancel</span></button></div></div>', 'small');
}
function delFeature() {
  const f = savedFeature();
  if (!f) return;
  FEATURES.splice(FEATURES.indexOf(f), 1);
  closePop();
  selId = null; draft = null; dirty = false;
  renderAll();
  toast('Deleted · ' + f.name, true);
}
$('#edMenuBtn').addEventListener('click', e => { e.stopPropagation(); setMenu(!$('#edMenu').classList.contains('on')); });
$('#edDup').addEventListener('click', () => { setMenu(false); dupFeature(); });
$('#edDel').addEventListener('click', () => { setMenu(false); delAsk(); });
document.addEventListener('click', e => { if (!e.target.closest('#edMenu') && !e.target.closest('#edMenuBtn')) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

selectFeature('second_wind');
