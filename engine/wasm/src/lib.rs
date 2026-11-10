//! WebAssembly bindings. NO LOGIC LIVES HERE: every function converts its
//! arguments, makes one call into `engine_core`, and converts the answer back.
//!
//! Two outcomes cross the boundary the way the TypeScript engine expresses them:
//! a rejected formula is `null`, and an input the original throws on is a thrown
//! `Error`.

use engine_core::expr::{self, Eval, EvalError, Lookup, Scope, ScopeVal};
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
