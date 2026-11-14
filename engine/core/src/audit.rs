//! Author-time audits — the second half of `src/lib/graph.ts` (lines 355-418
//! and 1460-2042), run when the DM saves a node. Every message here is copied
//! from the original character for character: authors read them.
//!
//! The op schema (opSchema.ts:96) is data the audit and the editor both read,
//! so it lives here as data.

use crate::expr;
use crate::graph::{self, ask_key, eval, eval_str, idents, label, s, spans, AuditItem};
use crate::js;
use crate::sheet;
use crate::value::{Map, Val};

/// One field of an op: (key, label, required, is an array).
pub type Field = (&'static str, &'static str, bool, bool);

const ONCE: Field = ("once", "Arms once", false, false);
const ONE_OF: Field = ("oneOf", "One across all targets", false, false);
const BY_LEVEL: Field = ("byLevel", "By level", false, true);

/// opSchema.ts:96, as far as the audit reads it: each op's group and fields, in order.
pub const OPS: [(&str, &str, &[Field]); 20] = [
    (
        "add",
        "passive",
        &[
            ("value", "Amount", true, false),
            ("dmgType", "Damage type", false, false),
            ONCE,
            ONE_OF,
            BY_LEVEL,
        ],
    ),
    (
        "boost",
        "sheet",
        &[
            ("stat", "Stat", true, false),
            ("value", "Amount", true, false),
            ("cap", "Up to a maximum of", false, false),
        ],
    ),
    ("useability", "sheet", &[("ability", "Ability", true, false)]),
    (
        "unarmored",
        "sheet",
        &[
            ("value", "Base", true, false),
            ("ability", "Plus (besides DEX)", false, false),
        ],
    ),
    ("adv", "passive", &[ONCE, ONE_OF]),
    ("dis", "passive", &[ONCE, ONE_OF]),
    (
        "crit",
        "passive",
        &[("threshold", "Crits on", true, false), ONCE, ONE_OF],
    ),
    ("floor", "passive", &[("minimum", "At least", true, false)]),
    (
        "reroll",
        "passive",
        &[
            ("keep", "The new roll is", true, false),
            ("faces", "Only dice showing at most", false, false),
        ],
    ),
    ("note", "passive", &[("text", "Note text", true, false), ONCE, ONE_OF]),
    (
        "rename",
        "passive",
        &[("to", "New name", true, false), ("text", "What changed", false, false)],
    ),
    ("resist", "passive", &[]),
    ("vuln", "passive", &[]),
    ("immune", "passive", &[]),
    (
        "setVar",
        "activation",
        &[("variable", "Variable", true, false), ("value", "Value", true, false)],
    ),
    ("setHp", "activation", &[("value", "Hit Points become", true, false)]),
    ("addUses", "activation", &[("value", "Change by", true, false)]),
    (
        "addSlot",
        "activation",
        &[
            ("value", "Change by", true, false),
            ("level", "Slot level", false, false),
            ("budget", "Or a budget of levels", false, false),
            ("maxLevel", "\u{2026}and no slot above level", false, false),
        ],
    ),
    ("grant", "activation", &[("value", "Amount", true, false), BY_LEVEL]),
    (
        "addVar",
        "activation",
        &[
            ("variable", "Variable", true, false),
            ("value", "Change by", true, false),
        ],
    ),
];

/// opSchema.ts:360.
fn op_title(op: &str) -> &'static str {
    match op {
        "add" => "Add",
        "adv" => "Adv",
        "dis" => "Dis",
        "crit" => "Crit",
        "floor" => "Floor",
        "reroll" => "Reroll",
        "note" => "Note",
        "rename" => "Rename",
        "boost" => "Boost",
        "useability" => "Use Ability",
        "unarmored" => "Unarmored AC",
        "resist" => "Resist",
        "vuln" => "Vuln",
        "immune" => "Immune",
        "setVar" => "Set Var",
        "addVar" => "Add Var",
        "addUses" => "Add Uses",
        "addSlot" => "Add Slot",
        "setHp" => "Set HP",
        "grant" => "Grant",
        _ => "undefined",
    }
}

