/*
 * Crosswise browser smoke/playthrough test using Edge + the Chrome DevTools
 * Protocol (no third-party dependencies).
 *
 * Run with: node tests/browser.test.js
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const Generator = require("../src/generator.js");

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "msedge"
].filter(Boolean);

const edgePath = EDGE_CANDIDATES.find((candidate) => {
  if (candidate === "msedge") return true;
  return fs.existsSync(candidate);
});

if (!edgePath) {
  console.log("SKIP browser test: Microsoft Edge was not found.");
  process.exit(0);
}

const root = path.resolve(__dirname, "..");
const pageUrl =
  "file:///" +
  path.join(root, "index.html").replace(/\\/g, "/") +
  "?level=easy&seed=UITEST";
const port = 9300 + Math.floor(Math.random() * 200);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "crosswise-browser-"));
const screenshots = path.join(root, "tests", "screenshots");
fs.mkdirSync(screenshots, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeout, label) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await fn()) return;
    await sleep(120);
  }
  throw new Error("Timed out waiting for " + label);
}

let browser = null;
let socket = null;
let messageId = 0;
const pending = new Map();
const pageErrors = [];

function send(method, params) {
  const id = (messageId += 1);
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  socket.send(JSON.stringify({ id, method, params: params || {} }));
  return promise;
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception
      ? response.exceptionDetails.exception.description
      : response.exceptionDetails.text;
    throw new Error("Page evaluation failed: " + detail);
  }
  return response.result ? response.result.value : undefined;
}

async function waitForSelector(selector, timeout) {
  await waitFor(
    () => evaluate("Boolean(document.querySelector(" + JSON.stringify(selector) + "))"),
    timeout || 8000,
    selector
  );
}

async function click(selector) {
  const clicked = await evaluate(
    "(() => { const el = document.querySelector(" +
      JSON.stringify(selector) +
      "); if (!el) return false; el.click(); return true; })()"
  );
  assert.equal(clicked, true, "click target exists: " + selector);
}

async function clickCell(r, c) {
  await click('[data-key="' + r + "," + c + '"]');
}

async function focusCell(r, c) {
  const focused = await evaluate(
    "(() => { const el = document.querySelector('[data-key=\"" +
      r +
      "," +
      c +
      "\"]'); if (!el) return false; el.focus(); return true; })()"
  );
  assert.equal(focused, true, "cell can be focused: " + r + "," + c);
}

async function clickTile(value) {
  const clicked = await evaluate(
    "(() => { const el = [...document.querySelectorAll('.tile')].find((tile) => tile.textContent === " +
      JSON.stringify(String(value)) +
      "); if (!el) return false; el.click(); return true; })()"
  );
  assert.equal(clicked, true, "a " + value + " tile is available");
}

async function capture(name) {
  const response = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  const file = path.join(screenshots, name);
  fs.writeFileSync(file, Buffer.from(response.data, "base64"));
  return file;
}

async function captureFull(name) {
  const metrics = await send("Page.getLayoutMetrics");
  const size = metrics.cssContentSize || metrics.contentSize;
  const response = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 }
  });
  const file = path.join(screenshots, name);
  fs.writeFileSync(file, Buffer.from(response.data, "base64"));
  return file;
}

async function main() {
  browser = spawn(
    edgePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + profile,
      "--window-size=1440,1200",
      pageUrl
    ],
    { stdio: "ignore", windowsHide: true }
  );

  let target = null;
  await waitFor(
    async () => {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/json/list");
        const list = await response.json();
        target = list.find((item) => item.type === "page" && /index\.html/.test(item.url));
        return Boolean(target);
      } catch (error) {
        return false;
      }
    },
    12000,
    "Edge DevTools target"
  );

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result || {});
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      pageErrors.push(
        details.exception && details.exception.description
          ? details.exception.description
          : details.text
      );
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      pageErrors.push(
        message.params.args
          .map((arg) => (arg.value == null ? arg.description : String(arg.value)))
          .join(" ")
      );
    }
  });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  await waitForSelector(".tile", 8000);
  await waitFor(
    () => evaluate("document.querySelectorAll('.cell--void').length > 0"),
    5000,
    "board cells"
  );

  console.log("  ok  page boots without a blank screen");

  const puzzle = Generator.generatePuzzle("easy", "UITEST");
  const blanks = puzzle.cells
    .filter((cell) => cell.editable)
    .sort((a, b) => a.r - b.r || a.c - b.c);
  const expectedTiles = puzzle.tiles.length;
  const inspectorCell =
    puzzle.cells.find((cell) => cell.kind === "number" && cell.hEq.length && cell.vEq.length) ||
    puzzle.cells.find((cell) => cell.kind === "number");
  const wrongEquation = puzzle.equations.find((equation) => {
    const blanksInLine = equation.cells.filter((coord) => {
      const cell = puzzle.cells.find((candidate) => candidate.r === coord.r && candidate.c === coord.c);
      return cell && cell.editable;
    });
    return blanksInLine.length === 1;
  });
  assert.ok(wrongEquation, "deterministic puzzle has a one-blank equation for the wrong-line test");
  const wrongCoord = wrongEquation.cells.find((coord) => {
    const cell = puzzle.cells.find((candidate) => candidate.r === coord.r && candidate.c === coord.c);
    return cell && cell.editable;
  });
  const wrongCell = puzzle.cells.find((cell) => cell.r === wrongCoord.r && cell.c === wrongCoord.c);
  const wrongValue = puzzle.tiles
    .map((tile) => tile.value)
    .find((value) => value !== wrongCell.solution);
  assert.ok(wrongValue != null, "a deliberately wrong tile is available");

  const initial = await evaluate(`(() => ({
    size: getComputedStyle(document.getElementById('board')).getPropertyValue('--size').trim(),
    equations: document.getElementById('equation-count').textContent,
    tiles: document.querySelectorAll('.tile').length,
    title: document.getElementById('level-title').textContent,
    puzzle: document.getElementById('puzzle-number').textContent,
    cells: document.querySelectorAll('.cell[data-key]').length,
    voidCells: document.querySelectorAll('.cell--void').length,
    twoDigitTiles: [...document.querySelectorAll('.tile')].filter((tile) => tile.textContent.length === 2).length,
    twoDigitCells: [...document.querySelectorAll('.cell--number .cell-glyph')].filter((glyph) => glyph.textContent.length === 2).length
  }))()`);

  assert.equal(initial.size, "7", "easy grid is 7x7");
  assert.equal(initial.equations, String(puzzle.meta.equationCount));
  assert.equal(initial.tiles, expectedTiles, "tile bank matches the generated puzzle");
  assert.ok(initial.twoDigitTiles > 0, "the bank contains multi-digit number tiles");
  assert.ok(initial.twoDigitCells > 0, "the grid contains multi-digit numbers");
  assert.equal(initial.title, "A gentle warm-up.");
  assert.match(initial.puzzle, /#ITEST/);
  assert.equal(initial.cells + initial.voidCells, 49, "board has all 49 grid positions");

  // Selecting a cell exposes both of its lines in the inspector.
  await clickCell(inspectorCell.r, inspectorCell.c);
  await waitForSelector(".line-row", 3000);
  const inspector = await evaluate(`(() => ({
    rows: document.querySelectorAll('.line-row').length,
    badge: document.getElementById('line-badge').textContent,
    directions: [...document.querySelectorAll('.line-direction')].map((node) => node.textContent)
  }))()`);
  assert.equal(inspector.rows, 2, "selected crossing shows both equations");
  assert.ok(inspector.directions.includes("Across"), "inspector shows an across line");

  // Complete one line incorrectly; Check should call it out.
  await clickCell(wrongCell.r, wrongCell.c);
  await clickTile(wrongValue);
  await click("#check-button");
  await waitFor(
    () => evaluate("document.querySelectorAll('.cell.is-wrong').length > 0"),
    3000,
    "wrong-line highlight"
  );
  const checked = await evaluate(`(() => ({
    wrongCells: document.querySelectorAll('.cell.is-wrong').length,
    toast: document.getElementById('toast-text').textContent,
    status: [...document.querySelectorAll('.line-status.is-invalid')].map((node) => node.textContent)
  }))()`);
  assert.ok(checked.wrongCells > 0, "Check marks off-balance cells");
  assert.match(checked.toast, /off balance|needs another look/i);
  assert.ok(checked.status.includes("Off balance"), "inspector reports an off-balance line");
  await click("#undo-button");
  await waitFor(
    () => evaluate("document.querySelectorAll('.cell.is-filled').length === 0"),
    3000,
    "undo after check"
  );

  // A hint places a correct tile, and undo fully restores the state.
  await click("#hint-button");
  await waitFor(
    () => evaluate("document.querySelectorAll('.cell.is-filled').length === 1"),
    3000,
    "hint placement"
  );
  const afterHint = await evaluate(`(() => ({
    hints: document.getElementById('hint-count').textContent,
    placed: document.querySelectorAll('.cell.is-filled').length,
    filled: document.getElementById('progress-label').textContent
  }))()`);
  assert.equal(afterHint.hints, "2");
  assert.equal(afterHint.placed, 1);
  assert.match(afterHint.filled, new RegExp("1 of " + expectedTiles));

  await click("#undo-button");
  await waitFor(
    () => evaluate("document.querySelectorAll('.cell.is-filled').length === 0"),
    3000,
    "undo"
  );
  const afterUndo = await evaluate(`(() => ({
    hints: document.getElementById('hint-count').textContent,
    moves: document.getElementById('moves').textContent,
    undoDisabled: document.getElementById('undo-button').disabled
  }))()`);
  assert.equal(afterUndo.hints, "3", "undo restores the hint allowance");
  assert.equal(afterUndo.moves, "0", "undo rolls back the move count");
  assert.equal(afterUndo.undoDisabled, true);

  // A few correct tiles plus a crossing selection make a useful visual check.
  for (const blank of blanks.slice(0, 3)) {
    await clickCell(blank.r, blank.c);
    await clickTile(blank.solution);
  }
  await evaluate("document.getElementById('toast').classList.remove('is-visible')");
  await sleep(1100);
  await focusCell(inspectorCell.r, inspectorCell.c);
  await sleep(250);
  const previewShot = await captureFull("inspector-easy.png");
  const preview = await evaluate(`(() => ({
    filled: document.querySelectorAll('.cell.is-filled').length,
    lines: document.querySelectorAll('.line-row').length,
    directions: [...document.querySelectorAll('.line-direction')].map((node) => node.textContent)
  }))()`);
  assert.equal(preview.filled, 3);
  assert.equal(preview.lines, 2, "crossing cell shows both lines");
  assert.deepEqual(preview.directions.sort(), ["Across", "Down"]);
  console.log("  ok  line inspector handles a crossing cell");

  // Solve the rest through the public UI.
  for (const blank of blanks) {
    const key = blank.r + "," + blank.c;
    const filled = await evaluate(
      "document.querySelector('[data-key=" +
        JSON.stringify(key) +
        "]').classList.contains('is-filled')"
    );
    if (filled) continue;
    await clickCell(blank.r, blank.c);
    await clickTile(blank.solution);
  }

  await waitFor(
    () => evaluate("document.getElementById('win-modal').hidden === false"),
    6000,
    "win modal"
  );
  const won = await evaluate(`(() => ({
    time: document.getElementById('win-time').textContent,
    moves: document.getElementById('win-moves').textContent,
    hints: document.getElementById('win-hints').textContent,
    progress: document.getElementById('progress-percent').textContent,
    solved: document.getElementById('equations-solved').textContent,
    total: document.getElementById('equations-total').textContent,
    wrong: document.querySelectorAll('.cell.is-wrong').length,
    modalCopy: document.getElementById('win-copy').textContent
  }))()`);
  assert.equal(won.progress, "100%");
  assert.equal(won.solved, won.total);
  assert.equal(won.wrong, 0);
  assert.equal(won.hints, "0");
  assert.equal(won.moves, String(expectedTiles));
  assert.match(won.modalCopy, /Every line balances/);

  const winShot = await capture("win-easy.png");
  console.log("  ok  solved the puzzle through the UI — " + won.time);

  await click("#close-win");
  await click('[data-level="medium"]');
  await waitFor(
    () => evaluate("document.getElementById('board').style.getPropertyValue('--size') === '9'"),
    6000,
    "medium grid"
  );
  const medium = await evaluate(`(() => ({
    size: document.getElementById('board').style.getPropertyValue('--size'),
    equations: Number(document.getElementById('equation-count').textContent),
    tiles: document.querySelectorAll('.tile').length,
    query: location.search
  }))()`);
  assert.equal(medium.size, "9");
  assert.ok(medium.equations >= 7, "medium puzzle has at least 7 equations");
  assert.ok(medium.tiles > 0, "medium puzzle has tiles");
  assert.match(medium.query, /level=medium/);
  assert.match(medium.query, /seed=/);

  const mediumShot = await capture("medium-desktop.png");
  console.log("  ok  switched to medium and generated a fresh grid");

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await sleep(450);
  const overflow = await evaluate("document.documentElement.scrollWidth - window.innerWidth");
  assert.ok(overflow <= 2, "no horizontal overflow on a 390px viewport, got " + overflow);
  const mobileShot = await capture("medium-mobile.png");
  console.log("  ok  mobile layout has no horizontal overflow");

  await click('[data-level="hard"]');
  await waitFor(
    () => evaluate("document.getElementById('board').style.getPropertyValue('--size') === '11'"),
    6000,
    "hard grid"
  );
  await sleep(300);
  const hardMobile = await evaluate(`(() => ({
    size: document.getElementById('board').style.getPropertyValue('--size'),
    equations: Number(document.getElementById('equation-count').textContent),
    tiles: document.querySelectorAll('.tile').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    boardWidth: document.getElementById('board').getBoundingClientRect().width
  }))()`);
  assert.equal(hardMobile.size, "11");
  assert.ok(hardMobile.equations >= 8, "hard puzzle has at least 8 equations");
  assert.ok(hardMobile.tiles > 0);
  assert.ok(hardMobile.overflow <= 2, "no horizontal overflow on hard at 390px");
  assert.ok(hardMobile.boardWidth > 300, "hard board still fills the screen");
  const hardMobileShot = await capture("hard-mobile.png");
  console.log("  ok  hard grid fits a 390px viewport");

  await send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 700,
    deviceScaleFactor: 1,
    mobile: true
  });
  await sleep(300);
  const narrowOverflow = await evaluate("document.documentElement.scrollWidth - window.innerWidth");
  assert.ok(narrowOverflow <= 2, "no horizontal overflow on hard at 320px, got " + narrowOverflow);
  console.log("  ok  hard grid fits a 320px viewport");

  assert.deepEqual(pageErrors, [], "no uncaught page errors");

  console.log("\nScreenshots:");
  console.log("  " + previewShot);
  console.log("  " + winShot);
  console.log("  " + mediumShot);
  console.log("  " + mobileShot);
  console.log("  " + hardMobileShot);
  console.log("\nBrowser tests passed.\n");
}

main()
  .catch((error) => {
    console.error("\nBrowser test failed:");
    console.error(error.stack || error);
    if (pageErrors.length) {
      console.error("\nPage errors:");
      pageErrors.forEach((message) => console.error("  " + message));
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (socket) {
      try {
        socket.close();
      } catch (error) {
        /* ignore */
      }
    }
    if (browser && browser.pid) {
      spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      /* ignore */
    }
  });
