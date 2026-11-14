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

use common::gen::*;
use common::{ask, cases, num};
use engine_core::expr::{Scope, ScopeVal};
use engine_core::js;
use engine_core::sheet;
use proptest::prelude::*;
use serde_json::{json, Value};

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
