/**
 * SRD 5.2 import — STAGE 1: fetch and transform. Writes JSON to disk.
 *
 * NOTHING HERE TOUCHES THE DATABASE. Stage 2 is a separate script that reads
 * these files after a human has looked at them. The mapping is where an import
 * like this goes wrong, and six hundred wrong rows are far harder to unpick
 * than six hundred wrong lines of JSON.
 *
 *   node scripts/srd-import.mjs            # fetch, transform, write srd-data/
 *   node scripts/srd-import.mjs --dry      # transform and report, write nothing
 *
 * ── THE FILTER FOOTGUN, which shaped this whole file ────────────────────────
 * Open5e v2 accepts TWO document parameters and honours a different one per
 * endpoint. The one an endpoint does not honour is ignored SILENTLY — it
 * returns the full unfiltered set rather than erroring. Verified by passing a
 * nonsense key and seeing what came back:
 *
 *   document__key= works on: spells, armor, species, backgrounds, feats
 *   document=     works on: items, magicitems
 *   weapons:      NEITHER — 75 rows are 38 SRD 5.2 + 37 SRD 5.1
 *
 * Using `document__key` on magicitems returns 2319 rows from Kobold Press,
 * Tome of Beasts and a dozen other publishers, none of which we have
 * attribution for. So every row is re-checked client-side against
 * `document.key === 'srd-2024'` no matter which parameter fetched it. The
 * server-side filter is an optimisation; the client-side check is the
 * guarantee, and the report counts what it rejected.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeTag } from '../src/lib/graph.ts'
import { ICONS } from '../src/lib/icons.ts'
// `report` is aliased: this file already has a `report` object collecting
// counts, and the gate's printer is a different thing entirely.
import { verify, report as printVerdict } from './srd-verify.mjs'

const API = 'https://api.open5e.com/v2'
const DOC = 'srd-2024'            // "System Reference Document 5.2"
const OUT = 'srd-data'
const DRY = process.argv.includes('--dry')

/* Which parameter each endpoint actually honours. Anything not listed here is
   fetched unfiltered and filtered entirely client-side. */
const DOC_PARAM = {
  spells: 'document__key',
  armor: 'document__key',
  species: 'document__key',
  backgrounds: 'document__key',
  feats: 'document__key',
  items: 'document',
  magicitems: 'document',
  weapons: null,                  // honours neither — see header
}

const report = { fetched: {}, kept: {}, rejected: {}, effects: [], defaults: {}, warnings: [] }
const note = (bucket, key) => { report[bucket][key] = (report[bucket][key] ?? 0) + 1 }

