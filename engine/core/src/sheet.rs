//! The sheet layer — what is active on a character, and the effective sheet
//! every screen displays. A port of `src/lib/effects.ts` and the helpers it
//! pulls in from `modEditor.ts`, `dnd.ts`, `equip.ts`, `shards.ts`, `spells.ts`
//! and `burden.ts`. Each function names its original.
//!
//! Everything here reads `Val`s — see `value.rs` for why — and is LENIENT about
//! malformed data: where the original would throw a TypeError reading a property
//! of `undefined`, this reads the property as absent. A recorded deviation.

use crate::expr::{self, Eval, EvalError, FormulaValue, Lookup, ScopeVal};
use crate::js;
use crate::value::{Map, Val};

/// equip.ts:64.
pub const ITEM_SLOTS: [&str; 8] = ["helmet", "armor", "cloak", "boots", "gloves", "neck", "ring1", "ring2"];
/// equip.ts:45.
const CONTAINER_KIND_ORDER: [&str; 4] = ["sack", "backpack", "bagOfHolding", "quiver"];
/// shards.ts:17.
pub const SHARD_SLOT_KEYS: [&str; 3] = ["slot1", "slot2", "slot3"];
pub const ABILITY_KEYS: [&str; 6] = ["str", "dex", "con", "int", "wis", "cha"];

/// dnd.ts:30. (display name, key)
pub const SKILLS: [(&str, &str); 18] = [
    ("Acrobatics", "acrobatics"),
    ("Animal Handling", "animalHandling"),
    ("Arcana", "arcana"),
    ("Athletics", "athletics"),
    ("Deception", "deception"),
    ("History", "history"),
    ("Insight", "insight"),
    ("Intimidation", "intimidation"),
    ("Investigation", "investigation"),
    ("Medicine", "medicine"),
    ("Nature", "nature"),
    ("Perception", "perception"),
    ("Performance", "performance"),
    ("Persuasion", "persuasion"),
    ("Religion", "religion"),
    ("Sleight of Hand", "sleightOfHand"),
    ("Stealth", "stealth"),
    ("Survival", "survival"),
];

/// modEditor.ts:23.
pub const MOD_STATS: [&str; 16] = [
    "STR",
    "DEX",
    "CON",
    "INT",
    "WIS",
    "CHA",
    "AC",
    "Attack",
    "Extra Attacks",
    "Damage",
    "Saves",
    "Speed",
    "Initiative",
    "Darkvision",
    "Max HP",
    "Carry Capacity \u{d7}",
];

fn obj(pairs: impl IntoIterator<Item = (&'static str, Val)>) -> Val {
    Val::obj(pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
}

fn empty_obj() -> Val {
    Val::obj(Map::new())
}

// --- dnd.ts ------------------------------------------------------------------------

/// dnd.ts:72. `floor((score - 10) / 2)`.
pub fn ability_mod(score: f64) -> f64 {
    ((score - 10.0) / 2.0).floor()
}

fn zero_scores() -> Val {
    obj(ABILITY_KEYS.map(|k| (k, Val::Num(10.0))))
}

/// dnd.ts:83. `sheet.abilities ?? ZERO_SCORES`.
pub fn abilities(sheet: &Val) -> Val {
    sheet.get("abilities").or(&zero_scores()).clone()
}

/// dnd.ts:87. `sheet.proficiencyBonus ?? 2`.
pub fn proficiency(sheet: &Val) -> Val {
    sheet.get("proficiencyBonus").or(&Val::Num(2.0)).clone()
}

// --- equip.ts ------------------------------------------------------------------------

/// equip.ts:24. `character.equipped ?? {}`.
fn get_gear(character: &Val) -> Val {
    character.get("equipped").or(&empty_obj()).clone()
}

/// equip.ts:36. Equipped containers, in tab order.
fn get_containers(gear: &Val) -> Vec<Val> {
    let by_kind = gear.get("containers");
    CONTAINER_KIND_ORDER
        .iter()
        .map(|kind| by_kind.get(kind))
        .filter(|c| c.truthy())
        .cloned()
        .collect()
}

// --- spells.ts ------------------------------------------------------------------------

/// spells.ts:31.
fn prepares_spells(spellbook: &Val) -> bool {
    if spellbook.get("pactMagic").truthy() {
        return false;
    }
    !spellbook.get("preparesSpells").strict_eq(&Val::Bool(false))
}

/// spells.ts:41. Cantrips and a known-style caster's spells are always ready.
fn is_prepared(spell: &Val, spellbook: &Val) -> bool {
    spell.get("level").strict_eq(&Val::Num(0.0)) || !prepares_spells(spellbook) || spell.get("prepared").truthy()
}

// --- shards.ts ------------------------------------------------------------------------

/// shards.ts:23. All three slots; a missing one reads as empty.
fn shard_slots(character: &Val) -> Vec<(&'static str, Val)> {
    let empty = obj([
        ("shardId", Val::Null),
        ("earned", Val::Num(0.0)),
        ("attuned", Val::arr(Vec::new())),
    ]);
    let raw = character.get("shards");
    SHARD_SLOT_KEYS
        .iter()
        .map(|k| (*k, raw.get(k).or(&empty).clone()))
        .collect()
}

fn find_node<'a>(tree: &'a Val, id: &Val) -> Option<&'a Val> {
    tree.get("nodes").items().iter().find(|n| n.get("id").strict_eq(id))
}

