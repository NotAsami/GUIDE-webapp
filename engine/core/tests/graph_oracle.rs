//! The feature graph on GENERATED characters, with the TypeScript engine as oracle.
//!
//!   cargo test -p engine_core --test graph_oracle
//!
//! The catalog corpus runs the content that exists, which is mostly well formed.
//! This runs what an author could get wrong: every op with fields that do not
//! belong to it, conditions that do not resolve, cycles, colliding variables,
//! targets that name nothing, an armed queue in every state.
//!
//! A case the original THROWS on is skipped, as in sheet_oracle.rs.

mod common;

use common::gen::*;
use common::{ask, cases, num};
use engine_core::expr::{Scope, ScopeVal};
use engine_core::value::Val;
use engine_core::{audit, graph};
use proptest::prelude::*;
use serde_json::{json, Value};

fn items(a: &[graph::AuditItem]) -> Value {
    Value::Array(a.iter().map(|i| shown(&i.to_val())).collect())
}

fn dump(m: &indexmap::IndexMap<String, Vec<graph::Indexed>>) -> Value {
    Value::Array(
        m.iter()
            .map(|(k, es)| json!([k, es.iter().map(|e| shown(&e.to_val())).collect::<Vec<_>>()]))
            .collect(),
    )
}

/// `null` for anything the port faulted on — the original threw, and `check` skips those.
fn or_fault<T>(r: Result<T, engine_core::expr::EvalError>, show: impl FnOnce(T) -> Value) -> Value {
    r.map_or(json!("FAULT"), show)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: cases() / 4, failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn variables_and_context_match(character in graph_character(), trees in trees(), types in catalog_types(), typed in any::<bool>()) {
        let types = if typed { types } else { json!({}) };
        let (c, t, k) = (val(&character), val(&trees), val(&types));
        let req = |f: &str| ask(json!({ "fn": f, "character": character, "trees": trees, "types": types }));
        check(req("baseScope"), || or_fault(graph::base_scope(&c, &t), |s| shown(&Val::obj(s))))?;
        check(req("characterVars"), || or_fault(graph::character_vars(&c, &t, &k), |(scope, audit)| json!({ "scope": shown(&Val::obj(scope)), "audit": items(&audit) })))?;
        check(req("context"), || or_fault(graph::build_context(&c, &t, &k), |ctx| json!({
            "scope": shown(&Val::obj(ctx.scope.clone())), "problems": items(&ctx.problems),
            "armed": ctx.armed.iter().map(shown).collect::<Vec<_>>(), "index": dump(&ctx.index), "byOwner": dump(&ctx.by_owner),
        })))?;
    }

    #[test]
    fn rolls_match(
        character in graph_character(), trees in trees(), reqs in prop::collection::vec(request(), 1..5),
        double in any::<bool>(), own in prop::option::of(prop::sample::select(vec!["fire", "Fire ", "cold", ""])),
        draws in prop::collection::vec(0.0f64..1.0, 0..40),
    ) {
        let (c, t) = (val(&character), val(&trees));
        let tape: Vec<Value> = draws.iter().map(|d| num(*d)).collect();
        let want = ask(json!({ "fn": "rolls", "character": character, "trees": trees, "types": {}, "reqs": reqs, "double": double, "own": own, "tape": tape }));
        check(want, || or_fault(graph::build_context(&c, &t, &Val::obj(Default::default())), |ctx| {
            Value::Array(reqs.iter().map(|req| {
                let req = val(req);
                let Ok(res) = graph::resolve(&ctx, &req) else { return json!("FAULT") };
                let mut used = 0usize;
                let mut random = || { used += 1; draws.get(used - 1).copied().unwrap_or(f64::NAN) };
                let own = own.map_or(Val::Undefined, Val::str);
                let rolled = graph::roll_resolution(&res, double, &own, &mut random);
                json!({
                    "keys": graph::req_keys(&req), "res": shown(&res), "total": shown(&graph::total(&res)),
                    "rolled": or_fault(rolled, |r| json!({ "out": shown(&r), "used": num(used as f64) })),
                    "armed": ctx.armed.iter().map(|m| graph::armed_matches(m, &req)).collect::<Vec<_>>(),
                })
            }).collect())
        }))?;
    }

    #[test]
    fn context_queries_match(character in graph_character(), trees in trees(), level in 1u8..21, on in any::<bool>(),
        target in prop::sample::select(GIDS), tags in prop::collection::vec(prop::sample::select(vec!["fire", " Fire", "cold"]), 0..3)) {
        let (c, t) = (val(&character), val(&trees));
        let kinds = ["fire", "Fire ", "cold", "Bless", "frightened"];
        let scope: Scope = [("level".to_owned(), ScopeVal::Num(f64::from(level))), ("isOn".to_owned(), ScopeVal::Bool(on)), ("x".to_owned(), ScopeVal::Num(2.0))].into_iter().collect();
        let want = ask(json!({ "fn": "queries", "character": character, "trees": trees, "types": {}, "kinds": kinds, "target": target, "tags": tags,
            "scope": { "level": num(f64::from(level)), "isOn": on, "x": "2" } }));
        check(want, || or_fault(graph::build_context(&c, &t, &Val::obj(Default::default())), |ctx| {
            let flags: Vec<Value> = kinds.iter().map(|k| or_fault(graph::damage_flags(&ctx, k), |(resist, vuln, immune)| json!({ "resist": resist, "vuln": vuln, "immune": immune }))).collect();
            let tag_vals: Vec<Val> = tags.iter().map(|t| Val::str(t)).collect();
            json!({
                "stale": or_fault(graph::stale_armed(&ctx, &ctx.scope), |v| v.iter().map(shown).collect()),
                "staleAt": or_fault(graph::stale_armed(&ctx, &scope), |v| v.iter().map(shown).collect()),
                "flags": flags,
                "suppressed": or_fault(graph::suppressed_effects(&ctx, &c), |v| v.iter().map(shown).collect()),
                "affected": graph::affected_by(&ctx, target, &tag_vals).iter().map(shown).collect::<Vec<_>>(),
            })
        }))?;
    }

    #[test]
    fn audits_match(
        graph_effects in list(rich_effect(), 5), defs in list(var_def(), 5), types in catalog_types(),
        nodes in list(strict_object(vec![("gid", pick(GIDS)), ("tags", list(pick(&["fire", "Fire ", "cold"]), 3))]), 5),
        prose in list(pick(PROSE), 3), short in prop_oneof![pick(FORMULAS), n()],
        uses in strict_object(vec![("max", prop_oneof![n(), pick(&["x", "counter + 1", "2"])].boxed())]),
    ) {
        let node = json!({ "graph": graph_effects, "vars": defs, "prose": prose, "uses": uses, "shortRecharge": short });
        let k = val(&types);
        let want = ask(json!({ "fn": "auditNode", "node": node, "nodes": nodes, "types": types }));
        check(want, || or_fault(audit::audit_node(&val(&node), val(&nodes).items(), &k), |a| items(&a)))?;
        let want = ask(json!({ "fn": "auditVars", "defs": defs, "types": types }));
        check(want, || or_fault(audit::audit_vars(val(&defs).items(), &k), |a| items(&a)))?;
        let want = ask(json!({ "fn": "probeScope", "defs": defs, "types": types }));
        check(want, || or_fault(graph::probe_scope(val(&defs).items(), &k), |(scope, a)| json!({ "scope": shown(&Val::obj(scope)), "audit": items(&a) })))?;
    }

    #[test]
    fn selectors_and_names_match(
        src in prop_oneof![prop::sample::select(TARGETS).prop_map(str::to_owned), "[a-zA-Z: .\u{00A0}\u{FEFF}\u{0085}\t]{0,12}", "(tag:|roll:|feature:)[ A-Za-z.\u{3000}]{0,8}"],
        nodes in list(object(vec![("gid", pick(GIDS)), ("tags", list(pick(&["fire", "Fire ", " FIRE", "cold"]), 3))]), 5),
        x in object(vec![("feature_id", pick(&["rage"])), ("spell_id", pick(&["s1"])), ("item_id", pick(&["i1"])), ("id", pick(&["inst", ""]))]),
        decls in list(strict_object(vec![("name", pick(VAR_NAMES)), ("from", pick(&["Rage", "Shield"]))]), 6), warn in any::<bool>(),
    ) {
        let want = ask(json!({ "fn": "strings", "src": src, "nodes": nodes, "x": x }));
        check(want, || json!({
            "tag": graph::normalize_tag(&src), "ask": graph::ask_key(&src), "key": graph::as_key(&src), "node": graph::node_gid(&src, &src),
            "count": num(graph::match_count(&src, val(&nodes).items())), "gid": graph::gid("feature", &val(&x)),
        }))?;
        let sev = if warn { "warn" } else { "err" };
        let pairs: Vec<(Val, Val)> = val(&decls).items().iter().map(|d| (d.get("name").clone(), d.get("from").clone())).collect();
        check(ask(json!({ "fn": "varCollisions", "decls": decls, "sev": sev })), || items(&graph::var_collisions(&pairs, sev)))?;
    }
}
