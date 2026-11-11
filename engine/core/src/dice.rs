//! Dice — a port of `src/lib/dice.ts`. Line references are to that file.
//!
//! THE ENGINE DOES NOT GENERATE RANDOMNESS. Every rolling function takes the
//! source as an argument: a function returning a uniform number in [0, 1),
//! `Math.random` in the app and a recorded tape in tests. The ORDER of draws is
//! part of the contract, because the side-by-side tests replay one tape into
//! both engines: one draw per die, in the order the dice appear in the result.
//!
//! `rollDiceTerms` (dice.ts:86) is not ported: nothing calls it.

use serde::{Deserialize, Serialize};

use crate::expr::{Eval, EvalError};
use crate::js;

/// The source of randomness: uniform in [0, 1).
pub type Random<'a> = &'a mut dyn FnMut() -> f64;

/// The most dice one call will roll. The original has no limit and simply
/// allocates until the tab dies; a limit is what lets this one promise not to.
/// A deviation — see docs/engine-port-fixes.md.
pub const MAX_DICE: f64 = 100_000.0;

/// dice.ts:18's result. `mod` is always present, 0 when the expression has none.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(tsify::Tsify))]
pub struct ParsedDice {
    pub count: f64,
    pub sides: f64,
    #[serde(rename = "mod")]
    pub modifier: f64,
}

/// dice.ts:47. One die as it sits in a roll record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(tsify::Tsify))]
pub struct RolledDie {
    pub v: f64,
    pub sides: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", tsify(optional))]
    pub orig: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", tsify(optional))]
    pub rerolled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", tsify(optional))]
    pub crit: Option<bool>,
}

/// dice.ts:62's result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(tsify::Tsify))]
pub struct HealRoll {
    pub total: f64,
    pub breakdown: String,
}

/// What a caller hands `roll_heal`: a flat number or an expression.
#[derive(Debug, Clone, PartialEq)]
pub enum Amount<'a> {
    Number(f64),
    Text(&'a str),
}

fn digits(s: &str) -> (&str, &str) {
    js::take_while(s, |c| c.is_ascii_digit())
}

fn skip_space(s: &str) -> &str {
    s.trim_start_matches(js::is_whitespace)
}

/// The shared tail of both dice regexes:
/// `d\s*(\d+)\s*([+-]\s*\d+)?\s*$`, case-insensitive. Returns (sides, mod).
fn sides_and_mod(s: &str) -> Option<(f64, f64)> {
    let s = s.strip_prefix(['d', 'D'])?;
    let (sides, s) = digits(skip_space(s));
    if sides.is_empty() {
        return None;
    }
    let s = skip_space(s);
    let (modifier, s) = match s.strip_prefix(['+', '-']) {
        Some(after_sign) => {
            let (magnitude, rest) = digits(skip_space(after_sign));
            if magnitude.is_empty() {
                return None;
            }
            let sign = if s.starts_with('-') { -1.0 } else { 1.0 };
            (sign * magnitude.parse::<f64>().ok()?, skip_space(rest))
        }
        None => (0.0, s),
    };
    s.is_empty().then_some((sides.parse::<f64>().ok()?, modifier))
}

/// dice.ts:18. `/^\s*(-?)\s*(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i` —
/// "2d6", "d8", "3d4 + 3", "-1d4". The count is SIGNED; `-0d6` is -0.
pub fn parse_dice(expr: &str) -> Option<ParsedDice> {
    let s = skip_space(expr);
    let (sign, s) = match s.strip_prefix('-') {
        Some(rest) => (-1.0, rest),
        None => (1.0, s),
    };
    let (count, s) = digits(skip_space(s));
    let (sides, modifier) = sides_and_mod(skip_space(s))?;
    let count = if count.is_empty() {
        1.0
    } else {
        count.parse::<f64>().ok()?
    };
    Some(ParsedDice {
        count: sign * count,
        sides,
        modifier,
    })
}

/// dice.ts:5. One die → 1..sides.
fn roll_die(sides: f64, random: Random) -> f64 {
    (random() * sides).floor() + 1.0
}