/// A granted feature as the screens see it: the original, re-identified.
fn granted(f: &Val, id: String, source: &Val) -> Map {
    let mut copy = f.spread();
    copy.insert("id".to_owned(), Val::str(&id));
    copy.insert("kind".to_owned(), f.get("kind").or(&Val::str("equipment")).clone());
    copy.insert("source".to_owned(), f.get("source").or(source).clone());
    copy
}

/// shards.ts:120. Features granted by every slotted shard.
pub fn shard_features(character: &Val, catalog: &Val) -> Vec<Val> {
    let mut out = Vec::new();
    for (slot_key, slot) in shard_slots(character) {
        let shard_id = slot.get("shardId");
        if !shard_id.truthy() {
            continue;
        }
        let tree = catalog.get_by(shard_id);
        if !tree.truthy() {
            continue;
        }
        for (i, f) in tree.get("baseFeatures").items().iter().enumerate() {
            let own = f.get("id").or(&Val::Num(i as f64)).to_js_string();
            out.push(Val::obj(granted(
                f,
                format!("shard-{slot_key}-base-{own}"),
                tree.get("name"),
            )));
        }
        for id in slot.get("attuned").items() {
            let Some(node) = find_node(tree, id) else { continue };
            for (i, f) in node.get("features").items().iter().enumerate() {
                let own = f.get("id").or(&Val::Num(i as f64)).to_js_string();
                let id = format!("shard-{slot_key}-{}-{own}", id.to_js_string());
                out.push(Val::obj(granted(f, id, node.get("name"))));
            }
        }
    }
    out
}

// --- modEditor.ts ------------------------------------------------------------------------

fn ability_of_stat(stat: &str) -> Option<&'static str> {
    ABILITY_KEYS.into_iter().find(|k| k.to_uppercase() == stat)
}

/// modEditor.ts:39.
pub fn is_ability(stat: &str) -> bool {
    ability_of_stat(stat).is_some()
}

/// modEditor.ts:76. Every stat a modifier row (or a `boost` op) may name.
pub fn is_mod_stat(stat: &str) -> bool {
    MOD_STATS.contains(&stat) || SKILLS.iter().any(|(name, _)| *name == stat)
}

/// `(eff[group] ??= {})[key] = value`.
fn set_in(eff: &mut Map, group: &str, key: &str, value: Val) {
    let mut inner = eff.get(group).map(Val::spread).unwrap_or_default();
    inner.insert(key.to_owned(), value);
    eff.insert(group.to_owned(), Val::obj(inner));
}

/// The distinct values of `list`, first occurrence kept — `[...new Set(list)]`.
fn unique(list: impl IntoIterator<Item = Val>) -> Vec<Val> {
    let mut out: Vec<Val> = Vec::new();
    for v in list {
        if !out.iter().any(|seen| seen.strict_eq(&v)) {
            out.push(v);
        }
    }
    out
}

