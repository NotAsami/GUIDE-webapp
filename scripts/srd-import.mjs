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
  classes: 'document__key',
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
      id: fid, name: t.name, category: 'racial',
      ...featureProse(t.desc),
      folder: srdFolder(r.name),
      icon: featureIcon(t.name),
      // Auto-tagging applies to features too, or none of this is targetable.
      tags: tag('racial', r.name, t.name, t.type ? String(t.type).toLowerCase() : null),
      source: 'srd', srd_key: fid,
    })
    // FeatureGrantRef is keyed `feature_id`, NOT `id`. Emitting `id` left every
    // race saying "undefined was referenced but no longer exists" in its audit.
    featureRefs.push({ feature_id: fid })
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
    features: featRow ? [{ feature_id: featRow }] : [],
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

/** Feature prose. `Feature` HAS NO `desc` FIELD — it declares
 *  light_description (the card, which scales to it) and deep_description (the
 *  detail panel below it). Writing `desc` put the text somewhere nothing reads,
 *  so all 44 imported features showed blank; the same mistake as emitting `id`
 *  where FeatureGrantRef declares `feature_id`.
 *
 *  Split at the first sentence so the card is scannable and the detail carries
 *  the rest. Nothing is dropped: a one-sentence trait puts everything on the
 *  card and leaves the detail empty. */
function featureProse(text) {
  const t = (text ?? '').trim()
  if (!t) return {}
  const m = /^(.+?[.!?])\s+(.+)$/s.exec(t)
  if (!m || m[1].length > 200) return { light_description: t }
  return { light_description: m[1], deep_description: m[2] }
}

/** Imported features are foldered by where they come from.
 *
 *  One flat "SRD" folder was right at 44 rows and wrong at 286: the SRD gives
 *  most classes their own Spellcasting, Expertise, Evasion and Ability Score
 *  Improvement, with genuinely different text each time — seven rows all called
 *  "Spellcasting" is correct data and an unusable list. Foldering by class
 *  separates them without touching the names, which matters because the name is
 *  what a character sheet shows: a Bard's feature should read "Spellcasting",
 *  not "Spellcasting (Bard)".
 *
 *  The editor derives folders from the features in them, so naming one here is
 *  all it takes for it to exist.
 *  `/` NESTS in the editor, so every one of these lives under a single
 *  collapsible SRD parent instead of 34 top-level folders sharing a prefix. */
const SRD_FOLDER = 'SRD'
const srdFolder = what => `${SRD_FOLDER}/${what}`

const toFeat = r => ({
  id: r.key,
  name: r.name,
  category: 'feat',
  icon: featureIcon(r.name),
  folder: srdFolder('Feats'),
  ...featureProse([r.desc, ...(r.benefits ?? []).map(b => b.desc)].filter(Boolean).join('\n\n')),
  prerequisite: r.prerequisite || undefined,   // Q7
  source: 'srd', srd_key: r.key,
  tags: tag('feat', r.type),
})

/* ── CLASSES AND SUBCLASSES ───────────────────────────────────────────────────
   One endpoint returns both: 24 rows for SRD 5.2, of which 12 carry
   `subclass_of`. That maps straight onto ClassDef.parent, which is how this
   schema already models a subclass — a row with a parent, not a nested
   structure — so subclasses need no separate handling.

   352 class features come WITH their prose and the levels they are gained at,
   so they become real feature_catalog rows gated by `when`, rather than a
   paragraph naming things the sheet cannot grant. */

/** The feature types that are actually FEATURES. Everything else Open5e
 *  returns under `features` is a column of the class progression table. */
const FEATURE_TYPES = new Set(['CLASS_LEVEL_FEATURE', 'CLASS_FEATURE_OPTION_LIST'])
const PLACEHOLDER = /^\[[\w\s]+\]$/

const CASTER = { NONE: 'none', FULL: 'full', HALF: 'half', THIRD: 'third', PACT: 'pact' }

const ABIL_NAME = {
  strength: 'str', dexterity: 'dex', constitution: 'con',
  intelligence: 'int', wisdom: 'wis', charisma: 'cha',
}

/** SRD 5.2 primary abilities — SUPPLIED DATA, not derived.
 *
 *  Open5e ships `primary_abilities: []` for every class, and ClassDef requires
 *  one, so these twelve come from the SRD itself rather than from the feed.
 *  Reviewed once and then data, exactly like the category and slot tables.
 *
 *  A MISS IS AN ERROR, not a default. This read `PRIMARY[slug] ?? 'str'`, which
 *  would have quietly made a thirteenth class a Strength class — the sort of
 *  plausible wrong value that never gets questioned. Anything absent here now
 *  fails the run instead. */