const SELECTOR_KINDS: [&str; 5] = ["feature", "spell", "item", "weapon", "shardnode"];
/// What an author may TARGET, one wider than what a roll may be (graph.ts:1471).
const TARGETABLE_ROLL_KINDS: [&str; 6] = ["attack", "damage", "save", "check", "feature", "d20"];

/// `/^[a-z][a-zA-Z0-9]*$/` (graph.ts:46).
fn is_var_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase()) && chars.all(|c| c.is_ascii_alphanumeric())
}

fn trimmed(v: &Val) -> Option<String> {
    v.as_str().map(|t| js::trim(t).to_owned())
}

/// `v?.trim()` is truthy.
fn filled(v: &Val) -> bool {
    trimmed(v).is_some_and(|t| !t.is_empty())
}

/// `/^roll:(a|b|c)(\.|$)/`.
fn rolls(target: &str, kinds: &[&str]) -> bool {
    target.strip_prefix("roll:").is_some_and(|rest| {
        kinds.iter().any(|k| {
            rest.strip_prefix(k)
                .is_some_and(|after| after.is_empty() || after.starts_with('.'))
        })
    })
}

/// graph.ts:358. Author-time checks on declarations alone — no character needed.
pub fn audit_vars(defs: &[Val], catalog_types: &Val) -> expr::Eval<Vec<AuditItem>> {
    let mut out = Vec::new();
    let name_of = |d: &Val| s(d.get("name"));
    let declared: Vec<String> = defs.iter().map(name_of).collect();
    let is_derived = |d: &&Val| d.get("kind").as_str() == Some("derived");
    // Which of them read a feature's use counter.
    let uses_vars: Vec<String> = defs
        .iter()
        .filter(is_derived)
        .filter(|d| d.get("uses").truthy())
        .map(name_of)
        .collect();

    for d in defs {
        let id = d.get("name");
        let name = name_of(d);
        let lbl = label(d);
        let formula = d.get("formula");
        let uses = d.get("uses");
        if !is_var_name(&name) {
            out.push(AuditItem::err(
                id,
                "Bad variable name",
                format!("\"{name}\" must start with a lowercase letter and contain only letters and digits."),
            ));
        }
        if d.get("kind").as_str() == Some("stored") {
            let ty = d.get("type");
            let initial = d.get("initial");
            let expected = if ty.as_str() == Some("bool") {
                "boolean"
            } else {
                "number"
            };
            if !ty.truthy() {
                out.push(AuditItem::err(id, "Missing type", format!("{lbl} is stored, so it must declare num or bool \u{2014} it is what a character without this variable reads.")));
            } else if !initial.is_undefined() && initial.type_of() != expected {
                out.push(AuditItem::err(
                    id,
                    "Initial disagrees with type",
                    format!("{lbl} is {} but its initial value is {}.", s(ty), initial.type_of()),
                ));
            }
            if formula.truthy() {
                out.push(AuditItem::err(
                    id,
                    "Stored variable has a formula",
                    format!(
                        "{lbl} is stored \u{2014} it is written, never computed. Make it derived or drop the formula."
                    ),
                ));
            }
        } else if uses.truthy() {
            // A use counter is READ, not computed: the two are alternatives.
            if filled(formula) {
                out.push(AuditItem::err(id, "Both a formula and a use counter", format!("{lbl} reads a feature's uses AND has a formula. It can only have one source \u{2014} drop whichever is not meant.")));
            }
            if !s(uses).starts_with("feature:") {
                out.push(AuditItem::err(
                    id,
                    "Not a feature",
                    format!(
                        "{lbl} reads uses from \"{}\". Only a feature has a use counter.",
                        s(uses)
                    ),
                ));
            }
        } else {
            if !formula.truthy() {
                out.push(AuditItem::err(
                    id,
                    "Missing formula",
                    format!("{lbl} is derived, so it needs a formula or a feature to read uses from."),
                ));
            }
            for ident in idents(formula) {
                // A derived variable cannot read a use counter, and this is the only place that can say so.
                if uses_vars.contains(&ident) {
                    out.push(AuditItem::err(id, "A derived variable cannot read a use counter", format!("{lbl} reads \"{ident}\", which is a feature's use count. Those are resolved after every derived variable \u{2014} a formula would read zero. Put the condition on the effect's when instead, where it works.")));
                    continue;
                }
                if declared.contains(&ident) || expr::VAR_IDENTS.contains(&ident.as_str()) || catalog_types.has(&ident)
                {
                    continue;
                }
                out.push(AuditItem::err(id, "Unknown identifier", format!("{lbl} reads \"{ident}\", which no variable in the catalog declares and the character state whitelist does not contain.")));
            }
        }
    }

    // Cycles are catchable here, from the declarations alone.
    let (_, walked) = graph::probe_scope(defs, catalog_types)?;
    out.extend(walked);
    Ok(out)
}

