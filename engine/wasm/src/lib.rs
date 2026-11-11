//! WebAssembly bindings. NO LOGIC LIVES HERE: every function converts its
//! arguments, makes one call into `engine_core`, and converts the answer back.
//!
//! Two outcomes cross the boundary the way the TypeScript engine expresses them:
//! a rejected formula is `null`, and an input the original throws on is a thrown
//! `Error`.

use engine_core::dice;
use engine_core::expr::{self, Eval, EvalError, Lookup, Scope, ScopeVal};
use engine_core::sheet;
use engine_core::value::{Map, Val};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const TYPES: &str = r#"
export type Scope = Record<string, number | boolean>;
export type EngineConstants = {
  VAR_IDENTS: string[]; ROLL_IDENTS: string[]; BOOST_IDENTS: string[];
  ROLL_IDENT_PROBE: Scope; HIT_ASK: string; HAS_PREFIX: string;
};
"#;

/// Development only: a panic prints its message instead of `unreachable`.
#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(debug_assertions)]
    console_error_panic_hook::set_once();
}

fn fail(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// A JavaScript scope object, read in place. Nothing is copied across the
/// boundary: the evaluator asks for the identifiers a formula mentions and each
/// is one own-property read, exactly as `Object.hasOwn(scope, id)` in expr.ts.
struct JsScope(JsValue);

impl Lookup for JsScope {
    fn lookup(&self, name: &str) -> Eval<Option<ScopeVal>> {
        let Some(object) = self.0.dyn_ref::<js_sys::Object>() else {
            return Err(EvalError::Fault("the scope is not an object".into()));
        };
        let key = JsValue::from_str(name);
        if !js_sys::Object::has_own(object, &key) {
            return Ok(None);
        }
        let value = js_sys::Reflect::get(object, &key).unwrap_or(JsValue::UNDEFINED);
        if let Some(b) = value.as_bool() {
            Ok(Some(ScopeVal::Bool(b)))
        } else if let Some(n) = value.as_f64() {
            Ok(Some(ScopeVal::Num(n)))
        } else {
            // The original coerces whatever it finds; a scope is typed number | boolean.
            Err(EvalError::Fault(format!(
                "scope value {name} is neither a number nor a boolean"
            )))
        }
    }
}

/// Plain objects rather than `Map`s, and numbers as numbers — NaN, Infinity and
/// -0 all survive, which a JSON string could not carry.
fn out<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    v.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
        .map_err(fail)
}

#[wasm_bindgen(js_name = evalExpr, unchecked_return_type = "FormulaValue | null")]
pub fn eval_expr(
    src: &str,
    #[wasm_bindgen(unchecked_param_type = "Scope")] scope: JsValue,
) -> Result<JsValue, JsError> {
    match expr::eval_expr(src, &JsScope(scope)) {
        Ok(v) => out(&v),
        Err(EvalError::Reject(_)) => Ok(JsValue::NULL),
        Err(EvalError::Fault(msg)) => Err(fail(msg)),
    }
}

#[wasm_bindgen(js_name = freeIdents)]
pub fn free_idents(src: &str) -> Vec<String> {
    expr::free_idents(src)
}

#[wasm_bindgen(unchecked_return_type = "Interpolated")]
pub fn interpolate(
    text: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "Scope")] scope: JsValue,
) -> Result<JsValue, JsError> {
    match expr::interpolate(text.as_deref().unwrap_or(""), &JsScope(scope)) {
        Ok(v) => out(&v),
        Err(EvalError::Reject(msg) | EvalError::Fault(msg)) => Err(fail(msg)),
    }
}

#[wasm_bindgen]
pub fn interpolations(text: Option<String>) -> Vec<String> {
    expr::interpolations(text.as_deref().unwrap_or(""))
}

#[wasm_bindgen(js_name = hasIdent)]
pub fn has_ident(feature_name: &str) -> String {
    expr::has_ident(feature_name)
}

#[wasm_bindgen(js_name = isHasIdent)]
pub fn is_has_ident(id: &str) -> bool {
    expr::is_has_ident(id)
}

#[derive(Serialize)]
#[allow(non_snake_case)]
struct Constants {
    VAR_IDENTS: &'static [&'static str],
    ROLL_IDENTS: &'static [&'static str],
    BOOST_IDENTS: &'static [&'static str],
    ROLL_IDENT_PROBE: Scope,
    HIT_ASK: &'static str,
    HAS_PREFIX: &'static str,
}

