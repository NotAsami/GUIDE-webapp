//! Generators of character data, shared by the sheet and graph oracle tests.
#![allow(dead_code)]

use engine_core::sheet;
use engine_core::value::Val;
use proptest::prelude::*;
use serde_json::{json, Map, Value};

use super::num;

pub type J = BoxedStrategy<Value>;

/// A `Val` in the oracle's spelling: numbers as strings, `undefined` keys dropped.
pub fn shown(v: &Val) -> Value {
    match v {
        Val::Undefined | Val::Null => Value::Null,
        Val::Bool(b) => json!(b),
        Val::Num(n) => num(*n),
        Val::Str(s) => json!(&**s),
        Val::Arr(a) => Value::Array(a.iter().map(shown).collect()),
        Val::Obj(m) => Value::Object(
            m.iter()
                .filter(|(_, v)| !v.is_undefined())
                .map(|(k, v)| (k.clone(), shown(v)))
                .collect(),
        ),
    }
}

pub fn val(v: &Value) -> Val {
    serde_json::from_value(v.clone()).unwrap()
}

/// Compare unless the original threw.
pub fn check(want: Value, got: impl FnOnce() -> Value) -> Result<(), TestCaseError> {
    if want.get("threw").is_some() {
        eprintln!(
            "SKIPPED-THREW {}",
            want.get("why").and_then(|w| w.as_str()).unwrap_or("")
        );
        return Ok(());
    }
    prop_assert_eq!(json!({ "ok": got() }), want);
    Ok(())
}

// --- generators ----------------------------------------------------------------

/// An object whose every field is sometimes missing and occasionally null.
pub fn object(fields: Vec<(&'static str, J)>) -> J {
    let entries: Vec<BoxedStrategy<Option<(String, Value)>>> = fields
        .into_iter()
        .map(|(key, s)| {
            prop_oneof![
                12 => s.prop_map(move |v| Some((key.to_owned(), v))),
                5 => Just(None),
                1 => Just(Some((key.to_owned(), Value::Null))),
            ]
            .boxed()
        })
        .collect();
    entries
        .prop_map(|e| Value::Object(e.into_iter().flatten().collect::<Map<_, _>>()))
        .boxed()
}

pub fn n() -> J {
    prop_oneof![4 => (-3i32..25).prop_map(|n| json!(n)), 1 => (-10i32..60).prop_map(|n| json!(f64::from(n) / 2.0)), 1 => Just(json!(0))].boxed()
}

pub fn flag() -> J {
    any::<bool>().prop_map(|b| json!(b)).boxed()
}

pub fn pick(options: &'static [&'static str]) -> J {
    prop::sample::select(options).prop_map(|s| json!(s)).boxed()
}

pub fn list(of: J, max: usize) -> J {
    prop::collection::vec(of, 0..max).prop_map(Value::Array).boxed()
}

pub const ABILITIES: &[&str] = &["str", "dex", "con", "int", "wis", "cha"];
pub const SKILL_KEYS: &[&str] = &["stealth", "perception", "athletics", "sleightOfHand", "Stealth"];

pub fn per_ability() -> J {
    object(ABILITIES.iter().map(|k| (*k, n())).collect())
}

fn raw_effects() -> J {
    object(vec![
        ("abilities", per_ability()),
        ("abilitySet", per_ability()),
        ("abilityCap", per_ability()),
        ("ac", n()),
        ("extraAttacks", n()),
        ("speed", n()),
        ("initiative", n()),
        ("darkvision", n()),
        ("maxHp", n()),
        ("carryMult", n()),
        ("saves", prop_oneof![n(), per_ability()].boxed()),
        ("skills", object(SKILL_KEYS.iter().map(|k| (*k, n())).collect())),
        ("skillProficiencies", list(pick(SKILL_KEYS), 3)),
        ("skillExpertise", list(pick(SKILL_KEYS), 3)),
        ("attackAbilities", list(pick(ABILITIES), 3)),
        (
            "unarmoredAc",
            list(
                object(vec![("base", n()), ("ability", pick(&["wis", "con", "xyz"]))]),
                2,
            ),
        ),
    ])
}