/// modEditor.ts:44. Modifier rows (`{ stat, amt, set? }`) compiled into the
/// structured effects the sheet layers. `undefined` when they compile to nothing.
pub fn compile_effects(mods: &[Val], skills: &Val) -> Val {
    let mut eff = Map::new();
    let granted = |field: &str| unique(skills.items().iter().flat_map(|s| s.get(field).items().iter().cloned()));
    let profs = granted("skillProficiencies");
    let expertise = granted("skillExpertise");
    if !profs.is_empty() {
        eff.insert("skillProficiencies".to_owned(), Val::arr(profs));
    }
    if !expertise.is_empty() {
        eff.insert("skillExpertise".to_owned(), Val::arr(expertise));
    }
    for m in mods {
        let amt = m.get("amt");
        if !amt.as_num().is_some_and(f64::is_finite) {
            continue;
        }
        let stat = m.get("stat").as_str().unwrap_or("");
        let flat = match stat {
            "AC" => Some("ac"),
            "Attack" => Some("attack"),
            "Extra Attacks" => Some("extraAttacks"),
            "Damage" => Some("damage"),
            "Saves" => Some("saves"),
            "Speed" => Some("speed"),
            "Initiative" => Some("initiative"),
            "Darkvision" => Some("darkvision"),
            "Max HP" => Some("maxHp"),
            "Carry Capacity \u{d7}" => Some("carryMult"),
            _ => None,
        };
        if let Some(ability) = ability_of_stat(stat) {
            let group = if m.get("set").truthy() {
                "abilitySet"
            } else {
                "abilities"
            };
            set_in(&mut eff, group, ability, amt.clone());
        } else if let Some(key) = flat {
            eff.insert(key.to_owned(), amt.clone());
        } else if let Some((_, key)) = SKILLS.iter().find(|(name, _)| *name == stat) {
            set_in(&mut eff, "skills", key, amt.clone());
        }
    }
    if eff.is_empty() {
        Val::Undefined
    } else {
        Val::obj(eff)
    }
}

/// `(g.ability ?? '').toLowerCase()`, if it names an ability.
fn ability_key(v: &Val) -> Option<&'static str> {
    let key = js::to_lower_case(&v.or(&Val::str("")).to_js_string());
    ABILITY_KEYS.into_iter().find(|k| *k == key)
}

/// modEditor.ts:93. The sheet layer a node's graph declares: its `boost`,
/// `useability` and `unarmored` ops, compiled. `scope` carries `level` and `prof`
/// and nothing else; without one, every boost must be a literal number.
pub fn sheet_effects(graph: &Val, scope: Option<&dyn Lookup>) -> Eval<Val> {
    let mut mods: Vec<Val> = Vec::new();
    let mut attack_abilities: Vec<&'static str> = Vec::new();
    let mut ability_cap = Map::new();
    let mut unarmored: Vec<Val> = Vec::new();
    for g in graph.items() {
        let op = g.get("op").as_str().unwrap_or("");
        if op == "unarmored" {
            let base = g.get("value").to_number();
            if !base.is_finite() {
                continue;
            }
            let mut rule = Map::from([("base".to_owned(), Val::Num(base))]);
            if let Some(key) = ability_key(g.get("ability")) {
                rule.insert("ability".to_owned(), Val::str(key));
            }
            unarmored.push(Val::obj(rule));
            continue;
        }
        if op == "useability" {
            if let Some(key) = ability_key(g.get("ability")) {
                if !attack_abilities.contains(&key) {
                    attack_abilities.push(key);
                }
            }
            continue;
        }
        let stat = g.get("stat");
        if op != "boost" || !stat.truthy() {
            continue;
        }
        // A number, or a dice-free formula over `level` and `prof`.
        let mut amt = g.get("value").to_number();
        if !amt.is_finite() {
            let src = g.get("value").or(&Val::str("")).to_js_string();
            let evaluated = match scope {
                Some(scope) => match expr::eval_expr(&src, scope) {
                    Ok(v) => Some(v),
                    Err(EvalError::Reject(_)) => None,
                    Err(fault) => return Err(fault),
                },
                None => None,
            };
            match evaluated {
                Some(FormulaValue::Num { flat, dice }) if dice.is_empty() => amt = flat,
                _ => continue,
            }
        }
        mods.push(obj([("stat", stat.clone()), ("amt", Val::Num(amt))]));
        // Lowest wins: two "to a maximum of" clauses both have to hold.
        let cap = g.get("cap");
        let cap_n = cap.to_number();
        let ability = ABILITY_KEYS
            .into_iter()
            .find(|k| *k == js::to_lower_case(&stat.to_js_string()));
        if let (false, Some(ability)) = (cap.is_undefined(), ability) {
            if !js::trim(&cap.to_js_string()).is_empty() && cap_n.is_finite() {
                let lowest = match ability_cap.get(ability) {
                    Some(existing) => js::min(existing.num(), cap_n),
                    None => cap_n,
                };
                ability_cap.insert(ability.to_owned(), Val::Num(lowest));
            }
        }
    }
    if mods.is_empty() && attack_abilities.is_empty() && unarmored.is_empty() {
        return Ok(Val::Undefined);
    }
    let mut out = compile_effects(&mods, &Val::Undefined).spread();
    if !attack_abilities.is_empty() {
        out.insert(
            "attackAbilities".to_owned(),
            Val::arr(attack_abilities.into_iter().map(Val::str).collect()),
        );
    }
    if !unarmored.is_empty() {
        out.insert("unarmoredAc".to_owned(), Val::arr(unarmored));
    }
    if !ability_cap.is_empty() {
        out.insert("abilityCap".to_owned(), Val::obj(ability_cap));
    }
    Ok(Val::obj(out))
}

