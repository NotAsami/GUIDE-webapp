//! The feature graph — the variable DAG and the contribution graph. A port of
//! `src/lib/graph.ts`; line references are to that file. The author-time audits
//! are in `audit.rs`.
//!
//! TWO DAGs, and the boundary between them is the design: variables read only
//! variables and character state; contributions never read contributions. It is
//! enforced by what is put IN THE SCOPE, never by a list check.

use indexmap::IndexMap;

use crate::dice::{self, Random};
use crate::expr::{self, Eval, EvalError, FormulaValue, Lookup, ScopeVal};
use crate::js;
use crate::sheet::{self, Source};
use crate::value::{Map, Val};

/// How deep a chain of variables or boosting nodes may run. Cycles are caught
/// long before this; it exists so no input can overflow the stack.
const MAX_CHAIN: usize = 256;

/// A scope the engine built itself. Values are `Val`s because they come off
/// stored character data; a formula that READS one that is neither a number
/// nor a boolean faults, as every scope does.
impl Lookup for Map {
    fn lookup(&self, name: &str) -> Eval<Option<ScopeVal>> {
        match self.get(name) {
            None => Ok(None),
            Some(Val::Num(n)) => Ok(Some(ScopeVal::Num(*n))),
            Some(Val::Bool(b)) => Ok(Some(ScopeVal::Bool(*b))),
            Some(_) => Err(EvalError::Fault(format!(
                "scope value {name} is neither a number nor a boolean"
            ))),
        }
    }
}

/// graph.ts:41. `t` is the title, `s` the sentence, `id` the offending node.
#[derive(Debug, Clone)]
pub struct AuditItem {
    pub sev: &'static str,
    pub id: Val,
    pub t: String,
    pub s: String,
}

impl AuditItem {
    pub fn err(id: &Val, t: impl Into<String>, s: String) -> AuditItem {
        AuditItem {
            sev: "err",
            id: id.clone(),
            t: t.into(),
            s,
        }
    }

    pub fn warn(id: &Val, t: impl Into<String>, s: String) -> AuditItem {
        AuditItem {
            sev: "warn",
            id: id.clone(),
            t: t.into(),
            s,
        }
    }

    pub fn to_val(&self) -> Val {
        obj([
            ("sev", Val::str(self.sev)),
            ("id", self.id.clone()),
            ("t", Val::str(&self.t)),
            ("s", Val::str(&self.s)),
        ])
    }
}

pub(crate) fn obj(pairs: impl IntoIterator<Item = (&'static str, Val)>) -> Val {
    Val::obj(pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
}

/// `${x}` in a template literal.
pub(crate) fn s(v: &Val) -> String {
    v.to_js_string()
}

// --- formulas held in data -------------------------------------------------------

/// `evalExpr(src, scope)` where `src` came off stored data. Not a string: the
/// original throws on `null`/`undefined` and rejects everything else.
pub(crate) fn eval(src: &Val, scope: &dyn Lookup) -> Eval<Option<FormulaValue>> {
    let result = match src {
        Val::Str(text) => expr::eval_expr(text, scope),
        Val::Null | Val::Undefined => return Err(EvalError::Fault("a formula is missing where one was read".into())),
        _ => return Ok(None),
    };
    match result {
        Ok(v) => Ok(Some(v)),
        Err(EvalError::Reject(_)) => Ok(None),
        Err(fault) => Err(fault),
    }
}

pub(crate) fn eval_str(src: &str, scope: &dyn Lookup) -> Eval<Option<FormulaValue>> {
    eval(&Val::str(src), scope)
}

/// `freeIdents(src)`: nothing at all from anything that is not a string.
pub(crate) fn idents(src: &Val) -> Vec<String> {
    src.as_str().map(expr::free_idents).unwrap_or_default()
}

/// `interpolations(text ?? '')`.
pub(crate) fn spans(text: &Val) -> Vec<String> {
    text.as_str().map(expr::interpolations).unwrap_or_default()
}

/// `interpolate(text ?? '', scope)`. Prose that is not a string is a TypeError
/// in the original.
fn interpolate(text: &Val, scope: &dyn Lookup) -> Eval<expr::Interpolated> {
    match text {
        Val::Str(t) => expr::interpolate(t, scope),
        Val::Null | Val::Undefined => expr::interpolate("", scope),
        _ => Err(EvalError::Fault("prose is not a string".into())),
    }
}

// --- the variable DAG ------------------------------------------------------------

/// graph.ts:52. The zero a character WITHOUT this variable reads.
fn zero(t: &Val) -> Val {
    if t.as_str() == Some("bool") {
        Val::Bool(false)
    } else {
        Val::Num(0.0)
    }
}

/// graph.ts:58. The value a variable takes in the author-time probe scope.
fn probe(t: &Val) -> Val {
    if t.as_str() == Some("bool") {
        Val::Bool(false)
    } else {
        Val::Num(1.0)
    }
}

/// graph.ts:54. `d.label ?? d.name`.
pub(crate) fn label(def: &Val) -> String {
    s(def.get("label").or(def.get("name")))
}

struct Walk<'a> {
    by_name: IndexMap<String, &'a Val>,
    visiting: Vec<String>,
    failed: Vec<String>,
    bind: fn(&FormulaValue) -> Option<Val>,
}

impl Walk<'_> {
    /// graph.ts:78. The memo IS the scope and the visiting set IS the cycle check.
    fn resolve(&mut self, name: &str, scope: &mut Map, audit: &mut Vec<AuditItem>, depth: usize) -> Eval<()> {
        if scope.contains_key(name) || self.failed.iter().any(|f| f == name) {
            return Ok(());
        }
        let Some(def) = self.by_name.get(name).copied() else {
            return Ok(());
        };
        if def.get("kind").as_str() != Some("derived") {
            return Ok(());
        }
        // The id is the name AS DECLARED: a variable with no name reports no id.
        let id = def.get("name").clone();
        if self.visiting.iter().any(|v| v == name) {
            self.failed.push(name.to_owned());
            let text = format!(
                "{} depends on itself. It resolves to nothing until the loop is broken.",
                label(def)
            );
            audit.push(AuditItem::err(&id, "Variable cycle", text));
            return Ok(());
        }
        if depth > MAX_CHAIN {
            return Err(EvalError::Fault(format!("variables chained deeper than {MAX_CHAIN}")));
        }
        self.visiting.push(name.to_owned());
        let empty = Val::str("");
        let formula = def.get("formula").or(&empty);
        for dep in idents(formula) {
            self.resolve(&dep, scope, audit, depth + 1)?;
        }
        self.visiting.retain(|v| v != name);
        if self.failed.iter().any(|f| f == name) {
            return Ok(());
        }
        match eval(formula, scope)?.as_ref().and_then(self.bind) {
            Some(bound) => {
                scope.insert(name.to_owned(), bound);
            }
            None => {
                self.failed.push(name.to_owned());
                let text = format!(
                    "{} = \"{}\" produced no usable value at these values.",
                    label(def),
                    s(formula)
                );
                audit.push(AuditItem::err(&id, "Variable did not resolve", text));
            }
        }
        Ok(())
    }
}

