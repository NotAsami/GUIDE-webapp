//! The expression evaluator — a port of `src/lib/expr.ts`, in the same shape:
//! a lexer, then ONE pass that parses and evaluates together. There is no AST,
//! because the original has none and nothing downstream inspects a formula's
//! structure. Line references below are to `expr.ts`.
//!
//! Dice come back UNROLLED, as strings. The evaluator never rolls.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::js;

/// expr.ts:15. `num` carries a flat part and unrolled dice terms.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(tsify::Tsify))]
#[serde(tag = "t")]
pub enum FormulaValue {
    #[serde(rename = "num")]
    Num { flat: f64, dice: Vec<String> },
    #[serde(rename = "bool")]
    Bool { v: bool },
    #[serde(rename = "arr")]
    Arr { v: Vec<f64> },
    #[serde(rename = "str")]
    Str { v: String },
}

/// One scope entry. `Bool` is listed first so an untagged read tries it first.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScopeVal {
    Bool(bool),
    Num(f64),
}

/// expr.ts:23. The scope IS the whitelist: an identifier absent from it is a rejection.
pub type Scope = IndexMap<String, ScopeVal>;

/// Why an evaluation produced no value.
#[derive(Debug, Clone, PartialEq)]
pub enum EvalError {
    /// The formula is wrong: syntax, unknown identifier, type error. The
    /// TypeScript engine returns `null` here and throws the message away; it is
    /// kept so a future "why" entry point needs no parser change.
    Reject(String),
    /// An input the TypeScript engine THROWS on rather than rejecting (a dice
    /// count past 1e21 scaled twice, runaway nesting). Surfaced as a thrown
    /// error by the bindings so the two engines keep behaving alike.
    Fault(String),
}

pub type Eval<T> = Result<T, EvalError>;

/// Where an identifier's value comes from. The evaluator asks only for the
/// names a formula actually mentions, so a caller holding a large scope
/// elsewhere (a JavaScript object, across the WebAssembly boundary) pays per
/// identifier read rather than per entry — measured at 175µs against 1µs for a
/// 51-name scope.
pub trait Lookup {
    /// `None` when the name is absent, which is a rejection one level up.
    fn lookup(&self, name: &str) -> Eval<Option<ScopeVal>>;
}

impl Lookup for Scope {
    fn lookup(&self, name: &str) -> Eval<Option<ScopeVal>> {
        Ok(self.get(name).copied())
    }
}

fn reject<T>(msg: impl Into<String>) -> Eval<T> {
    Err(EvalError::Reject(msg.into()))
}

/// expr.ts:29-51, 72, 58, 85.
pub const VAR_IDENTS: [&str; 19] = [
    "level",
    "prof",
    "str",
    "dex",
    "con",
    "int",
    "wis",
    "cha",
    "hp",
    "hpMax",
    "saveDc",
    "strScore",
    "dexScore",
    "conScore",
    "intScore",
    "wisScore",
    "chaScore",
    "attacksThisTurn",
    "tier",
];
pub const ROLL_IDENTS: [&str; 4] = ["cast", "proficient", "targetAc", "hit"];
pub const BOOST_IDENTS: [&str; 2] = ["level", "prof"];
pub const HIT_ASK: &str = "Did the attack hit?";
pub const HAS_PREFIX: &str = "has_";

/// expr.ts:104. What each roll identifier is, for the author-time probe.
pub fn roll_ident_probe() -> Scope {
    IndexMap::from([
        ("cast".to_owned(), ScopeVal::Num(1.0)),
        ("proficient".to_owned(), ScopeVal::Bool(false)),
        ("targetAc".to_owned(), ScopeVal::Num(1.0)),
        ("hit".to_owned(), ScopeVal::Bool(false)),
    ])
}

/// Deepest nesting evaluated. The original has no limit and dies with a
/// RangeError near 10,000 levels; a fixed limit is what lets this one promise
/// never to overflow the stack. An approved deviation — see the fixes doc.
pub const MAX_DEPTH: usize = 256;

