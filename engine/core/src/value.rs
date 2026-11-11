//! A JavaScript value, as the engine reads character data.
//!
//! The sheet layer and the resolver are written against data whose shape is
//! decided in TypeScript and stored as JSON: a missing key, `null` and
//! `undefined` each mean something, unknown fields ride along through a
//! `{...spread}`, and two references to one object are the SAME object. Typed
//! structs would have to re-decide all of that field by field; this type keeps
//! the original's semantics so the port can follow the original line by line.
//!
//! Objects and arrays are reference-counted, so a spread is a shallow copy and
//! identity (`===` on objects) is pointer identity — both exactly as in JavaScript.

use std::sync::Arc;

use indexmap::IndexMap;

use crate::js;

pub type Map = IndexMap<String, Val>;

#[derive(Debug, Clone, Default)]
pub enum Val {
    #[default]
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(Arc<str>),
    Arr(Arc<Vec<Val>>),
    Obj(Arc<Map>),
}

static UNDEFINED: Val = Val::Undefined;

impl Val {
    pub fn str(s: &str) -> Val {
        Val::Str(Arc::from(s))
    }

    pub fn arr(items: Vec<Val>) -> Val {
        Val::Arr(Arc::new(items))
    }

    pub fn obj(map: Map) -> Val {
        Val::Obj(Arc::new(map))
    }

    /// `x?.key` — `undefined` when `x` is not an object or has no such key.
    pub fn get(&self, key: &str) -> &Val {
        match self {
            Val::Obj(m) => m.get(key).unwrap_or(&UNDEFINED),
            _ => &UNDEFINED,
        }
    }

    /// `x?.[i]`.
    pub fn at(&self, i: usize) -> &Val {
        match self {
            Val::Arr(a) => a.get(i).unwrap_or(&UNDEFINED),
            _ => &UNDEFINED,
        }
    }

    /// `x?.[key]` with a computed key: `String(key)` names the property.
    pub fn get_by(&self, key: &Val) -> &Val {
        self.get(&key.to_js_string())
    }

    /// `key in x`, for own keys.
    pub fn has(&self, key: &str) -> bool {
        matches!(self, Val::Obj(m) if m.contains_key(key))
    }

    /// `x == null`.
    pub fn is_nullish(&self) -> bool {
        matches!(self, Val::Undefined | Val::Null)
    }

    pub fn is_undefined(&self) -> bool {
        matches!(self, Val::Undefined)
    }

    /// `a ?? b`.
    pub fn or<'a>(&'a self, fallback: &'a Val) -> &'a Val {
        if self.is_nullish() {
            fallback
        } else {
            self
        }
    }

    /// `!!x`.
    pub fn truthy(&self) -> bool {
        match self {
            Val::Undefined | Val::Null => false,
            Val::Bool(b) => *b,
            Val::Num(n) => *n != 0.0 && !n.is_nan(),
            Val::Str(s) => !s.is_empty(),
            Val::Arr(_) | Val::Obj(_) => true,
        }
    }

