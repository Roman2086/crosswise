/*
 * Crosswise generator + equation tests.
 * Run with: node tests/generator.test.js
 */
"use strict";

const assert = require("node:assert/strict");
const Equations = require("../src/equations.js");
const Generator = require("../src/generator.js");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok  " + name);
  } catch (error) {
    console.error("  FAIL " + name);
    throw error;
  }
}

function key(r, c) {
  return r + "," + c;
}

function cellMap(puzzle) {
  const map = new Map();
  for (const cell of puzzle.cells) {
    assert.ok(!map.has(key(cell.r, cell.c)), "duplicate cell at " + cell.r + "," + cell.c);
    map.set(key(cell.r, cell.c), cell);
  }
  return map;
}

function checkPuzzleSoundness(puzzle, label) {
  const map = cellMap(puzzle);
  assert.equal(puzzle.size, Generator.LEVELS[puzzle.level].size, label + ": size");
  assert.ok(puzzle.equations.length >= Generator.LEVELS[puzzle.level].minEquations, label + ": equation count");

  const equationIds = new Set(puzzle.equations.map((equation) => equation.id));
  assert.equal(equationIds.size, puzzle.equations.length, label + ": unique equation ids");

  const tileValues = puzzle.tiles.map((tile) => String(tile.value)).sort((a, b) => Number(a) - Number(b));
  const blankValues = [];
  const hRuns = new Map();
  const vRuns = new Map();

  for (const cell of puzzle.cells) {
    assert.ok(equationIds.has(cell.hEq[0]) || equationIds.has(cell.vEq[0]), label + ": cell belongs to an equation");
    assert.ok(cell.hEq.length <= 1, label + ": one across equation per cell");
    assert.ok(cell.vEq.length <= 1, label + ": one down equation per cell");

    if (cell.kind === "number") {
      assert.ok(Equations.isNumberToken(cell.value), label + ": number cell is 0-99");
      assert.ok(Number(cell.value) <= 99, label + ": cell value <= 99");
      if (cell.editable) {
        assert.equal(cell.given, false, label + ": editable cells are not givens");
        blankValues.push(String(cell.value));
      } else {
        assert.equal(cell.given, true, label + ": non-editable number is given");
      }
    } else {
      assert.equal(cell.editable, false, label + ": operators never editable");
      assert.equal(cell.given, true, label + ": operators are fixed");
      assert.ok(cell.value === "=" || Equations.isOperator(cell.value), label + ": operator cell");
    }
  }

  blankValues.sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(blankValues, tileValues, label + ": tile bank matches hidden numbers");

  for (const equation of puzzle.equations) {
    assert.ok(equation.tokens.length === 5 || equation.tokens.length === 7, label + ": equation has 5 or 7 cells");
    const tokens = equation.cells.map((coord) => {
      const cell = map.get(key(coord.r, coord.c));
      assert.ok(cell, label + ": equation cell exists");
      return cell.value;
    });
    const status = Equations.checkEquation(tokens);
    assert.equal(status.status, "valid", label + ": " + tokens.join(" ") + " is valid");
    assert.equal(tokens.join(" "), equation.solutionText, label + ": stored solution text");
    assert.equal(
      Equations.hasFractionalDivision(tokens.slice(0, tokens.indexOf("=")).join(" ")),
      false,
      label + ": divisions stay whole"
    );

    const numbers = equation.cells.filter((coord) => map.get(key(coord.r, coord.c)).kind === "number");
    const blanks = numbers.filter((coord) => map.get(key(coord.r, coord.c)).editable);
    const givens = numbers.filter((coord) => !map.get(key(coord.r, coord.c)).editable);
    assert.ok(blanks.length >= 1, label + ": equation has a blank");
    assert.ok(givens.length >= 1, label + ": equation has an anchor number");

    const first = equation.cells[0];
    const last = equation.cells[equation.cells.length - 1];
    const runKey = equation.direction === "h" ? "r" + first.r : "c" + first.c;
    const target = equation.direction === "h" ? hRuns : vRuns;
    if (!target.has(runKey)) target.set(runKey, []);
    target.get(runKey).push(equation.cells.map((coord) => (equation.direction === "h" ? coord.c : coord.r)));

    if (equation.direction === "h") {
      assert.equal(first.r, last.r, label + ": across equation shares a row");
    } else {
      assert.equal(first.c, last.c, label + ": down equation shares a column");
    }
  }

  // Every maximal row/column run must be exactly one equation. A singleton may
  // belong only to the perpendicular equation.
  for (let r = 0; r < puzzle.size; r += 1) {
    let c = 0;
    while (c < puzzle.size) {
      if (!map.has(key(r, c))) {
        c += 1;
        continue;
      }
      const start = c;
      while (c < puzzle.size && map.has(key(r, c))) c += 1;
      const coords = [];
      for (let x = start; x < c; x += 1) coords.push(x);
      const matches = (hRuns.get("r" + r) || []).filter((run) => run.length === coords.length && run[0] === start);
      if (coords.length === 1 && matches.length === 0) {
        const cell = map.get(key(r, start));
        assert.ok(cell.vEq.length > 0, label + ": single row cell belongs to a down equation");
      } else {
        assert.equal(matches.length, 1, label + ": row run at " + r + "," + start + " maps to one equation");
      }
    }
  }

  for (let c = 0; c < puzzle.size; c += 1) {
    let r = 0;
    while (r < puzzle.size) {
      if (!map.has(key(r, c))) {
        r += 1;
        continue;
      }
      const start = r;
      while (r < puzzle.size && map.has(key(r, c))) r += 1;
      const coords = [];
      for (let y = start; y < r; y += 1) coords.push(y);
      const matches = (vRuns.get("c" + c) || []).filter((run) => run.length === coords.length && run[0] === start);
      if (coords.length === 1 && matches.length === 0) {
        const cell = map.get(key(start, c));
        assert.ok(cell.hEq.length > 0, label + ": single column cell belongs to an across equation");
      } else {
        assert.equal(matches.length, 1, label + ": column run at " + start + "," + c + " maps to one equation");
      }
    }
  }

  const totalEquations = puzzle.equations.length;
  const mapped = [...hRuns.values(), ...vRuns.values()].reduce((sum, runs) => sum + runs.length, 0);
  assert.equal(mapped, totalEquations, label + ": all equations mapped");
}

