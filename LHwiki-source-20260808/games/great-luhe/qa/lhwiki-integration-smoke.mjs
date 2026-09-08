/** LHwiki 集成冒烟：入口、iframe 隔离、主题同步、移动端布局与游戏阶段零 API 请求。 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:5190";
const live = process.argv.includes("--live");
const shotArg = process.argv.find((value) => value.startsWith("--screenshot="));
const screenshot = shotArg?.slice("--screenshot=".length);
const browserPath = [
  process.env.PROGRAMFILES + "\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env["PROGRAMFILES(X86)"] + "\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe"
].find((value) => value && existsSync(value));

if (!browserPath) throw new Error("未找到系统 Edge/Chrome");
const expectedOrigin = new URL(base).origin;
const results = [];
const pass = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
let activePage;

async function preparePage(context) {
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  const failedResponses = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      errors.push(`${message.text()}${location.url ? ` @ ${location.url}` : ""}`);
    }
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  if (!live) {
    await page.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname === "/api/bootstrap"
        ? { sections: [], articles: [], contributors: [], teacherAdditions: [] }
        : { user: null };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
  }
  return { page, requests, errors, failedResponses };
}

async function acceptCloudBaseInterstitial(page) {
  const confirm = page.locator("button").filter({ hasText: "确定访问" }).first();
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
    await confirm.click();
    await page.waitForLoadState("load");
  }
}

async function gotoGame(page) {
  const target = `${base}/#/game`;
  await page.goto(target, { waitUntil: "load", timeout: 30_000 });
  await acceptCloudBaseInterstitial(page);
  if (await page.evaluate(() => location.hash) !== "#/game") {
    await page.goto(target, { waitUntil: "load", timeout: 30_000 });
  }
}

function applicationIssues(errors, failedResponses) {
  const warningResponses = new Set([`404 ${base}/`, `404 ${base}/favicon.ico`]);
  const onlyCloudBaseWarning = live && failedResponses.length > 0
    && failedResponses.every((entry) => warningResponses.has(entry));
  return {
    errors: onlyCloudBaseWarning
      ? errors.filter((entry) => !entry.includes(` @ ${base}/#/game`) && !entry.includes(` @ ${base}/favicon.ico`))
      : errors,
    failedResponses: onlyCloudBaseWarning ? [] : failedResponses
  };
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { page, requests, errors, failedResponses } = await preparePage(desktop);
  activePage = page;
  await gotoGame(page);
  await page.waitForSelector('.nav-link[href="#/game"].active');
  const frameElement = await page.waitForSelector("iframe.great-luhe-frame");
  const frame = await frameElement.contentFrame();
  await frame.waitForSelector("canvas.gluhe-canvas", { timeout: 15_000 });
  await frame.waitForFunction(() => document.querySelectorAll(".gluhe-next img").length === 1);
  await page.waitForTimeout(700);

  const desktopLayout = await page.evaluate(() => {
    const copy = document.querySelector(".great-luhe-copy").getBoundingClientRect();
    const game = document.querySelector(".great-luhe-frame").getBoundingClientRect();
    return { copyX: copy.x, gameX: game.x, gameWidth: game.width };
  });
  pass("桌面端使用次级入口与左右展陈布局", desktopLayout.gameX > desktopLayout.copyX && desktopLayout.gameWidth <= 520,
    JSON.stringify(desktopLayout));

  await page.click("[data-theme-menu]");
  await page.click('[data-theme-mode="dark"]');
  await frame.waitForFunction(() => document.querySelector(".gluhe-root")?.dataset.theme === "dark");
  const darkState = await frame.evaluate(() => {
    const root = document.querySelector(".gluhe-root");
    const canvas = document.querySelector("canvas.gluhe-canvas");
    const pixel = [...canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height * 0.08, 1, 1).data.slice(0, 3)];
    return { theme: root.dataset.theme, surface: getComputedStyle(document.querySelector(".gluhe-hud")).backgroundColor, pixel };
  });
  pass("深色主题同步到游戏 DOM 与 Canvas", darkState.theme === "dark" && darkState.pixel.every((value) => value < 90), JSON.stringify(darkState));

  const apiCountBeforePlay = requests.filter((url) => new URL(url).pathname.startsWith("/api/")).length;
  const canvas = await frame.locator("canvas.gluhe-canvas").boundingBox();
  await frame.page().mouse.click(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.24);
  await page.waitForTimeout(900);
  const apiCountAfterPlay = requests.filter((url) => new URL(url).pathname.startsWith("/api/")).length;
  pass("游玩与主题切换不触发 LHwiki API", apiCountAfterPlay === apiCountBeforePlay,
    `api ${apiCountBeforePlay}→${apiCountAfterPlay}`);
  pass("所有资源保持同源", requests.every((url) => new URL(url).origin === expectedOrigin));
  const desktopIssues = applicationIssues(errors, failedResponses);
  pass("桌面端应用控制台无错误", desktopIssues.errors.length === 0 && desktopIssues.failedResponses.length === 0,
    [desktopIssues.errors[0], desktopIssues.failedResponses[0]].filter(Boolean).join(" | "));
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mobileRun = await preparePage(mobile);
  activePage = mobileRun.page;
  await gotoGame(mobileRun.page);
  const mobileFrameElement = await mobileRun.page.waitForSelector("iframe.great-luhe-frame");
  const mobileFrame = await mobileFrameElement.contentFrame();
  await mobileFrame.waitForSelector("canvas.gluhe-canvas", { timeout: 15_000 });
  const mobileLayout = await mobileRun.page.evaluate(() => {
    const copy = document.querySelector(".great-luhe-copy").getBoundingClientRect();
    const game = document.querySelector(".great-luhe-frame").getBoundingClientRect();
    return { copyBottom: copy.bottom, gameTop: game.top, gameWidth: game.width, viewport: innerWidth };
  });
  pass("移动端改为上下布局且不横向溢出",
    mobileLayout.gameTop >= mobileLayout.copyBottom && mobileLayout.gameWidth <= mobileLayout.viewport,
    JSON.stringify(mobileLayout));
  const mobileCanvas = await mobileFrame.locator("canvas.gluhe-canvas").boundingBox();
  const mobileApiBefore = mobileRun.requests.filter((url) => new URL(url).pathname.startsWith("/api/")).length;
  await mobileRun.page.touchscreen.tap(mobileCanvas.x + mobileCanvas.width * 0.45, mobileCanvas.y + mobileCanvas.height * 0.24);
  await mobileRun.page.waitForTimeout(700);
  const mobileApiAfter = mobileRun.requests.filter((url) => new URL(url).pathname.startsWith("/api/")).length;
  pass("移动端触摸游玩不触发 LHwiki API", mobileApiAfter === mobileApiBefore,
    `api ${mobileApiBefore}→${mobileApiAfter}`);
  const mobileIssues = applicationIssues(mobileRun.errors, mobileRun.failedResponses);
  pass("移动端应用控制台无错误", mobileIssues.errors.length === 0 && mobileIssues.failedResponses.length === 0,
    [mobileIssues.errors[0], mobileIssues.failedResponses[0]].filter(Boolean).join(" | "));
  await mobile.close();
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error("DIAGNOSTIC URL", activePage.url());
    console.error("DIAGNOSTIC BODY", (await activePage.locator("body").innerText().catch(() => "")).slice(0, 1200));
    if (screenshot) await activePage.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}

const ok = results.every(Boolean);
console.log(ok ? "==== LHWIKI INTEGRATION PASS ====" : "==== LHWIKI INTEGRATION FAIL ====");
process.exit(ok ? 0 : 1);