// --- effects.ts ------------------------------------------------------------------------

/// effects.ts:40. The worn gear whose effects apply passively.
pub fn worn_gear(character: &Val) -> Vec<Val> {
    let eq = character.get("equipped");
    ITEM_SLOTS
        .iter()
        .map(|k| eq.get(k))
        .filter(|i| i.truthy())
        .cloned()
        .collect()
}

/// effects.ts:46. `resources.activeEffects ?? []`.
pub fn active_effects(character: &Val) -> Vec<Val> {
    character.get("resources").get("activeEffects").items().to_vec()
}

/// effects.ts:59. Features granted by equipped items: worn gear, wielded
/// weapons and the bound shard. `uses` is stripped.
pub fn gear_features(character: &Val) -> Vec<Val> {
    let eq = get_gear(character);
    let slots = ITEM_SLOTS
        .iter()
        .map(|k| eq.get(k))
        .chain(eq.get("weapons").items())
        .chain(std::iter::once(eq.get("guideShard")))
        .filter(|i| i.truthy());
    let mut out = Vec::new();
    for item in slots {
        for (idx, f) in item.get("features").items().iter().enumerate() {
            let item_id = item.get("id").or(item.get("name")).to_js_string();
            let own = f.get("id").or(&Val::Num(idx as f64)).to_js_string();
            let mut copy = f.spread();
            copy.insert("id".to_owned(), Val::str(&format!("gear-{item_id}-{own}")));
            copy.insert("uses".to_owned(), Val::Undefined);
            copy.insert("kind".to_owned(), f.get("kind").or(&Val::str("equipment")).clone());
            copy.insert("source".to_owned(), f.get("source").or(item.get("name")).clone());
            out.push(Val::obj(copy));
        }
    }
    out
}

/// effects.ts:110. One entity that exists on this character right now. `fx` is
/// the effect bundle it contributes passively, `undefined` when it has none.
#[derive(Debug, Clone)]
pub struct Source {
    pub kind: &'static str,
    pub obj: Val,
    /// Shard nodes only: a node's id is unique only within its tree.
    pub shard_id: Val,
    pub fx: Val,
}

impl Source {
    fn new(kind: &'static str, obj: &Val, fx: Val) -> Source {
        Source {
            kind,
            obj: obj.clone(),
            shard_id: Val::Undefined,
            fx,
        }
    }

    /// Read one back from the shape `activeSources()` returns.
    pub fn from_val(v: &Val) -> Source {
        let kind = ["feature", "shard", "shardnode", "spell", "weapon", "item", "effect"]
            .into_iter()
            .find(|k| v.get("kind").as_str() == Some(k))
            .unwrap_or("");
        Source {
            kind,
            obj: v.get("obj").clone(),
            shard_id: v.get("shardId").clone(),
            fx: v.get("fx").clone(),
        }
    }

    /// The shape `activeSources()` returns in TypeScript.
    pub fn to_val(&self) -> Val {
        let mut m = Map::from([
            ("kind".to_owned(), Val::str(self.kind)),
            ("obj".to_owned(), self.obj.clone()),
        ]);
        if !self.shard_id.is_undefined() {
            m.insert("shardId".to_owned(), self.shard_id.clone());
        }
        m.insert("fx".to_owned(), self.fx.clone());
        Val::obj(m)
    }
}

/// The only scope a boost gets: `level` and `prof`, read off the row.
struct BoostScope {
    level: Val,
    prof: Val,
}