/// graph.ts:67. One lazy memoized walk over derived variables. A cycle degrades
/// to a dropped variable, never a hung tab.
fn walk_derived<'a>(
    defs: impl Iterator<Item = &'a Val>,
    scope: &mut Map,
    bind: fn(&FormulaValue) -> Option<Val>,
    audit: &mut Vec<AuditItem>,
) -> Eval<()> {
    let mut by_name: IndexMap<String, &Val> = IndexMap::new();
    for d in defs {
        by_name.entry(s(d.get("name"))).or_insert(d);
    }
    let names: Vec<String> = by_name.keys().cloned().collect();
    let mut walk = Walk {
        by_name,
        visiting: Vec::new(),
        failed: Vec::new(),
        bind,
    };
    for name in names {
        walk.resolve(&name, scope, audit, 0)?;
    }
    Ok(())
}

/// A variable is num or bool. An array, an unrolled dice term or a display-only
/// string is "not a value this can store" (graph.ts:310).
fn bind_value(v: &FormulaValue) -> Option<Val> {
    match v {
        FormulaValue::Bool { v } => Some(Val::Bool(*v)),
        FormulaValue::Num { flat, dice } if dice.is_empty() => Some(Val::Num(*flat)),
        _ => None,
    }
}

/// Only the TYPE is wanted at author time, never the probe's computed value (graph.ts:162).
fn bind_type(v: &FormulaValue) -> Option<Val> {
    match v {
        FormulaValue::Arr { .. } => None,
        FormulaValue::Bool { .. } => Some(Val::Bool(false)),
        _ => Some(Val::Num(1.0)),
    }
}

fn set_if_absent(scope: &mut Map, name: &Val, value: Val) {
    scope.entry(s(name)).or_insert(value);
}

/// graph.ts:122. The scope the AUDIT evaluates formulas against: type-correct
/// and non-zero. Returns the scope and whatever the walk reported.
pub fn probe_scope(defs: &[Val], catalog_types: &Val) -> Eval<(Map, Vec<AuditItem>)> {
    let mut scope = Map::new();
    let mut audit = Vec::new();
    for k in expr::VAR_IDENTS {
        scope.insert(k.to_owned(), Val::Num(1.0));
    }
    for (k, v) in expr::roll_ident_probe() {
        let v = match v {
            ScopeVal::Num(n) => Val::Num(n),
            ScopeVal::Bool(b) => Val::Bool(b),
        };
        scope.insert(k, v);
    }
    for d in defs.iter().filter(|d| d.get("kind").as_str() == Some("stored")) {
        scope.insert(s(d.get("name")), probe(d.get("type")));
    }
    for d in defs
        .iter()
        .filter(|d| d.get("kind").as_str() == Some("derived") && d.get("uses").truthy())
    {
        scope.insert(s(d.get("name")), Val::Num(1.0));
    }
    // The catalog goes in BEFORE the walk, and never over a local declaration.
    let local: Vec<String> = defs.iter().map(|d| s(d.get("name"))).collect();
    for (name, t) in catalog_types.entries() {
        if !scope.contains_key(name) && !local.contains(name) {
            scope.insert(name.clone(), probe(t));
        }
    }
    walk_derived(defs.iter(), &mut scope, bind_type, &mut audit)?;
    // A derived variable that did not resolve still needs a binding.
    for d in defs {
        set_if_absent(&mut scope, d.get("name"), probe(d.get("type")));
    }
    for (name, t) in catalog_types.entries() {
        scope.entry(name.clone()).or_insert_with(|| probe(t));
    }
    Ok((scope, audit))
}

/// graph.ts:177. Declarations on one active source.
fn decls_of(source: &Source) -> &[Val] {
    source.obj.get("vars").items()
}

/// graph.ts:44. A declaration plus where it came from.
pub struct Binding<'a> {
    pub def: &'a Val,
    pub from: &'a Source,
}

/// graph.ts:187. Declared variables on the active set, FIRST WINS on a duplicate name.
pub fn collect_vars(sources: &[Source]) -> IndexMap<String, Binding<'_>> {
    let mut out = IndexMap::new();
    for from in sources {
        for def in decls_of(from) {
            out.entry(s(def.get("name"))).or_insert(Binding { def, from });
        }
    }
    out
}

/// spells.ts:89. Cantrip tier by character level: 1 / 5 / 11 / 17.
fn cantrip_tier(level: f64) -> f64 {
    if level >= 17.0 {
        4.0
    } else if level >= 11.0 {
        3.0
    } else if level >= 5.0 {
        2.0
    } else {
        1.0
    }
}

/// graph.ts:206. The non-variable half of a variable formula's scope: what the
/// character HAS, then exactly `VAR_IDENTS`.
pub fn base_scope(character: &Val, shard_trees: &Val) -> Eval<Map> {
    let view = sheet::effective_sheet(character, shard_trees)?;
    let ab = sheet::abilities(&view);
    let own = character.get("sheet");
    let mut scope = Map::new();
    for f in own.get("features").items() {
        // The STORED name: a rename changes what the screens show, never the identifier.
        let name = if f.has("__baseName") {
            f.get("__baseName")
        } else {
            f.get("name")
        };
        if name.truthy() {
            scope.insert(expr::has_ident(&s(name)), Val::Bool(true));
        }
    }
    let level = character.get("identity").get("level").or(&Val::Num(1.0)).clone();
    let zero = Val::Num(0.0);
    scope.insert("level".to_owned(), level.clone());
    scope.insert("prof".to_owned(), sheet::proficiency(&view));
    for key in sheet::ABILITY_KEYS {
        scope.insert(key.to_owned(), Val::Num(sheet::ability_mod(ab.get(key).num())));
    }
    for key in sheet::ABILITY_KEYS {
        scope.insert(format!("{key}Score"), ab.get(key).clone());
    }
    scope.insert("hp".to_owned(), own.get("hp").get("current").or(&zero).clone());
    scope.insert(
        "hpMax".to_owned(),
        view.get("hp").get("max").or(own.get("hp").get("max")).or(&zero).clone(),
    );
    scope.insert(
        "saveDc".to_owned(),
        character.get("spellbook").get("saveDC").or(&zero).clone(),
    );
    let attacks = character.get("resources").get("graph").get("attacks").or(&zero).clone();
    scope.insert("attacksThisTurn".to_owned(), attacks);
    scope.insert("tier".to_owned(), Val::Num(cantrip_tier(level.num())));
    Ok(scope)
}

