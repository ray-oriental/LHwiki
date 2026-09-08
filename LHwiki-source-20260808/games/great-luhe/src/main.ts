import "./styles.css";
import { GreatLuheGame } from "./game/Game";
import type { GameTheme } from "./game/Renderer";

type ThemePreference = GameTheme | "system";

function preferenceFromQuery(): ThemePreference {
  const value = new URLSearchParams(window.location.search).get("theme");
  return value === "dark" || value === "light" || value === "system" ? value : "system";
}

function effectiveTheme(preference: ThemePreference): GameTheme {
  return preference === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
}

function bootstrap(): void {
  const container = document.getElementById("great-luhe");
  if (!container) return;
  let preference = preferenceFromQuery();
  const game = new GreatLuheGame(container, {
    assetBase: container.dataset.assetBase ?? "",
    theme: effectiveTheme(preference)
  });
  game.mount();
  const syncTheme = (theme: ThemePreference): void => game.setTheme(effectiveTheme(theme));
  const onThemeMessage = (event: MessageEvent): void => {
    if (event.origin !== window.location.origin) return;
    if (window.parent !== window && event.source !== window.parent) return;
    const data = event.data as { type?: unknown; theme?: unknown; detail?: { effective?: unknown } } | null;
    if (data?.type !== "lhwiki-theme-change") return;
    const theme = data.theme ?? data.detail?.effective;
    if (theme === "dark" || theme === "light" || theme === "system") {
      preference = theme;
      syncTheme(theme);
    }
  };
  window.addEventListener("message", onThemeMessage);
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onSystemThemeChange = (): void => { if (preference === "system") syncTheme("system"); };
  media?.addEventListener?.("change", onSystemThemeChange);
  const destroy = game.destroy.bind(game);
  game.destroy = (): void => {
    window.removeEventListener("message", onThemeMessage);
    media?.removeEventListener?.("change", onSystemThemeChange);
    destroy();
  };
  // 供 LHwiki 嵌入时手动控制生命周期
  (window as unknown as { GreatLuheGame?: unknown }).GreatLuheGame = GreatLuheGame;
  (window as unknown as { __greatLuheInstance?: unknown }).__greatLuheInstance = game;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