/// dice.ts:29. `Array.from({ length: Math.max(0, count) })`: a negative or NaN
/// count rolls nothing and a fractional one rounds down.
pub fn roll_dice(count: f64, sides: f64, random: Random) -> Eval<Vec<f64>> {
    let length = js::max(0.0, count);
    let length = if length.is_nan() { 0.0 } else { length.trunc() };
    if length > MAX_DICE {
        return Err(EvalError::Fault(format!(
            "refusing to roll more than {MAX_DICE} dice at once"
        )));
    }
    Ok((0..length as usize).map(|_| roll_die(sides, random)).collect())
}

fn fresh(v: f64, sides: f64) -> RolledDie {
    RolledDie {
        v,
        sides,
        orig: None,
        rerolled: None,
        crit: None,
    }
}

/// dice.ts:53.
pub fn rolled_dice(count: f64, sides: f64, random: Random) -> Eval<Vec<RolledDie>> {
    Ok(roll_dice(count, sides, random)?
        .into_iter()
        .map(|v| fresh(v, sides))
        .collect())
}

/// dice.ts:57. Reroll one die, preserving the face it FIRST showed.
pub fn reroll_die(d: &RolledDie, random: Random) -> RolledDie {
    RolledDie {
        v: roll_die(d.sides, random),
        orig: Some(d.orig.unwrap_or(d.v)),
        rerolled: Some(true),
        ..d.clone()
    }
}

/// dice.ts:62. A flat number, "2d4", or "2d4 + 2" → the total (floored at 0)
/// and a human breakdown.
pub fn roll_heal(amount: Amount, random: Random) -> Eval<HealRoll> {
    let text = match amount {
        Amount::Number(n) => {
            return Ok(HealRoll {
                total: js::max(0.0, n),
                breakdown: js::number_to_string(n),
            });
        }
        Amount::Text(text) => text,
    };
    // `/^\s*(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i` — no sign, and the count is required.
    let (count, rest) = digits(skip_space(text));
    let parsed = if count.is_empty() {
        None
    } else {
        sides_and_mod(skip_space(rest))
    };
    let (Some((sides, modifier)), Ok(count)) = (parsed, count.parse::<f64>()) else {
        // `parseInt(amount, 10) || 0`: NaN and both zeros become 0.
        let n = js::parse_int(text);
        let n = if n.is_nan() || n == 0.0 { 0.0 } else { n };
        return Ok(HealRoll {
            total: js::max(0.0, n),
            breakdown: js::number_to_string(n),
        });
    };
    let dice = roll_dice(count, sides, random)?;
    let total = js::max(0.0, dice.iter().fold(0.0, |a, b| a + b) + modifier);
    let mod_str = if modifier == 0.0 {
        String::new()
    } else {
        let sign = if modifier > 0.0 { '+' } else { '\u{2212}' };
        format!(" {sign} {}", js::number_to_string(modifier.abs()))
    };
    let faces: Vec<String> = dice.iter().map(|v| js::number_to_string(*v)).collect();
    Ok(HealRoll {
        total,
        breakdown: format!(
            "{}d{}({}){mod_str}",
            js::number_to_string(count),
            js::number_to_string(sides),
            faces.join(" + ")
        ),
    })
}

