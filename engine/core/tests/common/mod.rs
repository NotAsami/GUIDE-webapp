//! Shared by the oracle tests: the long-lived TypeScript engine process, and
//! the shapes both sides speak in.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use engine_core::expr::EvalError;
use engine_core::js;
use serde_json::{json, Value};

struct Oracle {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub fn ask(req: Value) -> Value {
    static ORACLE: OnceLock<Mutex<Oracle>> = OnceLock::new();
    let oracle = ORACLE.get_or_init(|| {
        let mut child = Command::new("node")
            .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/engine-oracle.mjs"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("node must be on the PATH to run the oracle");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Mutex::new(Oracle {
            _child: child,
            stdin,
            stdout,
        })
    });
    let mut o = oracle.lock().unwrap_or_else(|e| e.into_inner());
    // ASCII only on the wire: Node's readline also breaks lines at U+2028 and
    // U+2029, which the generators produce on purpose.
    let mut line = String::new();
    for c in req.to_string().chars() {
        if c.is_ascii() {
            line.push(c);
        } else {
            let mut units = [0u16; 2];
            for u in c.encode_utf16(&mut units) {
                line.push_str(&format!("\\u{u:04x}"));
            }
        }
    }
    writeln!(o.stdin, "{line}").unwrap();
    let mut line = String::new();
    o.stdout.read_line(&mut line).unwrap();
    serde_json::from_str(&line).expect("the oracle answers in JSON")
}

/// A number the way the oracle spells it: `String(n)`, except that -0 is kept.
pub fn num(n: f64) -> Value {
    Value::String(if n == 0.0 && n.is_sign_negative() {
        "-0".into()
    } else {
        js::number_to_string(n)
    })
}

/// The port's outcome in the oracle's shape: a value, `null` for a rejection, or "it threw".
pub fn outcome<T>(r: Result<T, EvalError>, show: impl Fn(&T) -> Value) -> Value {
    match r {
        Ok(v) => json!({ "ok": show(&v) }),
        Err(EvalError::Reject(_)) => json!({ "ok": null }),
        Err(EvalError::Fault(_)) => json!({ "threw": true }),
    }
}

/// 10,000 per property by default (CI); `PROPTEST_CASES=100000` for a local soak.
pub fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10_000)
}