impl Lookup for BoostScope {
    fn lookup(&self, name: &str) -> Eval<Option<ScopeVal>> {
        let v = match name {
            "level" => &self.level,
            "prof" => &self.prof,
            _ => return Ok(None),
        };
        match v {
            Val::Num(n) => Ok(Some(ScopeVal::Num(*n))),
            Val::Bool(b) => Ok(Some(ScopeVal::Bool(*b))),
            _ => Err(EvalError::Fault(format!(
                "scope value {name} is neither a number nor a boolean"
            ))),
        }
    }
}

/// effects.ts:150. The attack-ability permissions an item's own graph grants, and nothing else.
fn granted_abilities(graph: &Val) -> Eval<Val> {
    let fx = sheet_effects(graph, None)?;
    let abilities = fx.get("attackAbilities");
    Ok(if abilities.items().is_empty() {
        Val::Undefined
    } else {
        obj([("attackAbilities", abilities.clone())])
    })
}

/// effects.ts:156. Everything active on this character. ORDER IS LOAD-BEARING:
/// sheet features → gear features → shard features → shards and their attuned
/// nodes → prepared spells → weapons → worn gear → applied effects.
pub fn active_sources(character: &Val, shard_trees: &Val) -> Eval<Vec<Source>> {
    let mut out = Vec::new();
    let sheet = character.get("sheet");
    let boost = BoostScope {
        level: character.get("identity").get("level").or(&Val::Num(1.0)).clone(),
        prof: proficiency(sheet),
    };

    let own = sheet.get("features").items().to_vec();
    for f in own
        .iter()
        .chain(&gear_features(character))
        .chain(&shard_features(character, shard_trees))
    {
        out.push(Source::new("feature", f, sheet_effects(f.get("graph"), Some(&boost))?));
    }

    // Slotted shards: the tree's base grant, then every attuned node. A
    // concealed, unrevealed node contributes nothing.
    for (_, slot) in shard_slots(character) {
        let shard_id = slot.get("shardId");
        if !shard_id.truthy() {
            continue;
        }
        let tree = shard_trees.get_by(shard_id);
        if !tree.truthy() {
            continue;
        }
        out.push(Source::new("shard", tree, tree.get("baseMods").clone()));
        for id in slot.get("attuned").items() {
            let Some(node) = find_node(tree, id) else { continue };
            if node.get("concealed").truthy() && !slot.get("revealed").get_by(id).truthy() {
                continue;
            }
            let mut source = Source::new("shardnode", node, node.get("mods").clone());
            source.shard_id = shard_id.clone();
            out.push(source);
        }
    }

    // READY spells only.
    let spellbook = character.get("spellbook");
    for spell in spellbook.get("spells").items() {
        if is_prepared(spell, spellbook) {
            out.push(Source::new("spell", spell, Val::Undefined));
        }
    }
    for weapon in character.get("equipped").get("weapons").items() {
        out.push(Source::new("weapon", weapon, granted_abilities(weapon.get("graph"))?));
    }
    for item in worn_gear(character) {
        let granted = granted_abilities(item.get("graph"))?;
        let fx = if granted.truthy() {
            let mut merged = item.get("effects").spread();
            merged.extend(granted.spread());
            Val::obj(merged)
        } else {
            item.get("effects").clone()
        };
        out.push(Source::new("item", &item, fx));
    }
    for effect in active_effects(character) {
        out.push(Source::new("effect", &effect, effect.get("effects").clone()));
    }
    Ok(out)
}

/// The passive bundles: `sources.flatMap(s => s.fx ?? [])`.
fn passive(sources: &[Source]) -> Vec<&Val> {
    sources.iter().map(|s| &s.fx).filter(|fx| !fx.is_nullish()).collect()
}

/// effects.ts:100. `Σ (pick(e) ?? 0)`.
fn sum(fx: &[&Val], key: &str) -> f64 {
    fx.iter().fold(0.0, |n, e| n + e.get(key).or(&Val::Num(0.0)).num())
}

fn carry_mult(fx: &[&Val]) -> f64 {
    fx.iter()
        .fold(1.0, |m, e| js::max(m, e.get("carryMult").or(&Val::Num(1.0)).num()))
}

/// effects.ts:239. The largest granted carrying-capacity multiplier.
pub fn carry_multiplier(character: &Val, shard_trees: &Val) -> Eval<f64> {
    Ok(carry_mult(&passive(&active_sources(character, shard_trees)?)))
}