/// The engine's constant lists, read once at boot.
#[wasm_bindgen(js_name = engineConstants, unchecked_return_type = "EngineConstants")]
pub fn engine_constants() -> Result<JsValue, JsError> {
    out(&Constants {
        VAR_IDENTS: &expr::VAR_IDENTS,
        ROLL_IDENTS: &expr::ROLL_IDENTS,
        BOOST_IDENTS: &expr::BOOST_IDENTS,
        ROLL_IDENT_PROBE: expr::roll_ident_probe(),
        HIT_ASK: expr::HIT_ASK,
        HAS_PREFIX: expr::HAS_PREFIX,
    })
}

// --- dice (slice 2) ------------------------------------------------------------
//
// The engine never generates randomness: each rolling function is handed the
// source, `Math.random` in the app and a recorded tape in tests.

fn draws(random: &js_sys::Function) -> impl FnMut() -> f64 + '_ {
    move || {
        random
            .call0(&JsValue::NULL)
            .ok()
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN)
    }
}

fn rolled<T: Serialize>(r: Eval<T>) -> Result<JsValue, JsError> {
    match r {
        Ok(v) => out(&v),
        Err(EvalError::Reject(msg) | EvalError::Fault(msg)) => Err(fail(msg)),
    }
}

#[wasm_bindgen(js_name = parseDice, unchecked_return_type = "ParsedDice | null")]
pub fn parse_dice(expr: &str) -> Result<JsValue, JsError> {
    match dice::parse_dice(expr) {
        Some(p) => out(&p),
        None => Ok(JsValue::NULL),
    }
}

#[wasm_bindgen(js_name = rollDice, unchecked_return_type = "number[]")]
pub fn roll_dice(
    count: f64,
    sides: f64,
    #[wasm_bindgen(unchecked_param_type = "() => number")] random: &js_sys::Function,
) -> Result<JsValue, JsError> {
    rolled(dice::roll_dice(count, sides, &mut draws(random)))
}

#[wasm_bindgen(js_name = rolledDice, unchecked_return_type = "RolledDie[]")]
pub fn rolled_dice(
    count: f64,
    sides: f64,
    #[wasm_bindgen(unchecked_param_type = "() => number")] random: &js_sys::Function,
) -> Result<JsValue, JsError> {
    rolled(dice::rolled_dice(count, sides, &mut draws(random)))
}

#[wasm_bindgen(js_name = rerollDie, unchecked_return_type = "RolledDie")]
pub fn reroll_die(
    #[wasm_bindgen(unchecked_param_type = "RolledDie")] die: JsValue,
    #[wasm_bindgen(unchecked_param_type = "() => number")] random: &js_sys::Function,
) -> Result<JsValue, JsError> {
    let die: dice::RolledDie = serde_wasm_bindgen::from_value(die).map_err(fail)?;
    out(&dice::reroll_die(&die, &mut draws(random)))
}

#[wasm_bindgen(js_name = rollHeal, unchecked_return_type = "HealRoll")]
pub fn roll_heal(
    #[wasm_bindgen(unchecked_param_type = "number | string")] amount: JsValue,
    #[wasm_bindgen(unchecked_param_type = "() => number")] random: &js_sys::Function,
) -> Result<JsValue, JsError> {
    let text = amount.as_string();
    let amount = match (amount.as_f64(), &text) {
        (Some(n), _) => dice::Amount::Number(n),
        (None, Some(t)) => dice::Amount::Text(t),
        (None, None) => return Err(fail("a heal amount is a number or a dice expression")),
    };
    rolled(dice::roll_heal(amount, &mut draws(random)))
}

#[wasm_bindgen(js_name = rolledDiceTerms, unchecked_return_type = "RolledDie[]")]
pub fn rolled_dice_terms(
    exprs: Vec<String>,
    double: bool,
    #[wasm_bindgen(unchecked_param_type = "() => number")] random: &js_sys::Function,
) -> Result<JsValue, JsError> {
    rolled(dice::rolled_dice_terms(&exprs, double, &mut draws(random)))
}

// --- the sheet layer (slice 3a) --------------------------------------------------
//
// Character data crosses as `Val`: a JavaScript value walked into Rust as it
// stands, with `undefined`, `null` and a missing key still three different things.