/// featureView.ts:39. A feature's use counter, its max resolved against `scope`.
/// `(current, max)`, or nothing for a feature without one.
pub(crate) fn uses_of(feature: &Val, scope: &dyn Lookup) -> Eval<Option<(f64, f64)>> {
    let uses = feature.get("uses");
    if !uses.truthy() {
        return Ok(None);
    }
    let authored = uses.get("max");
    let max = match authored {
        Val::Num(n) => *n,
        other => {
            let text = s(other.or(&Val::str("")));
            let raw = js::trim(&text);
            let n = js::string_to_number(raw);
            if raw.is_empty() {
                0.0
            } else if n.is_finite() {
                js::max(0.0, n.trunc())
            } else {
                // Dice in a use count is nonsense, so a formula carrying them is refused.
                match eval_str(raw, scope)? {
                    Some(FormulaValue::Num { flat, dice }) if dice.is_empty() => js::max(0.0, flat.trunc()),
                    _ => 0.0,
                }
            }
        }
    };
    // Absent `current` is FULL, not empty.
    let current = uses.get("current").or(&Val::Num(max)).num();
    Ok(Some((js::max(0.0, js::min(current, max)), max)))
}

/// graph.ts:256. Stored values, split by who may write them.
fn stored_value(def: &Val, state: &Val) -> Val {
    let bucket = if def.get("scope").as_str() == Some("dm") {
        state.get("dmVars")
    } else {
        state.get("vars")
    };
    bucket
        .get_by(def.get("name"))
        .or(def.get("initial"))
        .or(&zero(def.get("type")))
        .clone()
}

/// graph.ts:275. Every variable's settled value, ready to hand to the evaluator
/// as its scope. Derived variables are computed here and never stored.
pub fn character_vars(character: &Val, shard_trees: &Val, catalog_types: &Val) -> Eval<(Map, Vec<AuditItem>)> {
    let sources = sheet::active_sources(character, shard_trees)?;
    let bindings = collect_vars(&sources);
    let state = character.get("resources").get("graph");

    let decls: Vec<(Val, Val)> = sources
        .iter()
        .flat_map(|from| {
            decls_of(from)
                .iter()
                .map(move |def| (def.get("name").clone(), from.obj.get("name").clone()))
        })
        .collect();
    let mut audit = var_collisions(&decls, "err");

    let mut scope = base_scope(character, shard_trees)?;

    // Declared in the catalog but not active here: the type's zero.
    for (name, t) in catalog_types.entries() {
        if !bindings.contains_key(name) && !scope.contains_key(name) {
            scope.insert(name.clone(), zero(t));
        }
    }
    for b in bindings
        .values()
        .filter(|b| b.def.get("kind").as_str() == Some("stored"))
    {
        scope.insert(s(b.def.get("name")), stored_value(b.def, state));
    }

    walk_derived(bindings.values().map(|b| b.def), &mut scope, bind_value, &mut audit)?;

    // USE COUNTERS, LAST: a counter's ceiling is itself a formula over the finished scope.
    for b in bindings.values() {
        let counter = b.def.get("uses");
        if b.def.get("kind").as_str() != Some("derived") || !counter.truthy() {
            continue;
        }
        let features = character.get("sheet").get("features").items();
        let target = features
            .iter()
            .find(|f| counter.as_str() == Some(gid("feature", f).as_str()));
        let current = match target {
            Some(feature) => uses_of(feature, &scope)?.map(|(current, _)| current),
            None => None,
        };
        scope.insert(s(b.def.get("name")), Val::Num(current.unwrap_or(0.0)));
    }
    Ok((scope, audit))
}

/// graph.ts:340. Duplicate declarations of one name: `(name, declared by)`.
pub fn var_collisions(decls: &[(Val, Val)], sev: &'static str) -> Vec<AuditItem> {
    let mut seen: IndexMap<String, (Val, Vec<&Val>)> = IndexMap::new();
    for (name, from) in decls {
        seen.entry(s(name))
            .or_insert_with(|| (name.clone(), Vec::new()))
            .1
            .push(from);
    }
    let mut out = Vec::new();
    for (name, (id, froms)) in &seen {
        if froms.len() < 2 {
            continue;
        }
        // `Array.prototype.join` prints a missing name as nothing.
        let by: Vec<String> = froms
            .iter()
            .map(|f| if f.is_nullish() { String::new() } else { s(f) })
            .collect();
        let text = format!(
            "{name} is declared by {}. The first declaration wins.",
            by.join(" and ")
        );
        out.push(AuditItem {
            sev,
            id: id.clone(),
            t: "Duplicate variable".into(),
            s: text,
        });
    }
    out
}

// --- identity and matching -------------------------------------------------------

/// graph.ts:443. Stable graph id: the CATALOG back-ref first, the instance id as fallback.
pub fn gid(kind: &str, x: &Val) -> String {
    let empty = Val::str("");
    let id = x
        .get("feature_id")
        .or(x.get("spell_id"))
        .or(x.get("item_id"))
        .or(x.get("id"))
        .or(&empty);
    format!("{kind}:{}", s(id))
}

/// graph.ts:451. A shard node's id is unique only within its tree.
pub fn node_gid(shard_id: &str, node_id: &str) -> String {
    format!("shardnode:{shard_id}.{node_id}")
}

