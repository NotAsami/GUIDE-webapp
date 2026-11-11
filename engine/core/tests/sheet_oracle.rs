//! The sheet layer on GENERATED characters, with the TypeScript engine as oracle.
//!
//!   cargo test -p engine_core --test sheet_oracle
//!
//! The catalog corpus (src/lib/engine.corpus.test.ts) covers the content that
//! exists; this covers the shapes it does not — fields missing, null, zero,
//! duplicated ids, shards the catalog lacks, caps and formulas of every kind.
//!
//! Where the original THROWS (a TypeError on malformed data, e.g. `attuned: null`)
//! the case is skipped: the port reads such data as absent, a recorded deviation.

mod common;

use common::{ask, cases, num};
use engine_core::expr::{Scope, ScopeVal};
use engine_core::js;
use engine_core::sheet;
use engine_core::value::Val;
use proptest::prelude::*;
use serde_json::{json, Map, Value};

type J = BoxedStrategy<Value>;

/// A `Val` in the oracle's spelling: numbers as strings, `undefined` keys dropped.
fn shown(v: &Val) -> Value {
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

fn val(v: &Value) -> Val {
    serde_json::from_value(v.clone()).unwrap()
}

/// Compare unless the original threw.
fn check(want: Value, got: impl FnOnce() -> Value) -> Result<(), TestCaseError> {
    if want.get("threw").is_some() {
        return Ok(());
    }
    prop_assert_eq!(json!({ "ok": got() }), want);
    Ok(())
}

// --- generators ----------------------------------------------------------------

/// An object whose every field is sometimes missing and occasionally null.
fn object(fields: Vec<(&'static str, J)>) -> J {
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

fn n() -> J {
    prop_oneof![4 => (-3i32..25).prop_map(|n| json!(n)), 1 => (-10i32..60).prop_map(|n| json!(f64::from(n) / 2.0)), 1 => Just(json!(0))].boxed()
}

fn flag() -> J {
    any::<bool>().prop_map(|b| json!(b)).boxed()
}

fn pick(options: &'static [&'static str]) -> J {
    prop::sample::select(options).prop_map(|s| json!(s)).boxed()
}

fn list(of: J, max: usize) -> J {
    prop::collection::vec(of, 0..max).prop_map(Value::Array).boxed()
}

const ABILITIES: &[&str] = &["str", "dex", "con", "int", "wis", "cha"];
const SKILL_KEYS: &[&str] = &["stealth", "perception", "athletics", "sleightOfHand", "Stealth"];

fn per_ability() -> J {
    object(ABILITIES.iter().map(|k| (*k, n())).collect())
}

fn effects() -> J {
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

fn graph() -> J {
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

fn feature() -> J {
    object(vec![
        ("id", pick(&["f1", "f2", "f3"])),
        ("name", pick(&["Rage", "Unarmored Defense", "Lucky"])),
        ("kind", pick(&["class", "racial"])),
        ("source", pick(&["Barbarian"])),
        ("graph", graph()),
        ("uses", object(vec![("max", n()), ("current", n())])),
    ])
}

fn item() -> J {
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

fn trees() -> J {
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

fn character() -> J {
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

proptest! {
    #![proptest_config(ProptestConfig { cases: cases() / 4, failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn the_sheet_layer_matches(character in character(), trees in trees()) {
        let (c, t) = (val(&character), val(&trees));
        let req = |f: &str| ask(json!({ "fn": f, "character": character, "trees": trees }));
        check(req("activeSources"), || match sheet::active_sources(&c, &t) {
            Ok(sources) => Value::Array(sources.iter().map(|s| shown(&s.to_val())).collect()),
            Err(e) => json!(format!("{e:?}")),
        })?;
        check(req("effectiveSheet"), || match sheet::effective_sheet(&c, &t) {
            Ok(sheet) => shown(&sheet),
            Err(e) => json!(format!("{e:?}")),
        })?;
        check(req("gearFeatures"), || Value::Array(sheet::gear_features(&c).iter().map(shown).collect()))?;
        check(req("shardFeatures"), || Value::Array(sheet::shard_features(&c, &t).iter().map(shown).collect()))?;
        check(req("carryMultiplier"), || sheet::carry_multiplier(&c, &t).map_or(Value::Null, num))?;
        check(req("currentBurden"), || num(sheet::current_burden(&c)))?;
    }

    #[test]
    fn sheet_effects_match(graph in graph(), level in 1u8..21, prof in 2u8..7, scoped in any::<bool>()) {
        let scope: Scope = [("level".to_owned(), ScopeVal::Num(f64::from(level))), ("prof".to_owned(), ScopeVal::Num(f64::from(prof)))].into_iter().collect();
        let want = ask(json!({ "fn": "sheetEffects", "graph": graph, "scope": if scoped { json!({ "level": level, "prof": prof }) } else { Value::Null } }));
        check(want, || sheet::sheet_effects(&val(&graph), scoped.then_some(&scope as _)).map_or(json!("fault"), |v| shown(&v)))?;
    }

    #[test]
    fn compile_effects_match(
        mods in list(object(vec![("stat", pick(&["STR", "WIS", "AC", "Attack", "Damage", "Saves", "Stealth", "Sleight of Hand", "Carry Capacity \u{d7}", "Nope"])), ("amt", n()), ("set", flag())]), 6),
        skills in list(object(vec![("skillProficiencies", list(pick(SKILL_KEYS), 3)), ("skillExpertise", list(pick(SKILL_KEYS), 3))]), 3),
    ) {
        let want = ask(json!({ "fn": "compileEffects", "mods": mods, "skills": skills }));
        check(want, || shown(&sheet::compile_effects(val(&mods).items(), &val(&skills))))?;
    }

    #[test]
    fn number_coercion_and_rounding_match(s in "[-+0-9.eExXoObBa-fIinfty \u{00A0}\u{FEFF}]{0,10}", x in prop_oneof![-1e6f64..1e6, (-200i32..200).prop_map(|h| f64::from(h) / 4.0)]) {
        prop_assert_eq!(json!({ "ok": num(js::string_to_number(&s)) }), ask(json!({ "fn": "toNumber", "src": s })));
        prop_assert_eq!(json!({ "ok": num(js::round(x)) }), ask(json!({ "fn": "round", "src": num(x) })));
    }
}