/// graph.ts:1492. Author-time checks on one node's contributions, against the
/// rest of the catalog. `node` is `{ graph?, vars?, prose?, uses?, shortRecharge? }`
/// and `nodes` is every authored thing as `{ gid, tags? }`.
pub fn audit_node(node: &Val, nodes: &[Val], catalog_types: &Val) -> expr::Eval<Vec<AuditItem>> {
    let vars = node.get("vars").items();
    let effects = node.get("graph").items();
    let mut out = audit_vars(vars, catalog_types)?;
    let known: Vec<&Val> = nodes.iter().map(|n| n.get("gid")).collect();
    let declared: Vec<String> = vars.iter().map(|v| s(v.get("name"))).collect();
    // Type-correct, non-zero. auditVars already reported the declarations themselves.
    let (scope, _) = graph::probe_scope(vars, catalog_types)?;

    // Formulas and conditions are checked against the variable whitelist plus roll
    // context, plus every name declared elsewhere in the catalog.
    let allowed = |id: &str| {
        expr::VAR_IDENTS.contains(&id)
            || expr::ROLL_IDENTS.contains(&id)
            || declared.iter().any(|d| d == id)
            || catalog_types.has(id)
    };

    for eff in effects {
        let id = eff.get("id");
        let op = eff.get("op").as_str().unwrap_or("");
        let targets: Vec<String> = eff.get("target").items().iter().map(s).collect();
        // `eff.label || eff.id`
        let who = if eff.get("label").truthy() {
            s(eff.get("label"))
        } else {
            s(id)
        };
        let empty = Val::str("");
        let mut err = |t: &str, text: String| out.push(AuditItem::err(id, t, text));

        if !eff.get("label").truthy() {
            err(
                "Missing label",
                "Every contribution needs a label \u{2014} an unlabelled number in a breakdown cannot be checked."
                    .to_owned(),
            );
        }
        // Required-ness comes from the op schema. Array fields are exempt: an
        // empty level table means "no progression".
        let fields = OPS
            .iter()
            .find(|(name, _, _)| *name == op)
            .map_or(&[][..], |(_, _, fields)| fields);
        for (key, field_label, required, is_array) in fields {
            let v = eff.get(key);
            if *required && !*is_array && (v.is_nullish() || js::trim(&s(v)).is_empty()) {
                err(
                    &format!("Missing {}", js::to_lower_case(field_label)),
                    format!("{who} is {op}, whose schema requires {field_label}."),
                );
            }
        }
        let is_activation = graph::is_activation(op);
        let is_sheet = graph::is_sheet(op);
        if op != "add" && !is_activation && !is_sheet && eff.get("value").truthy() {
            err(
                "Value on a flag",
                format!("{who} is {op}, which is a flag, never a number. Advantage is not a bonus."),
            );
        }
        // A floor needs a total to raise, and only a d20 roll has one.
        if op == "floor" {
            let bad = targets.iter().find(|t| !rolls(t, &["check", "save", "d20"]));
            if targets.is_empty() || bad.is_some() {
                let aim = match bad {
                    Some(t) if !targets.is_empty() => format!("aims at \"{t}\""),
                    _ => "has no target".to_owned(),
                };
                err("A floor needs a check or a save", format!("{who} {aim}. Only a d20 roll has a total to raise \u{2014} target roll:check, roll:save or roll:d20."));
            }
        }
        // A flag cannot be decided after the dice land.
        if filled(eff.get("ask")) && matches!(op, "adv" | "dis" | "crit" | "floor") {
            err(
                &format!("{} cannot be asked", op_title(op)),
                format!("{who} asks \"{}\", but {op} changes how the roll itself resolves and an ask is answered after it already has. Use a player toggle instead: press \"player toggle\" on the when row, and the player holds it before rolling.", trimmed(eff.get("ask")).unwrap_or_default()),
            );
        }
        if eff.get("when").truthy() && eff.get("ask").truthy() {
            out.push(AuditItem::warn(id, "Vanishes when the condition is false", format!("{who} has both a condition and a toggle. While \"{}\" is false it does not surface at all \u{2014} the player is not offered a choice they could not take.", s(eff.get("when")))));
        }
        let mut err = |t: &str, text: String| out.push(AuditItem::err(id, t, text));
        let body = if eff.get("text").truthy() {
            eff.get("text")
        } else {
            eff.get("label")
        };
        if op == "note" && eff.get("ask").truthy() && !eff.get("once").truthy() && spans(body).is_empty() {
            err("Toggle on a note", format!("{who} is prose with nothing to reveal \u{2014} there is nothing for the player to resolve. Use `when` if it should be conditional, or interpolate a value into the text if the toggle is what decides whether they see it."));
        }
        // An `and` list can be unsatisfiable, and silently: a roll has ONE kind and ONE subject.
        if eff.get("match").as_str() == Some("and") {
            let distinct = |items: Vec<String>| {
                let mut seen: Vec<String> = Vec::new();
                for item in items {
                    if !seen.contains(&item) {
                        seen.push(item);
                    }
                }
                seen
            };
            let roll_parts = || targets.iter().filter_map(|t| t.strip_prefix("roll:"));
            let kinds = distinct(
                roll_parts()
                    .map(|r| r.split('.').next().unwrap_or("").to_owned())
                    .collect(),
            );
            let things = distinct(
                targets
                    .iter()
                    .filter(|t| !t.starts_with("roll:") && !t.starts_with("tag:"))
                    .cloned()
                    .collect(),
            );
            let subs = distinct(roll_parts().filter(|r| r.contains('.')).map(str::to_owned).collect());
            let clash = if kinds.len() > 1 {
                Some(format!("roll kinds ({})", kinds.join(", ")))
            } else if things.len() > 1 {
                Some(format!("things ({})", things.join(", ")))
            } else if subs.len() > 1 {
                Some(format!("sub-kinds ({})", subs.join(", ")))
            } else {
                None
            };
            if let Some(clash) = clash {
                err("This AND can never match", format!("{who} requires ALL of its targets at once, but a roll has one kind and one subject \u{2014} {clash} cannot both hold. Use OR, or split it into two nodes."));
            }
            if targets.len() < 2 {
                let have = if targets.len() == 1 { "only one" } else { "none" };
                out.push(AuditItem::warn(
                    id,
                    "AND with one target",
                    format!("{who} is set to match ALL targets but has {have} \u{2014} the toggle is doing nothing."),
                ));
            }
        }
        let mut err = |t: &str, text: String| out.push(AuditItem::err(id, t, text));

        // An armed effect's target has to be expressible as a roll kind.
        if eff.get("once").truthy() && targets.iter().any(|t| !t.starts_with("roll:")) {
            err("Armed modifier needs a roll target", format!("{who} arms once, so every target must be a roll: kind \u{2014} \"roll:attack\", not a thing or a tag. Leave the target empty to arm this node's own roll."));
        }

        // A reroll re-runs dice that were already rolled.
        if op == "reroll" {
            let is_d20 = |t: &&String| rolls(t, &["check", "save", "attack", "d20"]);
            let is_dmg = |t: &&String| rolls(t, &["damage"]);
            let d20 = targets.iter().filter(is_d20).count();
            let dmg = targets.iter().filter(is_dmg).count();
            let bad = targets.iter().find(|t| !is_d20(t) && !is_dmg(t));
            if targets.is_empty() || bad.is_some() {
                let aim = match bad {
                    Some(t) if !targets.is_empty() => format!("aims at \"{t}\""),
                    _ => "has no target".to_owned(),
                };
                err("Reroll needs a roll target", format!("{who} {aim}. Only dice already rolled can be re-run \u{2014} target a d20 roll (roll:check, roll:save, roll:attack, or roll:d20) or a damage roll."));
            }
            if d20 > 0 && dmg > 0 {
                err("Reroll spans two kinds of die", format!("{who} targets a d20 roll AND a damage roll. They are different dice with different settings \u{2014} split it into two effects."));
            }
            let keep = eff.get("keep").as_str();
            if keep == Some("advantage") && dmg > 0 {
                err("Advantage on a damage roll", format!("{who} rerolls damage with \"advantage\", and damage has none. Use \"better\" to keep whichever total is higher, or \"new\" to be stuck with the reroll."));
            }
            if keep == Some("better") && dmg == 0 {
                err("A d20 has one total", format!("{who} keeps the \"better\" of two totals, which only a damage roll has. On a d20 that is advantage \u{2014} use it instead."));
            }
            if eff.get("ask").truthy() {
                err("Toggle on a reroll", format!("{who} is offered on the finished roll and the player takes it or does not \u{2014} that IS the question. Use `when` if it should only appear sometimes."));
            }
            if eff.get("once").truthy() {
                err("A reroll cannot arm", format!("{who} acts on a roll that has already happened, so there is nothing to wait for. Drop \"arms once\"."));
            }
        }

        if op == "grant" {
            if targets.is_empty() || targets.iter().any(|t| !t.starts_with("roll:")) {
                err("Grant needs a roll target", format!("{who} lands on another player's sheet, so it must name the roll it answers to there \u{2014} \"roll:d20\" for their next D20 Test. It cannot be left empty, and a thing or a tag means nothing on a sheet this one cannot see."));
            }
            if targets.len() > 1 {
                let n = targets.len();
                out.push(AuditItem::warn(id, "Grant hands out one bonus per target", format!("{who} names {n} rolls, which places {n} separate bonuses on the recipient \u{2014} they can use every one. For \"their next D20 Test\", target roll:d20 alone.")));
            }
        }
        let mut err = |t: &str, text: String| out.push(AuditItem::err(id, t, text));

        if op == "rename" {
            if targets.is_empty() {
                err(
                    "Rename needs a target",
                    format!("{who} renames nothing \u{2014} pick the spell, item or feature it renames."),
                );
            }
            if filled(eff.get("ask")) {
                err(
                    "Rename cannot ask",
                    format!(
                        "{who} has an ask, but a name is not chosen per roll. Gate it with when (e.g. level >= 7)."
                    ),
                );
            }
        }

        if is_sheet {
            let title = op_title(op);
            if !targets.is_empty() {
                err(&format!("{title} cannot target"), format!("{who} applies to the sheet of whoever carries it. It has no target, and one set here does nothing."));
            }
            if filled(eff.get("when")) {
                err(&format!("{title} cannot be conditional"), format!("{who} has a \"when\", but the sheet is computed without one. Use a roll contribution if it is conditional."));
            }
            let ability = eff.get("ability");
            if op == "useability"
                && filled(ability)
                && !sheet::ABILITY_KEYS.contains(&js::to_lower_case(&trimmed(ability).unwrap_or_default()).as_str())
            {
                err("Unknown ability", format!("{who} names \"{}\", which is not one of STR, DEX, CON, INT, WIS or CHA. Attacks would keep using the weapon's own ability.", s(ability)));
            }
            // The rest of this branch is boost's own schema.
            if op != "boost" {
                continue;
            }
            let stat = eff.get("stat");
            let stat_text = s(stat.or(&empty));
            if filled(stat) && !sheet::is_mod_stat(&stat_text) {
                err(
                    "Unknown stat",
                    format!("{who} boosts \"{stat_text}\", which is not a sheet stat."),
                );
            }
            // A number, or a formula over `level` and `prof` — and nothing wider.
            let value = eff.get("value");
            if !value.to_number().is_finite() {
                let src = s(value.or(&empty));
                let stray: Vec<String> = expr::free_idents(&src)
                    .into_iter()
                    .filter(|i| !expr::BOOST_IDENTS.contains(&i.as_str()))
                    .collect();
                let boost_scope = Map::from([("level".to_owned(), Val::Num(1.0)), ("prof".to_owned(), Val::Num(2.0))]);
                let probed = if js::trim(&src).is_empty() {
                    None
                } else {
                    eval_str(&src, &boost_scope)?
                };
                let idents_allowed = expr::BOOST_IDENTS.join(" and ");
                if !stray.is_empty() {
                    let names: Vec<String> = stray.iter().map(|x| format!("`{x}`")).collect();
                    err("Boost reads more than level", format!("{who} has \"{src}\", which reads {}. A sheet boost is computed while the sheet is being built, so it can only use {idents_allowed} \u{2014} anything else would be asking for the number it is helping to produce, and would apply as nothing.", names.join(", ")));
                } else if !matches!(&probed, Some(expr::FormulaValue::Num { dice, .. }) if dice.is_empty()) {
                    err("Boost needs a number or a level formula", format!("{who} has \"{src}\". A sheet stat has no roll to happen at, so this must be a plain number or a dice-free formula over {idents_allowed} \u{2014} `level`, say, for \"+1 again whenever you gain a level\"."));
                }
            }
            // A cap only means something on an ability score.
            let cap = eff.get("cap");
            if !cap.is_undefined() && !js::trim(&s(cap)).is_empty() {
                if !cap.to_number().is_finite() {
                    err("Cap needs a plain number", format!("{who} caps at \"{}\". Like the amount, a ceiling on the sheet has nothing to compute against.", s(cap)));
                } else if !sheet::is_ability(&stat_text) {
                    err("Cap on a stat that has no ceiling", format!("{who} boosts \"{stat_text}\", and only ability scores are clamped. A cap here would be stored and never applied."));
                }
            }
            continue;
        }

        if is_activation {
            // `addUses` writes a use counter, usually somebody else's.
            if op == "addUses" {
                for t in targets.iter().filter(|t| !t.starts_with("feature:")) {
                    err("addUses targets a feature", format!("{who} aims at \"{t}\". Only a feature has a use counter \u{2014} pick one from the catalog, or leave the target empty to move this feature's own."));
                }
                continue;
            }
            // `addSlot` moves a slot, not a variable.
            if op == "addSlot" {
                if !targets.is_empty() {
                    err("Target on a slot cost", format!("{who} moves this character's own spell slots. It has no target, and one set here does nothing."));
                }
                continue;
            }
            // `grant` names a roll on someone else's sheet; its rules are above.
            if op == "grant" {
                continue;
            }
            // `setHp` names no variable. NARROWED, not skipped: the formula check below still runs.
            if op != "setHp" {
                let variable = eff.get("variable");
                match vars.iter().find(|x| x.get("name").strict_eq(variable)) {
                    None => err(
                        "Unknown variable",
                        format!(
                            "{who} writes \"{}\", which this node does not declare.",
                            s(variable.or(&empty))
                        ),
                    ),
                    Some(v) if v.get("kind").as_str() != Some("stored") => {
                        err("Writing a derived variable", format!("{} is derived \u{2014} it is computed from its formula on every read, so writing it would be discarded.", label(v)));
                    }
                    Some(v) if v.get("scope").as_str() == Some("dm") => {
                        err("Activation writes a DM variable", format!("{} is DM-only, and the player is the one pressing this. The write would be reverted by the database.", label(v)));
                    }
                    Some(_) => {}
                }
            }
            if !targets.is_empty() {
                err(
                    "Target on an activation",
                    format!("{who} writes to this character; it has no target to reach out at."),
                );
            }
        }

        if graph::is_damage_flag(op) {
            if targets.is_empty() {
                err("Damage flag with no target", format!("{who} is {op}, whose target names the damage kind. Add a tag: selector \u{2014} with none it applies to nothing."));
            }
            if eff.get("ask").truthy() {
                err(
                    "Toggle on a damage flag",
                    format!(
                        "{who} applies when damage lands, which raises no roll for the player to answer. Use `when`."
                    ),
                );
            }
        }

        for t in &targets {
            if t.starts_with("tag:") {
                continue; // a tag matching nothing is legal
            }
            if let Some(roll) = t.strip_prefix("roll:") {
                let mut parts = roll.split('.');
                let kind = parts.next().unwrap_or("");
                let sub = parts.next();
                if !TARGETABLE_ROLL_KINDS.contains(&kind) || sub == Some("") {
                    err(
                        "Unknown roll kind",
                        format!("\"{t}\" is not a roll. Kinds are {}.", TARGETABLE_ROLL_KINDS.join(", ")),
                    );
                }
                continue;
            }
            // `t.slice(0, t.indexOf(':'))`: with no colon at all, everything but the last character.
            let kind: String = match t.find(':') {
                Some(colon) => t.get(..colon).unwrap_or("").to_owned(),
                None => {
                    let mut chars: Vec<char> = t.chars().collect();
                    chars.pop();
                    chars.into_iter().collect()
                }
            };
            if !SELECTOR_KINDS.contains(&kind.as_str()) {
                err(
                    "Unknown selector",
                    format!(
                        "\"{t}\" names no namespace. Use one of {}, tag:, or roll:.",
                        SELECTOR_KINDS.join(", ")
                    ),
                );
                continue;
            }
            if !nodes.is_empty() && !known.iter().any(|g| g.as_str() == Some(t.as_str())) {
                err("Dangling target", format!("\"{t}\" names nothing in the catalog. A target that matches nothing YET is fine; one that cannot ever match is a typo."));
            }
        }

        for (src, what) in [
            (eff.get("value"), "formula"),
            (eff.get("when"), "condition"),
            (eff.get("threshold"), "crit range"),
        ] {
            if !src.truthy() {
                continue;
            }
            let read = idents(src);
            for ident in read.iter().filter(|i| !allowed(i)) {
                err(
                    "Unknown identifier",
                    format!("{who}'s {what} reads \"{ident}\", which nothing declares."),
                );
            }
            if eval(src, &scope)?.is_none() && read.iter().all(|i| allowed(i)) {
                err(
                    &format!("Bad {what}"),
                    format!("{who}'s {what} \"{}\" does not evaluate.", s(src)),
                );
            }
        }

        // An arm is decided when you press it, so its condition cannot ask about the roll.
        if eff.get("once").truthy() && eff.get("when").truthy() {
            if let Some(first) = idents(eff.get("when"))
                .iter()
                .find(|i| expr::ROLL_IDENTS.contains(&i.as_str()))
            {
                err("An arm cannot ask about the roll", format!("{who} arms on a press, but its condition reads \"{first}\" \u{2014} a fact about a roll that has not happened yet, so it can never be true here. Untick Arms once: the condition already limits it to the rolls that qualify."));
            }
        }

        // Inline compute is a formula in a sentence, and gets the same two checks.
        if op == "note" {
            for src in spans(body) {
                let unknown: Vec<String> = expr::free_idents(&src).into_iter().filter(|i| !allowed(i)).collect();
                if let Some(first) = unknown.first() {
                    err(
                        "Unknown identifier",
                        format!("{who}'s text reads \"{first}\", which nothing declares."),
                    );
                } else if eval_str(&src, &scope)?.is_none() {
                    err(
                        "Bad note text",
                        format!("{who}'s text computes \"{{{src}}}\", which does not evaluate."),
                    );
                }
            }
        }

        // Every filled cell of a level table is a formula too. Reported once.
        let mut bad_cells = Vec::new();
        for (i, cell) in eff.get("byLevel").items().iter().enumerate().skip(1) {
            let cell = js::trim(&s(cell.or(&empty))).to_owned();
            if cell.is_empty() {
                continue;
            }
            if eval_str(&cell, &scope)?.is_none() || expr::free_idents(&cell).iter().any(|i| !allowed(i)) {
                bad_cells.push(i.to_string());
            }
        }
        if !bad_cells.is_empty() {
            err(
                "Bad level table",
                format!("{who}'s table does not evaluate at level {}.", bad_cells.join(", ")),
            );
        }
    }

    // Effects sharing an `ask` fold into ONE rider, and a rider carries one op.
    let mut by_ask: indexmap::IndexMap<String, Vec<&Val>> = indexmap::IndexMap::new();
    for eff in effects.iter().filter(|e| e.get("ask").truthy()) {
        by_ask.entry(ask_key(&s(eff.get("ask")))).or_default().push(eff);
    }
    for group in by_ask.values() {
        let mut ops: Vec<String> = Vec::new();
        for op in group.iter().map(|e| s(e.get("op"))).filter(|op| op != "note") {
            if !ops.contains(&op) {
                ops.push(op);
            }
        }
        if let (true, Some(first), Some(first_op)) = (ops.len() > 1, group.first(), ops.first()) {
            out.push(AuditItem::warn(first.get("id"), "One checkbox, two kinds of effect", format!("\"{}\" groups {} into a single toggle, and a toggle carries one. {first_op} will apply and the rest will not. Give them separate asks, or make them the same op.", s(first.get("ask")), ops.join(" and "))));
        }
    }

    // A variable nothing reads and nothing writes is state with no mechanism.
    let mut referenced: Vec<String> = Vec::new();
    for d in vars {
        referenced.extend(idents(d.get("formula")));
    }
    for eff in effects {
        if eff.get("variable").truthy() {
            referenced.push(s(eff.get("variable")));
        }
        for src in [eff.get("value"), eff.get("when"), eff.get("threshold")]
            .into_iter()
            .chain(eff.get("byLevel").items())
        {
            referenced.extend(idents(src));
        }
        if eff.get("op").as_str() == Some("note") {
            let body = if eff.get("text").truthy() {
                eff.get("text")
            } else {
                eff.get("label")
            };
            for span in spans(body) {
                referenced.extend(expr::free_idents(&span));
            }
        }
    }
    for src in node.get("prose").items() {
        for span in spans(src) {
            referenced.extend(expr::free_idents(&span));
        }
    }
    // The use count and its partial-recharge sibling are formulas too.
    for src in [node.get("uses").get("max"), node.get("shortRecharge")] {
        referenced.extend(idents(src));
    }
    for d in vars {
        if !referenced.contains(&s(d.get("name"))) {
            out.push(AuditItem::warn(d.get("name"), "Variable is never used", format!("{} is declared but no condition reads it and no activation writes it, so changing it does nothing.", label(d))));
        }
    }
    Ok(out)
}