/// `raw.trim().toLowerCase().replace(/\s+/g, with)`.
fn squeeze(raw: &str, with: char) -> String {
    let lower = js::to_lower_case(js::trim(raw));
    let mut out = String::with_capacity(lower.len());
    let mut in_space = false;
    for c in lower.chars() {
        if js::is_whitespace(c) {
            if !in_space {
                out.push(with);
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// graph.ts:459. One normalisation for free-text tags, shared by the matcher and the editor.
pub fn normalize_tag(raw: &str) -> String {
    squeeze(raw, '_')
}

/// graph.ts:471. The identity of an `ask`, for grouping.
pub fn ask_key(raw: &str) -> String {
    squeeze(raw, ' ')
}

/// graph.ts:753. A target selector as the index keys it.
pub fn as_key(target: &str) -> String {
    match target.strip_prefix("tag:") {
        Some(tag) => format!("tag:{}", normalize_tag(tag)),
        None => target.to_owned(),
    }
}

/// graph.ts:723. Ability check, saving throw, attack roll: a D20 Test.
pub fn is_d20(kind: &Val) -> bool {
    matches!(kind.as_str(), Some("check" | "save" | "attack"))
}

/// graph.ts:729. Every index key a roll answers to, in order.
pub fn req_keys(req: &Val) -> Vec<String> {
    let kind = s(req.get("kind"));
    let mut keys = Vec::new();
    let mut push = |key: Option<String>| keys.extend(key.filter(|k| !k.is_empty()));
    let subject = req.get("subject");
    push(subject.truthy().then(|| s(subject)));
    for tag in req.get("tags").items() {
        push(Some(format!("tag:{}", normalize_tag(&s(tag)))));
    }
    push(Some(format!("roll:{kind}")));
    push(is_d20(req.get("kind")).then(|| "roll:d20".to_owned()));
    for part in [req.get("sub"), req.get("ability")] {
        push(part.truthy().then(|| format!("roll:{kind}.{}", s(part))));
    }
    keys
}

/// graph.ts:755. Does this armed modifier belong to this roll?
pub fn armed_matches(m: &Val, req: &Val) -> bool {
    let kind = m.get("kind");
    let kind_ok = if kind.as_str() == Some("d20") {
        is_d20(req.get("kind"))
    } else {
        kind.strict_eq(req.get("kind"))
    };
    let sub = m.get("sub");
    let subject = m.get("subject");
    kind_ok
        && (!sub.truthy() || sub.strict_eq(req.get("sub")) || sub.strict_eq(req.get("ability")))
        && (!subject.truthy() || subject.strict_eq(req.get("subject")))
}

/// graph.ts:777. The gid of an active source; none for a potion or a shard tree.
fn source_gid(source: &Source) -> Option<String> {
    match source.kind {
        "feature" | "spell" | "item" | "weapon" => Some(gid(source.kind, &source.obj)),
        "shardnode" => Some(node_gid(&s(&source.shard_id), &s(source.obj.get("id")))),
        _ => None,
    }
}

/// The ops whose target names a damage kind rather than a roll (graph.ts:475).
pub(crate) fn is_damage_flag(op: &str) -> bool {
    matches!(op, "resist" | "vuln" | "immune")
}

/// opSchema.ts:351. Runs on a press and writes state.
pub(crate) fn is_activation(op: &str) -> bool {
    matches!(op, "setVar" | "setHp" | "addUses" | "addSlot" | "grant" | "addVar")
}

/// opSchema.ts:353. Moves a number on the sheet; never reaches a roll.
pub(crate) fn is_sheet(op: &str) -> bool {
    matches!(op, "boost" | "useability" | "unarmored")
}

// --- the context -----------------------------------------------------------------

/// graph.ts:640. One authored effect, where it came from, and who owns it.
#[derive(Debug, Clone)]
pub struct Indexed {
    pub eff: Val,
    pub from: Source,
    pub owner: String,
}

impl Indexed {
    pub fn to_val(&self) -> Val {
        obj([
            ("eff", self.eff.clone()),
            ("from", self.from.to_val()),
            ("owner", Val::str(&self.owner)),
        ])
    }
}

/// graph.ts:646. Built once per character load and reused across every roll.
pub struct Context {
    pub scope: Map,
    pub index: IndexMap<String, Vec<Indexed>>,
    pub by_owner: IndexMap<String, Vec<Indexed>>,
    pub problems: Vec<AuditItem>,
    pub armed: Vec<Val>,
}

/// graph.ts:788.
pub fn build_context(character: &Val, shard_trees: &Val, catalog_types: &Val) -> Eval<Context> {
    let (scope, problems) = character_vars(character, shard_trees, catalog_types)?;
    let mut index: IndexMap<String, Vec<Indexed>> = IndexMap::new();
    let mut by_owner: IndexMap<String, Vec<Indexed>> = IndexMap::new();
    for from in sheet::active_sources(character, shard_trees)? {
        let Some(owner) = source_gid(&from) else { continue };
        for eff in from.obj.get("graph").items() {
            let e = Indexed {
                eff: eff.clone(),
                from: from.clone(),
                owner: owner.clone(),
            };
            by_owner.entry(owner.clone()).or_default().push(e.clone());
            // No target = this node's own roll, indexed under its own gid.
            let targets = eff.get("target").items();
            if targets.is_empty() {
                index.entry(owner.clone()).or_default().push(e);
            } else {
                for t in targets {
                    index.entry(as_key(&s(t))).or_default().push(e.clone());
                }
            }
        }
    }
    let armed = character.get("resources").get("graph").get("armed").items().to_vec();
    Ok(Context {
        scope,
        index,
        by_owner,
        problems,
        armed,
    })
}

impl Context {
    fn at(&self, key: &str) -> &[Indexed] {
        self.index.get(key).map_or(&[], Vec::as_slice)
    }
}

/// graph.ts:687. Armed modifiers whose condition has since gone false. Only
/// GATED arms are touched, and an unresolvable condition reads as still live.
pub fn stale_armed(ctx: &Context, scope: &dyn Lookup) -> Eval<Vec<Val>> {
    let mut out = Vec::new();
    for m in &ctx.armed {
        let owned = ctx.by_owner.get(&s(m.get("source"))).map_or(&[][..], Vec::as_slice);
        let effs: Vec<&Indexed> = owned
            .iter()
            .filter(|e| {
                if m.get("eff").truthy() {
                    e.eff.get("id").strict_eq(m.get("eff"))
                } else {
                    e.eff.get("op").strict_eq(m.get("op")) && e.eff.get("label").strict_eq(m.get("label"))
                }
            })
            .collect();
        if effs.is_empty() {
            continue;
        }
        let mut live = false;
        for e in effs {
            let when = e.eff.get("when");
            let still = when.is_undefined() || !matches!(eval(when, scope)?, Some(FormulaValue::Bool { v: false }));
            if still {
                live = true;
                break;
            }
        }
        if !live {
            out.push(m.get("id").clone());
        }
    }
    Ok(out)
}

/// graph.ts:836. Who targets this node: the reverse of what the index is normally asked.
pub fn affected_by(ctx: &Context, target: &str, tags: &[Val]) -> Vec<Val> {
    let keys = std::iter::once(target.to_owned()).chain(tags.iter().map(|t| format!("tag:{}", normalize_tag(&s(t)))));
    let mut seen: Vec<&Val> = Vec::new();
    let mut out = Vec::new();
    for key in keys {
        for e in ctx.at(&key) {
            if e.owner == target || seen.iter().any(|x| x.strict_eq(&e.eff)) {
                continue;
            }
            seen.push(&e.eff);
            out.push(obj([
                ("eff", e.eff.clone()),
                ("source", e.from.obj.get("name").clone()),
                ("sourceGid", Val::str(&e.owner)),
            ]));
        }
    }
    out
}

/// graph.ts:864. An active source's card text, whatever that source calls the field.
fn summary_of(obj: &Val) -> Val {
    ["light_description", "summary", "description", "effect"]
        .into_iter()
        .map(|k| obj.get(k))
        .find(|v| v.as_str().is_some_and(|text| !js::trim(text).is_empty()))
        .cloned()
        .unwrap_or(Val::Undefined)
}

/// graph.ts:879. The operands of a formula at the values it actually used.
fn parts_of(formula: &Val, scope: &Map) -> Val {
    if !formula.truthy() {
        return Val::Undefined;
    }
    let parts: Vec<Val> = idents(formula)
        .into_iter()
        .filter_map(|id| {
            scope
                .get(&id)
                .and_then(Val::as_num)
                .map(|n| obj([("name", Val::str(&id)), ("value", Val::Num(n))]))
        })
        .collect();
    if parts.is_empty() {
        Val::Undefined
    } else {
        Val::arr(parts)
    }
}

/// opSchema.ts:446. The formula a level table gives at this level: sparse means
/// step (walk DOWN to the last filled slot), and out of range clamps.
pub(crate) fn level_formula(eff: &Val, level: Option<&Val>) -> Option<String> {
    let table = eff.get("byLevel").items();
    let cell = |i: usize| js::trim(&s(table.get(i).unwrap_or(&Val::Undefined).or(&Val::str("")))).to_owned();
    if !(1..table.len()).any(|i| !cell(i).is_empty()) {
        return None;
    }
    let level = level.and_then(Val::as_num).unwrap_or(1.0);
    let start = js::min(js::max(1.0, js::round(level)), table.len() as f64 - 1.0);
    if start.is_nan() {
        return Some("0".to_owned());
    }
    let filled = (1..=start as usize).rev().map(cell).find(|c| !c.is_empty());
    // Below the first filled slot: the feature has not come online yet.
    Some(filled.unwrap_or_else(|| "0".to_owned()))
}

// --- resolve ---------------------------------------------------------------------

#[derive(Clone, Default)]
struct Amount {
    flat: f64,
    dice: Vec<String>,
}

struct Resolver<'a> {
    ctx: &'a Context,
    scope: Map,
    /// Everything that already matched the ROLL, by identity.
    seen: Vec<&'a Val>,
    memo: IndexMap<String, Amount>,
    visiting: Vec<String>,
    problems: Vec<AuditItem>,
}

impl<'a> Resolver<'a> {
    fn problem(&mut self, id: &Val, t: &str, text: String) {
        self.problems.push(AuditItem::err(id, t, text));
    }

    /// graph.ts:966. A node's contribution can itself be boosted by effects
    /// targeting that node's gid. Memoized by gid; a cycle drops the chained bonus.
    fn boost(&mut self, owner: &str, depth: usize) -> Eval<Amount> {
        if let Some(hit) = self.memo.get(owner) {
            return Ok(hit.clone());
        }
        if self.visiting.iter().any(|v| v == owner) {
            let text = format!("{owner} feeds itself. Its chained bonus is dropped until the loop is broken.");
            self.problem(&Val::str(owner), "Contribution cycle", text);
            return Ok(Amount::default());
        }
        if depth > MAX_CHAIN {
            return Err(EvalError::Fault(format!(
                "contributions chained deeper than {MAX_CHAIN}"
            )));
        }
        self.visiting.push(owner.to_owned());
        let mut acc = Amount::default();
        let ctx = self.ctx;
        for e in ctx.at(owner) {
            // Chaining is for nodes the roll did not name.
            let already = self.seen.iter().any(|x| x.strict_eq(&e.eff));
            if e.eff.get("op").as_str() != Some("add") || e.owner == owner || already {
                continue;
            }
            if let Some(v) = self.value(e, depth + 1)? {
                acc.flat += v.flat;
                acc.dice.extend(v.dice);
            }
        }
        self.visiting.retain(|v| v != owner);
        self.memo.insert(owner.to_owned(), acc.clone());
        Ok(acc)
    }

    /// graph.ts:993.
    fn value(&mut self, e: &Indexed, depth: usize) -> Eval<Option<Amount>> {
        let empty = Val::str("");
        let src = match level_formula(&e.eff, self.scope.get("level")) {
            Some(cell) => Val::str(&cell),
            None => e.eff.get("value").or(&empty).clone(),
        };
        let Some(FormulaValue::Num { flat, mut dice }) = eval(&src, &self.scope)? else {
            let text = format!(
                "{} = \"{}\" produced no usable value at these values.",
                s(e.eff.get("label")),
                s(&src)
            );
            self.problem(e.eff.get("id"), "Contribution did not resolve", text);
            return Ok(None);
        };
        let chained = self.boost(&e.owner, depth)?;
        dice.extend(chained.dice);
        Ok(Some(Amount {
            flat: flat + chained.flat,
            dice,
        }))
    }

    /// A formula that must come to one plain number, or a named problem.
    fn number(&mut self, src: &Val, eff: &Val, t: &str, text: String) -> Eval<Option<f64>> {
        match eval(src, &self.scope)? {
            Some(FormulaValue::Num { flat, dice }) if dice.is_empty() => Ok(Some(flat)),
            _ => {
                self.problem(eff.get("id"), t, text);
                Ok(None)
            }
        }
    }
}

fn dice_val(dice: &[String]) -> Val {
    Val::arr(dice.iter().map(|d| Val::str(d)).collect())
}

/// graph.ts:892. What applies to this roll.
pub fn resolve(ctx: &Context, req: &Val) -> Eval<Val> {
    // THE ROLL SCOPE: the character scope plus roll context. `hit` is bound only when known.
    let mut scope = ctx.scope.clone();
    scope.insert("cast".to_owned(), req.get("cast").or(&Val::Num(0.0)).clone());
    scope.insert(
        "proficient".to_owned(),
        req.get("proficient").or(&Val::Bool(false)).clone(),
    );
    scope.insert("targetAc".to_owned(), req.get("targetAc").or(&Val::Num(0.0)).clone());
    let hit = req.get("hit");
    if !hit.is_undefined() {
        scope.insert("hit".to_owned(), hit.clone());
    }

    // Match: the subject itself, each of its tags, the roll kind, the sub-kind, the ability.
    let keys = req_keys(req);
    let mut r = Resolver {
        ctx,
        scope,
        seen: Vec::new(),
        memo: IndexMap::new(),
        visiting: Vec::new(),
        problems: Vec::new(),
    };
    let mut matched: Vec<&Indexed> = Vec::new();
    for key in &keys {
        for e in ctx.at(key) {
            if r.seen.iter().any(|x| x.strict_eq(&e.eff)) {
                continue; // an OR across selectors applies once, not twice
            }
            r.seen.push(&e.eff);
            // `and` means every selector must hold of THIS roll.
            let every = e
                .eff
                .get("target")
                .items()
                .iter()
                .all(|t| keys.contains(&as_key(&s(t))));
            if e.eff.get("match").as_str() == Some("and") && !every {
                continue;
            }
            matched.push(e);
        }
    }

    let (mut adv, mut dis, mut crit) = (false, false, false);
    let mut crit_from: Option<f64> = None;
    let mut floor: Option<f64> = None;
    let mut riders: Vec<Map> = Vec::new();
    let mut notes: Vec<Val> = Vec::new();
    let mut ask_groups: IndexMap<String, usize> = IndexMap::new();

    // `say`: authored text computes wherever it is shown.
    fn say(text: &Val, scope: &Map) -> Eval<Val> {
        if text.truthy() {
            Ok(Val::str(&interpolate(text, scope)?.text))
        } else {
            Ok(text.clone())
        }
    }

    for e in matched {
        let eff = &e.eff;
        let from = &e.from;
        let op = eff.get("op").as_str().unwrap_or("");
        let name = s(eff.get("label"));

        // `when` gates EXISTENCE. An unknown `hit` is evaluated as if it hit and
        // what survives arrives as a question.
        let when = eff.get("when");
        let mut unknown_hit = false;
        if !when.is_undefined() {
            unknown_hit = hit.is_undefined() && idents(when).iter().any(|id| id == "hit");
            let cond = if unknown_hit {
                let mut as_if = r.scope.clone();
                as_if.insert("hit".to_owned(), Val::Bool(true));
                eval(when, &as_if)?
            } else {
                eval(when, &r.scope)?
            };
            match cond {
                Some(FormulaValue::Bool { v: true }) => {}
                Some(FormulaValue::Bool { v: false }) => continue,
                _ => {
                    let text = format!(
                        "{name}'s condition \"{}\" is not a yes/no answer at these values.",
                        s(when)
                    );
                    r.problem(eff.get("id"), "Condition did not resolve", text);
                    continue;
                }
            }
        }
        // The author's own question wins over the engine's.
        let hit_ask = if unknown_hit {
            Val::str(expr::HIT_ASK)
        } else {
            Val::Undefined
        };
        let ask = eff.get("ask").or(&hit_ask).clone();

        let mut reveal = Val::Undefined;
        if op == "note" {
            let body = if eff.get("text").truthy() {
                eff.get("text")
            } else {
                eff.get("label")
            };
            let shown = interpolate(body, &r.scope)?;
            for src in &shown.bad {
                let text = format!("{name}'s text reads \"{{{src}}}\", which produced no value at these values.");
                r.problem(eff.get("id"), "Note did not compute", text);
            }
            if !eff.get("ask").truthy() {
                notes.push(Val::str(&shown.text));
                continue;
            }
            reveal = Val::str(&shown.text);
        }

        // None of these reach a roll: damage flags, activation outcomes, sheet
        // ops, renames — and a `once` effect ARMS rather than applies.
        if is_damage_flag(op) || is_activation(op) || is_sheet(op) || op == "rename" || eff.get("once").truthy() {
            continue;
        }

        let v = if op == "add" {
            match r.value(e, 0)? {
                Some(v) => v,
                None => continue,
            }
        } else {
            Amount::default()
        };

        let source_text = summary_of(&from.obj);
        let base = |label: Val| -> Map {
            Map::from([
                ("label".to_owned(), label),
                ("source".to_owned(), from.obj.get("name").clone()),
                ("sourceGid".to_owned(), Val::str(&e.owner)),
                ("op".to_owned(), eff.get("op").clone()),
            ])
        };

        // A REROLL IS ALWAYS AN OFFER, never automatic.
        if op == "reroll" {
            let mut faces = None;
            let authored = eff.get("faces");
            if authored.as_str().is_some_and(|f| !js::trim(f).is_empty()) {
                let text = format!(
                    "{name}'s \"only dice showing at most {}\" produced no number at these values.",
                    s(authored)
                );
                match r.number(authored, eff, "Reroll threshold did not resolve", text)? {
                    Some(n) => faces = Some(n.trunc()),
                    None => continue,
                }
            }
            let keep = match eff.get("keep").as_str() {
                Some("advantage") => "advantage",
                Some("better") => "better",
                _ => "new",
            };
            let damage = eff
                .get("target")
                .items()
                .iter()
                .any(|t| s(t).starts_with("roll:damage"));
            let mut rider = base(say(eff.get("label"), &r.scope)?);
            rider.insert("formula".to_owned(), Val::str(""));
            rider.insert("flat".to_owned(), Val::Num(0.0));
            rider.insert("dice".to_owned(), Val::arr(Vec::new()));
            rider.insert("when".to_owned(), Val::str("manual"));
            rider.insert("on".to_owned(), Val::Bool(false));
            rider.insert("keep".to_owned(), Val::str(keep));
            rider.insert("rerolls".to_owned(), Val::str(if damage { "damage" } else { "d20" }));
            if let Some(n) = faces {
                rider.insert("faces".to_owned(), Val::Num(n));
            }
            rider.insert("sourceText".to_owned(), source_text);
            riders.push(rider);
            continue;
        }

        let empty = Val::str("");
        let formula = eff.get("value").or(&empty).clone();
        let unconditional = when.is_undefined() && !eff.get("ask").truthy();
        let asked = ask.truthy();

        // A flag applies now unless the player still has to answer for it.
        if unconditional || !asked {
            match op {
                "adv" => adv = true,
                "dis" => dis = true,
                "crit" => {
                    // The flag stands even when the threshold is broken.
                    crit = true;
                    let threshold = eff.get("threshold");
                    if threshold.truthy() {
                        let text = format!(
                            "{name}'s threshold \"{}\" produced no number at these values.",
                            s(threshold)
                        );
                        if let Some(n) = r.number(threshold, eff, "Crit range did not resolve", text)? {
                            crit_from = Some(crit_from.map_or(n, |lowest| js::min(lowest, n)));
                        }
                    }
                }
                "floor" => {
                    let minimum = eff.get("minimum").or(&empty).clone();
                    let text = format!(
                        "{name}'s minimum \"{}\" produced no number at these values.",
                        s(&minimum)
                    );
                    if let Some(n) = r.number(&minimum, eff, "Minimum did not resolve", text)? {
                        floor = Some(floor.map_or(n, |highest| js::max(highest, n)));
                    }
                }
                _ => {}
            }
        }

        let mut rider = base(say(eff.get("label"), &r.scope)?);
        rider.insert("formula".to_owned(), formula);
        rider.insert("flat".to_owned(), Val::Num(v.flat));
        rider.insert("dice".to_owned(), dice_val(&v.dice));
        if unconditional {
            rider.insert("when".to_owned(), Val::str("always"));
            rider.insert("on".to_owned(), Val::Bool(true));
        } else {
            rider.insert("when".to_owned(), Val::str(if asked { "manual" } else { "active" }));
            rider.insert("on".to_owned(), Val::Bool(!asked));
            rider.insert("text".to_owned(), say(&ask, &r.scope)?);
            rider.insert("reveal".to_owned(), reveal.clone());
        }
        rider.insert("dmgType".to_owned(), eff.get("dmgType").clone());
        rider.insert("sourceText".to_owned(), source_text);
        rider.insert("parts".to_owned(), parts_of(eff.get("value"), &r.scope));

        // One fact, one checkbox: effects sharing an `ask` are one decision.
        if !unconditional && asked {
            let key = ask_key(&s(&ask));
            if let Some(existing) = ask_groups.get(&key).and_then(|i| riders.get_mut(*i)) {
                let flat = existing.get("flat").map_or(0.0, Val::num) + v.flat;
                existing.insert("flat".to_owned(), Val::Num(flat));
                let mut dice = existing.get("dice").map(|d| d.items().to_vec()).unwrap_or_default();
                dice.extend(v.dice.iter().map(|d| Val::str(d)));
                existing.insert("dice".to_owned(), Val::arr(dice));
                if reveal.truthy() {
                    let joined = match existing.get("reveal").filter(|x| x.truthy()) {
                        Some(have) => Val::str(&format!("{}\n\n{}", s(have), s(&reveal))),
                        None => reveal.clone(),
                    };
                    existing.insert("reveal".to_owned(), joined);
                }
                // A real contribution outranks prose, whichever was authored first.
                if existing.get("op").and_then(Val::as_str) == Some("note") && op != "note" {
                    for key in ["op", "formula", "dmgType"] {
                        existing.insert(key.to_owned(), rider.get(key).cloned().unwrap_or_default());
                    }
                }
                continue;
            }
            ask_groups.insert(key, riders.len());
        }
        riders.push(rider);
    }

    // The armed queue. TAKEN arms (no `ask`) apply; OFFERED ones arrive as a question.
    let offered = |source: &Val| {
        ctx.armed
            .iter()
            .filter(|m| m.get("ask").truthy() && !m.get("spent").truthy() && armed_matches(m, req))
            .filter(|m| m.get("source").strict_eq(source))
            .count()
    };
    for m in &ctx.armed {
        // Already answered: taking what a hold offered spends it.
        if !armed_matches(m, req) || m.get("spent").truthy() {
            continue;
        }
        let op = m.get("op").as_str().unwrap_or("");
        let empty = Val::str("");
        let value = m.get("value").or(&empty);
        let mut amount = Amount::default();
        if op == "add" {
            match eval(value, &r.scope)? {
                Some(FormulaValue::Num { flat, dice }) => amount = Amount { flat, dice },
                _ => {
                    let text = format!(
                        "{} = \"{}\" produced no usable value at these values. It stays armed.",
                        s(m.get("label")),
                        s(value)
                    );
                    r.problem(m.get("id"), "Armed modifier did not resolve", text);
                    continue;
                }
            }
        }
        let asked = m.get("ask").truthy();
        // An OFFERED arm has not been taken, so it grants nothing yet.
        if !asked {
            match op {
                "adv" => adv = true,
                "dis" => dis = true,
                "crit" => crit = true,
                _ => {}
            }
        }
        let source = m.get("source");
        let named = m.get("sourceName");
        let mut rider = Map::from([
            ("label".to_owned(), say(m.get("label"), &r.scope)?),
            (
                "source".to_owned(),
                if named.truthy() { named.clone() } else { source.clone() },
            ),
            ("sourceGid".to_owned(), source.clone()),
            ("op".to_owned(), m.get("op").clone()),
            ("formula".to_owned(), value.clone()),
            ("flat".to_owned(), Val::Num(amount.flat)),
            ("dice".to_owned(), dice_val(&amount.dice)),
            ("when".to_owned(), Val::str(if asked { "manual" } else { "always" })),
            ("on".to_owned(), Val::Bool(!asked)),
            ("armedId".to_owned(), m.get("id").clone()),
            ("dmgType".to_owned(), m.get("dmgType").clone()),
        ]);
        if asked {
            rider.insert("text".to_owned(), say(m.get("ask"), &r.scope)?);
            rider.insert("reveal".to_owned(), say(m.get("text"), &r.scope)?);
            // Only a REAL choice gets a group.
            if offered(source) > 1 {
                rider.insert("choice".to_owned(), source.clone());
                let picks = m.get("picks");
                if picks.truthy() && picks.num() > 1.0 {
                    rider.insert("picks".to_owned(), picks.clone());
                }
            }
        }
        rider.insert("parts".to_owned(), parts_of(m.get("value"), &r.scope));
        riders.push(rider);
    }

    let mut out = Map::from([
        ("adv".to_owned(), Val::Bool(adv)),
        ("dis".to_owned(), Val::Bool(dis)),
        ("crit".to_owned(), Val::Bool(crit)),
        (
            "riders".to_owned(),
            Val::arr(riders.into_iter().map(Val::obj).collect()),
        ),
        ("notes".to_owned(), Val::arr(notes)),
        (
            "problems".to_owned(),
            Val::arr(r.problems.iter().map(AuditItem::to_val).collect()),
        ),
    ]);
    if let Some(n) = floor {
        out.insert("floor".to_owned(), Val::Num(n));
    }
    if let Some(n) = crit_from {
        out.insert("critFrom".to_owned(), Val::Num(n));
    }
    Ok(Val::obj(out))
}

/// graph.ts:1311. Resist / vulnerable / immune to a named damage kind or
/// condition. Flags, never numbers; `when` is honoured against the character scope.
pub fn damage_flags(ctx: &Context, dmg_type: &str) -> Eval<(bool, bool, bool)> {
    let (mut resist, mut vuln, mut immune) = (false, false, false);
    for e in ctx.at(&format!("tag:{}", normalize_tag(dmg_type))) {
        let op = e.eff.get("op").as_str().unwrap_or("");
        if !is_damage_flag(op) {
            continue;
        }
        let when = e.eff.get("when");
        if !when.is_undefined() && !matches!(eval(when, &ctx.scope)?, Some(FormulaValue::Bool { v: true })) {
            continue;
        }
        match op {
            "resist" => resist = true,
            "vuln" => vuln = true,
            _ => immune = true,
        }
    }
    Ok((resist, vuln, immune))
}

/// graph.ts:1354. The active effects an immunity is currently suppressing, by id.
pub fn suppressed_effects(ctx: &Context, character: &Val) -> Eval<Vec<Val>> {
    let mut out: Vec<Val> = Vec::new();
    for e in sheet::active_effects(character) {
        let (_, _, immune) = damage_flags(ctx, &s(e.get("name")))?;
        if immune && !out.iter().any(|id| id.strict_eq(e.get("id"))) {
            out.push(e.get("id").clone());
        }
    }
    Ok(out)
}

fn is_folded(rider: &Val) -> bool {
    rider.get("op").as_str() == Some("add") && rider.get("when").as_str() != Some("manual")
}

/// graph.ts:1376. What this roll's contributions come to; dice stay UNROLLED.
pub fn total(res: &Val) -> Val {
    let on: Vec<&Val> = res.get("riders").items().iter().filter(|r| is_folded(r)).collect();
    let flat = on.iter().fold(0.0, |n, r| n + r.get("flat").num());
    let dice: Vec<Val> = on.iter().flat_map(|r| r.get("dice").items().iter().cloned()).collect();
    obj([("flat", Val::Num(flat)), ("dice", Val::arr(dice))])
}

fn die_val(d: &dice::RolledDie) -> Val {
    obj([("v", Val::Num(d.v)), ("sides", Val::Num(d.sides))])
}

/// Contributions in a damage type the roll itself is not, gathered per type.
#[derive(Default)]
struct OtherType {
    exprs: Vec<Val>,
    dice: Vec<Val>,
    flat: f64,
    sources: Vec<Val>,
}

/// graph.ts:1395. `total()`, rolled: every contribution's dice thrown ONCE, with
/// the faces kept on the rider that owns them. The only function here that
/// touches randomness.
pub fn roll_resolution(res: &Val, double: bool, own_type: &Val, random: Random) -> Eval<Val> {
    let lower = |v: &Val| v.as_str().map(|t| js::to_lower_case(js::trim(t)));
    let own = lower(own_type);
    let mut flat = 0.0;
    let mut by_source: Vec<(Val, f64)> = Vec::new();
    let mut by_type: IndexMap<String, OtherType> = IndexMap::new();
    let mut riders = Vec::new();
    for r in res.get("riders").items() {
        if !is_folded(r) {
            riders.push(r.clone());
            continue;
        }
        let mut value = r.get("flat").num();
        let mut rolled: Vec<Val> = Vec::new();
        let mut out = r.clone();
        let terms: Vec<String> = r.get("dice").items().iter().map(s).collect();
        if !terms.is_empty() {
            let thrown = dice::rolled_dice_terms(&terms, double, random)?;
            value += thrown.iter().fold(0.0, |n, d| n + d.v);
            rolled = thrown.iter().map(die_val).collect();
            let mut copy = r.spread();
            copy.insert("rolledDice".to_owned(), Val::arr(rolled.clone()));
            out = Val::obj(copy);
        }
        riders.push(out);
        // A total is per damage type or it is nothing.
        let kind = lower(r.get("dmgType")).filter(|t| !t.is_empty());
        if let (Some(own), Some(kind)) = (&own, kind) {
            if &kind != own {
                let e = by_type.entry(kind).or_default();
                e.exprs.extend(r.get("dice").items().iter().cloned());
                e.dice.extend(rolled);
                e.flat += r.get("flat").num();
                if !e.sources.iter().any(|src| src.strict_eq(r.get("source"))) {
                    e.sources.push(r.get("source").clone());
                }
                continue;
            }
        }
        flat += value;
        if value != 0.0 && !value.is_nan() {
            match by_source.iter_mut().find(|(label, _)| label.strict_eq(r.get("source"))) {
                Some((_, sum)) => *sum += value,
                None => by_source.push((r.get("source").clone(), value)),
            }
        }
    }
    let terms = by_source
        .into_iter()
        .map(|(label, value)| obj([("label", label), ("value", Val::Num(value))]));
    let extra = by_type.into_iter().map(
        |(
            kind,
            OtherType {
                exprs,
                dice,
                flat,
                sources,
            },
        )| {
            let expr: Vec<String> = exprs.iter().map(s).collect();
            obj([
                ("type", Val::str(&kind)),
                ("expr", Val::str(&expr.join(" + "))),
                ("dice", Val::arr(dice)),
                ("flat", Val::Num(flat)),
                ("sources", Val::arr(sources)),
            ])
        },
    );
    Ok(obj([
        ("flat", Val::Num(flat)),
        ("riders", Val::arr(riders)),
        ("terms", Val::arr(terms.collect())),
        ("extra", Val::arr(extra.collect())),
    ]))
}

/// graph.ts:1475. How many catalogued things a selector currently matches;
/// a `roll:` selector matches a roll, not a node, so it is always live.
pub fn match_count(selector: &str, nodes: &[Val]) -> f64 {
    if selector.starts_with("roll:") {
        return f64::INFINITY;
    }
    let count = match selector.strip_prefix("tag:") {
        Some(tag) => {
            let tag = normalize_tag(tag);
            nodes
                .iter()
                .filter(|n| n.get("tags").items().iter().any(|t| normalize_tag(&s(t)) == tag))
                .count()
        }
        None => nodes.iter().filter(|n| n.get("gid").as_str() == Some(selector)).count(),
    };
    count as f64
}