async function fetchAll(endpoint, fields) {
  const param = DOC_PARAM[endpoint]
  const base = `${API}/${endpoint}/?limit=200`
    + (param ? `&${param}=${DOC}` : '')
    + (fields ? `&fields=${fields.join(',')}` : '')
  const out = []
  let url = base
  while (url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`)
    const page = await res.json()
    out.push(...page.results)
    url = page.next
  }
  report.fetched[endpoint] = out.length

  // THE GUARANTEE. Never trust the query parameter.
  const kept = out.filter(r => {
    const k = r.document?.key ?? r.document
    if (k === DOC) return true
    note('rejected', `${endpoint}:${k ?? 'unknown'}`)
    return false
  })
  report.kept[endpoint] = kept.length
  return kept
}

// ── mapping tables. Reviewed and approved, so data rather than judgement. ────

const CATEGORY = {
  weapon: 'weapon', ammunition: 'ammo',
  armor: 'armor', shield: 'armor',
  potion: 'consumable', poison: 'consumable', scroll: 'consumable',
  tools: 'tool', 'spellcasting-focus': 'tool', 'equipment-pack': 'tool',
  'adventuring-gear': 'misc', art: 'misc', gem: 'misc', jewelry: 'misc',
  'trade-good': 'misc', 'wondrous-item': 'misc',
  ring: 'misc', rod: 'misc', staff: 'misc', wand: 'misc',
  // Not imported: nothing in the app models a mount or a boat, and a "Service"
  // is a price list entry, not a thing you carry.
  mount: null, 'land-vehicle': null, 'waterborne-vehicle': null, service: null,
}

/** Q2, with granularity — a dagger must not occupy a greatsword's space.
 *  Driven by data the API actually gives us (weight, and the weapon's own
 *  properties) rather than by one number per category. */
function footprint(category, weightLb, props) {
  const w = Number(weightLb) || 0
  const has = re => props.some(x => re.test(x))
  if (category === 'weapon') {
    if (has(/two-handed|heavy/i) || w >= 10) return [1, 3]   // greatsword, maul, pike
    if (w <= 2 || has(/light|thrown/i)) return [1, 1]        // dagger, dart, sickle
    return [1, 2]                                            // longsword, mace
  }
  if (category === 'armor') {
    if (w >= 40) return [2, 3]                               // plate, chain mail
    if (w >= 15) return [2, 2]                               // breastplate, scale
    return [2, 1]                                            // leather, padded
  }
  if (category === 'ammo') return [1, 1]
  if (w >= 20) return [2, 2]                                 // a chest, a barrel
  return [1, 1]
}

/** Q5. Slot by name keyword, first match wins. Order matters: "cloak of
 *  elvenkind" must hit `cloak` before anything else can claim it. Inference,
 *  but visible and harmless inference — a wrong slot is obvious on the doll,
 *  unlike a wrong modifier. */
const SLOT_KEYWORDS = [
  [/\b(helm|helmet|hat|crown|circlet|headband|mask)\b/i, 'helmet'],
  [/\b(cloak|cape|mantle)\b/i, 'cloak'],
  [/\b(boots|shoes|slippers|sandals)\b/i, 'boots'],
  [/\b(gauntlets|gloves|bracers)\b/i, 'gloves'],
  [/\b(amulet|necklace|periapt|medallion|brooch|scarab|talisman)\b/i, 'neck'],
  [/\bring\b/i, 'ring1'],
  [/\b(armor|armour|mail|plate|breastplate|cuirass)\b/i, 'armor'],
]

/** Icon by name keyword, falling back to the category.
 *
 *  A category-only table gave six icons across 941 rows — `fa-cube` on 256 of
 *  them — which is coverage rather than quality: a shelf where every wondrous
 *  item is the same grey box tells the DM nothing. These are the same kind of
 *  visible, harmless inference the slot table uses: a wrong icon is obvious and
 *  costs a click to change, unlike a wrong modifier.
 *
 *  First match wins, so order matters — "Staff of Fire" must reach `staff`
 *  before `fire` could claim it. */
const ICON_KEYWORDS = [
  [/\bpotion|elixir|philter|oil\b/i, 'fa-flask'],
  [/\bscroll\b/i, 'fa-scroll'],
  [/\bring\b/i, 'fa-ring'],
  [/\bwand\b/i, 'fa-wand-sparkles'],
  [/\bstaff|quarterstaff\b/i, 'fa-staff-snake'],
  [/\brod\b/i, 'fa-wand-magic'],
  [/\bamulet|necklace|periapt|medallion|talisman|brooch|scarab\b/i, 'fa-gem'],
  [/\bcloak|cape|mantle|robe\b/i, 'fa-user-ninja'],
  [/\bboots|shoes|slippers\b/i, 'fa-shoe-prints'],
  [/\bgloves|gauntlets|bracers\b/i, 'fa-mitten'],
  [/\bhelm|hat|crown|circlet|headband|mask\b/i, 'fa-hat-wizard'],
  [/\bshield\b/i, 'fa-shield-halved'],
  [/\bbow\b|arrow/i, 'fa-bullseye'],
  [/\bcrossbow|bolt\b/i, 'fa-crosshairs'],
  [/\bdagger|knife|dart\b/i, 'fa-khanda'],
  [/\baxe\b/i, 'fa-axe'],
  [/\bhammer|maul|mace|club\b/i, 'fa-hammer'],
  [/\bspear|pike|lance|trident|javelin|glaive|halberd\b/i, 'fa-location-arrow'],
  [/\bsword|blade|scimitar|rapier\b/i, 'fa-khanda'],
  [/\bbag|pouch|sack|backpack|case|chest\b/i, 'fa-bag-shopping'],
  [/\bbook|tome|manual|folio\b/i, 'fa-book'],
  [/\bgem|stone|pearl|crystal\b/i, 'fa-gem'],
  [/\blantern|torch|candle|lamp\b/i, 'fa-fire'],
  [/\bhorn|instrument|lute|flute|drum|pipes\b/i, 'fa-music'],
  /* Armour BEFORE rope: "Chain Mail" matched /chain/ and came out as a chain
     link. Keyword tables are order-sensitive and the order is the rule. */
  [/\bmail|plate|armor|armour|breastplate|cuirass|leather\b/i, 'fa-shield-halved'],
  [/\brope|chain\b/i, 'fa-link'],
  [/\btools|supplies|kit\b/i, 'fa-screwdriver-wrench'],
]

const CATEGORY_ICON = {
  weapon: 'fa-khanda', ammo: 'fa-location-arrow', armor: 'fa-shield-halved',
  consumable: 'fa-flask-vial', tool: 'fa-screwdriver-wrench',
  quest: 'fa-scroll', misc: 'fa-cube',
}

/* Every emitted icon must exist in the vetted palette. A Font Awesome class
   that is not real renders as NOTHING — no error, no fallback box, just a hole
   where the icon was, which is the exact failure the gi:/fa- split already
   taught this codebase once. Checked rather than trusted: `fa-baton`, invented
   for rods, was not a Font Awesome name at all and would have shipped blank on
   six items. */
const VETTED = new Set(ICONS)

const iconFor = (name, category) => {
  const pick = ICON_KEYWORDS.find(([re]) => re.test(name))?.[1]
  const fallback = CATEGORY_ICON[category] ?? 'fa-cube'
  if (pick && !VETTED.has(pick)) {
    report.warnings.push(`icon "${pick}" is not in lib/icons.ts — would render blank; used ${fallback} instead`)
    return fallback
  }
  return pick ?? fallback
}

const slotFor = (name, category) => {
  for (const [re, slot] of SLOT_KEYWORDS) if (re.test(name)) return slot
  if (category === 'armor') return 'armor'
  return undefined
}

// ── the effect whitelist. Four patterns, exact match only. ──────────────────
//
// SRD 5.2 does NOT put the number in the prose — every one of these says the
// bonus "is determined by the rarity", and the +N lives only in the name. So a
// match needs BOTH halves: the description exactly equal to a known string,
// and an (+N) suffix on the name. Either missing means no effect at all.

const norm = s => (s ?? '').replace(/\s+/g, ' ').trim()

const WHITELIST = [
  {
    id: 'weapon-attack-damage',
    desc: "You have a bonus to attack rolls and damage rolls made with this magic weapon. The bonus is determined by the weapon's rarity.",
    /* NO `target`. An untargeted node resolves against its OWN owner's roll
       (graph.ts buildContext: "No target = this node's own roll"), which for a
       weapon means the rolls made WITH that weapon. Targeting `roll:attack`
       instead — as this did — applies the bonus to every attack the character
       makes, so a +1 dagger in the off hand buffs a mundane greatsword. */
    apply: (n, slug) => ({ graph: [
      { id: `${slug}_bonus`, op: 'add', value: String(n), label: `+${n} magic weapon` },
    ] }),
  },
  {
    id: 'armor-ac',
    desc: 'You have a bonus to Armor Class while wearing this armor. The bonus is determined by its rarity.',
    apply: n => ({ effects: { ac: n } }),
  },
  {
    id: 'shield-ac',
    desc: "While holding this Shield, you have a bonus to Armor Class determined by the Shield's rarity, in addition to the Shield's normal bonus to AC.",
    apply: n => ({ effects: { ac: n } }),
  },
  {
    id: 'ammunition-attack-damage',
    descStartsWith: 'You have a bonus to attack rolls and damage rolls made with this piece of magic ammunition.',
    apply: (n, slug) => ({ graph: [
      { id: `${slug}_bonus`, op: 'add', value: String(n), label: `+${n} magic ammunition` },
    ] }),
  },
]

/** Returns whatever the whitelist produces, or null. Never guesses.
 *
 *  `slug` makes each generated node id unique to its item. Node ids are not
 *  used for indexing — buildContext keys on the OWNER's gid, so a shared id was
 *  not breaking anything today — but the audit reports by id and the editor
 *  jumps to it, and 117 nodes called `srd_atk` is a collision waiting for
 *  whatever indexes them next. The name says `bonus`, not `atk`, because the
 *  single untargeted node deliberately covers attack AND damage. */
function whitelistEffects(name, desc, slug) {
  const plus = /\(\+([123])\)/.exec(name ?? '')
  if (!plus) return null
  const n = Number(plus[1])
  const d = norm(desc)
  for (const p of WHITELIST) {
    const hit = p.desc ? d === norm(p.desc) : d.startsWith(p.descStartsWith)
    if (!hit) continue
    report.effects.push({ item: name, pattern: p.id, bonus: n })
    return p.apply(n, slug)
  }
  return null
}

const tag = (...xs) => [...new Set(xs.filter(Boolean).map(normalizeTag))]

// ── transforms ───────────────────────────────────────────────────────────────

function toItem(r, weaponsByKey, armorByKey) {
  const catKey = r.category?.key ?? 'adventuring-gear'
  const category = CATEGORY[catKey]
  if (category === null || category === undefined) {
    note('defaults', `skipped-category:${catKey}`)
    return null
  }
  const props = (r.weapon ? (weaponsByKey.get(r.weapon.key ?? r.weapon)?.properties ?? []) : [])
    .map(x => x.property?.name).filter(Boolean)
  const [w, h] = footprint(category, r.weight, props)

  const rarity = r.rarity?.key ?? 'common'
  const magic = /\(\+([123])\)/.exec(r.name ?? '')
  const weapon = r.weapon ? weaponsByKey.get(r.weapon.key ?? r.weapon) : null
  const armor = r.armor ? armorByKey.get(r.armor.key ?? r.armor) : null

  const out = {
    name: r.name,
    category,
    rarity,
    flavor: r.desc ?? '',
    weight: r.weight != null ? Number(r.weight) : undefined,
    w, h,
    icon: iconFor(r.name ?? '', category),
    source: 'srd',
    srd_key: r.key,
    tags: tag(
      category, catKey, rarity,
      weapon?.damage_type?.name,
      ...(weapon?.properties ?? []).map(p => p.property?.name),
      // Q3: keep all 757 rows and make the ladder addressable.
      magic ? `magic+${magic[1]}` : null,
      r.requires_attunement ? 'attunement' : null,
    ),
  }

  const cost = Number(r.cost ?? 0)
  if (cost > 0) { out.value = cost; out.valueUnit = 'gp' }

  if (r.requires_attunement) out.attune = r.attunement_detail || 'Requires attunement'

  const slot = slotFor(r.name ?? '', category)
  if (slot) out.slot = slot; else if (category === 'armor') note('defaults', 'armor-no-slot')

  if (weapon) {
    out.damageDice = weapon.damage_dice
    out.type = weapon.damage_type?.name
    const props = (weapon.properties ?? []).map(p => p.property?.name).filter(Boolean)
    if (props.length) out.properties = props
    if (props.some(p => /finesse/i.test(p))) out.ability = 'finesse'
    if (/\bammunition\b/i.test(props.join(' '))) out.ranged = true
  }
  /* Q4: base AC REPLACES, it never adds — its own field, never effects.ac.
     The Dex rule travels with it: `baseAc` alone turns a Breastplate's
     "14 + Dex (max 2)" into a flat 14, which is the silent wrong number the
     separate field was introduced to prevent. */
  if (armor?.ac_base != null) {
    out.baseAc = Number(armor.ac_base)
    if (armor.ac_add_dexmod) out.acAddDex = true
    if (armor.ac_cap_dexmod != null) out.acDexCap = Number(armor.ac_cap_dexmod)
    out.tags = tag(...out.tags, `armor:${armor.category}`,
      armor.grants_stealth_disadvantage ? 'stealth_disadvantage' : null,
      armor.strength_score_required ? `str_req:${armor.strength_score_required}` : null)
  }

  const fx = whitelistEffects(r.name, r.desc, normalizeTag(r.key ?? r.name ?? 'srd'))
  if (fx?.effects) out.effects = { ...out.effects, ...fx.effects }
  if (fx?.graph) out.graph = fx.graph

  return out
}

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment',
  'Evocation', 'Illusion', 'Necromancy', 'Transmutation']

const ABILITY = { strength: 'str', dexterity: 'dex', constitution: 'con',
  intelligence: 'int', wisdom: 'wis', charisma: 'cha' }

function toSpell(r) {
  const school = SCHOOLS.find(s => s.toLowerCase() === (r.school?.key ?? '').toLowerCase())
  if (!school) { report.warnings.push(`spell ${r.key}: unknown school ${r.school?.key}`); return null }

  // Q8, the simple choice: higher_level appended, canUpcast from the structured
  // options, `scaling` left empty for hand-authoring. Deriving scaling from
  // casting_options is parsing-adjacent and this file does not parse.
  const desc = [r.desc, r.higher_level && `\n\n**At Higher Levels.** ${r.higher_level}`]
    .filter(Boolean).join('')

  return {
    name: r.name,
    level: r.level ?? 0,
    school,
    castingTime: r.casting_time ?? 'action',
    range: r.range_text || (r.range != null ? `${r.range} ${r.range_unit ?? 'feet'}` : 'Self'),
    v: !!r.verbal, s: !!r.somatic, m: !!r.material,
    material: r.material_specified || undefined,
    duration: r.duration ?? 'Instantaneous',
    concentration: !!r.concentration,
    ritual: !!r.ritual,
    desc,
    hasDamage: !!r.damage_roll,
    dice: r.damage_roll || undefined,
    dmgType: r.damage_types?.[0] || undefined,
    save: ABILITY[(r.saving_throw_ability ?? '').toLowerCase()] || undefined,
    canUpcast: (r.casting_options ?? []).length > 0,
    source: 'srd',
    srd_key: r.key,
    tags: tag(school, `level:${r.level ?? 0}`, ...(r.damage_types ?? []),
      ...(r.classes ?? []).map(c => `class:${c.name}`),
      r.concentration ? 'concentration' : null, r.ritual ? 'ritual' : null),
  }
}

/** A species trait is either a number for the sheet or a named ability. Only
 *  9 species, so the numeric ones are recognised by an explicit trait TYPE from
 *  the API rather than by reading prose. Anything unrecognised becomes a
 *  feature, which is the safe direction: a feature is inert prose, a wrong
 *  boost is a wrong number on a sheet. */
function toSpecies(r) {
  const traits = r.traits ?? []
  const features = []
  const featureRefs = []
  const slug = normalizeTag(r.name)
  let speed, darkvision, size
  for (const t of traits) {
    const type = (t.type ?? '').toUpperCase()
    if (type === 'SIZE') { size = t.desc; continue }
    if (type === 'SPEED') { speed = /(\d+)/.exec(t.desc ?? '')?.[1]; continue }
    if (/darkvision/i.test(t.name ?? '')) { darkvision = /(\d+)/.exec(t.desc ?? '')?.[1]; continue }
    /* The id is DERIVED, not minted, so the race can name it in the same run —
       an imported species whose `features` array is empty is nine names and a
       speed value, which is what the first pass produced. */
    const fid = `${r.key}_${normalizeTag(t.name)}`
    features.push({
      id: fid, name: t.name, desc: t.desc, category: 'racial',
      icon: featureIcon(t.name),
      // Auto-tagging applies to features too, or none of this is targetable.
      tags: tag('racial', r.name, t.name, t.type ? String(t.type).toLowerCase() : null),
      source: 'srd', srd_key: fid,
    })
    featureRefs.push({ id: fid })
  }
  return {
    race: {
      name: r.name,
      icon: 'fa-user',
      /* Open5e ships an empty `desc` for every SRD species, so a card built from
         it alone would be blank. The trait names are the honest summary — real
         content from the same row, not invented prose. */
      desc: r.desc || (traits.length
        ? `**Traits.** ${traits.map(t => t.name).filter(Boolean).join(', ')}`
        : ''),
      skillChoices: [], skillChooseN: 0,
      languages: [], languageChooseN: 0,
      proficiencies: {},
      // Linked HERE, not in stage 2: both sides are produced by this same run,
      // so leaving the array empty just deferred work that has all its inputs.
      features: featureRefs,
      vars: [],
      /* `Speed` and `Darkvision` EXACTLY as modEditor.ts MOD_STATS spells them —
         it is a string set, so 'SPEED' matched nothing and the node never
         resolved. Ids are per-species because a node id repeated across nine
         rows is a collision waiting for whatever indexes them next. */
      graph: [
        ...(speed ? [{ id: `${slug}_speed`, op: 'boost', stat: 'Speed', value: Number(speed), label: `${r.name} speed` }] : []),
        ...(darkvision ? [{ id: `${slug}_dark`, op: 'boost', stat: 'Darkvision', value: Number(darkvision), label: `${r.name} darkvision` }] : []),
      ],
      source: 'srd', srd_key: r.key,
      tags: tag('species', r.name, size ? `size:${size.split(' ')[0]}` : null),
    },
    features,
  }
}

/** SRD 5.2 backgrounds. All four share one shape — five `benefits` entries,
 *  keyed by `type` — so this reads the type rather than the prose.
 *
 *  The ability increase becomes a BOOST RULE, not a written number, for the
 *  same reason a racial +2 DEX does: a written field could not be un-written
 *  when the background changes. But the SRD offers three abilities and lets the
 *  player split +2/+1 or +1/+1/+1, and nothing here can know which — so the
 *  three are recorded in `abilityOptions` for the assign step to ask about, and
 *  `graph` is left EMPTY. Emitting a guessed +2 would be a wrong number on a
 *  sheet, which is the one thing this importer refuses to do.
 *
 *  Equipment is left as prose on `desc` and an empty `equipment` list: the SRD
 *  text is "Choose A or B" with named items, and turning those names into
 *  EquipRefs means matching prose against the item catalog — parsing, which
 *  this file does not do. The structure is there for hand-authoring.
 */
function toBackground(r, featIndex) {
  const by = {}
  for (const b of r.benefits ?? []) (by[b.type] ??= []).push(b)
  const first = t => (by[t]?.[0]?.desc ?? '').trim()

  const abilityText = first('ability_score')
  const abilityOptions = Object.entries(ABILITY)
    .filter(([long]) => new RegExp(long, 'i').test(abilityText))
    .map(([, short]) => short)
  if (abilityText && abilityOptions.length !== 3) {
    report.warnings.push(`background ${r.key}: parsed ${abilityOptions.length} abilities from "${abilityText}"`)
  }

  // "Insight and Religion" -> ['Insight','Religion']
  const skills = first('skill_proficiency')
    .split(/\s*(?:,|\band\b)\s*/).map(x => x.trim()).filter(Boolean)

  const tools = first('tool_proficiency')
  const featName = first('feat')
  /* Resolve the named feat against the feats imported in this same run. The
     SRD writes "Magic Initiate (Cleric)" where the feat row is "Magic Initiate",
     so the match is on the name with any parenthetical stripped — an exact
     lookup against a list built moments ago, not prose matching. A miss links
     nothing and is reported rather than guessed at. */
  const featBase = featName.replace(/\s*\(.*$/, '').trim()
  const featRow = featBase && featIndex.get(normalizeTag(featBase))
  if (featName && !featRow) report.warnings.push(`background ${r.key}: feat "${featName}" matched no imported feat`)

  const desc = [
    r.desc,
    featName && `**Feat.** ${featName}`,
    by.equipment?.[0]?.desc && `**Equipment.** ${by.equipment[0].desc}`,
  ].filter(Boolean).join('\n\n')

  return {
    name: r.name,
    icon: 'fa-scroll',
    desc,
    abilityOptions,
    skills,
    skillChooseN: 0,
    proficiencies: tools ? { tools: [tools] } : {},
    features: featRow ? [{ id: featRow }] : [],
    equipment: [],
    tags: tag('background', r.name, ...skills.map(x => `skill:${x}`)),
    vars: [],
    graph: [],
    source: 'srd',
    srd_key: r.key,
  }
}

/** A feature's icon. Features fall back to a single `fa-diamond`, so 44
 *  imported rows would be 44 identical diamonds on the Features screen.
 *
 *  SPELLS ARE DELIBERATELY NOT GIVEN ONE. Spellbook derives a glyph from the
 *  school (`sp.icon || schoolIcon(sp.school)`), which is the designed
 *  behaviour and the same `auto` fallback the spell editor's icon picker
 *  offers — writing an explicit icon would bypass it and duplicate data that
 *  is already derivable from the school. */
const FEATURE_ICON_KEYWORDS = [
  [/\bbreath\b/i, 'fa-wind'],
  [/\bresist|resistance\b/i, 'fa-shield-halved'],
  [/\bflight|fly|wing\b/i, 'fa-feather'],
  [/\bancestry|lineage|heritage\b/i, 'fa-dna'],
  [/\bdarkvision|sight|vision\b/i, 'fa-eye'],
  [/\bluck|fortune\b/i, 'fa-clover'],
  [/\bmagic|spell|cantrip|arcane\b/i, 'fa-wand-sparkles'],
  [/\bheal|life|vigor\b/i, 'fa-heart-pulse'],
  [/\bstealth|hidden|camouflage\b/i, 'fa-user-ninja'],
  [/\bweapon|attack|martial|fighting\b/i, 'fa-khanda'],
  [/\bskill|expert|trained\b/i, 'fa-brain'],
  [/\btough|durable|endurance\b/i, 'fa-shield'],
  [/\bspeed|swift|nimble|mobile\b/i, 'fa-bolt'],
]

const featureIcon = name => {
  const pick = FEATURE_ICON_KEYWORDS.find(([re]) => re.test(name ?? ''))?.[1]
  if (pick && !VETTED.has(pick)) {
    report.warnings.push(`feature icon "${pick}" is not in lib/icons.ts — would render blank`)
    return 'fa-diamond'
  }
  return pick ?? 'fa-diamond'
}

const toFeat = r => ({
  id: r.key,
  name: r.name,
  category: 'feat',
  icon: featureIcon(r.name),
  desc: [r.desc, ...(r.benefits ?? []).map(b => b.desc)].filter(Boolean).join('\n\n'),
  prerequisite: r.prerequisite || undefined,   // Q7
  source: 'srd', srd_key: r.key,
  tags: tag('feat', r.type),
})

// ── run ──────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`SRD 5.2 import · stage 1 · document ${DOC}${DRY ? ' · DRY RUN' : ''}\n`)

  const [weapons, armor, items, magicitems, spells, species, feats, backgrounds] = await Promise.all([
    fetchAll('weapons'), fetchAll('armor'), fetchAll('items'),
    fetchAll('magicitems'), fetchAll('spells'), fetchAll('species'), fetchAll('feats'),
    fetchAll('backgrounds'),
  ])

  const weaponsByKey = new Map(weapons.map(w => [w.key, w]))
  const armorByKey = new Map(armor.map(a => [a.key, a]))

  const outItems = [...items, ...magicitems].map(r => toItem(r, weaponsByKey, armorByKey)).filter(Boolean)
  const outSpells = spells.map(toSpell).filter(Boolean)
  const outFeats = feats.map(toFeat)
  /* Feats first, so backgrounds can point at them. */
  const featIndex = new Map(outFeats.map(f => [normalizeTag(f.name), f.id]))
  const outBackgrounds = backgrounds.map(r => toBackground(r, featIndex))
  const speciesPairs = species.map(toSpecies)
  const outRaces = speciesPairs.map(x => x.race)
  const outRacialFeatures = speciesPairs.flatMap(x => x.features)

  const files = {
    'items.json': outItems,
    'spells.json': outSpells,
    'races.json': outRaces,
    'features.json': [...outRacialFeatures, ...outFeats],
    'backgrounds.json': outBackgrounds,
  }

  /* THE GATE. The same check stage 2 runs before it writes rows — one
     implementation, so the two can never drift into disagreeing about what a
     valid dataset is. Stage 1 fails loudly rather than writing JSON a loader
     would then refuse. */
  const dataset = {
    items: outItems, spells: outSpells, races: outRaces,
    features: files['features.json'], backgrounds: outBackgrounds,
  }
  const failures = verify(dataset)
  if (!printVerdict(failures, 'transform')) {
    console.error('\nRefusing to write. Fix the transform above.')
    process.exit(1)
  }

  if (!DRY) {
    mkdirSync(OUT, { recursive: true })
    for (const [name, data] of Object.entries(files)) {
      writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n')
    }
    /* The attribution travels WITH the data. Checked on every run, because the
       licence is a condition of using the content rather than documentation
       about it — a regenerated dataset must never lose its notice. */
    if (!existsSync(join(OUT, 'LICENSE.txt'))) {
      throw new Error('srd-data/LICENSE.txt is missing - refusing to write SRD data without its attribution notice')
    }
  }

  // ── the report. Short enough to actually read. ──
  const L = []
  L.push('# SRD 5.2 import — stage 1 report\n')
  L.push(`Document: \`${DOC}\` · generated ${new Date().toISOString()}\n`)

  L.push('\n## Rows\n')
  L.push('| endpoint | fetched | kept (srd-2024) |')
  L.push('|---|--:|--:|')
  for (const k of Object.keys(report.fetched)) {
    L.push(`| ${k} | ${report.fetched[k]} | ${report.kept[k]} |`)
  }

  L.push('\n## Written\n')
  for (const [name, data] of Object.entries(files)) L.push(`- \`${name}\` — ${data.length} rows`)

  const rej = Object.entries(report.rejected)
  L.push('\n## Rejected by the client-side document check\n')
  L.push(rej.length
    ? rej.map(([k, n]) => `- ${k} — ${n} rows`).join('\n')
    : '_none_')

  L.push('\n## Auto-generated effects\n')
  L.push(`${report.effects.length} items matched the whitelist. Everything else kept its prose and got nothing.\n`)
  const byPattern = {}
  for (const e of report.effects) (byPattern[e.pattern] ??= []).push(e)
  for (const [p, es] of Object.entries(byPattern)) {
    const bonuses = [...new Set(es.map(e => `+${e.bonus}`))].sort().join(' ')
    L.push(`- **${p}** — ${es.length} items, bonuses ${bonuses}`)
    L.push(`  <br>e.g. ${es.slice(0, 3).map(e => e.item).join(', ')}`)
  }

  L.push('\n## Attribution\n')
  L.push('SRD 5.2 is CC-BY-4.0. `srd-data/LICENSE.txt` carries the required notice and sits beside')
  L.push('the data. Every row also carries `source: srd` and its `srd_key`, so a single row stays')
  L.push('traceable to the notice after it is loaded, exported, or copied onto a sheet.')

  L.push('\n## Defaults applied\n')
  const defs = Object.entries(report.defaults)
  L.push(defs.length ? defs.map(([k, n]) => `- ${k} — ${n}`).join('\n') : '_none_')

  if (report.warnings.length) {
    L.push('\n## Warnings\n')
    L.push(report.warnings.map(w => `- ${w}`).join('\n'))
  }

  const md = L.join('\n') + '\n'
  if (!DRY) writeFileSync(join(OUT, 'REPORT.md'), md)
  console.log(md)
}

main().catch(e => { console.error(e); process.exit(1) })