/// expr.ts:94. "Improved Brutal Strike (Enhanced)" -> `has_improved_brutal_strike_enhanced`.
pub fn has_ident(feature_name: &str) -> String {
    let mut out = String::from(HAS_PREFIX);
    let mut gap = false;
    for c in js::to_lower_case(feature_name).chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if gap && out.len() > HAS_PREFIX.len() {
                out.push('_');
            }
            gap = false;
            out.push(c);
        } else {
            gap = true;
        }
    }
    out
}

/// expr.ts:98. `/^has_[a-z0-9_]+$/`.
pub fn is_has_ident(id: &str) -> bool {
    match id.strip_prefix(HAS_PREFIX) {
        Some(rest) => {
            !rest.is_empty()
                && rest
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        }
        None => false,
    }
}

// --- values ------------------------------------------------------------------

fn num(flat: f64) -> FormulaValue {
    FormulaValue::Num { flat, dice: Vec::new() }
}

fn type_name(v: &FormulaValue) -> &'static str {
    match v {
        FormulaValue::Num { .. } => "num",
        FormulaValue::Bool { .. } => "bool",
        FormulaValue::Arr { .. } => "arr",
        FormulaValue::Str { .. } => "str",
    }
}

fn as_num(v: FormulaValue) -> Eval<(f64, Vec<String>)> {
    match v {
        FormulaValue::Num { flat, dice } => Ok((flat, dice)),
        other => reject(format!("expected a number, got {}", type_name(&other))),
    }
}

/// A number with no dice — required anywhere a value must be comparable or countable.
fn plain(v: FormulaValue) -> Eval<f64> {
    let (flat, dice) = as_num(v)?;
    if dice.is_empty() {
        Ok(flat)
    } else {
        reject("a dice value is not allowed here")
    }
}

fn as_bool(v: FormulaValue) -> Eval<bool> {
    match v {
        FormulaValue::Bool { v } => Ok(v),
        other => reject(format!("expected a boolean, got {}", type_name(&other))),
    }
}

/// expr.ts:151.
fn neg_dice(dice: Vec<String>) -> Vec<String> {
    dice.into_iter()
        .map(|s| match s.strip_prefix('-') {
            Some(rest) => rest.to_owned(),
            None => format!("-{s}"),
        })
        .collect()
}

/// The leading run of `s` that satisfies `pred`, and what follows it.
fn take_while(s: &str, pred: impl Fn(char) -> bool) -> (&str, &str) {
    let end = s.find(|c: char| !pred(c)).unwrap_or(s.len());
    s.split_at(end)
}

/// expr.ts:157. `n * 2d6` multiplies the COUNT. A term that is not `-?N dM` —
/// which only an earlier scaling can produce, e.g. `1e+21d6` — is where the
/// original dereferences a failed regex match and throws a TypeError.
fn scale_dice(dice: &[String], k: f64) -> Eval<Vec<String>> {
    let mut out = Vec::new();
    for s in dice {
        let (negative, body) = match s.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, s.as_str()),
        };
        let (count_digits, after) = take_while(body, |c| c.is_ascii_digit());
        let sides = after.strip_prefix('d').unwrap_or("");
        let well_formed = !count_digits.is_empty() && !sides.is_empty() && sides.chars().all(|c| c.is_ascii_digit());
        let parsed = count_digits.parse::<f64>();
        let (true, Ok(n)) = (well_formed, parsed) else {
            return Err(EvalError::Fault(format!("dice term {s} cannot be scaled")));
        };
        let count = (if negative { -1.0 } else { 1.0 }) * n * k;
        if count == 0.0 {
            continue;
        }
        out.push(format!(
            "{}{}d{}",
            if count < 0.0 { "-" } else { "" },
            js::number_to_string(count.abs()),
            sides
        ));
    }
    Ok(out)
}