const PRIMARY = {
  barbarian: 'str', bard: 'cha', cleric: 'wis', druid: 'wis',
  fighter: 'str', monk: 'dex', paladin: 'str', ranger: 'dex',
  rogue: 'dex', sorcerer: 'cha', warlock: 'cha', wizard: 'int',
}

const CLASS_ICON = {
  barbarian: 'fa-hand-fist', bard: 'fa-music', cleric: 'fa-cross', druid: 'fa-leaf',
  fighter: 'fa-shield-halved', monk: 'fa-hand-sparkles', paladin: 'fa-scale-balanced',
  ranger: 'fa-bullseye', rogue: 'fa-user-ninja', sorcerer: 'fa-fire',
  warlock: 'fa-book-skull', wizard: 'fa-hat-wizard',
}

/* ── THE CLASS PROGRESSION TABLE ──────────────────────────────────────────────
   Open5e ships each table COLUMN as a feature whose `desc` is the literal
   "[Column data]" and whose numbers live in `data_for_class_table`. Dropping
   those rows was right — they are not features — but the first pass dropped the
   numbers with them, which is why Barbarian's Weapon Mastery still reads "as
   shown in the Weapon Mastery column of the Barbarian Features table" and the
   table does not exist anywhere.

   A column is a LEVEL-INDEXED DERIVED VARIABLE on the class: `[0,2,2,…][level]`,
   which §35 of the expression language exists for. Index 0 is the level-0 slot
   the convention reserves; levels 1–20 follow.

   Two families are deliberately NOT imported, because the app already owns them
   and a second copy is the one-authored-value-two-render-paths bug:
     · PROFICIENCY_BONUS — canon, +3 at level 7.
     · SPELL_SLOTS (the 1st–9th grid) — derived from `ClassDef.caster`.
   Warlock's own "Spell Slots" column is CLASS_TABLE_DATA, not SPELL_SLOTS, and
   IS imported: pact slots are a count the caster type does not carry. */
const OWNED_ELSEWHERE = new Set(['PROFICIENCY_BONUS', 'SPELL_SLOTS'])

/** `Rage Damage` → `rageDamage`, matching VarDef's /^[a-z][a-zA-Z0-9]*$/. */
const varName = label => {
  const parts = String(label).replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  const n = parts[0].toLowerCase() + parts.slice(1).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')
  return /^[a-z][a-zA-Z0-9]*$/.test(n) ? n : null
}

/** `[0,1,1,2,…][level]`, the level-indexed table §35 expects. */
const table = nums => `[0,${nums.join(',')}][level]`

/** A dice column splits into the two numbers it is made of.
 *
 *  An array literal holds numbers, so `[1d6,2d6][level]` cannot be written —
 *  the value type has a dice list, the array type does not. But "NdM" is not
 *  ambiguous text needing interpretation; it is two numbers in a fixed format.
 *  Splitting it is decomposition, not inference, and it is uniform: parse
 *  count and faces, emit a variable for whichever of the two actually moves,
 *  and skip the one that never does.
 *
 *  So Sneak Attack's d6 never changes and its COUNT does — `{sneakAttackDice}d6`.
 *  Martial Arts always rolls one die and the SIZE changes — `1d{martialArtsDie}`.
 *  Bardic Die is the same shape as Martial Arts. A column where both moved
 *  would get both variables; none in SRD 5.2 does. */
const DICE_CELL = /^(\d*)[dD](\d+)$/

/** "Bardic Die" → "Bardic", so the die variable is `bardicDie`, not `bardicDieDie`. */
const diceBase = name => String(name).replace(/\s+Dic?e$/i, '')

function diceVars(raw, f, className, taken) {
  const parsed = raw.map(v => {
    if (v === '') return { n: 0, d: 0 }
    const m = DICE_CELL.exec(v)
    return m ? { n: m[1] === '' ? 1 : Number(m[1]), d: Number(m[2]) } : null
  })
  if (parsed.some(x => x === null)) return null

  const counts = parsed.map(x => x.n)
  const faces = parsed.map(x => x.d)
  const out = []
  const add = (suffix, nums, what) => {
    // Only what MOVES becomes a variable. A constant one is noise the prose can
    // simply write out — nobody needs `{sneakAttackFaces}` to render a 6.
    if (new Set(nums).size <= 1) return
    const name = varName(diceBase(f.name) + ' ' + suffix)
    if (!name || taken.has(name)) {
      report.warnings.push(`class ${className}: column "${f.name}" → no usable name for ${what}`)
      return
    }
    taken.add(name)
    out.push({ name, kind: 'derived', label: `${f.name} (${what})`, formula: table(nums) })
  }
  add('Dice', counts, 'number of dice')
  add('Die', faces, 'die size')

  if (!out.length) {
    report.warnings.push(`class ${className}: column "${f.name}" never changes — left out`)
  }
  return out
}

