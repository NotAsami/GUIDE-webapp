//! Dice, with the TypeScript engine as the oracle. Both sides are fed the SAME
//! recorded draws, and must use the same number of them.
//!
//!   cargo test -p engine_core --test dice_oracle
//!
//! Counts stay small: past `dice::MAX_DICE` the port refuses where the original
//! allocates until it dies (a recorded deviation), and a fixed case covers that edge.

mod common;

use common::{ask, cases, num, outcome};
use engine_core::dice::{self, Amount, RolledDie};
use proptest::prelude::*;
use serde_json::{json, Value};

/// Replays `draws`, then NaN — and counts every call, including the ones past the end.
fn tape<'a>(draws: &'a [f64], used: &'a mut usize) -> impl FnMut() -> f64 + 'a {
    move || {
        *used += 1;
        draws.get(*used - 1).copied().unwrap_or(f64::NAN)
    }
}

fn nums(v: &[f64]) -> Vec<Value> {
    v.iter().map(|n| num(*n)).collect()
}

fn die(d: &RolledDie) -> Value {
    let mut o = json!({ "v": num(d.v), "sides": num(d.sides) });
    if let Some(orig) = d.orig {
        o["orig"] = num(orig);
    }
    if let Some(rerolled) = d.rerolled {
        o["rerolled"] = json!(rerolled);
    }
    if let Some(crit) = d.crit {
        o["crit"] = json!(crit);
    }
    o
}

fn dice_list(v: &[RolledDie]) -> Value {
    Value::Array(v.iter().map(die).collect())
}

/// The oracle's `{ out, used }` shape.
fn with_used(out: Value, used: usize) -> Value {
    match out.get("ok") {
        Some(ok) => json!({ "ok": { "out": ok, "used": num(used as f64) } }),
        None => out,
    }
}

// --- generators ----------------------------------------------------------------

fn draws() -> impl Strategy<Value = Vec<f64>> {
    prop::collection::vec(
        prop_oneof![0.0f64..1.0, Just(0.0), Just(0.999_999_999_999_999_9)],
        0..70,
    )
}

/// Dice expressions: mostly well-formed, with the spacing, case and signs the
/// regex tolerates — and enough noise to cross into what it refuses.
fn terms() -> impl Strategy<Value = String> {
    let space = "[ \t\u{00A0}\u{FEFF}]{0,2}";
    prop_oneof![
        6 => ("-?", space, "[0-9]{0,2}", space, "[dD]", space, "[0-9]{1,2}", space, "([+-] ?[0-9]{1,2})?", space)
            .prop_map(|(a, b, c, d, e, f, g, h, i, j)| format!("{b}{a}{d}{c}{f}{e}{h}{g}{j}{i}{b}")),
        2 => "[-+dD0-9 .xe\u{00A0}\u{0085}\u{0662}]{0,8}",
        1 => "-?[0-9]{1,2}",
    ]
}

fn counts() -> impl Strategy<Value = f64> {
    prop_oneof![
        4 => (0u8..30).prop_map(f64::from),
        2 => -5.0f64..30.0,
        1 => prop_oneof![Just(f64::NAN), Just(-0.0), Just(f64::NEG_INFINITY)],
    ]
}

fn sides() -> impl Strategy<Value = f64> {
    prop_oneof![
        5 => (0u8..101).prop_map(f64::from),
        2 => -20.0f64..100.0,
        1 => prop_oneof![Just(f64::NAN), Just(f64::INFINITY), Just(1e21)],
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: cases(), failure_persistence: None, ..ProptestConfig::default() })]

    #[test]
    fn parse_dice_matches(src in terms()) {
        let got = dice::parse_dice(&src)
            .map(|p| json!({ "count": num(p.count), "sides": num(p.sides), "mod": num(p.modifier) }));
        prop_assert_eq!(json!({ "ok": got }), ask(json!({ "fn": "parseDice", "src": src })));
    }

    #[test]
    fn roll_dice_matches(count in counts(), sides in sides(), draws in draws()) {
        let mut used = 0;
        let got = outcome(dice::roll_dice(count, sides, &mut tape(&draws, &mut used)), |v| json!(nums(v)));
        let want = ask(json!({ "fn": "rollDice", "count": num(count), "sides": num(sides), "tape": nums(&draws) }));
        prop_assert_eq!(with_used(got, used), want);
    }

    #[test]
    fn rolled_dice_terms_match(exprs in prop::collection::vec(terms(), 0..5), double in any::<bool>(), draws in draws()) {
        let mut used = 0;
        let got = outcome(dice::rolled_dice_terms(&exprs, double, &mut tape(&draws, &mut used)), |v| dice_list(v));
        let want = ask(json!({ "fn": "rolledDiceTerms", "exprs": exprs, "double": double, "tape": nums(&draws) }));
        prop_assert_eq!(with_used(got, used), want);
    }

    #[test]
    fn reroll_die_matches(v in sides(), s in sides(), orig in prop::option::of(sides()), crit in prop::option::of(any::<bool>()), draws in draws()) {
        let d = RolledDie { v, sides: s, orig, rerolled: None, crit };
        let mut used = 0;
        let got = die(&dice::reroll_die(&d, &mut tape(&draws, &mut used)));
        let want = ask(json!({ "fn": "rerollDie", "die": die(&d), "tape": nums(&draws) }));
        prop_assert_eq!(with_used(json!({ "ok": got }), used), want);
    }

    #[test]
    fn roll_heal_matches(text in prop_oneof![terms().prop_map(Some), Just(None)], number in counts(), draws in draws()) {
        let mut used = 0;
        let amount = text.as_deref().map_or(Amount::Number(number), Amount::Text);
        let got = outcome(dice::roll_heal(amount, &mut tape(&draws, &mut used)), |h| json!({ "total": num(h.total), "breakdown": h.breakdown }));
        let want = ask(json!({ "fn": "rollHeal", "text": text, "number": num(number), "tape": nums(&draws) }));
        prop_assert_eq!(with_used(got, used), want);
    }
}