/// expr.ts:165.
fn apply(op: &str, l: FormulaValue, r: FormulaValue) -> Eval<FormulaValue> {
    match op {
        "+" | "-" => {
            let (a_flat, mut dice) = as_num(l)?;
            let (b_flat, b_dice) = as_num(r)?;
            if op == "-" {
                dice.extend(neg_dice(b_dice));
                Ok(FormulaValue::Num {
                    flat: a_flat - b_flat,
                    dice,
                })
            } else {
                dice.extend(b_dice);
                Ok(FormulaValue::Num {
                    flat: a_flat + b_flat,
                    dice,
                })
            }
        }
        "*" => {
            let (a_flat, a_dice) = as_num(l)?;
            let (b_flat, b_dice) = as_num(r)?;
            if !a_dice.is_empty() && !b_dice.is_empty() {
                return reject("dice on both sides of *");
            }
            let (dice_flat, dice, scalar) = if a_dice.is_empty() {
                (b_flat, b_dice, a_flat)
            } else {
                (a_flat, a_dice, b_flat)
            };
            if dice.is_empty() {
                return Ok(num(a_flat * b_flat));
            }
            // `(1d6 + 2) * wis` — a dice term added to a flat can't be scaled.
            if dice_flat != 0.0 {
                return reject("cannot scale a dice term added to a flat value");
            }
            if !js::is_integer(scalar) {
                return reject("a dice count must stay a whole number");
            }
            Ok(FormulaValue::Num {
                flat: 0.0,
                dice: scale_dice(&dice, scalar)?,
            })
        }
        "/" => {
            let a = plain(l)?;
            let b = plain(r)?;
            if b == 0.0 {
                return reject("division by zero");
            }
            Ok(num((a / b).floor()))
        }
        "<" | "<=" | ">" | ">=" => {
            let a = plain(l)?;
            let b = plain(r)?;
            Ok(FormulaValue::Bool {
                v: match op {
                    "<" => a < b,
                    "<=" => a <= b,
                    ">" => a > b,
                    _ => a >= b,
                },
            })
        }
        "==" | "!=" => {
            let eq = match (l, r) {
                (FormulaValue::Arr { .. }, FormulaValue::Arr { .. }) => return reject("arrays are not comparable"),
                (l @ FormulaValue::Num { .. }, r @ FormulaValue::Num { .. }) => plain(l)? == plain(r)?,
                (FormulaValue::Str { v: a }, FormulaValue::Str { v: b }) => a == b,
                (FormulaValue::Bool { v: a }, FormulaValue::Bool { v: b }) => a == b,
                _ => return reject("== operands differ in type"),
            };
            Ok(FormulaValue::Bool {
                v: if op == "==" { eq } else { !eq },
            })
        }
        // Both sides are type-checked before combining: there is no short circuit.
        "&&" => {
            let a = as_bool(l)?;
            let b = as_bool(r)?;
            Ok(FormulaValue::Bool { v: a && b })
        }
        "||" => {
            let a = as_bool(l)?;
            let b = as_bool(r)?;
            Ok(FormulaValue::Bool { v: a || b })
        }
        _ => reject(format!("unknown operator {op}")),
    }
}

// --- lexer -------------------------------------------------------------------

/// A token. Public because the scripting language's parser will start here.
#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Dice(String),
    Ident(String),
    Str(String),
    Punct(&'static str),
}

/// expr.ts:228. Two-character operators first, so `<=` never lexes as `<` then `=`.
const OPS: [&str; 20] = [
    "<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "<", ">", "!", "(", ")", "[", "]", ",", "?", ":",
];