/** One column → the derived VarDefs it yields, possibly none. */
function columnVar(f, className, taken) {
  const rows = f.data_for_class_table ?? []
  if (!rows.length) return null
  if (OWNED_ELSEWHERE.has(f.feature_type)) return null

  const byLevel = new Map(rows.map(r => [r.level, String(r.column_value ?? '').trim()]))
  const raw = Array.from({ length: 20 }, (_, i) => byLevel.get(i + 1) ?? '')
  // A LEVEL WITH NO ENTRY IS ZERO, not a mystery. Sorcery Points starts at
  // level 2 and Channel Divinity at 2 or 3, so the table simply has no cell
  // there — the column is fully numeric, it just does not start at 1. Reading
  // absence as 0 is what the blank means; it is not an interpretation of a value.
  const bad = raw.find(v => v !== '' && !/^[+-]?\d+$/.test(v))
  if (bad) {
    const dice = diceVars(raw, f, className, taken)
    if (dice) return dice
    report.warnings.push(
      `class ${className}: column "${f.name}" is neither a number nor NdM (${bad}) `
      + '— left out, this one needs a human')
    return null
  }
  const name = varName(f.name)
  if (!name || taken.has(name)) {
    report.warnings.push(`class ${className}: column "${f.name}" → no usable variable name`)
    return null
  }
  taken.add(name)
  // Index 0 is the level-0 slot §35 reserves; arr[level] then reads at the level.
  return [{
    name, kind: 'derived', label: f.name,
    formula: table(raw.map(v => (v === '' ? 0 : Number(v)))),
  }]
}

/** A class row plus every feature it grants. */
function toClass(r) {
  const slug = (r.key ?? '').replace(/^srd-2024_/, '')
  const parentKey = r.subclass_of?.key ?? null
  const baseSlug = (parentKey ?? r.key ?? '').replace(/^srd-2024_/, '')

  const features = []
  const refs = []
  const vars = []
  const taken = new Set()
  let subclassAt = null
  for (const f of r.features ?? []) {
    // A column contributes its numbers whatever else happens to the row — a few
    // columns are typed CLASS_LEVEL_FEATURE and are a real feature AND a column.
    const cols = columnVar(f, r.name, taken)
    if (cols) vars.push(...cols)

    /* ONLY REAL FEATURES. Open5e models the class TABLE as features too — one
       row per column — so "Proficiency Bonus", "Cantrips", "Rages", "Sorcery
       Points" and every spell-slot column arrive alongside Rage and Extra
       Attack, 98 of them carrying the literal text "[Column data]". They are
       the progression table, which this schema expresses as level-gated
       features and derived variables, not as rows of their own. */
    if (!FEATURE_TYPES.has(f.feature_type)) { note('defaults', `skipped-${String(f.feature_type).toLowerCase()}`); continue }
    /* Belt and braces: a placeholder body is not prose whatever its type says. */
    if (PLACEHOLDER.test((f.desc ?? '').trim())) { note('defaults', 'skipped-placeholder-prose'); continue }
    /* "Wizard Spell List" — a SECTION HEADER, not a feature. Its whole body is
       "This section presents the Wizard spell list.", it grants nothing, and
       the list it points at is already a query: every imported spell carries a
       `class:wizard` tag, so `tag:class:wizard` IS the Wizard spell list. A row
       whose only content is a pointer to something the data already answers is
       a row that can only be in the way. */
    if (/ Spell List$/.test(f.name ?? '')) { note('defaults', 'skipped-spell-list-header'); continue }
    /* "Spellcasting" is a PROPERTY OF THE CLASS, not a feature you gain. Every
       mechanical thing in it now lives on the class row: cantrips known and
       prepared spells are the level-indexed vars above, the slot progression
       comes from `caster`, and the ability is `castingAbility`. What is left is
       generic 5e rules — ritual casting, spellcasting focus — which are the
       same for every caster and belong in a rules reference, not on a card in
       one character's feature list. Keeping it would also put the slot numbers
       in two places, which is the defect this codebase has shipped twice. */
    if (f.name === 'Spellcasting' || f.name === 'Pact Magic') { note('defaults', 'skipped-spellcasting'); continue }
    /* "Wizard Subclass" is NOT a feature. It says "you gain a subclass at level
       3" — which is `ClassDef.subclassLevel`, a field, not something that
       belongs on a character's feature list. Gaining a subclass is a structural
       fact about the class; the subclass's OWN features are the features.
       The level is the one useful thing in the row, so it is read out before
       the row is dropped, replacing a hardcoded 3. */
    if (/ Subclass$/.test(f.name ?? '')) {
      const at = (f.gained_at ?? []).map(g => g.level).filter(n => typeof n === 'number')
      if (at.length) subclassAt = Math.min(...at)
      note('defaults', 'skipped-subclass-marker')
      continue
    }

    const levels = (f.gained_at ?? []).map(g => g.level).filter(n => typeof n === 'number')
    const at = levels.length ? Math.min(...levels) : null
    const fid = f.key
    features.push({
      id: fid,
      name: f.name,
      category: 'class',
      icon: featureIcon(f.name),
      folder: srdFolder(r.name),
      ...featureProse(f.desc),
      source: 'srd', srd_key: fid,
      tags: tag('class', r.name, f.name, at ? `level:${at}` : null),
    })
    // `when` is how this schema expresses progression — see FeatureGrantRef.
    refs.push(at ? { feature_id: fid, when: `level >= ${at}` } : { feature_id: fid })
  }

  if (!PRIMARY[baseSlug]) {
    report.warnings.push(`class ${r.name}: no primary ability supplied for "${baseSlug}" — add it to PRIMARY`)
  }

  const cls = {
    name: r.name,
    icon: CLASS_ICON[baseSlug] ?? 'fa-shield-halved',
    desc: r.desc || '',
    hitDie: Number(String(r.hit_dice ?? 'D8').replace(/\D/g, '')) || 8,
    primaryAbility: PRIMARY[baseSlug],
    saveProficiencies: (r.saving_throws ?? [])
      .map(x => ABIL_NAME[(x.name ?? '').toLowerCase()]).filter(Boolean),
    skillChoices: [], skillChooseN: 0,
    proficiencies: {},
    startingEquipment: [],
    caster: CASTER[r.caster_type] ?? 'none',
    features: refs,
    tags: tag('class', r.name, parentKey ? 'subclass' : 'baseclass',
      CASTER[r.caster_type] !== 'none' ? 'caster' : null),
    vars, graph: [],
    ...(parentKey ? { parent: parentKey } : { subclassLevel: subclassAt ?? 3, subclassLabel: 'Subclass' }),
    source: 'srd', srd_key: r.key,
  }
  return { cls, features }
}

