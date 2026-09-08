/** 生产构建冒烟：无调试钩子、无 console error、可投放、校徽加载 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5179";
const CAND = [
  process.env.PROGRAMFILES + "\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env["PROGRAMFILES(X86)"] + "\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe"
];
const executablePath = CAND.find((p) => p && existsSync(p));

const errors = [];
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 860 }, hasTouch: true });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: "load", timeout: 20000 });
await page.waitForSelector("canvas.gluhe-canvas", { timeout: 10000 });
await page.waitForTimeout(1200);

const noHook = await page.evaluate(() => typeof window.__gluhe === "undefined");
console.log(`${noHook ? "PASS" : "FAIL"}  生产构建不含调试钩子 __gluhe`);

// 鼠标投放两球 + 触摸一球
const rect = await page.evaluate(() => {
  const c = document.querySelector("canvas.gluhe-canvas").getBoundingClientRect();
  return { left: c.left, top: c.top, width: c.width, height: c.height };
});
await page.mouse.move(rect.left + rect.width * 0.5, rect.top + 200);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(600);
await page.mouse.move(rect.left + rect.width * 0.3, rect.top + 200);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(1500);

// 通过像素判断画面非空白（球已渲染）
const colorful = await page.evaluate(() => {
  const c = document.querySelector("canvas.gluhe-canvas");
  const ctx = c.getContext("2d");
  const d = ctx.getImageData(0, Math.floor(c.height * 0.7), c.width, Math.floor(c.height * 0.25)).data;
  let distinct = new Set();
  for (let i = 0; i < d.length; i += 4 * 997) distinct.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return distinct.size > 4;
});
console.log(`${colorful ? "PASS" : "FAIL"}  生产画面渲染正常（球体可见）`);

// 校徽请求全部成功
const logoOk = await page.evaluate(async () => {
  const imgs = ["l01","l02","l03","l04","l05","l06","l07","l08","l09","l10"];
  for (const id of imgs) {
    const r = await fetch(`assets/schools/${id}.png`, { method: "HEAD" });
    if (!r.ok) return false;
  }
  return true;
});
console.log(`${logoOk ? "PASS" : "FAIL"}  10 张校徽在 dist 中可访问`);

const realErrors = errors.filter((e) => !e.includes("favicon"));
console.log(`${realErrors.length === 0 ? "PASS" : "FAIL"}  生产控制台无 error${realErrors.length ? " — " + realErrors[0] : ""}`);

await browser.close();
const allPass = noHook && colorful && logoOk && realErrors.length === 0;
console.log(allPass ? "==== PROD SMOKE PASS ====" : "==== PROD SMOKE FAIL ====");
process.exit(allPass ? 0 : 1);