/// expr.ts:230.
pub fn lex(src: &str) -> Eval<Vec<Tok>> {
    let digit = |c: char| c.is_ascii_digit();
    let mut out = Vec::new();
    let mut rest = src;
    while let Some(first) = rest.chars().next() {
        if js::is_whitespace(first) {
            rest = rest.trim_start_matches(js::is_whitespace);
            continue;
        }
        if digit(first) {
            let (whole, after) = take_while(rest, digit);
            // Dice before number, or `2d6` lexes as `2` followed by an identifier `d6`.
            if let Some(tail) = after.strip_prefix('d') {
                let (sides, after_dice) = take_while(tail, digit);
                if !sides.is_empty() {
                    out.push(Tok::Dice(format!("{whole}d{sides}")));
                    rest = after_dice;
                    continue;
                }
            }
            // `\d+(?:\.\d+)?` — the fraction only counts if a digit follows the dot.
            let mut literal_len = whole.len();
            let mut next = after;
            if let Some(tail) = after.strip_prefix('.') {
                let (frac, after_frac) = take_while(tail, digit);
                if !frac.is_empty() {
                    literal_len += 1 + frac.len();
                    next = after_frac;
                }
            }
            let (literal, _) = rest.split_at(literal_len);
            match literal.parse::<f64>() {
                Ok(n) => out.push(Tok::Num(n)),
                Err(_) => return reject("unreadable number"),
            }
            rest = next;
            continue;
        }
        // String literals have no escapes: the next quote ends them.
        if let Some(body) = rest.strip_prefix('"') {
            let Some(end) = body.find('"') else {
                return reject("unterminated string");
            };
            let (text, tail) = body.split_at(end);
            out.push(Tok::Str(text.to_owned()));
            rest = tail.strip_prefix('"').unwrap_or(tail);
            continue;
        }
        // Must START lowercase; `_` is allowed after that, for `has_*`.
        if first.is_ascii_lowercase() {
            let (id, after) = take_while(rest, |c| c.is_ascii_alphanumeric() || c == '_');
            out.push(Tok::Ident(id.to_owned()));
            rest = after;
            continue;
        }
        let Some(op) = OPS.iter().copied().find(|o| rest.starts_with(o)) else {
            return reject(format!("unexpected character {first:?}"));
        };
        out.push(Tok::Punct(op));
        rest = rest.split_at(op.len()).1;
    }
    Ok(out)
}

/// expr.ts:292. Every identifier a formula references, in source order, deduped.
/// Lex-only, and `[]` when the source does not lex.
pub fn free_idents(src: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tok in lex(src).unwrap_or_default() {
        if let Tok::Ident(name) = tok {
            if name != "true" && name != "false" && !out.contains(&name) {
                out.push(name);
            }
        }
    }
    out
}

/// expr.ts:306.
fn prec(op: &str) -> Option<u8> {
    Some(match op {
        "||" => 1,
        "&&" => 2,
        "==" | "!=" => 3,
        "<" | "<=" | ">" | ">=" => 4,
        "+" | "-" => 5,
        "*" | "/" => 6,
        _ => return None,
    })
}

// --- the single pass -----------------------------------------------------------

struct Pass<'a> {
    toks: Vec<Tok>,
    pos: usize,
    scope: &'a dyn Lookup,
    depth: usize,
}

