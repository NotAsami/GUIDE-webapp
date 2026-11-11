//! Generated inputs, with the TypeScript engine as the oracle.
//!
//! `scripts/engine-oracle.mjs` is started once and asked what the original does
//! with each generated case; any difference fails. Needs `node` on the PATH.
//!
//!   cargo test -p engine_core --test expr_oracle
//!   PROPTEST_CASES=100000 cargo test -p engine_core --test expr_oracle --release
//!
//! NOT generated here, because they sit in the two approved deviations (see
//! docs/engine-port-fixes.md): literals long enough to overflow to Infinity,
//! NaN in the scope, and nesting past MAX_DEPTH. Fixed cases for the edges of
//! those live in src/lib/engine.parity.test.ts.

mod common;

use common::{ask, cases, num, outcome};
use engine_core::expr::{self, FormulaValue, Scope, ScopeVal};
use engine_core::js;
use proptest::prelude::*;
use serde_json::{json, Value};

fn value(v: &FormulaValue) -> Value {
    match v {
        FormulaValue::Num { flat, dice } => json!({ "t": "num", "flat": num(*flat), "dice": dice }),
        FormulaValue::Bool { v } => json!({ "t": "bool", "v": v }),
        FormulaValue::Arr { v } => json!({ "t": "arr", "v": v.iter().map(|n| num(*n)).collect::<Vec<_>>() }),
        FormulaValue::Str { v } => json!({ "t": "str", "v": v }),
    }
}

fn scope_json(scope: &Scope) -> Value {
    Value::Object(
        scope
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    match v {
                        ScopeVal::Bool(b) => json!(b),
                        ScopeVal::Num(n) => num(*n),
                    },
                )
            })
            .collect(),
    )
}

// --- generators ----------------------------------------------------------------

fn scopes() -> impl Strategy<Value = Scope> {
    let n = prop_oneof![
        (-20i32..40).prop_map(f64::from),
        (-40i32..40).prop_map(|h| f64::from(h) / 2.0),
        Just(-0.0),
        -1e6f64..1e6,
        Just(1e21),
    ];
    (n.clone(), n.clone(), n, any::<bool>(), any::<bool>()).prop_map(|(level, wis, half, on, has)| {
        let mut s: Scope = [
            ("level".to_owned(), ScopeVal::Num(level)),
            ("wis".to_owned(), ScopeVal::Num(wis)),
            ("half".to_owned(), ScopeVal::Num(half)),
            ("on".to_owned(), ScopeVal::Bool(on)),
        ]
        .into_iter()
        .collect();
        if has {
            s.insert("has_rage".to_owned(), ScopeVal::Bool(true));
        }
        s
    })
}

/// Literals and names. Up to 25 digits, so counts cross the 1e21 formatting edge
/// without reaching Infinity.
fn leaf() -> impl Strategy<Value = String> {
    prop_oneof![
        4 => (0u32..30).prop_map(|n| n.to_string()),
        1 => "[0-9]{1,3}\\.[0-9]{1,3}",
        1 => "[0-9]{18,25}",
        3 => "[0-9]{1,2}d[0-9]{1,2}",
        1 => "[0-9]{18,23}d[0-9]{1,2}",
        4 => prop_oneof![Just("level"), Just("wis"), Just("half"), Just("on"), Just("true"), Just("false"),
                         Just("has_rage"), Just("has_other"), Just("missing"), Just("cast")].prop_map(str::to_owned),
        1 => "\"[a-z ]{0,4}\"",
    ]
}

fn exprs() -> impl Strategy<Value = String> {
    let op = prop_oneof![
        Just("+"),
        Just("-"),
        Just("*"),
        Just("/"),
        Just("<"),
        Just("<="),
        Just(">"),
        Just(">="),
        Just("=="),
        Just("!="),
        Just("&&"),
        Just("||"),
    ];
    leaf().prop_recursive(6, 64, 4, move |inner| {
        prop_oneof![
            6 => (inner.clone(), op.clone(), inner.clone()).prop_map(|(a, o, b)| format!("{a} {o} {b}")),
            2 => inner.clone().prop_map(|a| format!("({a})")),
            1 => inner.clone().prop_map(|a| format!("-{a}")),
            1 => inner.clone().prop_map(|a| format!("!{a}")),
            2 => (inner.clone(), inner.clone(), inner.clone()).prop_map(|(c, a, b)| format!("{c} ? {a} : {b}")),
            2 => (prop::collection::vec(inner.clone(), 1..4), inner.clone())
                .prop_map(|(items, i)| format!("[{}][{i}]", items.join(", "))),
        ]
    })
}

/// A well-formed expression with one character deleted, inserted or replaced.
fn mutated() -> impl Strategy<Value = String> {
    (
        exprs(),
        any::<prop::sample::Index>(),
        0u8..3,
        "[-+*/<>=!&|()\\[\\],?:. \"d0-9a-zA-Z_#\u{00A0}\u{FEFF}\u{0085}]",
    )
        .prop_map(|(src, at, how, ch)| {
            let mut chars: Vec<char> = src.chars().collect();
            let i = at.index(chars.len().max(1)).min(chars.len());
            match how {
                0 if i < chars.len() => {
                    chars.remove(i);
                }
                1 => chars.splice(i..i, ch.chars()).for_each(drop),
                _ if i < chars.len() => {
                    chars.splice(i..=i, ch.chars()).for_each(drop);
                }
                _ => {}
            }
            chars.into_iter().collect()
        })
}