    /// `typeof x`.
    pub fn type_of(&self) -> &'static str {
        match self {
            Val::Undefined => "undefined",
            Val::Bool(_) => "boolean",
            Val::Num(_) => "number",
            Val::Str(_) => "string",
            Val::Null | Val::Arr(_) | Val::Obj(_) => "object",
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Val::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_num(&self) -> Option<f64> {
        match self {
            Val::Num(n) => Some(*n),
            _ => None,
        }
    }

    /// The elements of `x ?? []`.
    pub fn items(&self) -> &[Val] {
        match self {
            Val::Arr(a) => a,
            _ => &[],
        }
    }

    /// `Object.entries(x ?? {})`.
    pub fn entries(&self) -> impl Iterator<Item = (&String, &Val)> {
        let map = match self {
            Val::Obj(m) => Some(m.iter()),
            _ => None,
        };
        map.into_iter().flatten()
    }

    /// `{ ...x }` — a shallow copy; nothing at all from a non-object.
    pub fn spread(&self) -> Map {
        match self {
            Val::Obj(m) => (**m).clone(),
            _ => Map::new(),
        }
    }

    /// `a === b`. Objects and arrays compare by identity.
    pub fn strict_eq(&self, other: &Val) -> bool {
        match (self, other) {
            (Val::Undefined, Val::Undefined) | (Val::Null, Val::Null) => true,
            (Val::Bool(a), Val::Bool(b)) => a == b,
            (Val::Num(a), Val::Num(b)) => a == b,
            (Val::Str(a), Val::Str(b)) => a == b,
            (Val::Arr(a), Val::Arr(b)) => Arc::ptr_eq(a, b),
            (Val::Obj(a), Val::Obj(b)) => Arc::ptr_eq(a, b),
            _ => false,
        }
    }

    /// The operand of `+ - * /` and `Math.*`: the number itself, 0 for `null`,
    /// 0/1 for a boolean, NaN for `undefined`. A string or an object is NaN here
    /// where JavaScript would concatenate or coerce — a recorded deviation, on
    /// data the types forbid.
    pub fn num(&self) -> f64 {
        match self {
            Val::Num(n) => *n,
            Val::Null => 0.0,
            Val::Bool(b) => f64::from(u8::from(*b)),
            _ => f64::NAN,
        }
    }

    /// `Number(x)`.
    pub fn to_number(&self) -> f64 {
        match self {
            Val::Str(s) => js::string_to_number(s),
            Val::Arr(a) => match a.as_slice() {
                [] => 0.0,
                [one] => Val::str(&one.to_js_string_in_array()).to_number(),
                _ => f64::NAN,
            },
            Val::Obj(_) => f64::NAN,
            other => other.num(),
        }
    }

    /// `String(x)`.
    pub fn to_js_string(&self) -> String {
        match self {
            Val::Undefined => "undefined".to_owned(),
            Val::Null => "null".to_owned(),
            Val::Bool(b) => b.to_string(),
            Val::Num(n) => js::number_to_string(*n),
            Val::Str(s) => s.to_string(),
            Val::Arr(a) => a.iter().map(Val::to_js_string_in_array).collect::<Vec<_>>().join(","),
            Val::Obj(_) => "[object Object]".to_owned(),
        }
    }

    /// `Array.prototype.join` prints `null` and `undefined` as nothing.
    fn to_js_string_in_array(&self) -> String {
        if self.is_nullish() {
            String::new()
        } else {
            self.to_js_string()
        }
    }
}

impl From<f64> for Val {
    fn from(n: f64) -> Val {
        Val::Num(n)
    }
}

impl From<bool> for Val {
    fn from(b: bool) -> Val {
        Val::Bool(b)
    }
}

impl From<&str> for Val {
    fn from(s: &str) -> Val {
        Val::str(s)
    }
}

// --- JSON, for native tests and any host that speaks it ---------------------------
//
// JSON has no `undefined`: reading never produces one, and writing drops a key
// that holds one (and prints one inside an array as `null`), as JSON.stringify does.

impl serde::Serialize for Val {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::{SerializeMap, SerializeSeq};
        match self {
            Val::Undefined | Val::Null => s.serialize_unit(),
            Val::Bool(b) => s.serialize_bool(*b),
            Val::Num(n) => s.serialize_f64(*n),
            Val::Str(v) => s.serialize_str(v),
            Val::Arr(a) => {
                let mut seq = s.serialize_seq(Some(a.len()))?;
                for v in a.iter() {
                    seq.serialize_element(v)?;
                }
                seq.end()
            }
            Val::Obj(m) => {
                let mut map = s.serialize_map(None)?;
                for (k, v) in m.iter().filter(|(_, v)| !v.is_undefined()) {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
        }
    }
}

impl<'de> serde::Deserialize<'de> for Val {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Val, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = Val;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("any JSON value")
            }
            fn visit_unit<E>(self) -> Result<Val, E> {
                Ok(Val::Null)
            }
            fn visit_none<E>(self) -> Result<Val, E> {
                Ok(Val::Null)
            }
            fn visit_bool<E>(self, b: bool) -> Result<Val, E> {
                Ok(Val::Bool(b))
            }
            fn visit_f64<E>(self, n: f64) -> Result<Val, E> {
                Ok(Val::Num(n))
            }
            fn visit_i64<E>(self, n: i64) -> Result<Val, E> {
                Ok(Val::Num(n as f64))
            }
            fn visit_u64<E>(self, n: u64) -> Result<Val, E> {
                Ok(Val::Num(n as f64))
            }
            fn visit_str<E>(self, s: &str) -> Result<Val, E> {
                Ok(Val::str(s))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Val, A::Error> {
                let mut out = Vec::new();
                while let Some(v) = seq.next_element()? {
                    out.push(v);
                }
                Ok(Val::arr(out))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Val, A::Error> {
                let mut out = Map::new();
                while let Some((k, v)) = map.next_entry::<String, Val>()? {
                    out.insert(k, v);
                }
                Ok(Val::obj(out))
            }
        }
        d.deserialize_any(V)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Val {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn missing_null_and_undefined_stay_distinct() {
        let v = parse(r#"{"a": null, "b": 0, "c": ""}"#);
        assert!(v.has("a") && !v.has("z"));
        assert!(v.get("a").is_nullish() && !v.get("a").is_undefined());
        assert!(v.get("z").is_undefined());
        assert!(v.get("z").get("deeper").is_undefined());
        assert!(!v.get("b").is_nullish() && !v.get("b").truthy() && !v.get("c").truthy());
        assert_eq!(v.get("a").or(&Val::Num(7.0)).num(), 7.0);
        assert_eq!(v.get("b").or(&Val::Num(7.0)).num(), 0.0);
    }

    #[test]
    fn a_spread_is_shallow_and_identity_is_by_reference() {
        let v = parse(r#"{"graph": [{"id": "e1"}], "name": "x"}"#);
        let copy = Val::obj(v.spread());
        assert!(!copy.strict_eq(&v));
        assert!(copy.get("graph").strict_eq(v.get("graph")));
        assert!(copy.get("graph").at(0).strict_eq(v.get("graph").at(0)));
        assert!(!parse("{}").strict_eq(&parse("{}")));
        assert!(Val::str("a").strict_eq(&Val::str("a")));
    }

    #[test]
    fn coercions_follow_javascript() {
        assert_eq!(parse("null").to_number(), 0.0);
        assert!(Val::Undefined.to_number().is_nan());
        assert_eq!(parse(r#"" 12 ""#).to_number(), 12.0);
        assert_eq!(parse(r#""""#).to_number(), 0.0);
        assert!(parse(r#""1d6""#).to_number().is_nan());
        assert_eq!(parse("[1,null,[2,3]]").to_js_string(), "1,,2,3");
        assert_eq!(Val::Undefined.to_js_string(), "undefined");
        assert_eq!(
            serde_json::to_string(&Val::obj(Map::from([
                ("a".into(), Val::Undefined),
                ("b".into(), Val::Num(1.0))
            ])))
            .unwrap(),
            r#"{"b":1.0}"#
        );
    }
}