/// dice.ts:103. Graph dice terms ("1d4", "-1d4") rolled to dice that remember
/// what they are. A negative term's faces come back negative; an unparseable
/// term rolls nothing; a trailing modifier is dropped. `double` rolls the same
/// count again in the SAME batch, for damage dice on a critical hit.
pub fn rolled_dice_terms(exprs: &[String], double: bool, random: Random) -> Eval<Vec<RolledDie>> {
    let mut out = Vec::new();
    for expr in exprs {
        let Some(p) = parse_dice(expr) else { continue };
        let sign = if p.count < 0.0 { -1.0 } else { 1.0 };
        let count = p.count.abs() * if double { 2.0 } else { 1.0 };
        out.extend(
            roll_dice(count, p.sides, random)?
                .into_iter()
                .map(|v| fresh(v * sign, p.sides)),
        );
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tape: the draws come back in order, and the test can see how many were used.
    fn tape(draws: &[f64]) -> impl FnMut() -> f64 + '_ {
        let mut i = 0;
        move || {
            i += 1;
            draws.get(i - 1).copied().unwrap_or(f64::NAN)
        }
    }

    #[test]
    fn parse_dice_reads_every_form_and_keeps_the_sign_on_the_count() {
        let p = |count, sides, modifier| Some(ParsedDice { count, sides, modifier });
        assert_eq!(parse_dice("2d6"), p(2.0, 6.0, 0.0));
        assert_eq!(parse_dice("d8"), p(1.0, 8.0, 0.0));
        assert_eq!(parse_dice(" 3 D 4 + 3 "), p(3.0, 4.0, 3.0));
        assert_eq!(parse_dice("1d10 - 2"), p(1.0, 10.0, -2.0));
        assert_eq!(parse_dice("-1d4"), p(-1.0, 4.0, 0.0));
        assert!(parse_dice("-0d6").is_some_and(|d| d.count == 0.0 && d.count.is_sign_negative()));
        for bad in ["", "not dice", "2d", "2d6+", "2d6+1+1", "+1d4", "2d6x", "1e3d6"] {
            assert_eq!(parse_dice(bad), None, "{bad}");
        }
    }

    #[test]
    fn one_draw_per_die_in_order_and_a_crit_doubles_in_one_batch() {
        let draws = [0.0, 0.5, 0.999, 0.25];
        let mut r = tape(&draws);
        let rolled = rolled_dice_terms(&["1d4".into(), "-1d6".into(), "junk".into()], true, &mut r).unwrap();
        let faces: Vec<f64> = rolled.iter().map(|d| d.v).collect();
        assert_eq!(faces, vec![1.0, 3.0, -6.0, -2.0]);
        assert_eq!(rolled[2].sides, 6.0);
    }

    #[test]
    fn odd_counts_roll_nothing_or_round_down_and_runaway_counts_fault() {
        let draws = [0.0; 4];
        assert_eq!(roll_dice(-3.0, 6.0, &mut tape(&draws)), Ok(vec![]));
        assert_eq!(roll_dice(f64::NAN, 6.0, &mut tape(&draws)), Ok(vec![]));
        assert_eq!(roll_dice(2.9, 6.0, &mut tape(&draws)), Ok(vec![1.0, 1.0]));
        assert!(matches!(
            roll_dice(1e21, 6.0, &mut tape(&draws)),
            Err(EvalError::Fault(_))
        ));
    }

    #[test]
    fn a_reroll_keeps_the_first_face() {
        let draws = [0.5, 0.9];
        let mut r = tape(&draws);
        let twice = reroll_die(&reroll_die(&fresh(12.0, 20.0), &mut r), &mut r);
        assert_eq!((twice.v, twice.orig, twice.rerolled), (19.0, Some(12.0), Some(true)));
    }

    #[test]
    fn heal_reads_numbers_expressions_and_junk() {
        let draws = [0.0, 0.999];
        let heal = |a| roll_heal(a, &mut tape(&draws)).unwrap();
        let h = |total, breakdown: &str| HealRoll {
            total,
            breakdown: breakdown.into(),
        };
        assert_eq!(heal(Amount::Number(-3.0)), h(0.0, "-3"));
        assert_eq!(heal(Amount::Text("02d4 - 1")), h(4.0, "2d4(1 + 4) \u{2212} 1"));
        assert_eq!(heal(Amount::Text("0d6 - 2")), h(0.0, "0d6() \u{2212} 2"));
        assert_eq!(heal(Amount::Text("3 apples")), h(3.0, "3"));
        assert_eq!(heal(Amount::Text("d8")), h(0.0, "0"));
        assert_eq!(heal(Amount::Text("-2")), h(0.0, "-2"));
        assert_eq!(heal(Amount::Text("-0")), h(0.0, "0"));
    }
}
