/*
 * Crosswise — interlocking equation puzzle generator
 * Creates a crossword-like lattice of valid equations, then hides a
 * difficulty-appropriate selection of whole numbers in a shared number bank.
 */
(function (root) {
  "use strict";

  var Equations =
    typeof require === "function" && typeof module !== "undefined"
      ? require("./equations.js")
      : root.Crosswise.equations;

  var isNumberToken = Equations.isNumberToken;

  var LEVELS = {
    easy: {
      id: "easy",
      label: "Easy",
      size: 7,
      targetEquations: 7,
      minEquations: 6,
      operandCounts: [2],
      operators: ["+", "\u2212"],
      maxOperandByCount: { 2: 20 },
      maxResult: 20,
      minCells: 5,
      maxCells: 5,
      blankRatio: 0.5,
      hints: 3,
      description: "7 \u00d7 7 \u00b7 sums & differences",
      detail: "Two numbers, one operation, cells up to 20."
    },
    medium: {
      id: "medium",
      label: "Medium",
      size: 9,
      targetEquations: 10,
      minEquations: 8,
      operandCounts: [2, 3],
      operators: ["+", "\u2212", "\u00d7"],
      maxOperandByCount: { 2: 40, 3: 12 },
      maxResult: 80,
      minCells: 5,
      maxCells: 7,
      blankRatio: 0.55,
      hints: 3,
      description: "9 \u00d7 9 \u00b7 multiplication chains",
      detail: "Longer chains and multiplication. Cells can reach 80."
    },
    hard: {
      id: "hard",
      label: "Hard",
      size: 11,
      targetEquations: 12,
      minEquations: 10,
      operandCounts: [2, 3],
      operators: ["+", "\u2212", "\u00d7", "\u00f7"],
      maxOperandByCount: { 2: 99, 3: 14 },
      maxResult: 99,
      minCells: 5,
      maxCells: 7,
      blankRatio: 0.6,
      hints: 2,
      description: "11 \u00d7 11 \u00b7 all four operations, up to 99",
      detail: "Dense crossings, division, and cells from 0 to 99."
    }
  };

  /* ------------------------------------------------------------------ */
  /* Seeded random                                                       */
  /* ------------------------------------------------------------------ */

  function hashSeed(seed) {
    var text = String(seed == null ? Math.random() : seed);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    return mulberry32(hashSeed(seed));
  }

  function randInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  function shuffle(rng, list) {
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /* ------------------------------------------------------------------ */
  /* Equation pools                                                      */
  /* ------------------------------------------------------------------ */

  var poolCache = Object.create(null);

  function numberRange(max) {
    var result = [];
    for (var n = 1; n <= max; n += 1) result.push(n);
    return result;
  }

  function combinationsOfOperators(operators, count) {
    if (count === 1) return operators.map(function (op) { return [op]; });
    var combos = [];
    operators.forEach(function (a) {
      operators.forEach(function (b) {
        combos.push([a, b]);
      });
    });
    return combos;
  }

  function isTrivialProduct(op, value) {
    return (op === "\u00d7" || op === "\u00f7") && value === 1;
  }

  function makeCandidate(numbers, operators, config) {
    var parts = [];
    for (var i = 0; i < numbers.length; i += 1) {
      if (i > 0) {
        if (isTrivialProduct(operators[i - 1], numbers[i])) return null;
        if (isTrivialProduct(operators[i - 1], numbers[i - 1])) return null;
        parts.push(operators[i - 1]);
      }
      parts.push(String(numbers[i]));
    }

    var expression = parts.join(" ");
    var evaluated = Equations.evaluate(expression);
    if (!evaluated.ok || evaluated.value.d !== 1) return null;
    if (Equations.hasFractionalDivision(expression)) return null;
    var result = evaluated.value.n;
    if (result < 0 || result > config.maxResult) return null;

    var tokens = [];
    for (var j = 0; j < numbers.length; j += 1) {
      if (j > 0) tokens.push(operators[j - 1]);
      tokens.push(String(numbers[j]));
    }
    tokens.push("=");
    tokens.push(String(result));

    if (tokens.length < config.minCells || tokens.length > config.maxCells) {
      return null;
    }

    var positionsByValue = Object.create(null);
    tokens.forEach(function (token, index) {
      if (isNumberToken(token)) {
        if (!positionsByValue[token]) positionsByValue[token] = [];
        positionsByValue[token].push(index);
      }
    });

    return {
      tokens: tokens,
      text: tokens.join(" "),
      length: tokens.length,
      result: result,
      operandCount: numbers.length,
      positionsByValue: positionsByValue
    };
  }

  function buildPool(levelId) {
    var config = LEVELS[levelId];
    var seen = Object.create(null);
    var pool = [];

    config.operandCounts.forEach(function (count) {
      var values = numberRange(config.maxOperandByCount[count]);
      var opCombos = combinationsOfOperators(config.operators, count - 1);
      var numberCombo = [];

      function walk(depth) {
        if (depth === count) {
          opCombos.forEach(function (ops) {
            var candidate = makeCandidate(numberCombo, ops, config);
            if (candidate && !seen[candidate.text]) {
              seen[candidate.text] = true;
              pool.push(candidate);
            }
          });
          return;
        }
        for (var i = 0; i < values.length; i += 1) {
          numberCombo.push(values[i]);
          walk(depth + 1);
          numberCombo.pop();
        }
      }

      walk(0);
    });

    var byValue = Object.create(null);
    for (var n = 0; n <= 99; n += 1) byValue[String(n)] = [];
    pool.forEach(function (candidate) {
      Object.keys(candidate.positionsByValue).forEach(function (value) {
        byValue[value].push(candidate);
      });
    });

    var stats = { total: pool.length, byValue: {} };
    Object.keys(byValue).forEach(function (value) {
      stats.byValue[value] = byValue[value].length;
    });

    return { config: config, pool: pool, byValue: byValue, stats: stats };
  }

  function getPool(levelId) {
    if (!LEVELS[levelId]) throw new Error("Unknown difficulty: " + levelId);
    if (!poolCache[levelId]) poolCache[levelId] = buildPool(levelId);
    return poolCache[levelId];
  }

  /* ------------------------------------------------------------------ */
  /* Layout construction                                                 */
  /* ------------------------------------------------------------------ */

  function createLayout(size) {
    var grid = new Array(size);
    for (var r = 0; r < size; r += 1) {
      grid[r] = new Array(size).fill(null);
    }
    return { size: size, grid: grid, equations: [], usedTexts: Object.create(null) };
  }

  function cellAt(layout, r, c) {
    if (r < 0 || c < 0 || r >= layout.size || c >= layout.size) return null;
    return layout.grid[r][c];
  }

  function inside(layout, r, c) {
    return r >= 0 && c >= 0 && r < layout.size && c < layout.size;
  }

  /**
   * A placement is valid when:
   *  - every overlapping cell is a matching whole number not already used in
   *    this direction;
   *  - no new cell sits directly beside a perpendicular equation cell;
   *  - the cells immediately before and after the run are empty.
   * This keeps every maximal row/column run a complete, intentional equation.
   */
  function canPlace(layout, direction, startR, startC, candidate) {
    var horizontal = direction === "h";
    var dr = horizontal ? 0 : 1;
    var dc = horizontal ? 1 : 0;
    var length = candidate.length;
    var overlap = 0;

    var endR = startR + dr * (length - 1);
    var endC = startC + dc * (length - 1);
    if (!inside(layout, startR, startC) || !inside(layout, endR, endC)) return false;

    var before = cellAt(layout, startR - dr, startC - dc);
    var after = cellAt(layout, endR + dr, endC + dc);
    if (before || after) return false;

    for (var i = 0; i < length; i += 1) {
      var r = startR + dr * i;
      var c = startC + dc * i;
      var token = candidate.tokens[i];
      var existing = layout.grid[r][c];

      if (existing) {
        if (!isNumberToken(token) || existing.value !== token) return false;
        if (horizontal && existing.eqH.length) return false;
        if (!horizontal && existing.eqV.length) return false;
        overlap += 1;
        continue;
      }

      if (horizontal) {
        if (cellAt(layout, r - 1, c) || cellAt(layout, r + 1, c)) return false;
      } else {
        if (cellAt(layout, r, c - 1) || cellAt(layout, r, c + 1)) return false;
      }
    }

    return overlap > 0;
  }

  function commit(layout, direction, startR, startC, candidate) {
    var horizontal = direction === "h";
    var dr = horizontal ? 0 : 1;
    var dc = horizontal ? 1 : 0;
    var id = "e" + layout.equations.length;
    var cells = [];

    for (var i = 0; i < candidate.length; i += 1) {
      var r = startR + dr * i;
      var c = startC + dc * i;
      var token = candidate.tokens[i];
      var cell = layout.grid[r][c];
      if (!cell) {
        cell = {
          r: r,
          c: c,
          value: token,
          number: isNumberToken(token),
          eqH: [],
          eqV: []
        };
        layout.grid[r][c] = cell;
      }
      if (horizontal) cell.eqH.push(id);
      else cell.eqV.push(id);
      cells.push({ r: r, c: c });
    }

    layout.equations.push({
      id: id,
      direction: direction,
      startR: startR,
      startC: startC,
      cells: cells,
      tokens: candidate.tokens.slice(),
      text: candidate.text,
      result: candidate.result,
      operandCount: candidate.operandCount
    });
    layout.usedTexts[candidate.text] = true;
  }

  function firstPlacement(layout, pool, rng) {
    for (var attempt = 0; attempt < 80; attempt += 1) {
      var candidate = pool[Math.floor(rng() * pool.length)];
      if (!candidate) continue;
      var horizontal = rng() < 0.58;
      var length = candidate.length;
      var slack = layout.size - length;
      if (slack < 0) continue;

      var startR;
      var startC;
      if (horizontal) {
        startR = clamp(Math.floor(slack / 2) + randInt(rng, -2, 2), 0, layout.size - 1);
        startC = clamp(Math.floor(slack / 2) + randInt(rng, -2, 2), 0, slack);
      } else {
        startR = clamp(Math.floor(slack / 2) + randInt(rng, -2, 2), 0, slack);
        startC = clamp(Math.floor(slack / 2) + randInt(rng, -2, 2), 0, layout.size - 1);
      }

      commit(layout, horizontal ? "h" : "v", startR, startC, candidate);
      return true;
    }
    return false;
  }

  function eligibleAnchors(layout) {
    var anchors = [];
    for (var r = 0; r < layout.size; r += 1) {
      for (var c = 0; c < layout.size; c += 1) {
        var cell = layout.grid[r][c];
        if (!cell || !cell.number) continue;
        var dirs = [];
        if (!cell.eqH.length) dirs.push("h");
        if (!cell.eqV.length) dirs.push("v");
        if (dirs.length) anchors.push({ r: r, c: c, dirs: dirs });
      }
    }
    return anchors;
  }

  function tryAddEquation(layout, byValue, rng) {
    var anchors = eligibleAnchors(layout);
    if (!anchors.length) return false;
    shuffle(rng, anchors);

    var maxAnchors = Math.min(anchors.length, 28);
    for (var a = 0; a < maxAnchors; a += 1) {
      var anchor = anchors[a];
      var cell = layout.grid[anchor.r][anchor.c];
      var list = byValue[cell.value];
      if (!list || !list.length) continue;
      var dirs = anchor.dirs.slice();
      shuffle(rng, dirs);

      for (var d = 0; d < dirs.length; d += 1) {
        var direction = dirs[d];
        var horizontal = direction === "h";

        for (var attempt = 0; attempt < 34; attempt += 1) {
          var candidate = list[Math.floor(rng() * list.length)];
          if (!candidate || layout.usedTexts[candidate.text]) continue;
          if (candidate.length > layout.size) continue;

          var positions = candidate.positionsByValue[cell.value];
          if (!positions || !positions.length) continue;
          var position = positions[Math.floor(rng() * positions.length)];

          var startR = horizontal ? anchor.r : anchor.r - position;
          var startC = horizontal ? anchor.c - position : anchor.c;

          if (canPlace(layout, direction, startR, startC, candidate)) {
            commit(layout, direction, startR, startC, candidate);
            return true;
          }
        }
      }
    }
    return false;
  }

  function tryLayout(config, pool, byValue, rng) {
    var layout = createLayout(config.size);
    if (!firstPlacement(layout, pool, rng)) return layout;

    var attempts = 320;
    var idle = 0;
    while (layout.equations.length < config.targetEquations && attempts > 0) {
      var placed = tryAddEquation(layout, byValue, rng);
      attempts -= 1;
      idle = placed ? 0 : idle + 1;
      if (idle >= 9) break;
    }
    return layout;
  }

  /* ------------------------------------------------------------------ */
  /* Givens and final puzzle                                             */
  /* ------------------------------------------------------------------ */

  function chooseBlanks(layout, config, rng) {
    var numberCells = [];
    for (var r = 0; r < layout.size; r += 1) {
      for (var c = 0; c < layout.size; c += 1) {
        var cell = layout.grid[r][c];
        if (cell && cell.number) numberCells.push(cell);
      }
    }

    if (!numberCells.length) return [];

    var target = clamp(
      Math.round(numberCells.length * config.blankRatio),
      layout.equations.length,
      numberCells.length - 1
    );

    for (var attempt = 0; attempt < 16; attempt += 1) {
      var result = tryChooseBlanks(layout, rng, numberCells, target);
      if (result) return result;
    }

    // Extremely defensive fallback: a sparse but valid one-blank-per-equation set.
    var fallback = Object.create(null);
    layout.equations.forEach(function (equation) {
      var options = equation.cells.filter(function (coord) {
        return layout.grid[coord.r][coord.c].number;
      });
      if (options.length) {
        var pick = options[Math.floor(rng() * options.length)];
        fallback[pick.r + "," + pick.c] = true;
      }
    });
    return blankMapToCoords(fallback);
  }

  function tryChooseBlanks(layout, rng, numberCells, target) {
    var stats = Object.create(null);
    layout.equations.forEach(function (equation) {
      var numberCoords = equation.cells.filter(function (coord) {
        return layout.grid[coord.r][coord.c].number;
      });
      stats[equation.id] = { given: numberCoords.length, blank: 0 };
    });

    var blankMap = Object.create(null);

    function equationsFor(cell) {
      return cell.eqH.concat(cell.eqV);
    }

    function canBlank(cell) {
      var ids = equationsFor(cell);
      for (var i = 0; i < ids.length; i += 1) {
        if (!stats[ids[i]] || stats[ids[i]].given <= 1) return false;
      }
      return true;
    }

    function markBlank(cell) {
      var key = cell.r + "," + cell.c;
      if (blankMap[key]) return true;
      if (!canBlank(cell)) return false;
      blankMap[key] = true;
      equationsFor(cell).forEach(function (id) {
        if (stats[id]) {
          stats[id].given -= 1;
          stats[id].blank += 1;
        }
      });
      return true;
    }

    // Start by guaranteeing that every equation has something to fill.
    var equations = shuffle(rng, layout.equations.slice());
    for (var e = 0; e < equations.length; e += 1) {
      var equation = equations[e];
      if (stats[equation.id].blank > 0) continue;
      var options = shuffle(
        rng,
        equation.cells.filter(function (coord) {
          var candidate = layout.grid[coord.r][coord.c];
          return candidate.number && !blankMap[coord.r + "," + coord.c];
        })
      );
      var placed = false;
      for (var o = 0; o < options.length; o += 1) {
        var optionCell = layout.grid[options[o].r][options[o].c];
        if (markBlank(optionCell)) {
          placed = true;
          break;
        }
      }
      if (!placed) return null;
    }

    // Then add blanks at random, never removing an equation's last anchor.
    var shuffled = shuffle(rng, numberCells.slice());
    for (var i = 0; i < shuffled.length && countKeys(blankMap) < target; i += 1) {
      var candidateCell = shuffled[i];
      if (blankMap[candidateCell.r + "," + candidateCell.c]) continue;
      markBlank(candidateCell);
    }

    // Verify every line has at least one hidden number and one visible anchor.
    for (var k = 0; k < layout.equations.length; k += 1) {
      var check = stats[layout.equations[k].id];
      if (!check || check.blank < 1 || check.given < 1) return null;
    }

    return blankMapToCoords(blankMap);
  }

  function blankMapToCoords(blankMap) {
    return Object.keys(blankMap).map(function (key) {
      var parts = key.split(",");
      return { r: Number(parts[0]), c: Number(parts[1]) };
    });
  }

  function countKeys(object) {
    return Object.keys(object).length;
  }

  function scoreLayout(layout) {
    var equipment = layout.equations.length;
    var unique = 0;
    for (var r = 0; r < layout.size; r += 1) {
      for (var c = 0; c < layout.size; c += 1) {
        if (layout.grid[r][c]) unique += 1;
      }
    }
    var crossings = 0;
    for (var rr = 0; rr < layout.size; rr += 1) {
      for (var cc = 0; cc < layout.size; cc += 1) {
        var cell = layout.grid[rr][cc];
        if (cell && cell.eqH.length && cell.eqV.length) crossings += 1;
      }
    }
    return equipment * 100 + crossings * 3 + unique;
  }

  function finalize(layout, config, seed) {
    var rng = makeRng(seed + "-givens");
    var blankCoords = chooseBlanks(layout, config, rng);
    var blankLookup = Object.create(null);
    blankCoords.forEach(function (coord) {
      blankLookup[coord.r + "," + coord.c] = true;
    });

    var cells = [];
    for (var r = 0; r < layout.size; r += 1) {
      for (var c = 0; c < layout.size; c += 1) {
        var source = layout.grid[r][c];
        if (!source) continue;
        var blank = !!blankLookup[r + "," + c];
        cells.push({
          r: r,
          c: c,
          value: source.value,
          solution: source.value,
          kind: source.number ? "number" : source.value === "=" ? "equals" : "operator",
          given: !blank,
          editable: blank,
          hEq: source.eqH.slice(),
          vEq: source.eqV.slice()
        });
      }
    }

    var sortedEquations = layout.equations.slice().sort(function (a, b) {
      if (a.startR !== b.startR) return a.startR - b.startR;
      if (a.startC !== b.startC) return a.startC - b.startC;
      return a.direction === "h" ? -1 : 1;
    });

    var equations = sortedEquations.map(function (equation) {
      return {
        id: equation.id,
        direction: equation.direction,
        cells: equation.cells.map(function (coord) {
          return { r: coord.r, c: coord.c };
        }),
        tokens: equation.tokens.slice(),
        solutionText: equation.text,
        operandCount: equation.operandCount
      };
    });

    var tiles = [];
    var tileId = 0;
    blankCoords
      .slice()
      .sort(function (a, b) {
        return a.r - b.r || a.c - b.c;
      })
      .forEach(function (coord) {
        tiles.push({
          id: "t" + tileId,
          value: layout.grid[coord.r][coord.c].value,
          r: coord.r,
          c: coord.c
        });
        tileId += 1;
      });
    tiles.sort(function (a, b) {
      return Number(a.value) - Number(b.value) || a.id.localeCompare(b.id);
    });

    var crossings = 0;
    cells.forEach(function (cell) {
      if (cell.hEq.length && cell.vEq.length) crossings += 1;
    });

    return {
      seed: seed,
      level: config.id,
      levelLabel: config.label,
      size: config.size,
      cells: cells,
      equations: equations,
      tiles: tiles,
      solution: cells
        .filter(function (cell) { return cell.kind === "number"; })
        .map(function (cell) {
          return { r: cell.r, c: cell.c, value: cell.value };
        }),
      meta: {
        equationCount: equations.length,
        blankCount: blankCoords.length,
        givenCount: cells.filter(function (cell) {
          return cell.kind === "number" && cell.given;
        }).length,
        crossingCount: crossings,
        hints: config.hints
      },
      config: {
        description: config.description,
        detail: config.detail
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  function generatePuzzle(levelId, seed) {
    var config = LEVELS[levelId];
    if (!config) throw new Error("Unknown difficulty: " + levelId);
    var poolData = getPool(levelId);
    var actualSeed = seed == null ? String(Date.now()) : String(seed);

    var best = null;
    var bestScore = -1;
    var attempts = 42;

    for (var i = 0; i < attempts; i += 1) {
      var rng = makeRng(actualSeed + "-layout-" + i);
      var layout = tryLayout(config, poolData.pool, poolData.byValue, rng);
      var score = scoreLayout(layout);
      if (score > bestScore) {
        best = layout;
        bestScore = score;
      }
      if (layout.equations.length >= config.targetEquations) {
        best = layout;
        break;
      }
    }

    if (!best || !best.equations.length) {
      throw new Error("Could not generate a puzzle. Please try another seed.");
    }

    return finalize(best, config, actualSeed);
  }

  var api = {
    LEVELS: LEVELS,
    generatePuzzle: generatePuzzle,
    getPoolStats: function (levelId) {
      return getPool(levelId).stats;
    },
    _internal: {
      makeRng: makeRng,
      hashSeed: hashSeed
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Crosswise = root.Crosswise || {};
  root.Crosswise.generator = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