/// An effect bundle. `saves: null` is left out: the original throws on it at the
/// first read (effects.ts:447), which would skip nearly every case that carries one.
pub fn effects() -> J {
    raw_effects()
        .prop_map(|mut e| {
            if e.get("saves").is_some_and(Value::is_null) {
                e.as_object_mut().map(|m| m.remove("saves"));
            }
            e
        })
        .boxed()
}

pub fn graph() -> J {
    let value = prop_oneof![
        3 => n(),
        2 => pick(&["2", " 3 ", "", "level", "prof * 2", "level / 4 + 1", "1d4", "str", "level +", "0x10", "1e1", "Infinity"]),
    ]
    .boxed();
    let cap = prop_oneof![n(), pick(&["20", "", " ", "x", "18.5"])].boxed();
    list(
        object(vec![
            ("id", pick(&["e1", "e2", "e3"])),
            (
                "op",
                pick(&["boost", "boost", "useability", "unarmored", "add", "note"]),
            ),
            (
                "stat",
                pick(&[
                    "STR",
                    "DEX",
                    "CON",
                    "AC",
                    "Speed",
                    "Max HP",
                    "Stealth",
                    "Extra Attacks",
                    "Carry Capacity \u{d7}",
                    "Saves",
                    "str",
                    "Nope",
                    "",
                ]),
            ),
            ("value", value),
            ("cap", cap),
            ("ability", pick(&["wis", "WIS", "dex", "xyz", ""])),
            ("when", pick(&["level > 3"])),
        ]),
        4,
    )
}

pub fn feature() -> J {
    object(vec![
        ("id", pick(&["f1", "f2", "f3"])),
        ("name", pick(&["Rage", "Unarmored Defense", "Lucky"])),
        ("kind", pick(&["class", "racial"])),
        ("source", pick(&["Barbarian"])),
        ("graph", graph()),
        ("uses", object(vec![("max", n()), ("current", n())])),
    ])
}

pub fn item() -> J {
    object(vec![
        ("id", pick(&["i1", "i2", "i3", "bag"])),
        (
            "name",
            pick(&["Chain Mail", "Shield", "Cloak of Protection", "Bag of Holding"]),
        ),
        ("weight", n()),
        ("qty", n()),
        ("isShield", flag()),
        ("baseAc", n()),
        ("acAddDex", flag()),
        ("acDexCap", n()),
        ("effects", effects()),
        ("graph", graph()),
        ("features", list(feature(), 2)),
        ("container", object(vec![("weightless", flag())])),
        ("containerId", pick(&["bag", "i1", "nowhere"])),
    ])
}

pub fn trees() -> J {
    let node = object(vec![
        ("id", pick(&["core", "n1", "n2"])),
        ("name", pick(&["Ember Core", "Kindle"])),
        ("mods", effects()),
        ("features", list(feature(), 2)),
        ("graph", graph()),
        ("concealed", flag()),
    ]);
    let tree = (list(node, 4), effects(), list(feature(), 2), any::<bool>())
        .prop_map(|(nodes, base_mods, base_features, with_base)| {
            let mut t = json!({ "name": "Shard of Cinder", "nodes": nodes });
            if with_base {
                t["baseMods"] = base_mods;
                t["baseFeatures"] = base_features;
            }
            t
        })
        .boxed();
    object(vec![("cinder", tree.clone()), ("tide", tree)])
}