// --- burden.ts ------------------------------------------------------------------------

/// burden.ts:22. `(weight ?? 0) * (qty ?? 1)`.
fn item_weight(item: &Val) -> f64 {
    item.get("weight").or(&Val::Num(0.0)).num() * item.get("qty").or(&Val::Num(1.0)).num()
}

/// burden.ts:79. Total carried weight in pounds, rounded to one decimal. The
/// contents of a weightless container do not count; the container itself does.
pub fn current_burden(character: &Val) -> f64 {
    let gear = get_gear(character);
    let containers = get_containers(&gear);
    let inventory = character.get("inventory").items();
    let weightless: Vec<&Val> = containers
        .iter()
        .chain(inventory)
        .filter(|c| c.get("container").get("weightless").truthy())
        .map(|c| c.get("id"))
        .filter(|id| id.truthy())
        .collect();
    let in_weightless = |it: &Val| weightless.iter().any(|id| id.strict_eq(it.get("containerId")));

    let mut total = 0.0;
    for it in inventory.iter().filter(|it| !in_weightless(it)) {
        total += item_weight(it);
    }
    for it in ITEM_SLOTS.iter().map(|k| gear.get(k)).filter(|it| it.truthy()) {
        total += item_weight(it);
    }
    for it in gear.get("weapons").items().iter().chain(&containers) {
        total += item_weight(it);
    }
    if gear.get("guideShard").truthy() {
        total += item_weight(gear.get("guideShard"));
    }
    js::round(total * 10.0) / 10.0
}

/// burden.ts:114 folded with effects.ts:432: the speed lost to encumbrance.
fn speed_penalty(current: f64, max: f64) -> f64 {
    if max <= 0.0 {
        0.0
    } else if current > (max * 2.0) / 3.0 {
        20.0
    } else if current > max / 3.0 {
        10.0
    } else {
        0.0
    }
}

// --- armour class and the effective sheet ----------------------------------------------

struct Candidate {
    /// As authored: shown in the breakdown untouched, and only the arithmetic coerces it.
    base: Val,
    source: Val,
    dex: bool,
    cap: Option<f64>,
    /// The second ability of an unarmored rule: (label, value).
    extra: Option<(String, f64)>,
}

fn term(label: Val, value: Val) -> Val {
    obj([("label", label), ("value", value)])
}