impl Pass<'_> {
    fn at(&self, v: &str) -> bool {
        matches!(self.toks.get(self.pos), Some(Tok::Punct(p)) if *p == v)
    }

    fn eat(&mut self, v: &str) -> Eval<()> {
        if !self.at(v) {
            return reject(format!("expected {v}"));
        }
        self.pos += 1;
        Ok(())
    }

    fn descend(&mut self) -> Eval<()> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(EvalError::Fault(format!("nested deeper than {MAX_DEPTH}")));
        }
        Ok(())
    }

    /// expr.ts:332. Ternary sits below every binary operator and is right-associative.
    fn expr(&mut self) -> Eval<FormulaValue> {
        self.descend()?;
        let out = self.ternary();
        self.depth -= 1;
        out
    }

    fn ternary(&mut self) -> Eval<FormulaValue> {
        let c = self.binary(0)?;
        if !self.at("?") {
            return Ok(c);
        }
        self.pos += 1;
        let cond = as_bool(c)?;
        let a = self.expr()?;
        self.eat(":")?;
        let b = self.expr()?;
        // BOTH branches are evaluated: a type error in the untaken one still rejects.
        if type_name(&a) != type_name(&b) {
            return reject("ternary branches differ in type");
        }
        Ok(if cond { a } else { b })
    }

    /// expr.ts:346. Precedence climbing; `p + 1` on the right makes it left-associative.
    fn binary(&mut self, min: u8) -> Eval<FormulaValue> {
        let mut left = self.unary()?;
        while let Some(Tok::Punct(op)) = self.toks.get(self.pos) {
            let op = *op;
            let Some(p) = prec(op) else { break };
            if p < min {
                break;
            }
            self.pos += 1;
            let right = self.binary(p + 1)?;
            left = apply(op, left, right)?;
        }
        Ok(left)
    }

    /// expr.ts:359.
    fn unary(&mut self) -> Eval<FormulaValue> {
        if self.at("-") {
            self.pos += 1;
            self.descend()?;
            let inner = self.unary();
            self.depth -= 1;
            let (flat, dice) = as_num(inner?)?;
            // 0 - x, not -x, to avoid -0.
            return Ok(FormulaValue::Num {
                flat: 0.0 - flat,
                dice: neg_dice(dice),
            });
        }
        if self.at("!") {
            self.pos += 1;
            self.descend()?;
            let inner = self.unary();
            self.depth -= 1;
            return Ok(FormulaValue::Bool { v: !as_bool(inner?)? });
        }
        self.postfix()
    }

    /// expr.ts:372.
    fn postfix(&mut self) -> Eval<FormulaValue> {
        let mut v = self.primary()?;
        while self.at("[") {
            self.pos += 1;
            let i = plain(self.expr()?)?;
            self.eat("]")?;
            let FormulaValue::Arr { v: items } = &v else {
                return reject("cannot index a non-array");
            };
            // 0-indexed; out of range clamps to the nearest end. A NaN index reads
            // nothing: `undefined` in the original, NaN here (approved deviation).
            let at = js::min(items.len() as f64 - 1.0, js::max(0.0, i.trunc()));
            let picked = if at.is_nan() {
                None
            } else {
                items.get(at as usize).copied()
            };
            v = num(picked.unwrap_or(f64::NAN));
        }
        Ok(v)
    }

    /// expr.ts:385.
    fn primary(&mut self) -> Eval<FormulaValue> {
        let Some(tok) = self.toks.get(self.pos).cloned() else {
            return reject("unexpected end of expression");
        };
        self.pos += 1;
        match tok {
            Tok::Num(n) => Ok(num(n)),
            Tok::Dice(d) => Ok(FormulaValue::Num {
                flat: 0.0,
                dice: vec![d],
            }),
            Tok::Str(s) => Ok(FormulaValue::Str { v: s }),
            Tok::Ident(name) => {
                if name == "true" || name == "false" {
                    return Ok(FormulaValue::Bool { v: name == "true" });
                }
                match self.scope.lookup(&name)? {
                    Some(ScopeVal::Bool(v)) => Ok(FormulaValue::Bool { v }),
                    Some(ScopeVal::Num(n)) => Ok(num(n)),
                    // A presence identifier the scope does not carry is `false`, not an error.
                    None if is_has_ident(&name) => Ok(FormulaValue::Bool { v: false }),
                    None => reject(format!("unknown identifier {name}")),
                }
            }
            Tok::Punct("(") => {
                let v = self.expr()?;
                self.eat(")")?;
                Ok(v)
            }
            Tok::Punct("[") => {
                let mut items = Vec::new();
                loop {
                    items.push(plain(self.expr()?)?); // numeric and dice-free
                    if !self.at(",") {
                        break;
                    }
                    self.pos += 1;
                }
                self.eat("]")?;
                Ok(FormulaValue::Arr { v: items })
            }
            Tok::Punct(p) => reject(format!("unexpected {p}")),
        }
    }
}

/// expr.ts:319. Evaluate `src` against `scope`.
pub fn eval_expr(src: &str, scope: &dyn Lookup) -> Eval<FormulaValue> {
    let mut pass = Pass {
        toks: lex(src)?,
        pos: 0,
        scope,
        depth: 0,
    };
    let v = pass.expr()?;
    if pass.pos < pass.toks.len() {
        return reject("trailing input");
    }
    Ok(v)
}

// --- inline compute in prose ---------------------------------------------------