/// No grammar at all: tokens in any order.
fn soup() -> impl Strategy<Value = String> {
    let tok = prop_oneof![
        leaf(),
        "(<=|>=|==|!=|&&|\\|\\||[-+*/<>!()\\[\\],?:])",
        "[ \t\u{00A0}\u{FEFF}\u{0085}\u{2028}=&|#.dD_A-Z{}\"é\u{1F600}]",
    ];
    (prop::collection::vec(tok, 0..12), any::<bool>()).prop_map(|(t, spaced)| t.join(if spaced { " " } else { "" }))
}

fn sources() -> impl Strategy<Value = String> {
    prop_oneof![5 => exprs(), 3 => mutated(), 2 => soup()]
}

fn prose() -> impl Strategy<Value = String> {
    let part = prop_oneof![
        3 => sources().prop_map(|s| format!("{{{s}}}")),
        2 => "[a-z {}\u{2212}é]{0,6}",
        1 => sources().prop_map(|s| format!("{{ {s}\u{FEFF}}}")),
    ];
    prop::collection::vec(part, 0..5).prop_map(|p| p.concat())
}

/// Text that leans on what case-mapping and whitespace disagree about.
fn unicode() -> impl Strategy<Value = String> {
    prop::collection::vec(
        prop_oneof![
            3 => any::<char>().prop_map(String::from),
            3 => "[A-Za-z0-9 _()'+:-]",
            2 => "[ΣσςİIıǅǈΆẞ\u{0345}\u{00AD}\u{0301}\u{212A}\u{FEFF}\u{0085}\u{00A0}\u{2028}\u{3000}\t\n]",
        ],
        0..12,
    )
    .prop_map(|p| p.concat())
}

/// Capital letters added in Unicode 17. Rust's tables have them; Node 24's
/// (Unicode 16) do not yet, so Node leaves them unchanged when lowercasing.
/// JavaScript's answer here depends on the browser it runs in — the port's does
/// not. Recorded as a deviation in docs/engine-port-fixes.md.
fn unicode_17(c: u32) -> bool {
    matches!(c, 0xA7CE | 0xA7D2 | 0xA7D4 | 0x16EA0..=0x16EB8)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: cases(), failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn eval_expr_matches(src in sources(), scope in scopes()) {
        let want = ask(json!({ "fn": "evalExpr", "src": src, "scope": scope_json(&scope) }));
        prop_assert_eq!(outcome(expr::eval_expr(&src, &scope), value), want);
    }

    #[test]
    fn free_idents_match(src in sources()) {
        let want = ask(json!({ "fn": "freeIdents", "src": src }));
        prop_assert_eq!(json!({ "ok": expr::free_idents(&src) }), want);
    }

    #[test]
    fn interpolate_matches(text in prose(), scope in scopes()) {
        let want = ask(json!({ "fn": "interpolate", "src": text, "scope": scope_json(&scope) }));
        let got = outcome(expr::interpolate(&text, &scope), |i| json!({ "text": i.text, "bad": i.bad }));
        prop_assert_eq!(got, want);
        let spans = ask(json!({ "fn": "interpolations", "src": text }));
        prop_assert_eq!(json!({ "ok": expr::interpolations(&text) }), spans);
    }

    #[test]
    fn has_ident_matches(name in unicode()) {
        let want = ask(json!({ "fn": "hasIdent", "src": name }));
        let got = expr::has_ident(&name);
        prop_assert_eq!(json!({ "ok": got }), want);
        let is = ask(json!({ "fn": "isHasIdent", "src": name }));
        prop_assert_eq!(json!({ "ok": expr::is_has_ident(&name) }), is);
    }

    #[test]
    fn trim_and_lowercase_match(s in unicode()) {
        prop_assume!(!s.chars().any(|c| unicode_17(c as u32)));
        prop_assert_eq!(json!({ "ok": js::trim(&s) }), ask(json!({ "fn": "trim", "src": s })));
        prop_assert_eq!(json!({ "ok": js::to_lower_case(&s) }), ask(json!({ "fn": "lower", "src": s })));
    }

    #[test]
    fn numbers_print_alike(n in prop_oneof![any::<f64>(), (-1e22f64..1e22), (0i64..i64::MAX).prop_map(|i| i as f64)]) {
        prop_assert_eq!(json!({ "ok": js::number_to_string(n) }), ask(json!({ "fn": "str", "src": num(n) })));
    }
}

/// Every code point, not a sample: lowercasing and the whitespace set are tables,
/// and a table is either right everywhere or wrong somewhere specific.
#[test]
fn every_code_point_lowercases_and_classifies_alike() {
    const STEP: u32 = 0x4000;
    let mut differing = Vec::new();
    for from in (0..0x11_0000).step_by(STEP as usize) {
        let to = from + STEP;
        let chars: Vec<char> = (from..to).filter_map(char::from_u32).collect();
        let want = ask(json!({ "fn": "lowerRange", "from": from, "to": to }));
        for (c, want) in chars.iter().zip(want["ok"].as_array().unwrap()) {
            let got = js::to_lower_case(&c.to_string());
            if want.as_str() != Some(got.as_str()) {
                differing.push(*c as u32);
            }
        }
        // The oracle spells every number as a string.
        let spaces: Vec<String> = chars
            .iter()
            .filter(|c| js::is_whitespace(**c))
            .map(|c| (*c as u32).to_string())
            .collect();
        assert_eq!(
            json!({ "ok": spaces }),
            ask(json!({ "fn": "spaceRange", "from": from, "to": to })),
            "whitespace in {from:#x}..{to:#x}"
        );
    }
    // Anything outside the Unicode 17 set is a real difference.
    let unexpected: Vec<String> = differing
        .iter()
        .filter(|c| !unicode_17(**c))
        .map(|c| format!("U+{c:04X}"))
        .collect();
    assert!(unexpected.is_empty(), "lowercase differs: {unexpected:?}");
}
