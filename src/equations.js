/*
 * Crosswise — equation utilities
 * Shared by the browser game and the Node test suite.
 */
(function (root) {
  "use strict";

  var DIGIT = /^[0-9]$/;
  var NUMBER_TOKEN = /^(0|[1-9][0-9]?)$/;
  var OPERATOR = /^[+\-*/\u2212\u00d7\u00f7]$/;

  function isDigit(ch) {
    return typeof ch === "string" && DIGIT.test(ch);
  }

  function isNumberToken(value) {
    if (typeof value === "number") {
      return Number.isInteger(value) && value >= 0 && value <= 99;
    }
    if (typeof value !== "string" || !NUMBER_TOKEN.test(value)) return false;
    return Number(value) <= 99;
  }

  function isOperator(ch) {
    return typeof ch === "string" && OPERATOR.test(ch);
  }

  function normalizeOperator(ch) {
    if (ch === "\u2212") return "-";
    if (ch === "\u00d7") return "*";
    if (ch === "\u00f7") return "/";
    return ch;
  }

  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      var t = a % b;
      a = b;
      b = t;
    }
    return a || 1;
  }

  function rational(n, d) {
    d = d == null ? 1 : d;
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    if (d < 0) {
      n = -n;
      d = -d;
    }
    var g = gcd(n, d);
    return { n: n / g, d: d / g };
  }

  function add(a, b) {
    if (!a || !b) return null;
    return rational(a.n * b.d + b.n * a.d, a.d * b.d);
  }

  function neg(a) {
    return a ? rational(-a.n, a.d) : null;
  }

  function mul(a, b) {
    if (!a || !b) return null;
    return rational(a.n * b.n, a.d * b.d);
  }

  function div(a, b) {
    if (!a || !b || b.n === 0) return null;
    return rational(a.n * b.d, a.d * b.n);
  }

  function tokenize(expression) {
    var tokens = [];
    var i = 0;
    var text = String(expression == null ? "" : expression);

    while (i < text.length) {
      var ch = text[i];
      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }
      if (isDigit(ch)) {
        var start = i;
        while (i < text.length && isDigit(text[i])) i += 1;
        var raw = text.slice(start, i);
        if (raw.length > 1 && raw[0] === "0") {
          return { ok: false, error: "A number cannot start with zero." };
        }
        tokens.push({ type: "number", text: raw, value: Number(raw) });
        continue;
      }
      if (isOperator(ch)) {
        tokens.push({
          type: "operator",
          text: ch,
          value: normalizeOperator(ch)
        });
        i += 1;
        continue;
      }
      return { ok: false, error: "Unexpected character \u201c" + ch + "\u201d." };
    }

    if (!tokens.length) return { ok: false, error: "The expression is empty." };
    for (var j = 0; j < tokens.length; j += 1) {
      if (j % 2 === 0 && tokens[j].type !== "number") {
        return { ok: false, error: "Expected a number." };
      }
      if (j % 2 === 1 && tokens[j].type !== "operator") {
        return { ok: false, error: "Expected an operator." };
      }
    }
    if (tokens.length % 2 === 0) {
      return { ok: false, error: "The expression ends with an operator." };
    }
    return { ok: true, tokens: tokens };
  }

  function evaluateTokens(tokens) {
    var term = rational(tokens[0].value);
    var total = rational(0);
    var pendingSign = 1;

    for (var i = 1; i < tokens.length; i += 2) {
      var op = tokens[i].value;
      var value = rational(tokens[i + 1].value);

      if (op === "*") {
        term = mul(term, value);
      } else if (op === "/") {
        term = div(term, value);
      } else {
        total = add(total, pendingSign === 1 ? term : neg(term));
        pendingSign = op === "+" ? 1 : -1;
        term = value;
      }
      if (!term || !total) {
        return { ok: false, error: "This expression cannot be calculated." };
      }
    }

    total = add(total, pendingSign === 1 ? term : neg(term));
    if (!total) return { ok: false, error: "This expression cannot be calculated." };
    return { ok: true, value: total };
  }

  function evaluate(expression) {
    var tokenized = tokenize(expression);
    if (!tokenized.ok) return tokenized;
    return evaluateTokens(tokenized.tokens);
  }

  /**
   * True when any division in the expression produces a fraction at the
   * point it is evaluated. Integer-only steps are friendlier in a puzzle.
   */
  function hasFractionalDivision(expression) {
    var tokenized = tokenize(expression);
    if (!tokenized.ok) return true;
    var tokens = tokenized.tokens;
    var term = rational(tokens[0].value);
    for (var i = 1; i < tokens.length; i += 2) {
      var op = tokens[i].value;
      var value = rational(tokens[i + 1].value);
      if (op === "*") {
        term = mul(term, value);
      } else if (op === "/") {
        term = div(term, value);
        if (!term || term.d !== 1) return true;
      } else {
        term = value;
      }
    }
    return false;
  }

  /**
   * Check a full or partial equation made of whole-number cells.
   * @param {Array<string|number|null>} cells one token per cell
   * @returns {{status: "valid"|"invalid"|"incomplete", reason?: string}}
   */
  function checkEquation(cells) {
    var list = Array.prototype.slice.call(cells || []);
    if (!list.length) {
      return { status: "invalid", reason: "The equation is empty." };
    }
    if (list.some(function (value) { return value == null || value === ""; })) {
      return { status: "incomplete" };
    }
    if (
      list.some(function (value) {
        return !isNumberToken(value) && !isOperator(value) && value !== "=";
      })
    ) {
      return { status: "invalid", reason: "The equation contains an invalid cell." };
    }

    var equalsAt = -1;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] === "=") {
        if (equalsAt !== -1) {
          return { status: "invalid", reason: "An equation needs exactly one equals sign." };
        }
        equalsAt = i;
      }
    }
    if (equalsAt === -1) {
      return { status: "invalid", reason: "An equation needs an equals sign." };
    }

    var leftCells = list.slice(0, equalsAt);
    var rightCells = list.slice(equalsAt + 1);
    if (!leftCells.length || !rightCells.length) {
      return { status: "invalid", reason: "The equation is missing a side." };
    }
    if (rightCells.length !== 1 || !isNumberToken(rightCells[0])) {
      return { status: "invalid", reason: "The answer must be one whole-number cell." };
    }

    var left = evaluate(leftCells.join(" "));
    if (!left.ok) return { status: "invalid", reason: left.error };
    if (left.value.d !== 1) {
      return { status: "invalid", reason: "This expression does not make a whole number." };
    }

    var expected = Number(rightCells[0]);
    if (left.value.n !== expected) {
      return {
        status: "invalid",
        reason: "It works out to " + left.value.n + ", not " + expected + "."
      };
    }
    return { status: "valid", value: left.value.n };
  }

  function pretty(cells, blank) {
    var placeholder = blank == null ? "\u00b7" : blank;
    return (cells || [])
      .map(function (value) {
        if (value == null || value === "") return placeholder;
        if (value === "-") return "\u2212";
        return String(value);
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Split a compact equation string into number/operator/equals tokens. */
  function toCells(text) {
    return String(text)
      .match(/[0-9]+|[+\-*/\u2212\u00d7\u00f7=]/g) || [];
  }

  var api = {
    isDigit: isDigit,
    isNumberToken: isNumberToken,
    isOperator: isOperator,
    normalizeOperator: normalizeOperator,
    evaluate: evaluate,
    hasFractionalDivision: hasFractionalDivision,
    checkEquation: checkEquation,
    pretty: pretty,
    toCells: toCells
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Crosswise = root.Crosswise || {};
  root.Crosswise.equations = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
