//! JavaScript semantics the TypeScript engine relies on without saying so.
//! Each helper exists because the obvious Rust call gives a different answer.

/// What `\s`, `String.prototype.trim` and friends treat as whitespace.
/// Rust's `char::is_whitespace` differs twice: it accepts U+0085 (JS does not)
/// and refuses U+FEFF (JS accepts it).
pub fn is_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// `s.trim()`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_whitespace)
}

/// `s.toLowerCase()`. Both sides implement Unicode default lowercasing with the
/// final-sigma rule; the harness checks every code point against Node.
pub fn to_lower_case(s: &str) -> String {
    s.to_lowercase()
}

/// `String(n)` — `1e+21`, `0.30000000000000004`, and `-0` prints as `0`.
pub fn number_to_string(n: f64) -> String {
    ryu_js::Buffer::new().format(n).to_owned()
}

/// `Math.min(a, b)`: NaN if either is NaN, and -0 below +0. `f64::min` ignores NaN.
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_negative() {
            a
        } else {
            b
        }
    } else if a < b {
        a
    } else {
        b
    }
}

/// `Math.max(a, b)`: NaN if either is NaN, and +0 above -0.
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_negative() {
            b
        } else {
            a
        }
    } else if a > b {
        a
    } else {
        b
    }
}

/// The leading run of `s` that satisfies `pred`, and what follows it — the
/// hand-written stand-in for a regex's `\d+` or `\s*`.
pub fn take_while(s: &str, pred: impl Fn(char) -> bool) -> (&str, &str) {
    let end = s.find(|c: char| !pred(c)).unwrap_or(s.len());
    s.split_at(end)
}

/// `parseInt(s, 10)`: leading whitespace, an optional sign, then digits; NaN if
/// there are none. Whatever follows the digits is ignored, and `"-0"` is -0.
pub fn parse_int(s: &str) -> f64 {
    let s = s.trim_start_matches(is_whitespace);
    let (sign, s) = match s.strip_prefix('-') {
        Some(rest) => (-1.0, rest),
        None => (1.0, s.strip_prefix('+').unwrap_or(s)),
    };
    let (digits, _) = take_while(s, |c| c.is_ascii_digit());
    digits.parse::<f64>().map_or(f64::NAN, |n| sign * n)
}

/// `Math.round(n)`: halves go UP (-2.5 is -2), where `f64::round` sends them
/// away from zero. A result of zero keeps the sign of what was rounded.
pub fn round(n: f64) -> f64 {
    if !n.is_finite() {
        return n;
    }
    let floor = n.floor();
    let rounded = if n - floor >= 0.5 { floor + 1.0 } else { floor };
    if rounded == 0.0 && n.is_sign_negative() {
        -0.0
    } else {
        rounded
    }
}

/// `Number(s)` for a string: surrounding whitespace is ignored, `""` is 0, and
/// the whole remainder must be one numeric literal — decimal, `Infinity`, or an
/// unsigned `0x`/`0o`/`0b` integer. Anything else is NaN. Rust's own parser is
/// too generous (`inf`, `nan`, `infinity` in any case), so the shape is checked first.
pub fn string_to_number(s: &str) -> f64 {
    let s = trim(s);
    if s.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = s.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return digits.chars().fold(0.0, |n, c| {
                n * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0))
            });
        }
    }
    let unsigned = s.strip_prefix(['+', '-']).unwrap_or(s);
    if unsigned == "Infinity" {
        return if s.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let digit = |c: char| c.is_ascii_digit();
    let (whole, rest) = take_while(unsigned, digit);
    let (frac, rest) = match rest.strip_prefix('.') {
        Some(after) => take_while(after, digit),
        None => ("", rest),
    };
    if whole.is_empty() && frac.is_empty() {
        return f64::NAN;
    }
    let exponent_ok = match rest.strip_prefix(['e', 'E']) {
        Some(exp) => {
            let exp = exp.strip_prefix(['+', '-']).unwrap_or(exp);
            !exp.is_empty() && exp.chars().all(digit)
        }
        None => rest.is_empty(),
    };
    if !exponent_ok {
        return f64::NAN;
    }
    s.parse::<f64>().unwrap_or(f64::NAN)
}

/// `Number.isInteger(n)`.
pub fn is_integer(n: f64) -> bool {
    n.is_finite() && n.trunc() == n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitespace_is_the_js_set_not_the_rust_one() {
        assert!(is_whitespace('\u{FEFF}') && !'\u{FEFF}'.is_whitespace());
        assert!(!is_whitespace('\u{0085}') && '\u{0085}'.is_whitespace());
        assert_eq!(trim("\u{FEFF}\u{00A0} a b \t\n"), "a b");
    }

    #[test]
    fn numbers_print_the_way_string_n_does() {
        assert_eq!(number_to_string(-0.0), "0");
        assert_eq!(number_to_string(1e21), "1e+21");
        assert_eq!(number_to_string(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(number_to_string(f64::NAN), "NaN");
        assert_eq!(number_to_string(f64::NEG_INFINITY), "-Infinity");
    }

    #[test]
    fn min_and_max_propagate_nan_and_order_the_zeros() {
        assert!(min(1.0, f64::NAN).is_nan() && max(f64::NAN, 1.0).is_nan());
        assert!(max(0.0, -0.0).is_sign_positive() && max(-0.0, 0.0).is_sign_positive());
        assert!(min(0.0, -0.0).is_sign_negative() && min(-0.0, 0.0).is_sign_negative());
    }
}