/// effects.ts:261. Armour Class and the working that produced it. The base is a
/// competition, never a sum; only the shield and the magic bonuses add.
pub fn armor_class(character: &Val, base: &Val, abilities: &Val, sources: &[Source]) -> (f64, Val) {
    let dex = ability_mod(abilities.get("dex").num());
    let worn = worn_gear(character);
    let armour = worn
        .iter()
        .find(|i| !i.get("isShield").truthy() && !i.get("baseAc").is_undefined());
    let shield = worn.iter().find(|i| i.get("isShield").truthy());

    let dex_of = |c: &Candidate| c.cap.map_or(dex, |cap| js::min(dex, cap));
    let value_of = |c: &Candidate| {
        c.base.num() + if c.dex { dex_of(c) } else { 0.0 } + c.extra.as_ref().map_or(0.0, |(_, value)| *value)
    };

    let mut candidates = Vec::new();
    if let Some(armour) = armour {
        let cap = armour.get("acDexCap");
        candidates.push(Candidate {
            base: armour.get("baseAc").clone(),
            source: armour.get("name").clone(),
            dex: armour.get("acAddDex").truthy(),
            cap: (!cap.is_undefined()).then(|| cap.num()),
            extra: None,
        });
    } else {
        // Unarmored rules apply only with no body armour on — a shield is fine.
        for s in sources {
            for rule in s.fx.get("unarmoredAc").items() {
                let ability = rule.get("ability");
                let extra = ability.truthy().then(|| {
                    let label = ability.to_js_string().to_uppercase();
                    (label, ability_mod(abilities.get_by(ability).num()))
                });
                candidates.push(Candidate {
                    base: rule.get("base").clone(),
                    source: s.obj.get("name").clone(),
                    dex: true,
                    cap: None,
                    extra,
                });
            }
        }
        candidates.push(Candidate {
            base: Val::Num(10.0),
            source: Val::Undefined,
            dex: true,
            cap: None,
            extra: None,
        });
    }

    // The override replaces the BASE, not the total.
    let sheet_ac = base.get("ac");
    let best = if sheet_ac.is_undefined() {
        // `reduce((a, b) => valueOf(b) > valueOf(a) ? b : a)`: the first of equals wins.
        let mut it = candidates.into_iter();
        let mut best = it.next().unwrap_or(Candidate {
            base: Val::Num(10.0),
            source: Val::Undefined,
            dex: true,
            cap: None,
            extra: None,
        });
        for c in it {
            if value_of(&c) > value_of(&best) {
                best = c;
            }
        }
        best
    } else {
        Candidate {
            base: sheet_ac.clone(),
            source: Val::Undefined,
            dex: false,
            cap: None,
            extra: None,
        }
    };

    let mut bonuses: Vec<(Val, Val)> = Vec::new();
    if let Some((label, value)) = &best.extra {
        bonuses.push((Val::str(label), Val::Num(*value)));
    }
    // The shield is one line, enchantment included.
    let shield_source = shield.and_then(|sh| sources.iter().position(|s| s.obj.get("id").strict_eq(sh.get("id"))));
    if let Some(sh) = shield.filter(|sh| sh.get("baseAc").truthy()) {
        let magic = shield_source
            .and_then(|i| sources.get(i))
            .map_or(0.0, |s| s.fx.get("ac").or(&Val::Num(0.0)).num());
        bonuses.push((sh.get("name").clone(), Val::Num(sh.get("baseAc").num() + magic)));
    }
    for (i, s) in sources.iter().enumerate() {
        if s.fx.get("ac").truthy() && Some(i) != shield_source {
            bonuses.push((s.obj.get("name").clone(), s.fx.get("ac").clone()));
        }
    }

    let total = best.base.num()
        + if best.dex { dex_of(&best) } else { 0.0 }
        + bonuses.iter().fold(0.0, |n, (_, v)| n + v.num());
    let mut breakdown = Map::from([("base".to_owned(), best.base.clone())]);
    if best.source.truthy() {
        breakdown.insert("source".to_owned(), best.source.clone());
    }
    if best.dex {
        breakdown.insert("dex".to_owned(), Val::Bool(true));
    }
    if !bonuses.is_empty() {
        let terms = bonuses.into_iter().map(|(label, value)| term(label, value)).collect();
        breakdown.insert("bonuses".to_owned(), Val::arr(terms));
    }
    (total, Val::obj(breakdown))
}