fn val_in(v: &JsValue) -> Val {
    if v.is_undefined() {
        Val::Undefined
    } else if v.is_null() {
        Val::Null
    } else if let Some(b) = v.as_bool() {
        Val::Bool(b)
    } else if let Some(n) = v.as_f64() {
        Val::Num(n)
    } else if let Some(s) = v.as_string() {
        Val::str(&s)
    } else if let Some(array) = v.dyn_ref::<js_sys::Array>() {
        Val::arr(array.iter().map(|item| val_in(&item)).collect())
    } else if let Some(object) = v.dyn_ref::<js_sys::Object>().filter(|_| v.is_object()) {
        let mut map = Map::new();
        for key in js_sys::Object::keys(object).iter() {
            let value = js_sys::Reflect::get(object, &key).unwrap_or(JsValue::UNDEFINED);
            map.insert(key.as_string().unwrap_or_default(), val_in(&value));
        }
        Val::obj(map)
    } else {
        // A function, a symbol, a bigint: nothing the engine reads.
        Val::Undefined
    }
}

fn val_out(v: &Val) -> JsValue {
    match v {
        Val::Undefined => JsValue::UNDEFINED,
        Val::Null => JsValue::NULL,
        Val::Bool(b) => JsValue::from_bool(*b),
        Val::Num(n) => JsValue::from_f64(*n),
        Val::Str(s) => JsValue::from_str(s),
        Val::Arr(items) => items.iter().map(val_out).collect::<js_sys::Array>().into(),
        Val::Obj(map) => {
            let object = js_sys::Object::new();
            for (key, value) in map.iter() {
                let _ = js_sys::Reflect::set(&object, &JsValue::from_str(key), &val_out(value));
            }
            object.into()
        }
    }
}

fn faulted<T>(r: Eval<T>) -> Result<T, JsError> {
    r.map_err(|e| match e {
        EvalError::Reject(msg) | EvalError::Fault(msg) => fail(msg),
    })
}

#[wasm_bindgen(js_name = effectiveSheet)]
pub fn effective_sheet(character: &JsValue, shard_trees: &JsValue) -> Result<JsValue, JsError> {
    Ok(val_out(&faulted(sheet::effective_sheet(
        &val_in(character),
        &val_in(shard_trees),
    ))?))
}

#[wasm_bindgen(js_name = activeSources)]
pub fn active_sources(character: &JsValue, shard_trees: &JsValue) -> Result<JsValue, JsError> {
    let sources = faulted(sheet::active_sources(&val_in(character), &val_in(shard_trees)))?;
    Ok(sources
        .iter()
        .map(|s| val_out(&s.to_val()))
        .collect::<js_sys::Array>()
        .into())
}

#[wasm_bindgen(js_name = gearFeatures)]
pub fn gear_features(character: &JsValue) -> JsValue {
    sheet::gear_features(&val_in(character))
        .iter()
        .map(val_out)
        .collect::<js_sys::Array>()
        .into()
}

#[wasm_bindgen(js_name = shardFeatures)]
pub fn shard_features(character: &JsValue, catalog: &JsValue) -> JsValue {
    sheet::shard_features(&val_in(character), &val_in(catalog))
        .iter()
        .map(val_out)
        .collect::<js_sys::Array>()
        .into()
}

#[wasm_bindgen(js_name = carryMultiplier)]
pub fn carry_multiplier(character: &JsValue, shard_trees: &JsValue) -> Result<f64, JsError> {
    faulted(sheet::carry_multiplier(&val_in(character), &val_in(shard_trees)))
}

#[wasm_bindgen(js_name = currentBurden)]
pub fn current_burden(character: &JsValue) -> f64 {
    sheet::current_burden(&val_in(character))
}

#[wasm_bindgen(js_name = compileEffects)]
pub fn compile_effects(mods: &JsValue, skills: &JsValue) -> JsValue {
    val_out(&sheet::compile_effects(val_in(mods).items(), &val_in(skills)))
}

/// `scope` is read in place, like every scope; omit it and every boost must be a literal.
#[wasm_bindgen(js_name = sheetEffects)]
pub fn sheet_effects(graph: &JsValue, scope: JsValue) -> Result<JsValue, JsError> {
    let scope = (!scope.is_undefined()).then(|| JsScope(scope));
    let lookup = scope.as_ref().map(|s| s as &dyn Lookup);
    Ok(val_out(&faulted(sheet::sheet_effects(&val_in(graph), lookup))?))
}