pub fn character() -> J {
    let slot = (
        pick(&["cinder", "tide", "gone"]),
        list(pick(&["core", "n1", "n2", "ghost"]), 4),
        object(vec![("n1", flag()), ("core", flag())]),
        0u8..4,
    )
        .prop_map(|(id, attuned, revealed, shape)| match shape {
            0 => json!({ "shardId": null, "earned": 0, "attuned": [] }),
            1 => json!({ "shardId": id, "earned": 3, "attuned": attuned }),
            _ => json!({ "shardId": id, "earned": 3, "attuned": attuned, "revealed": revealed }),
        })
        .boxed();
    let sheet = object(vec![
        ("abilities", prop_oneof![4 => (n(), n(), n(), n(), n(), n()).prop_map(|(a, b, c, d, e, f)| json!({"str": a, "dex": b, "con": c, "int": d, "wis": e, "cha": f})), 1 => per_ability()].boxed()),
        ("proficiencyBonus", n()),
        ("ac", n()),
        ("speed", n()),
        ("initiative", n()),
        ("attacksPerAction", n()),
        ("hp", object(vec![("current", n()), ("max", n()), ("temp", n())])),
        ("senses", object(vec![("darkvision", n()), ("passive", n())])),
        ("saveBonuses", per_ability()),
        ("skillBonuses", object(SKILL_KEYS.iter().map(|k| (*k, n())).collect())),
        ("skillProficiencies", list(pick(SKILL_KEYS), 3)),
        ("skillExpertise", list(pick(SKILL_KEYS), 3)),
        ("attackAbilities", list(pick(ABILITIES), 3)),
        ("features", list(feature(), 4)),
        ("notes", pick(&["kept as written"])),
    ]);
    let mut worn: Vec<(&'static str, J)> = sheet::ITEM_SLOTS.iter().map(|k| (*k, item())).collect();
    worn.push(("weapons", list(item(), 3)));
    worn.push(("guideShard", item()));
    worn.push((
        "containers",
        object(vec![("backpack", item()), ("bagOfHolding", item()), ("pouch", item())]),
    ));
    let spell = object(vec![
        ("id", pick(&["s1", "s2"])),
        ("name", pick(&["Fire Bolt"])),
        ("level", (0u8..3).prop_map(|l| json!(l)).boxed()),
        ("prepared", flag()),
        ("graph", graph()),
    ]);
    let effect = object(vec![
        ("id", pick(&["a1", "a2"])),
        ("name", pick(&["Bless"])),
        ("effects", effects()),
    ]);
    object(vec![
        (
            "identity",
            object(vec![("level", (1u8..21).prop_map(|l| json!(l)).boxed())]),
        ),
        ("sheet", sheet),
        ("equipped", object(worn)),
        ("inventory", list(item(), 5)),
        (
            "spellbook",
            object(vec![
                ("spells", list(spell, 4)),
                ("preparesSpells", flag()),
                ("pactMagic", flag()),
                ("saveDC", n()),
            ]),
        ),
        (
            "shards",
            object(vec![("slot1", slot.clone()), ("slot2", slot.clone()), ("slot3", slot)]),
        ),
        ("resources", object(vec![("activeEffects", list(effect, 3))])),
    ])
}

/// Like `object`, but a field is present or missing, never null — for requests,
/// whose values go straight into the roll scope.
pub fn strict_object(fields: Vec<(&'static str, J)>) -> J {
    let entries: Vec<BoxedStrategy<Option<(String, Value)>>> = fields
        .into_iter()
        .map(|(key, s)| prop_oneof![2 => s.prop_map(move |v| Some((key.to_owned(), v))), 1 => Just(None)].boxed())
        .collect();
    entries
        .prop_map(|e| Value::Object(e.into_iter().flatten().collect::<Map<_, _>>()))
        .boxed()
}

pub const FORMULAS: &[&str] = &[
    "2",
    "1d4",
    "-1d4",
    "level",
    "level / 2",
    "prof + wis",
    "x",
    "x + y",
    "counter",
    "isOn ? 1d6 : 0",
    "cast",
    "hit",
    "level +",
    "",
    "[1,2,3][level]",
    "2d6 * 1d4",
    "has_rage ? 2 : 0",
    "has_nothing",
    "isOn",
    "\"s\"",
    "nope",
    "cast * 1d6",
    "1000000000000000000000 * 1d6",
];
pub const CONDITIONS: &[&str] = &[
    "isOn",
    "level >= 5",
    "hit",
    "hit && isOn",
    "cast >= 3",
    "x > 1",
    "nope",
    "",
    "1",
    "proficient",
    "targetAc >= 15",
    "!isOn",
    "has_rage",
    "counter > 0",
    "hit || level > 3",
];
pub const TARGETS: &[&str] = &[
    "roll:attack",
    "roll:attack.melee",
    "roll:attack.str",
    "roll:damage",
    "roll:damage.melee",
    "roll:save",
    "roll:save.dex",
    "roll:check",
    "roll:d20",
    "roll:feature",
    "roll:bogus",
    "roll:attack.",
    "roll:attack.melee.x",
    "tag:fire",
    "tag: Fire ",
    "tag:Radiant Damage",
    "feature:f1",
    "feature:rage",
    "item:i1",
    "spell:s1",
    "shardnode:cinder.core",
    "weapon:i1",
    "nope",
    "x:y",
];
pub const OPS: &[&str] = &[
    "add",
    "add",
    "add",
    "adv",
    "dis",
    "crit",
    "floor",
    "reroll",
    "note",
    "note",
    "rename",
    "resist",
    "vuln",
    "immune",
    "boost",
    "useability",
    "unarmored",
    "setVar",
    "addVar",
    "addUses",
    "addSlot",
    "setHp",
    "grant",
];
pub const GIDS: &[&str] = &[
    "feature:rage",
    "feature:f1",
    "feature:f2",
    "item:i1",
    "weapon:i1",
    "spell:s1",
    "shardnode:cinder.core",
];
pub const VAR_NAMES: &[&str] = &["x", "y", "isOn", "counter", "dm", "Bad", "level"];
pub const PROSE: &[&str] = &[
    "Rage",
    "Add {level >= 5 ? 2d10 : 1d10} to it",
    "DC {8 + prof}",
    "{bad +}",
    "{nope}",
    "",
    "plain text",
    "{x} and {isOn ? \"on\" : \"off\"}",
];
pub const ASKS: &[&str] = &["Did it?", " did  IT? ", "", "Other question", "Did the attack hit?"];

/// A graph effect of any op, with fields that fit it and fields that do not.
pub fn rich_effect() -> J {
    strict_object(vec![
        ("id", pick(&["e1", "e2", "e3", "e4"])),
        ("label", pick(PROSE)),
        ("target", list(pick(TARGETS), 4)),
        ("match", pick(&["and", "or", "and"])),
        ("value", prop_oneof![5 => pick(FORMULAS), 1 => n()].boxed()),
        ("when", pick(CONDITIONS)),
        ("ask", pick(ASKS)),
        ("once", flag()),
        ("oneOf", flag()),
        ("dmgType", pick(&["fire", " Fire ", "", "cold"])),
        ("text", pick(PROSE)),
        ("threshold", pick(&["19", "20 - 1", "x", "1d4", "", "nope"])),
        ("minimum", pick(&["10", "level", "bad +", "1d4"])),
        ("keep", pick(&["advantage", "new", "better", "odd"])),
        ("faces", pick(&["2", " ", "x", "1d4", "level / 3"])),
        ("stat", pick(&["STR", "AC", "Speed", "Max HP", "Stealth", "Nope", ""])),
        ("cap", prop_oneof![n(), pick(&["20", "", "x"])].boxed()),
        ("ability", pick(&["wis", "WIS", "xyz", ""])),
        ("variable", pick(&["x", "isOn", "y", "dm", "ghost"])),
        (
            "byLevel",
            list(pick(&["", "", "1", "1d6", "level", "bad +", "nope"]), 7),
        ),
        ("to", pick(&["New Name"])),
    ])
    .prop_flat_map(|e| {
        pick(OPS).prop_map(move |op| {
            let mut e = e.clone();
            e["op"] = op;
            e
        })
    })
    .boxed()
}

pub fn var_def() -> J {
    strict_object(vec![
        ("name", pick(VAR_NAMES)),
        ("kind", pick(&["stored", "derived", "derived"])),
        ("type", pick(&["num", "bool"])),
        (
            "formula",
            pick(&[
                "y + 1",
                "x * 2",
                "level",
                "isOn ? 1 : 0",
                "x",
                "nope",
                "1d4",
                "[1,2]",
                "\"s\"",
                "",
                "counter + 1",
                "y",
                " ",
            ]),
        ),
        (
            "uses",
            prop_oneof![1 => pick(&["feature:f1", "feature:rage", "item:i1"]), 5 => Just(json!(""))].boxed(),
        ),
        ("scope", pick(&["dm", "player"])),
        ("initial", prop_oneof![n(), flag()].boxed()),
        ("label", pick(&["A Label"])),
        ("resetOn", pick(&["turn", "short"])),
    ])
}

pub fn rich_feature() -> J {
    strict_object(vec![
        ("id", pick(&["f1", "f2", "f3"])),
        ("feature_id", pick(&["rage", "f1", "f2"])),
        (
            "name",
            pick(&["Rage", "Reckless Attack", "Improved Brutal Strike (Enhanced)"]),
        ),
        ("__baseName", pick(&["Rage"])),
        ("tags", list(pick(&["fire", "Fire", "cold"]), 2)),
        ("light_description", pick(&["Card text.", " "])),
        ("graph", list(rich_effect(), 5)),
        ("vars", list(var_def(), 4)),
        (
            "uses",
            object(vec![
                ("max", prop_oneof![n(), pick(&["2", "level", "x", "1d4", " "])].boxed()),
                ("current", n()),
            ]),
        ),
    ])
}

pub fn armed_mod() -> J {
    strict_object(vec![
        ("id", pick(&["a1", "a2", "a3", "a4"])),
        ("source", pick(&["feature:rage", "feature:f1", "elsewhere"])),
        ("sourceName", pick(&["Rage", ""])),
        ("eff", pick(&["e1", "e2"])),
        ("label", pick(PROSE)),
        ("kind", pick(&["attack", "damage", "d20", "save", "feature"])),
        ("sub", pick(&["melee", "str", "dex"])),
        ("subject", pick(GIDS)),
        ("op", pick(&["add", "add", "adv", "dis", "crit", "note"])),
        ("value", pick(FORMULAS)),
        ("dmgType", pick(&["fire", "cold"])),
        ("picks", n()),
        ("ask", pick(ASKS)),
        ("text", pick(PROSE)),
        ("spent", pick(&["roll-1", ""])),
    ])
}

/// A character whose features carry real graphs and variables, with stored
/// state and an armed queue.
pub fn graph_character() -> J {
    let state = strict_object(vec![
        ("vars", strict_object(vec![("x", n()), ("isOn", flag()), ("y", n())])),
        ("dmVars", strict_object(vec![("dm", n()), ("x", n())])),
        ("armed", list(armed_mod(), 4)),
        ("attacks", n()),
    ]);
    (character(), list(rich_feature(), 4), state, list(rich_effect(), 3))
        .prop_map(|(mut c, features, state, weapon_graph)| {
            if !c["sheet"].is_object() {
                c["sheet"] = json!({});
            }
            c["sheet"]["features"] = features;
            if !c["resources"].is_object() {
                c["resources"] = json!({});
            }
            c["resources"]["graph"] = state;
            if let Some(weapon) = c["equipped"]["weapons"].get_mut(0).filter(|w| w.is_object()) {
                weapon["graph"] = weapon_graph;
                weapon["item_id"] = json!("i1");
            }
            c
        })
        .boxed()
}

pub fn request() -> J {
    strict_object(vec![
        (
            "kind",
            pick(&["attack", "attack", "damage", "save", "check", "feature", "bogus"]),
        ),
        ("cast", n()),
        ("proficient", flag()),
        ("targetAc", n()),
        ("hit", flag()),
        ("sub", pick(&["melee", "ranged", "dex", "stealth"])),
        ("subject", pick(GIDS)),
        ("tags", list(pick(&["fire", " Fire", "cold", "Radiant  Damage"]), 3)),
        ("ability", pick(&["str", "dex"])),
    ])
    .prop_map(|mut r| {
        if r.get("kind").is_none() {
            r["kind"] = json!("attack");
        }
        r
    })
    .boxed()
}

pub fn catalog_types() -> J {
    strict_object(vec![
        ("x", pick(&["num", "bool"])),
        ("far", pick(&["num", "bool"])),
        ("isOn", pick(&["bool"])),
        ("nope", pick(&["num"])),
    ])
}