/// effects.ts:355. The base sheet with every worn-gear, shard and applied
/// effect layered in. Derived and display-only: never written back.
pub fn effective_sheet(character: &Val, shard_trees: &Val) -> Eval<Val> {
    let no_sheet = empty_obj();
    let base = character.get("sheet").or(&no_sheet);
    let sources = active_sources(character, shard_trees)?;
    let fx = passive(&sources);

    // Abilities: max(base, highest set) + Σ flat, clamped by the LOWEST cap.
    let zero = zero_scores();
    let base_ab = base.get("abilities").or(&zero);
    let mut abilities = base_ab.spread();
    for key in ABILITY_KEYS {
        let mut set_floor = base_ab.get(key).num();
        let mut flat = 0.0;
        let mut cap: Option<f64> = None;
        for e in &fx {
            let s = e.get("abilitySet").get(key);
            if !s.is_undefined() {
                set_floor = js::max(set_floor, s.num());
            }
            let b = e.get("abilities").get(key);
            if !b.is_undefined() {
                flat += b.num();
            }
            let c = e.get("abilityCap").get(key);
            if !c.is_undefined() {
                cap = Some(cap.map_or(c.num(), |lowest| js::min(lowest, c.num())));
            }
        }
        // Clamped, never lowered: a score already past the ceiling keeps what it had.
        let score = match cap {
            None => set_floor + flat,
            Some(cap) => js::max(set_floor, js::min(cap, set_floor + flat)),
        };
        abilities.insert(key.to_owned(), Val::Num(score));
    }
    let abilities = Val::obj(abilities);

    // Unioned, not summed — the one non-numeric thing an effect bundle carries.
    let attack_abilities = unique(
        base.get("attackAbilities")
            .items()
            .iter()
            .cloned()
            .chain(fx.iter().flat_map(|e| e.get("attackAbilities").items().iter().cloned())),
    );
    // `[...base.attackAbilities]` keeps the base's own duplicates; only additions are deduplicated.
    let base_attack = base.get("attackAbilities").items();
    let mut attack = base_attack.to_vec();
    for k in attack_abilities {
        if !attack.iter().any(|have| have.strict_eq(&k)) {
            attack.push(k);
        }
    }

    let (ac, ac_breakdown) = armor_class(character, base, &abilities, &sources);
    let initiative = base.get("initiative").or(&Val::Num(0.0)).num() + sum(&fx, "initiative");
    let attacks_per_action = base.get("attacksPerAction").or(&Val::Num(1.0)).num() + sum(&fx, "extraAttacks");

    let base_hp = base.get("hp");
    let hp_max = base_hp.get("max").or(&Val::Num(0.0)).num() + sum(&fx, "maxHp");
    // Clamped on READ, not on write.
    let hp = if base_hp.truthy() {
        let mut hp = base_hp.spread();
        hp.insert("max".to_owned(), Val::Num(hp_max));
        hp.insert(
            "current".to_owned(),
            Val::Num(js::min(base_hp.get("current").or(&Val::Num(0.0)).num(), hp_max)),
        );
        Val::obj(hp)
    } else {
        Val::Undefined
    };

    // Speed: gear bonuses first, then the encumbrance penalty off the effective STR.
    let gear_speed = base.get("speed").or(&Val::Num(0.0)).num() + sum(&fx, "speed");
    let capacity = abilities.get("str").num() * 15.0 * carry_mult(&fx);
    let speed = js::max(0.0, gear_speed - speed_penalty(current_burden(character), capacity));

    // Darkvision: the largest granted range.
    let mut darkvision = base.get("senses").get("darkvision").or(&Val::Num(0.0)).num();
    for e in &fx {
        let d = e.get("darkvision");
        if !d.is_undefined() {
            darkvision = js::max(darkvision, d.num());
        }
    }

    // Save bonuses: a number is all saves; an object is per ability.
    let mut save_bonuses = base.get("saveBonuses").spread();
    let add = |into: &mut Map, key: &str, by: f64| {
        let have = into.get(key).unwrap_or(&Val::Undefined).or(&Val::Num(0.0)).num();
        into.insert(key.to_owned(), Val::Num(have + by));
    };
    for e in &fx {
        let saves = e.get("saves");
        if saves.is_undefined() {
            continue;
        }
        for key in ABILITY_KEYS {
            match saves {
                Val::Num(all) => add(&mut save_bonuses, key, *all),
                per_ability => {
                    let v = per_ability.get(key);
                    if !v.is_undefined() {
                        add(&mut save_bonuses, key, v.num());
                    }
                }
            }
        }
    }

    let mut skill_bonuses = base.get("skillBonuses").spread();
    for e in &fx {
        for (key, v) in e.get("skills").entries() {
            if !v.is_undefined() {
                add(&mut skill_bonuses, key, v.num());
            }
        }
    }

    // Granted proficiency and expertise: a union with what the character has.
    // Expertise implies proficiency, so a grant of one is a grant of both.
    let listed = |field: &'static str| fx.iter().flat_map(move |e| e.get(field).items().iter().cloned());
    let skill_proficiencies = unique(
        base.get("skillProficiencies")
            .items()
            .iter()
            .cloned()
            .chain(listed("skillProficiencies"))
            .chain(listed("skillExpertise")),
    );
    let skill_expertise = unique(
        base.get("skillExpertise")
            .items()
            .iter()
            .cloned()
            .chain(listed("skillExpertise")),
    );

    let mut senses = base.get("senses").spread();
    senses.insert("darkvision".to_owned(), Val::Num(darkvision));

    let mut out = base.spread();
    for (key, value) in [
        ("abilities", abilities),
        ("ac", Val::Num(ac)),
        ("speed", Val::Num(speed)),
        ("acBreakdown", ac_breakdown),
        ("initiative", Val::Num(initiative)),
        ("attacksPerAction", Val::Num(attacks_per_action)),
        ("hp", hp),
        ("senses", Val::obj(senses)),
        ("attackAbilities", Val::arr(attack)),
        ("saveBonuses", Val::obj(save_bonuses)),
        ("skillBonuses", Val::obj(skill_bonuses)),
        ("skillProficiencies", Val::arr(skill_proficiencies)),
        ("skillExpertise", Val::arr(skill_expertise)),
        ("__effective", Val::Bool(true)),
    ] {
        out.insert(key.to_owned(), value);
    }
    Ok(Val::obj(out))
}
