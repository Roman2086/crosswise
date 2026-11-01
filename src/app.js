/*
 * Crosswise — game interface
 */
(function () {
  "use strict";

  var Equations = window.Crosswise.equations;
  var Generator = window.Crosswise.generator;
  var LEVELS = Generator.LEVELS;
  var LEVEL_ORDER = ["easy", "medium", "hard"];

  var LEVEL_TITLES = {
    easy: "A gentle warm-up.",
    medium: "Mind the crossings.",
    hard: "Everything must balance."
  };

  var OPERATOR_LABELS = {
    "+": "plus",
    "\u2212": "minus",
    "-": "minus",
    "\u00d7": "times",
    "\u00f7": "divided by",
    "=": "equals"
  };

  var STORAGE_KEY = "crosswise.v2";

  var state = {
    level: "easy",
    puzzle: null,
    cellsByKey: new Map(),
    boardNodes: new Map(),
    values: new Map(),
    tiles: [],
    selectedTileId: null,
    selectedCellKey: null,
    dragOverKey: null,
    draggingTileId: null,
    history: [],
    moves: 0,
    hintsLeft: 0,
    hintsUsed: 0,
    startedAt: 0,
    elapsed: 0,
    running: false,
    won: false,
    fullWarned: false,
    invalidEqIds: new Set(),
    hintedKey: null,
    best: Object.create(null),
    lastFocused: null,
    statuses: [],
    winTimer: null,
    checkTimer: null,
    hintTimer: null,
    toastTimer: null,
    enterTimer: null,
    dealTimer: null,
    celebrateTimer: null
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cellKey(r, c) {
    return r + "," + c;
  }

  function availableTiles() {
    return state.tiles.filter(function (tile) {
      return !tile.placedAt;
    });
  }

  function tileById(id) {
    for (var i = 0; i < state.tiles.length; i += 1) {
      if (state.tiles[i].id === id) return state.tiles[i];
    }
    return null;
  }

  function tileAtCell(key) {
    for (var i = 0; i < state.tiles.length; i += 1) {
      if (state.tiles[i].placedAt === key) return state.tiles[i];
    }
    return null;
  }

  function selectableCell(key) {
    return state.cellsByKey.get(key) || null;
  }

  function formatTime(seconds) {
    var total = Math.max(0, Math.floor(seconds || 0));
    var minutes = Math.floor(total / 60);
    var secs = total % 60;
    var hours = Math.floor(minutes / 60);
    if (hours > 0) {
      minutes = minutes % 60;
      return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    }
    return String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function makeSeed() {
    var stamp = Date.now().toString(36);
    var salt = Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0");
    return (stamp + salt).toUpperCase();
  }

  function puzzleNumber(seed) {
    return String(seed || "").slice(-5).toUpperCase() || "00000";
  }

  function readSave() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { level: "easy", best: {} };
      var parsed = JSON.parse(raw);
      return {
        level: LEVELS[parsed.level] ? parsed.level : "easy",
        best: parsed.best && typeof parsed.best === "object" ? parsed.best : {}
      };
    } catch (error) {
      return { level: "easy", best: {} };
    }
  }

  function writeSave() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ level: state.level, best: state.best })
      );
    } catch (error) {
      /* Storage can be unavailable on locked-down file:// pages. */
    }
  }

  function getBest(level) {
    var value = Number(state.best[level]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function cacheElements() {
    els.board = $("board");
    els.tileBank = $("tile-bank");
    els.bankCount = $("bank-count");
    els.bankEmpty = $("bank-empty");
    els.bankInstruction = $("bank-instruction");
    els.bankCard = document.querySelector(".bank-card");
    els.timer = $("timer");
    els.moves = $("moves");
    els.tilesLeft = $("tiles-left");
    els.levelName = $("level-name");
    els.gridSize = $("grid-size");
    els.puzzleNumber = $("puzzle-number");
    els.levelTitle = $("level-title");
    els.levelChip = $("level-chip");
    els.equationCount = $("equation-count");
    els.equationsTotal = $("equations-total");
    els.equationsSolved = $("equations-solved");
    els.equationStatLabel = $("equation-stat-label");
    els.progressLabel = $("progress-label");
    els.progressPercent = $("progress-percent");
    els.progressTrack = $("progress-track");
    els.progressFill = $("progress-fill");
    els.checkButton = $("check-button");
    els.hintButton = $("hint-button");
    els.hintCount = $("hint-count");
    els.undoButton = $("undo-button");
    els.actionNote = $("action-note");
    els.lineInspector = $("line-inspector");
    els.lineBadge = $("line-badge");
    els.toast = $("toast");
    els.toastText = $("toast-text");
    els.toastMark = document.querySelector(".toast-mark");
    els.winModal = $("win-modal");
    els.winConfetti = $("win-confetti");
    els.winTime = $("win-time");
    els.winMoves = $("win-moves");
    els.winHints = $("win-hints");
    els.winBest = $("win-best");
    els.winCopy = $("win-copy");
    els.nextPuzzle = $("next-puzzle");
    els.bestTime = $("best-time");
  }

  /* ------------------------------------------------------------------ */
  /* Starting and rendering a puzzle                                     */
  /* ------------------------------------------------------------------ */

  function buildPuzzle(level, seedOverride) {
    var lastError = null;
    for (var attempt = 0; attempt < 4; attempt += 1) {
      try {
        var seed = seedOverride || makeSeed();
        return {
          puzzle: Generator.generatePuzzle(level, seed),
          seed: seed
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Could not generate a puzzle.");
  }

  function syncUrl(level, seed) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set("level", level);
      url.searchParams.set("seed", seed);
      window.history.replaceState(null, "", url.toString());
    } catch (error) {
      /* History is not available in every embedded context. */
    }
  }

  function startNewPuzzle(level, seedOverride) {
    if (!LEVELS[level]) level = "easy";
    stopTimer();
    clearTransientTimers();
    hideToast();
    closeWinModal(true);
    clearConfetti();
    document.body.classList.remove("modal-open");

    var generated;
    try {
      generated = buildPuzzle(level, seedOverride);
    } catch (error) {
      showToast("The puzzle generator stumbled. Please try again.", "wrong", 5000);
      return;
    }

    var puzzle = generated.puzzle;
    state.level = level;
    state.puzzle = puzzle;
    state.cellsByKey = new Map();
    state.boardNodes = new Map();
    state.values = new Map();
    state.tiles = puzzle.tiles.map(function (tile) {
      return { id: tile.id, value: tile.value, placedAt: null };
    });
    state.selectedTileId = null;
    state.selectedCellKey = null;
    state.dragOverKey = null;
    state.draggingTileId = null;
    state.history = [];
    state.moves = 0;
    state.hintsLeft = puzzle.meta.hints;
    state.hintsUsed = 0;
    state.elapsed = 0;
    state.running = false;
    state.won = false;
    state.fullWarned = false;
    state.invalidEqIds = new Set();
    state.hintedKey = null;
    state.statuses = [];
    state.lastFocused = null;

    puzzle.cells.forEach(function (cell) {
      cell.key = cellKey(cell.r, cell.c);
      state.cellsByKey.set(cell.key, cell);
    });

    setLevelUI(level);
    writeSave();
    syncUrl(level, generated.seed);
    els.board.classList.remove("is-entering", "is-celebrating", "is-arming");
    renderBoard(puzzle);
    renderBank();
    els.puzzleNumber.textContent = "Puzzle #" + puzzleNumber(generated.seed);
    els.equationCount.textContent = String(puzzle.meta.equationCount);
    els.equationsTotal.textContent = String(puzzle.meta.equationCount);
    els.timer.textContent = "00:00";
    document.title = "Crosswise — " + LEVELS[level].label + " math crossword";

    refreshGame();
    startTimer();

    if (els.board) {
      els.board.classList.add("is-entering");
      clearTimeout(state.enterTimer);
      state.enterTimer = window.setTimeout(function () {
        els.board.classList.remove("is-entering");
      }, 1400);
    }
    if (els.bankCard) {
      els.bankCard.classList.add("is-dealing");
      clearTimeout(state.dealTimer);
      state.dealTimer = window.setTimeout(function () {
        els.bankCard.classList.remove("is-dealing");
      }, 800);
    }

    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      window.scrollTo(0, 0);
    }
  }

  function setLevelUI(level) {
    var config = LEVELS[level];
    if (!config) return;
    state.level = level;

    document.querySelectorAll(".level-button").forEach(function (button) {
      var active = button.dataset.level === level;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", active ? "true" : "false");
    });

    els.levelName.textContent = config.label;
    els.gridSize.textContent = config.size + " × " + config.size;
    els.levelChip.textContent = config.label + " · " + config.size + " × " + config.size;
    els.levelTitle.textContent = LEVEL_TITLES[level];
    updateBestFooter();
  }

  function updateBestFooter() {
    if (!els.bestTime) return;
    var best = getBest(state.level);
    var label = LEVELS[state.level] ? LEVELS[state.level].label.toLowerCase() : "easy";
    els.bestTime.textContent = best
      ? "Best " + label + " time — " + formatTime(best)
      : "Best " + label + " time — not set";
  }

  function renderBoard(puzzle) {
    var fragment = document.createDocumentFragment();
    var board = els.board;
    var size = puzzle.size;
    var stagger = 0;

    board.replaceChildren();
    board.style.setProperty("--size", String(size));
    board.setAttribute("aria-rowcount", String(size));
    board.setAttribute("aria-colcount", String(size));
    board.setAttribute(
      "aria-label",
      puzzle.levelLabel + " " + size + " by " + size + " math crossword with " +
        puzzle.meta.equationCount + " equations. Cells hold whole numbers."
    );

    for (var r = 0; r < size; r += 1) {
      for (var c = 0; c < size; c += 1) {
        var key = cellKey(r, c);
        var meta = state.cellsByKey.get(key);
        var cell = document.createElement("div");

        if (!meta) {
          cell.className = "cell cell--void";
          cell.setAttribute("aria-hidden", "true");
          fragment.appendChild(cell);
          continue;
        }

        cell.className =
          "cell " +
          (meta.editable ? "cell--editable" : "cell--fixed") +
          " cell--" +
          meta.kind;
        if (!meta.editable && meta.kind === "number") cell.classList.add("cell--given");
        if (meta.kind === "number" && meta.hEq.length && meta.vEq.length) {
          cell.classList.add("cell--crossing");
        }
        cell.dataset.key = key;
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-rowindex", String(r + 1));
        cell.setAttribute("aria-colindex", String(c + 1));
        cell.tabIndex = meta.editable ? 0 : -1;
        cell.style.setProperty("--stagger", String(Math.min(stagger, 70)));
        stagger += 1;

        var glyph = document.createElement("span");
        glyph.className = "cell-glyph";
        glyph.setAttribute("aria-hidden", "true");
        cell.appendChild(glyph);
        fragment.appendChild(cell);
        state.boardNodes.set(key, cell);
      }
    }

    board.appendChild(fragment);
  }

  function renderBank() {
    var focused = document.activeElement;
    var focusedTileId =
      focused && focused.classList && focused.classList.contains("tile")
        ? focused.dataset.tileId
        : null;
    var tiles = availableTiles().slice().sort(function (a, b) {
      return Number(a.value) - Number(b.value) || a.id.localeCompare(b.id);
    });

    els.tileBank.replaceChildren();
    tiles.forEach(function (tile, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "tile";
      button.dataset.tileId = tile.id;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Number " + tile.value + " tile");
      button.setAttribute("draggable", "true");
      button.style.setProperty("--tile-order", String(index));
      button.textContent = tile.value;
      els.tileBank.appendChild(button);
    });

    if (focusedTileId) {
      window.requestAnimationFrame(function () {
        var next = els.tileBank.querySelector('[data-tile-id="' + focusedTileId + '"]');
        if (next) next.focus({ preventScroll: true });
      });
    }

    updateBankSelection();
  }

  function updateBankSelection() {
    var tiles = availableTiles();
    var selectedTile = state.selectedTileId ? tileById(state.selectedTileId) : null;

    if (state.selectedTileId && (!selectedTile || selectedTile.placedAt)) {
      state.selectedTileId = null;
      selectedTile = null;
    }

    els.tileBank.querySelectorAll(".tile").forEach(function (button) {
      var selected = button.dataset.tileId === state.selectedTileId;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    els.bankCount.textContent = tiles.length + " left";
    els.tilesLeft.textContent = String(tiles.length);
    els.bankEmpty.hidden = tiles.length > 0;
    els.board.classList.toggle("is-arming", Boolean(selectedTile));

    if (state.won) {
      els.bankInstruction.textContent = "Every tile is in place.";
    } else if (!tiles.length) {
      els.bankInstruction.textContent = "All tiles are placed. Check every line.";
    } else if (selectedTile) {
      els.bankInstruction.textContent = "Now tap a blank cell to place " + selectedTile.value + ".";
    } else {
      var selected = state.selectedCellKey ? state.cellsByKey.get(state.selectedCellKey) : null;
      if (selected && selected.editable && !state.values.has(selected.key)) {
        els.bankInstruction.textContent = "Choose a tile for the selected cell.";
      } else {
        els.bankInstruction.textContent = "Pick a tile, then tap a blank.";
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Game state                                                          */
  /* ------------------------------------------------------------------ */

  function currentValue(meta) {
    if (!meta) return null;
    if (!meta.editable) return meta.value;
    return state.values.get(meta.key) || null;
  }

  function computeStatuses() {
    if (!state.puzzle) return [];
    return state.puzzle.equations.map(function (equation) {
      var tokens = equation.cells.map(function (coord) {
        return currentValue(state.cellsByKey.get(cellKey(coord.r, coord.c)));
      });
      return {
        equation: equation,
        tokens: tokens,
        result: Equations.checkEquation(tokens)
      };
    });
  }

  function refreshGame() {
    state.statuses = computeStatuses();
    updateStats();
    updateBoard();
    updateLineInspector();
    updateControls();
    updateBankSelection();
  }

  function updateStats() {
    var total = state.puzzle ? state.puzzle.meta.blankCount : 0;
    var placed = state.values.size;
    var percent = total ? Math.round((placed / total) * 100) : 0;
    var solved = state.statuses.filter(function (status) {
      return status.result.status === "valid";
    }).length;

    els.moves.textContent = String(state.moves);
    els.progressLabel.textContent = placed + " of " + total + " tiles placed";
    els.progressPercent.textContent = percent + "%";
    els.progressFill.style.width = percent + "%";
    els.progressTrack.setAttribute("aria-valuenow", String(percent));
    els.progressTrack.setAttribute("aria-valuetext", placed + " of " + total + " tiles placed");
    els.equationsSolved.textContent = String(solved);
    els.equationStatLabel.textContent = solved === 1 ? "line balanced" : "lines balanced";
  }

  function updateControls() {
    var tiles = availableTiles();
    els.undoButton.disabled = state.won || state.history.length === 0;
    els.hintButton.disabled = state.won || state.hintsLeft <= 0 || tiles.length === 0;
    els.checkButton.disabled = state.won;
    els.hintCount.textContent = String(state.hintsLeft);

    if (state.won) {
      els.actionNote.textContent = "Puzzle complete — beautifully balanced.";
    } else if (state.hintsLeft <= 0) {
      els.actionNote.textContent = "No hints left. The grid is all yours now.";
    } else {
      els.actionNote.textContent = "Tap a filled cell to send its tile back to the bank.";
    }
  }

  function updateBoard() {
    if (!state.puzzle) return;
    var selectedMeta = state.selectedCellKey
      ? state.cellsByKey.get(state.selectedCellKey)
      : null;
    var selectedTile = state.selectedTileId ? tileById(state.selectedTileId) : null;
    var hIds = new Set(selectedMeta ? selectedMeta.hEq : []);
    var vIds = new Set(selectedMeta ? selectedMeta.vEq : []);

    state.boardNodes.forEach(function (node, key) {
      var meta = state.cellsByKey.get(key);
      if (!meta) return;

      var value = meta.editable ? state.values.get(key) || null : null;
      var glyph = node.firstElementChild;
      var isSelected = key === state.selectedCellKey;
      var isGhost =
        Boolean(selectedTile) && isSelected && meta.editable && !value;
      var inH = meta.hEq.some(function (id) { return hIds.has(id); });
      var inV = meta.vEq.some(function (id) { return vIds.has(id); });
      var isWrong =
        meta.hEq.some(function (id) { return state.invalidEqIds.has(id); }) ||
        meta.vEq.some(function (id) { return state.invalidEqIds.has(id); });

      node.classList.toggle("is-filled", Boolean(value));
      node.classList.toggle("is-selected", isSelected);
      node.classList.toggle("is-ghost", isGhost);
      node.classList.toggle("is-line-h", inH);
      node.classList.toggle("is-line-v", inV);
      node.classList.toggle("is-wrong", isWrong);
      node.classList.toggle("is-hinted", key === state.hintedKey);
      node.classList.toggle("is-drag-over", key === state.dragOverKey);

      if (meta.editable) {
        glyph.textContent = value || (isGhost ? selectedTile.value : "");
      } else {
        glyph.textContent = meta.value;
      }

      node.setAttribute("aria-label", describeCell(meta, value));
      if (isSelected) node.setAttribute("aria-selected", "true");
      else node.removeAttribute("aria-selected");
    });
  }

  function describeCell(meta, value) {
    var position = "Row " + (meta.r + 1) + ", column " + (meta.c + 1);
    if (meta.kind === "operator") {
      return position + ", " + (OPERATOR_LABELS[meta.value] || meta.value) + " operator";
    }
    if (meta.kind === "equals") return position + ", equals sign";
    if (!meta.editable) return position + ", given " + meta.value;
    if (value) return position + ", " + value + ". Tap to remove this tile.";
    return position + ", blank cell";
  }

  /* ------------------------------------------------------------------ */
  /* Selection and inspection                                            */
  /* ------------------------------------------------------------------ */

  function focusCell(key) {
    var node = state.boardNodes.get(key);
    if (!node) return;
    node.focus({ preventScroll: false });
    if (state.selectedCellKey !== key) {
      state.selectedCellKey = key;
      refreshGame();
    }
  }

  function updateLineInspector() {
    if (!state.puzzle || !state.selectedCellKey) {
      els.lineBadge.hidden = true;
      var empty = document.createElement("div");
      empty.className = "line-empty";
      var mark = document.createElement("span");
      mark.className = "line-empty-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "\u2316";
      var copy = document.createElement("p");
      copy.textContent =
        "Select any cell to see the across and down equations it belongs to.";
      empty.appendChild(mark);
      empty.appendChild(copy);
      els.lineInspector.replaceChildren(empty);
      return;
    }

    var meta = state.cellsByKey.get(state.selectedCellKey);
    if (!meta) return;
    var equationIds = meta.hEq.concat(meta.vEq);
    var statusMap = new Map();
    state.statuses.forEach(function (status) {
      statusMap.set(status.equation.id, status);
    });
    var statuses = equationIds
      .map(function (id) { return statusMap.get(id); })
      .filter(Boolean);

    if (!statuses.length) {
      els.lineBadge.hidden = true;
      return;
    }

    var anyInvalid = statuses.some(function (status) {
      return status.result.status === "invalid";
    });
    var allValid = statuses.every(function (status) {
      return status.result.status === "valid";
    });

    els.lineBadge.hidden = false;
    els.lineBadge.textContent = anyInvalid
      ? "Off balance"
      : allValid
        ? "Balanced"
        : "In progress";
    els.lineBadge.classList.toggle("is-invalid", anyInvalid);
    els.lineBadge.classList.toggle("is-valid", !anyInvalid && allValid);

    var fragment = document.createDocumentFragment();
    statuses
      .slice()
      .sort(function (a, b) {
        if (a.equation.direction === b.equation.direction) return 0;
        return a.equation.direction === "h" ? -1 : 1;
      })
      .forEach(function (status) {
        fragment.appendChild(buildLineRow(status));
      });
    els.lineInspector.replaceChildren(fragment);
  }

  function buildLineRow(status) {
    var equation = status.equation;
    var result = status.result;
    var row = document.createElement("div");
    row.className = "line-row";

    var head = document.createElement("div");
    head.className = "line-row-head";
    var direction = document.createElement("span");
    direction.className = "line-direction";
    direction.textContent = equation.direction === "h" ? "Across" : "Down";
    head.appendChild(direction);

    var statusLabel = document.createElement("span");
    statusLabel.className = "line-status";
    if (result.status === "valid") {
      statusLabel.textContent = "Balanced";
      statusLabel.classList.add("is-valid");
    } else if (result.status === "invalid") {
      statusLabel.textContent = "Off balance";
      statusLabel.classList.add("is-invalid");
    } else {
      var blanks = status.tokens.filter(function (value) { return value == null; }).length;
      statusLabel.textContent = blanks + (blanks === 1 ? " cell blank" : " cells blank");
    }
    head.appendChild(statusLabel);
    row.appendChild(head);

    var line = document.createElement("div");
    line.className = "line-equation";
    line.setAttribute("aria-label", Equations.pretty(status.tokens));
    appendEquationTokens(line, status.tokens);
    row.appendChild(line);

    if (result.status === "invalid" && result.reason) {
      var reason = document.createElement("p");
      reason.className = "line-current";
      reason.textContent = result.reason;
      row.appendChild(reason);
    } else if (result.status === "valid") {
      var balanced = document.createElement("p");
      balanced.className = "line-current";
      balanced.textContent = "Every cell is filled and the line balances.";
      row.appendChild(balanced);
    }

    return row;
  }

  function appendEquationTokens(container, tokens) {
    tokens.forEach(function (value) {
      if (value == null || value === "") {
        var blank = document.createElement("span");
        blank.className = "line-token line-token--number line-token--blank";
        blank.textContent = "\u00b7";
        container.appendChild(blank);
        return;
      }
      if (Equations.isOperator(value) || value === "=") {
        var operator = document.createElement("span");
        operator.className =
          "line-token " + (value === "=" ? "line-token--equals" : "line-token--op");
        operator.textContent = value;
        container.appendChild(operator);
        return;
      }
      var number = document.createElement("span");
      number.className = "line-token line-token--number";
      number.textContent = String(value);
      container.appendChild(number);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Placing, clearing, undoing                                          */
  /* ------------------------------------------------------------------ */

  function markEdited() {
    state.invalidEqIds.clear();
    state.fullWarned = false;
    if (state.checkTimer) {
      clearTimeout(state.checkTimer);
      state.checkTimer = null;
    }
  }

  function placeTileAt(key, tileId, options) {
    if (state.won) return false;
    var meta = state.cellsByKey.get(key);
    var tile = tileById(tileId);
    if (!meta || !meta.editable || !tile || tile.placedAt) return false;

    var opts = options || {};
    var previous = tileAtCell(key);
    if (previous && previous.id === tileId) {
      state.selectedCellKey = key;
      refreshGame();
      return true;
    }

    if (previous) previous.placedAt = null;
    tile.placedAt = key;
    state.values.set(key, tile.value);
    state.history.push({
      type: "place",
      key: key,
      previousTileId: previous ? previous.id : null,
      tileId: tile.id,
      hint: Boolean(opts.hint)
    });
    state.moves += 1;
    state.selectedTileId = null;
    state.selectedCellKey = key;
    markEdited();

    if (opts.hint) {
      state.hintedKey = key;
      if (state.hintTimer) clearTimeout(state.hintTimer);
      state.hintTimer = window.setTimeout(function () {
        state.hintedKey = null;
        updateBoard();
      }, 1100);
    }

    renderBank();
    refreshGame();
    focusCell(key);
    checkForWin();
    return true;
  }

  function clearCell(key) {
    if (state.won) return false;
    var meta = state.cellsByKey.get(key);
    var tile = tileAtCell(key);
    if (!meta || !meta.editable || !tile) return false;

    tile.placedAt = null;
    state.values.delete(key);
    state.selectedCellKey = key;
    state.history.push({
      type: "clear",
      key: key,
      previousTileId: tile.id
    });
    state.moves += 1;
    markEdited();
    renderBank();
    refreshGame();
    focusCell(key);
    return true;
  }

  function undo() {
    if (state.won || !state.history.length) return;
    var action = state.history.pop();
    if (!action) return;

    if (action.type === "place") {
      var placed = tileById(action.tileId);
      if (placed) placed.placedAt = null;
      state.values.delete(action.key);
      if (action.previousTileId) {
        var previous = tileById(action.previousTileId);
        if (previous) {
          previous.placedAt = action.key;
          state.values.set(action.key, previous.value);
        }
      }
      if (action.hint) {
        state.hintsLeft = Math.min(state.puzzle.meta.hints, state.hintsLeft + 1);
        state.hintsUsed = Math.max(0, state.hintsUsed - 1);
      }
    } else if (action.type === "clear") {
      var restored = tileById(action.previousTileId);
      if (restored) {
        restored.placedAt = action.key;
        state.values.set(action.key, restored.value);
      }
    }

    state.moves = Math.max(0, state.moves - 1);
    state.selectedTileId = null;
    state.selectedCellKey = action.key;
    state.hintedKey = null;
    markEdited();
    renderBank();
    refreshGame();
    focusCell(action.key);
  }

  function giveHint() {
    if (state.won || state.hintsLeft <= 0) return;
    var freeValues = new Set(
      availableTiles().map(function (tile) {
        return tile.value;
      })
    );
    var blanks = [];
    state.puzzle.cells.forEach(function (cell) {
      if (cell.editable && !state.values.has(cell.key) && freeValues.has(cell.solution)) {
        blanks.push(cell);
      }
    });

    if (!blanks.length) {
      showToast("The tile you need is already on the board. Undo a placement to free it up.", "wrong", 4200);
      return;
    }

    var pick = blanks[Math.floor(Math.random() * blanks.length)];
    var tile = availableTiles().find(function (candidate) {
      return candidate.value === pick.solution;
    });
    if (!tile) return;

    state.hintsLeft -= 1;
    state.hintsUsed += 1;
    var placed = placeTileAt(pick.key, tile.id, { hint: true });
    if (!placed) {
      state.hintsLeft += 1;
      state.hintsUsed = Math.max(0, state.hintsUsed - 1);
      return;
    }
    showToast("A nudge: " + pick.solution + " belongs in that cell.", "good", 1900);
    updateControls();
  }

  function checkPuzzle() {
    if (!state.puzzle || state.won) return;
    var statuses = computeStatuses();
    state.statuses = statuses;
    var invalid = statuses.filter(function (status) {
      return status.result.status === "invalid";
    });
    var complete = statuses.filter(function (status) {
      return status.result.status !== "incomplete";
    });
    var valid = statuses.filter(function (status) {
      return status.result.status === "valid";
    });

    state.invalidEqIds = new Set(
      invalid.map(function (status) {
        return status.equation.id;
      })
    );
    updateBoard();

    if (invalid.length) {
      showToast(
        invalid.length +
          (invalid.length === 1 ? " completed line is" : " completed lines are") +
          " off balance. They\u2019re tinted coral.",
        "wrong",
        4200
      );
    } else if (valid.length && valid.length === complete.length) {
      showToast(
        valid.length +
          (valid.length === 1 ? " line balances" : " lines balance") +
          " so far. Keep going.",
        "good",
        2600
      );
    } else {
      showToast("No completed lines yet. Place a few more tiles.", "info", 2400);
    }

    if (state.checkTimer) clearTimeout(state.checkTimer);
    if (invalid.length) {
      state.checkTimer = window.setTimeout(function () {
        state.invalidEqIds.clear();
        updateBoard();
      }, 4300);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Win state                                                           */
  /* ------------------------------------------------------------------ */

  function checkForWin() {
    if (!state.puzzle || state.won) return false;
    if (state.values.size < state.puzzle.meta.blankCount) return false;

    var statuses = computeStatuses();
    state.statuses = statuses;
    var allValid = statuses.every(function (status) {
      return status.result.status === "valid";
    });
    if (allValid) {
      finishWin();
      return true;
    }

    var invalid = statuses.filter(function (status) {
      return status.result.status === "invalid";
    });
    state.invalidEqIds = new Set(
      invalid.map(function (status) {
        return status.equation.id;
      })
    );
    if (!state.fullWarned) {
      state.fullWarned = true;
      updateBoard();
      showToast(
        "The grid is full, but " +
          Math.max(invalid.length, 1) +
          (Math.max(invalid.length, 1) === 1 ? " line still needs" : " lines still need") +
          " another look.",
        "wrong",
        4600
      );
    }
    return false;
  }

  function finishWin() {
    if (state.won) return;
    stopTimer();
    state.won = true;
    state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    state.selectedTileId = null;
    state.invalidEqIds.clear();
    state.hintedKey = null;
    updateBoard();
    updateStats();
    updateControls();
    updateBankSelection();

    var previousBest = getBest(state.level);
    var isBest = state.elapsed > 0 && (!previousBest || state.elapsed < previousBest);
    if (isBest) {
      state.best[state.level] = state.elapsed;
      writeSave();
      updateBestFooter();
    }

    els.winTime.textContent = formatTime(state.elapsed);
    els.winMoves.textContent = String(state.moves);
    els.winHints.textContent = String(state.hintsUsed);
    els.winBest.textContent = isBest
      ? "A new best time for " + LEVELS[state.level].label.toLowerCase() + "."
      : previousBest
        ? "Your best " +
          LEVELS[state.level].label.toLowerCase() +
          " time is " +
          formatTime(previousBest) +
          "."
        : "A clean first solve.";
    els.winCopy.textContent =
      "You placed " +
      state.puzzle.meta.blankCount +
      " tiles across " +
      state.puzzle.meta.equationCount +
      " interlocking equations. Every line balances.";

    els.board.classList.add("is-celebrating");
    clearTimeout(state.celebrateTimer);
    state.celebrateTimer = window.setTimeout(function () {
      els.board.classList.remove("is-celebrating");
    }, 1400);

    clearTimeout(state.winTimer);
    state.winTimer = window.setTimeout(openWinModal, 620);
  }

  function openWinModal() {
    if (!state.won) return;
    state.lastFocused = document.activeElement;
    els.winModal.hidden = false;
    document.body.classList.add("modal-open");
    launchConfetti();
    window.setTimeout(function () {
      if (!els.winModal.hidden) els.nextPuzzle.focus({ preventScroll: true });
    }, 60);
  }

  function closeWinModal(silent) {
    if (els.winModal.hidden) return;
    els.winModal.hidden = true;
    document.body.classList.remove("modal-open");
    clearConfetti();
    if (!silent) {
      if (state.lastFocused && typeof state.lastFocused.focus === "function") {
        state.lastFocused.focus({ preventScroll: true });
      } else {
        els.nextPuzzle.blur();
      }
    }
    state.lastFocused = null;
  }

  function launchConfetti() {
    var colors = ["#d9552f", "#f0bd4a", "#2b7a78", "#1e2b29", "#fff9ec", "#e78a63"];
    var count = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 68;
    els.winConfetti.replaceChildren();
    for (var i = 0; i < count; i += 1) {
      var piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.setProperty("--x", Math.random() * 100 + "vw");
      piece.style.setProperty("--w", 5 + Math.random() * 8 + "px");
      piece.style.setProperty("--h", 7 + Math.random() * 11 + "px");
      piece.style.setProperty("--rot", Math.random() * 360 + "deg");
      piece.style.setProperty("--color", colors[Math.floor(Math.random() * colors.length)]);
      piece.style.setProperty("--duration", 2.4 + Math.random() * 2.2 + "s");
      piece.style.setProperty("--delay", Math.random() * 0.7 + "s");
      piece.style.setProperty("--drift", Math.random() * 140 - 70 + "px");
      els.winConfetti.appendChild(piece);
    }
  }

  function clearConfetti() {
    if (els.winConfetti) els.winConfetti.replaceChildren();
  }

  /* ------------------------------------------------------------------ */
  /* Timer                                                               */
  /* ------------------------------------------------------------------ */

  function startTimer() {
    stopTimer();
    state.startedAt = Date.now();
    state.elapsed = 0;
    state.running = true;
    els.timer.textContent = "00:00";
    state.timerId = window.setInterval(function () {
      if (!state.running) return;
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      els.timer.textContent = formatTime(state.elapsed);
    }, 500);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    if (state.running) {
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      els.timer.textContent = formatTime(state.elapsed);
    }
    state.running = false;
  }

  function clearTransientTimers() {
    if (state.winTimer) clearTimeout(state.winTimer);
    if (state.checkTimer) clearTimeout(state.checkTimer);
    if (state.hintTimer) clearTimeout(state.hintTimer);
    if (state.enterTimer) clearTimeout(state.enterTimer);
    if (state.dealTimer) clearTimeout(state.dealTimer);
    if (state.celebrateTimer) clearTimeout(state.celebrateTimer);
    state.winTimer = null;
    state.checkTimer = null;
    state.hintTimer = null;
    state.enterTimer = null;
    state.dealTimer = null;
    state.celebrateTimer = null;
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */

  function showToast(message, tone, duration) {
    if (!els.toast) return;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    els.toast.className =
      "toast" +
      (tone === "wrong" ? " toast--wrong" : tone === "good" ? " toast--good" : "");
    els.toastText.textContent = message;
    els.toastMark.textContent = tone === "good" ? "\u2713" : tone === "wrong" ? "!" : "i";
    void els.toast.offsetWidth;
    els.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(function () {
      els.toast.classList.remove("is-visible");
    }, duration || 3200);
  }

  function hideToast() {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = null;
    if (els.toast) els.toast.classList.remove("is-visible");
  }

  /* ------------------------------------------------------------------ */
  /* Interaction                                                         */
  /* ------------------------------------------------------------------ */

  function handleBoardClick(event) {
    var node = event.target.closest(".cell");
    if (!node || node.classList.contains("cell--void")) return;
    var meta = selectableCell(node.dataset.key);
    if (!meta) return;

    state.selectedCellKey = meta.key;
    if (state.won) {
      refreshGame();
      return;
    }

    if (meta.editable) {
      if (state.selectedTileId) {
        placeTileAt(meta.key, state.selectedTileId);
        return;
      }
      if (state.values.has(meta.key)) {
        clearCell(meta.key);
        return;
      }
    }
    refreshGame();
  }

  function handleBoardFocus(event) {
    var node = event.target.closest(".cell");
    if (!node || node.classList.contains("cell--void")) return;
    var meta = selectableCell(node.dataset.key);
    if (!meta) return;
    if (state.selectedCellKey !== meta.key) {
      state.selectedCellKey = meta.key;
      refreshGame();
    }
  }

  function nextCellInDirection(meta, dr, dc) {
    var r = meta.r + dr;
    var c = meta.c + dc;
    while (r >= 0 && c >= 0 && r < state.puzzle.size && c < state.puzzle.size) {
      var key = cellKey(r, c);
      if (state.boardNodes.has(key)) return key;
      r += dr;
      c += dc;
    }
    return null;
  }

  function handleBoardKeydown(event) {
    var node = event.target.closest(".cell");
    if (!node || node.classList.contains("cell--void")) return;
    var meta = selectableCell(node.dataset.key);
    if (!meta) return;

    var direction = null;
    if (event.key === "ArrowUp") direction = [-1, 0];
    else if (event.key === "ArrowDown") direction = [1, 0];
    else if (event.key === "ArrowLeft") direction = [0, -1];
    else if (event.key === "ArrowRight") direction = [0, 1];

    if (direction) {
      var target = nextCellInDirection(meta, direction[0], direction[1]);
      if (target) {
        event.preventDefault();
        state.selectedCellKey = target;
        focusCell(target);
      }
      return;
    }

    if (event.key === "Escape") {
      state.selectedTileId = null;
      state.selectedCellKey = null;
      refreshGame();
      node.blur();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      if (meta.editable && state.values.has(meta.key)) {
        event.preventDefault();
        clearCell(meta.key);
      }
      return;
    }

    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      if (meta.editable && state.selectedTileId) {
        placeTileAt(meta.key, state.selectedTileId);
      }
      return;
    }
  }

  function handleTileClick(event) {
    var button = event.target.closest(".tile");
    if (!button) return;
    var tile = tileById(button.dataset.tileId);
    if (!tile || tile.placedAt || state.won) return;

    var selected = state.selectedCellKey
      ? state.cellsByKey.get(state.selectedCellKey)
      : null;

    if (selected && selected.editable && !state.values.has(selected.key)) {
      placeTileAt(selected.key, tile.id);
      return;
    }

    state.selectedTileId = state.selectedTileId === tile.id ? null : tile.id;
    refreshGame();
  }

  function handleTileDragStart(event) {
    var button = event.target.closest(".tile");
    if (!button) return;
    state.draggingTileId = button.dataset.tileId;
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", button.dataset.tileId);
    } catch (error) {
      /* Some browsers restrict custom drag data; state still has the id. */
    }
    button.classList.add("is-dragging");
  }

  function handleTileDragEnd(event) {
    var button = event.target.closest(".tile");
    if (button) button.classList.remove("is-dragging");
    if (state.dragOverKey) {
      var node = state.boardNodes.get(state.dragOverKey);
      if (node) node.classList.remove("is-drag-over");
      state.dragOverKey = null;
    }
    state.draggingTileId = null;
  }

  function handleDragOver(event) {
    if (state.won) return;
    var node = event.target.closest(".cell");
    if (!node || node.classList.contains("cell--void")) return;
    var meta = selectableCell(node.dataset.key);
    if (!meta || !meta.editable) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (state.dragOverKey && state.dragOverKey !== meta.key) {
      var previous = state.boardNodes.get(state.dragOverKey);
      if (previous) previous.classList.remove("is-drag-over");
    }
    state.dragOverKey = meta.key;
    node.classList.add("is-drag-over");
  }

  function handleDragLeave(event) {
    var node = event.target.closest(".cell");
    if (!node) return;
    if (node.dataset.key === state.dragOverKey) {
      node.classList.remove("is-drag-over");
      state.dragOverKey = null;
    }
  }

  function handleDrop(event) {
    if (state.won) return;
    var node = event.target.closest(".cell");
    if (!node || node.classList.contains("cell--void")) return;
    var meta = selectableCell(node.dataset.key);
    if (!meta || !meta.editable) return;
    event.preventDefault();

    var tileId = state.draggingTileId;
    try {
      tileId = event.dataTransfer.getData("text/plain") || tileId;
    } catch (error) {
      /* Fall back to the id captured on dragstart. */
    }
    if (node.dataset.key === state.dragOverKey) {
      node.classList.remove("is-drag-over");
      state.dragOverKey = null;
    }
    state.draggingTileId = null;
    if (tileId) placeTileAt(meta.key, tileId);
  }

  function handleModalKeydown(event) {
    if (els.winModal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeWinModal();
      return;
    }
    if (event.key !== "Tab") return;

    var focusable = Array.prototype.slice.call(
      els.winModal.querySelectorAll("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    document.querySelectorAll(".level-button").forEach(function (button) {
      button.addEventListener("click", function () {
        var level = button.dataset.level;
        if (!LEVELS[level] || level === state.level) return;
        startNewPuzzle(level);
      });
    });

    $("new-puzzle").addEventListener("click", function () {
      startNewPuzzle(state.level);
    });

    $("brand-home").addEventListener("click", function (event) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (els.board) els.board.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    els.board.addEventListener("click", handleBoardClick);
    els.board.addEventListener("focusin", handleBoardFocus);
    els.board.addEventListener("keydown", handleBoardKeydown);
    els.board.addEventListener("dragover", handleDragOver);
    els.board.addEventListener("dragleave", handleDragLeave);
    els.board.addEventListener("drop", handleDrop);

    els.tileBank.addEventListener("click", handleTileClick);
    els.tileBank.addEventListener("dragstart", handleTileDragStart);
    els.tileBank.addEventListener("dragend", handleTileDragEnd);

    els.checkButton.addEventListener("click", checkPuzzle);
    els.hintButton.addEventListener("click", giveHint);
    els.undoButton.addEventListener("click", undo);

    document.querySelectorAll("[data-close-win]").forEach(function (element) {
      element.addEventListener("click", function () {
        closeWinModal();
      });
    });
    els.nextPuzzle.addEventListener("click", function () {
      closeWinModal(true);
      startNewPuzzle(state.level);
    });
    document.addEventListener("keydown", handleModalKeydown);
  }

  function init() {
    cacheElements();
    var saved = readSave();
    state.best = saved.best || {};
    var params = new URLSearchParams(window.location.search);
    var requestedLevel = params.get("level");
    var requestedSeed = params.get("seed");
    state.level = LEVELS[requestedLevel]
      ? requestedLevel
      : LEVELS[saved.level]
        ? saved.level
        : "easy";
    bindEvents();
    startNewPuzzle(state.level, requestedSeed || undefined);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
