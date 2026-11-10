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