// ── run ──────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`SRD 5.2 import · stage 1 · document ${DOC}${DRY ? ' · DRY RUN' : ''}\n`)

  const [weapons, armor, items, magicitems, spells, species, feats, backgrounds, classes] = await Promise.all([
    fetchAll('weapons'), fetchAll('armor'), fetchAll('items'),
    fetchAll('magicitems'), fetchAll('spells'), fetchAll('species'), fetchAll('feats'),
    fetchAll('backgrounds'), fetchAll('classes'),
  ])

  const weaponsByKey = new Map(weapons.map(w => [w.key, w]))
  const armorByKey = new Map(armor.map(a => [a.key, a]))

  const outItems = [...items, ...magicitems].map(r => toItem(r, weaponsByKey, armorByKey)).filter(Boolean)
  const outSpells = spells.map(toSpell).filter(Boolean)
  const outFeats = feats.map(toFeat)
  /* Feats first, so backgrounds can point at them. */
  const featIndex = new Map(outFeats.map(f => [normalizeTag(f.name), f.id]))
  const outBackgrounds = backgrounds.map(r => toBackground(r, featIndex))
  const classPairs = classes.map(toClass)
  const outClasses = classPairs.map(x => x.cls)
  const outClassFeatures = classPairs.flatMap(x => x.features)
  const speciesPairs = species.map(toSpecies)
  const outRaces = speciesPairs.map(x => x.race)
  const outRacialFeatures = speciesPairs.flatMap(x => x.features)

  const files = {
    'items.json': outItems,
    'spells.json': outSpells,
    'races.json': outRaces,
    'features.json': [...outRacialFeatures, ...outFeats, ...outClassFeatures],
    'classes.json': outClasses,
    'backgrounds.json': outBackgrounds,
  }

  /* THE GATE. The same check stage 2 runs before it writes rows — one
     implementation, so the two can never drift into disagreeing about what a
     valid dataset is. Stage 1 fails loudly rather than writing JSON a loader
     would then refuse. */
  const dataset = {
    items: outItems, spells: outSpells, races: outRaces,
    features: files['features.json'], backgrounds: outBackgrounds, classes: outClasses,
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