/// expr.ts:446. `{...}` spans, non-greedy and non-nesting: `(start, end, inner)`
/// byte ranges where `start..end` covers the braces.
fn spans(text: &str) -> Vec<(usize, usize, &str)> {
    let mut out = Vec::new();
    let mut open: Option<usize> = None;
    for (i, c) in text.char_indices() {
        match c {
            '{' => open = Some(i),
            '}' => {
                if let Some(start) = open.take() {
                    if let Some(inner) = text.get(start + 1..i) {
                        out.push((start, i + 1, inner));
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// expr.ts:453. Every interpolated source in a piece of prose, in order.
pub fn interpolations(text: &str) -> Vec<String> {
    spans(text).into_iter().map(|(_, _, inner)| inner.to_owned()).collect()
}

/// expr.ts:460. How a value reads inside a sentence; a bare boolean or an array does not.
fn display(v: &FormulaValue) -> Option<String> {
    match v {
        FormulaValue::Str { v } => Some(v.clone()),
        FormulaValue::Num { flat, dice } => {
            if dice.is_empty() {
                return Some(js::number_to_string(*flat));
            }
            let d = dice.join(" + ");
            // `flat ?` in the original: zero and NaN both read as "no flat part".
            if *flat == 0.0 || flat.is_nan() {
                Some(d)
            } else {
                let sign = if *flat > 0.0 { '+' } else { '\u{2212}' };
                Some(format!("{d} {sign} {}", js::number_to_string(flat.abs())))
            }
        }
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(tsify::Tsify))]
pub struct Interpolated {
    pub text: String,
    pub bad: Vec<String>,
}

/// expr.ts:478. `{level * 2}` in rule text renders as `16`. A span that does not
/// evaluate is left exactly as written and named in `bad`.
pub fn interpolate(text: &str, scope: &dyn Lookup) -> Eval<Interpolated> {
    let mut out = String::new();
    let mut bad = Vec::new();
    let mut copied = 0;
    for (start, end, inner) in spans(text) {
        out.push_str(text.get(copied..start).unwrap_or(""));
        let shown = match eval_expr(inner, scope) {
            Ok(v) => display(&v),
            Err(EvalError::Reject(_)) => None,
            Err(fault) => return Err(fault),
        };
        match shown {
            Some(s) => out.push_str(&s),
            None => {
                bad.push(js::trim(inner).to_owned());
                out.push_str(text.get(start..end).unwrap_or(""));
            }
        }
        copied = end;
    }
    out.push_str(text.get(copied..).unwrap_or(""));
    Ok(Interpolated { text: out, bad })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(pairs: &[(&str, f64)]) -> Scope {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), ScopeVal::Num(*v)))
            .collect()
    }
    fn n(flat: f64, dice: &[&str]) -> FormulaValue {
        FormulaValue::Num {
            flat,
            dice: dice.iter().map(|s| (*s).to_owned()).collect(),
        }
    }
    fn ev(src: &str) -> Eval<FormulaValue> {
        eval_expr(src, &scope(&[("level", 7.0), ("wis", 4.0)]))
    }
    fn rejected(src: &str) -> bool {
        matches!(ev(src), Err(EvalError::Reject(_)))
    }

    #[test]
    fn division_floors_toward_minus_infinity_and_rejects_zero() {
        assert_eq!(ev("-7 / 2"), Ok(n(-4.0, &[])));
        assert_eq!(ev("level / 2"), Ok(n(3.0, &[])));
        assert!(rejected("5 / 0"));
        // Both ternary branches run, so a guarded division still rejects.
        assert!(rejected("level == 7 ? 0 : 10 / 0"));
    }

    #[test]
    fn only_division_floors() {
        assert_eq!(ev("1.5 + 1"), Ok(n(2.5, &[])));
    }

    #[test]
    fn multiplication_and_division_can_make_negative_zero_but_unary_minus_cannot() {
        let neg_zero = |v: Eval<FormulaValue>| matches!(v, Ok(FormulaValue::Num { flat, .. }) if flat == 0.0 && flat.is_sign_negative());
        assert!(neg_zero(ev("0 * -1")));
        assert!(neg_zero(ev("0 / -5")));
        assert!(!neg_zero(ev("-0")));
    }

    #[test]
    fn arrays_clamp_at_both_ends_and_cannot_be_empty() {
        assert_eq!(ev("[1,2,3][-1]"), Ok(n(1.0, &[])));
        assert_eq!(ev("[1,2,3][99]"), Ok(n(3.0, &[])));
        assert_eq!(ev("[1,2,3][1.9]"), Ok(n(2.0, &[])));
        assert!(rejected("[]"));
        assert!(rejected("[1,]"));
    }

    #[test]
    fn dice_stay_unrolled_and_scale_by_count() {
        assert_eq!(ev("2d6 + 1d4 + 3"), Ok(n(3.0, &["2d6", "1d4"])));
        assert_eq!(ev("1d8 - 1d4"), Ok(n(0.0, &["1d8", "-1d4"])));
        assert_eq!(ev("wis * 1d6"), Ok(n(0.0, &["4d6"])));
        assert_eq!(ev("-1 * 02d06"), Ok(n(0.0, &["-2d06"])));
        assert_eq!(ev("0 * 1d6"), Ok(n(0.0, &[])));
        assert!(rejected("1.5 * 2d6"));
        assert!(rejected("(1d6 + 2) * wis"));
        assert!(rejected("2d6 * 1d4"));
    }

    #[test]
    fn the_scope_is_the_whitelist_and_has_idents_are_the_one_exception() {
        assert!(rejected("cast + 1"));
        assert_eq!(ev("has_rage"), Ok(FormulaValue::Bool { v: false }));
        assert!(rejected("has_Rage"));
    }

    #[test]
    fn what_the_original_throws_on_is_a_fault_not_a_rejection() {
        let huge = ev("2 * (1000000000000000000000 * 1d6)");
        assert!(matches!(huge, Err(EvalError::Fault(_))));
        assert_eq!(ev("1000000000000000000000 * 1d6"), Ok(n(0.0, &["1e+21d6"])));
        let deep = format!("{}1{}", "(".repeat(MAX_DEPTH + 1), ")".repeat(MAX_DEPTH + 1));
        assert!(matches!(ev(&deep), Err(EvalError::Fault(_))));
        let ok = format!("{}1{}", "(".repeat(MAX_DEPTH - 1), ")".repeat(MAX_DEPTH - 1));
        assert_eq!(ev(&ok), Ok(n(1.0, &[])));
    }

    #[test]
    fn js_whitespace_separates_tokens() {
        assert_eq!(ev("1\u{FEFF}+\u{00A0}2"), Ok(n(3.0, &[])));
        assert!(rejected("1\u{0085}+ 2"));
    }

    #[test]
    fn free_idents_are_in_source_order_deduped_and_empty_when_unlexable() {
        assert_eq!(free_idents("b + a * b + true"), vec!["b", "a"]);
        assert!(free_idents("a + #").is_empty());
    }

    #[test]
    fn has_ident_collapses_everything_outside_a_to_z_and_digits() {
        assert_eq!(
            has_ident("Improved Brutal Strike (Enhanced)"),
            "has_improved_brutal_strike_enhanced"
        );
        assert_eq!(has_ident("\u{0130}nfo Kelvin\u{212A}"), "has_i_nfo_kelvink");
        assert_eq!(has_ident(""), "has_");
        assert!(is_has_ident("has_a_1") && !is_has_ident("has_") && !is_has_ident("has_A"));
    }

    #[test]
    fn interpolation_renders_spans_and_names_the_ones_that_fail() {
        let s = scope(&[("level", 7.0)]);
        assert_eq!(
            interpolate("deal {level * 2} and { nope } and {{level}} {}", &s),
            Ok(Interpolated {
                text: "deal 14 and { nope } and {7} {}".into(),
                bad: vec!["nope".into(), String::new()]
            })
        );
        assert_eq!(
            interpolate("{2d6 - 3} {1d8 - 1d4}", &s).map(|i| i.text),
            Ok("2d6 \u{2212} 3 1d8 + -1d4".into())
        );
        assert_eq!(interpolations("a {x} b {y z} {"), vec!["x", "y z"]);
    }
}
