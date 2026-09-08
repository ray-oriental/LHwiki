/**
 * 浏览器自动化冒烟测试（playwright-core + 系统 Edge/Chrome，不下载浏览器）。
 * 覆盖：启动无报错、投放、合成、死亡线、潞河 FSM 全流程、重开清理、destroy。
 * 用法：node qa/run-qa.mjs [baseURL]   默认 http://127.0.0.1:5178（dev server）
 */
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:5178";
const results = [];
const consoleErrors = [];

function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const EXECUTABLE_CANDIDATES = [
  process.env.PROGRAMFILES + "\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env["PROGRAMFILES(X86)"] + "\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe",
  process.env["PROGRAMFILES(X86)"] + "\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe"
];

import { existsSync } from "node:fs";
const executablePath = EXECUTABLE_CANDIDATES.find((p) => p && existsSync(p));
if (!executablePath) {
  console.error("未找到系统 Edge/Chrome，无法运行 QA");
  process.exit(2);
}
console.log("browser:", executablePath);

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 900 }, hasTouch: true });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

const state = () => page.evaluate(() => window.__gluhe.state());
const sleep = (ms) => page.waitForTimeout(ms);

try {
  await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !!window.__gluhe, null, { timeout: 15000 });
  await sleep(800);
  report("游戏启动且调试钩子就绪", true);

  // ---- 基本投放 ----
  const rect = await page.evaluate(() => {
    const c = document.querySelector("canvas.gluhe-canvas").getBoundingClientRect();
    return { left: c.left, top: c.top, width: c.width, height: c.height };
  });
  const dropAt = async (xRatio) => {
    await page.mouse.move(rect.left + rect.width * xRatio, rect.top + rect.height * 0.3);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(500);
  };
  const s0 = await state();
  await dropAt(0.5);
  const s1 = await state();
  report("鼠标投放生成球", s1.balls === s0.balls + 1, `balls ${s0.balls}→${s1.balls}`);

  // 触摸（Pointer Events 统一处理）
  const ballsPreTouch = (await state()).balls;
  await page.touchscreen.tap(rect.left + rect.width * 0.4, rect.top + rect.height * 0.25);
  await sleep(500);
  const ballsPostTouch = (await state()).balls;
  report("触摸投放正常", ballsPostTouch === ballsPreTouch + 1,
    `balls ${ballsPreTouch}→${ballsPostTouch}`);

  await dropAt(0.3);
  await dropAt(0.7);
  await sleep(1500);
  const s2 = await state();
  report("墙壁/地面碰撞后球仍在场内", s2.balls >= 3, `balls=${s2.balls}`);

  // ---- 合成：同等级掉落 ----
  await page.evaluate(() => window.__gluhe.game.doRestart());
  await sleep(200);
  const before = await state();
  await page.evaluate(() => {
    window.__gluhe.drop(1, 240);
  });
  await sleep(400);
  await page.evaluate(() => {
    window.__gluhe.drop(1, 240);
  });
  await sleep(1800);
  const after = await state();
  report("相同等级正确合并（球数减少或等级提升）",
    after.score > before.score || after.balls <= before.balls + 1,
    `score ${before.score}→${after.score}, balls ${before.balls}→${after.balls}`);

  // ---- 潞河 FSM 全流程 ----
  // 独立清场并在中心下方固定铺球，避免前序随机物理状态影响压碎断言。
  await page.evaluate(() => {
    window.__gluhe.game.doRestart();
    window.__gluhe.placeStatic(1, 205, 360);
    window.__gluhe.placeStatic(2, 240, 430);
    window.__gluhe.placeStatic(3, 275, 500);
  });
  await sleep(200);
  const scorePreLuhe = (await state()).score;
  await page.evaluate(() => window.__gluhe.triggerLuhe());
  await sleep(200);
  let st = await state();
  report("潞河事件启动 + LuheCount+1 + 输入锁定",
    st.luheActive && st.luheCount >= 1 && st.inputLocked,
    JSON.stringify(st));

  await sleep(1200); // SPAWN 结束 → TEXT
  st = await state();
  const heavyText = await page.evaluate(() =>
    document.querySelector(".gluhe-heavy-text")?.textContent ?? "");
  report("'好……沉……'逐字出现", heavyText.startsWith("好"), `text="${heavyText}" state=${st.luheState}`);

  // 等待 CRUSH_FALL / BREAK_FLOOR / VIEWPORT_FALL / EXPLODE / RECOVER
  let sawCrushOrFall = false;
  let sawFloorBroken = false;
  for (let i = 0; i < 120; i++) {
    await sleep(100);
    st = await state();
    if (st.luheState >= 3 && st.luheState <= 5) sawCrushOrFall = true;
    if (st.floorBroken) sawFloorBroken = true;
    if (!st.luheActive) break;
  }
  report("潞河超重下坠（CRUSH_FALL 进入）", sawCrushOrFall);
  report("潞河击穿底板（地板出现裂缝缺口）", sawFloorBroken);
  st = await state();
  const luheDelta = st.score - scorePreLuhe;
  report("压碎按等级加分（500合成奖+压碎分+1000尾奖 > 1500）",
    luheDelta > 1500, `delta=${luheDelta}`);
  report("终局结束：底板恢复 + 输入解锁 + 游戏继续",
    !st.floorBroken && st.floorPresent && !st.inputLocked && !st.luheActive && !st.gameOver,
    JSON.stringify(st));

  // ---- 第二次潞河（队列/重复触发安全） ----
  const cnt1 = st.luheCount;
  await page.evaluate(() => window.__gluhe.triggerLuhe());
  for (let i = 0; i < 140; i++) {
    await sleep(100);
    st = await state();
    if (!st.luheActive) break;
  }
  report("第二次潞河完整走完且计数为 2", st.luheCount === cnt1 + 1 && st.floorPresent && !st.inputLocked,
    `luheCount=${st.luheCount}`);

  // ---- 死亡线判定（确定性）：静止球稳定越线 1.6s 应判负；
  //      其前已验证自然堆叠在过量投放下最终也会触顶 ----
  await page.evaluate(() => {
    window.__gluhe.game.doRestart();
    window.__gluhe.placeStatic(5, 240, 90); // r=47 → top=43 < 死亡线130，稳定越线
  });
  let st2 = await state();
  let died = false;
  for (let i = 0; i < 30 && !died; i++) {
    await sleep(200);
    st2 = await state();
    if (st2.gameOver) { died = true; break; }
  }
  report("稳定越线触发 Game Over", died, `gameOver=${st2.gameOver}`);
  // 判负后清场，验证"运动中的球不误判死亡"
  await page.evaluate(() => window.__gluhe.game.doRestart());
  await page.evaluate(() => window.__gluhe.drop(5, 240)); // 下落经过死亡线
  await sleep(1200);
  const noFalseDeath = !(await state()).gameOver;
  report("下落中的球越过死亡线不误判", noFalseDeath);

  await page.evaluate(() => {
    window.__gluhe.placeStatic(5, 240, 90);
  });
  for (let i = 0; i < 30 && !(await state()).gameOver; i++) await sleep(200);

  await sleep(1000); // 弹层在游戏内延迟 700ms 出现
  const modalVisible = await page.evaluate(() => !!document.querySelector(".gluhe-modal"));
  report("Game Over 弹层出现", modalVisible);

  const lockedAfterGO = (await state()).inputLocked;
  report("Game Over 后不能继续投球", lockedAfterGO);

  // ---- 重开：状态彻底清理 ----
  await page.evaluate(() => window.__gluhe.game.doRestart());
  await sleep(400);
  st = await state();
  report("重开后球清零/分数清零/潞河清零/输入恢复",
    st.balls === 0 && st.score === 0 && st.luheCount === 0 && !st.inputLocked && !st.gameOver,
    JSON.stringify(st));
  const modalGone = await page.evaluate(() => !document.querySelector(".gluhe-modal"));
  report("重开后弹层关闭", modalGone);

  // 重开后再玩正常
  await dropAt(0.5);
  st = await state();
  report("重开后可正常投放", st.balls === 1, `balls=${st.balls}`);

  // ---- 连续重开 5 次：无残留 ----
  for (let i = 0; i < 5; i++) {
    await dropAt(0.3 + i * 0.1);
    await page.evaluate(() => window.__gluhe.game.doRestart());
    await sleep(200);
  }
  st = await state();
  const singleCanvas = await page.evaluate(() =>
    document.querySelectorAll(".gluhe-canvas").length === 1
    && document.querySelectorAll(".gluhe-hud").length === 1
    && !document.querySelector(".gluhe-modal"));
  report("连续重开 5 次无 DOM/状态残留",
    st.balls === 0 && st.score === 0 && singleCanvas, JSON.stringify(st));

  // ---- destroy ----
  await page.evaluate(() => window.__gluhe.game.destroy());
  await sleep(300);
  const domGone = await page.evaluate(() =>
    !document.querySelector(".gluhe-canvas") && !document.querySelector(".gluhe-fx-layer")
    && !document.querySelector(".gluhe-heavy-text") && !document.querySelector(".gluhe-dim"));
  report("destroy 后 DOM/FX 层全清理", domGone);

  // ---- 控制台错误 ----
  const realErrors = consoleErrors.filter((e) => !e.includes("favicon"));
  report("控制台无持续 error", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
} catch (err) {
  report("QA 执行异常", false, String(err).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`);
process.exit(failed.length > 0 ? 1 : 0);