console.log("\nEquation evaluator");
test("respects standard order of operations", () => {
  assert.equal(Equations.evaluate("2+3*4").value.n, 14);
  assert.equal(Equations.evaluate("2*3+4").value.n, 10);
  assert.equal(Equations.evaluate("8/2/2").value.n, 2);
  assert.equal(Equations.evaluate("4/6*18").value.n, 12);
});

test("supports the display operators", () => {
  assert.equal(Equations.evaluate("12\u00f73\u00d74").value.n, 16);
  assert.equal(Equations.evaluate("9\u22124+1").value.n, 6);
  assert.equal(Equations.checkEquation(["12", "\u00f7", "3", "=", "4"]).status, "valid");
});

test("checks multi-digit whole-number cells", () => {
  assert.equal(Equations.checkEquation(["40", "+", "32", "=", "72"]).status, "valid");
  assert.equal(Equations.checkEquation(["99", "\u2212", "9", "=", "90"]).status, "valid");
  assert.equal(Equations.checkEquation(["7", "\u00d7", "9", "+", "36", "=", "99"]).status, "valid");
  assert.equal(Equations.checkEquation(["4", "+", "4", "=", "9"]).status, "invalid");
  assert.equal(Equations.checkEquation(["5", "\u00f7", "2", "=", "2"]).status, "invalid");
  assert.equal(Equations.checkEquation(["4", "+", "4", "=", null]).status, "incomplete");
});

test("validates cell tokens and the 0-99 range", () => {
  assert.equal(Equations.isNumberToken("0"), true);
  assert.equal(Equations.isNumberToken("99"), true);
  assert.equal(Equations.isNumberToken("100"), false);
  assert.equal(Equations.isNumberToken("07"), false);
  assert.equal(Equations.isNumberToken("x"), false);
});

test("pretty-print keeps whole-number cells separated", () => {
  assert.equal(Equations.pretty(["12", "+", "7", "=", "19"]), "12 + 7 = 19");
  assert.equal(Equations.pretty([null, "+", "2", "=", null]), "\u00b7 + 2 = \u00b7");
  assert.deepEqual(Equations.toCells("12+7=19"), ["12", "+", "7", "=", "19"]);
});

test("detects fractional intermediate division", () => {
  assert.equal(Equations.hasFractionalDivision("4/6*18"), true);
  assert.equal(Equations.hasFractionalDivision("8/2/2"), false);
  assert.equal(Equations.hasFractionalDivision("4+8/2"), false);
});

console.log("\nGenerator");
for (const level of ["easy", "medium", "hard"]) {
  test(level + " generates sound 0-99 cell puzzles across 40 seeds", () => {
    for (let i = 0; i < 40; i += 1) {
      const puzzle = Generator.generatePuzzle(level, level + "-test-" + i);
      checkPuzzleSoundness(puzzle, level + "-" + i);
    }
  });
}

test("the same seed produces the same puzzle", () => {
  const a = Generator.generatePuzzle("medium", "repeatable-seed");
  const b = Generator.generatePuzzle("medium", "repeatable-seed");
  assert.deepEqual(a, b);
});

test("hard puzzles use the full 0-99 cell range", () => {
  let sawNinetyNine = false;
  for (let i = 0; i < 25; i += 1) {
    const puzzle = Generator.generatePuzzle("hard", "range-" + i);
    for (const cell of puzzle.cells) {
      if (cell.kind !== "number") continue;
      assert.ok(Number(cell.value) >= 0 && Number(cell.value) <= 99);
      if (Number(cell.value) === 99) sawNinetyNine = true;
    }
  }
  assert.equal(sawNinetyNine, true, "at least one hard puzzle reaches 99");
});

console.log("\n" + passed + " tests passed.\n");
