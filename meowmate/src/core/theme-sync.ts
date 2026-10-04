import { Bridge, IS_TAURI } from "./bridge";
import { createThemeSync } from "./theme";

const sync = createThemeSync(
  () => IS_TAURI ? Bridge.sharedTheme() : Promise.resolve(null),
  matchMedia("(prefers-color-scheme: dark)"),
  appearance => { document.documentElement.dataset.theme = appearance; },
);
void sync.refresh();
const timer = IS_TAURI ? setInterval(() => { void sync.refresh(); }, 1000) : undefined;
const refresh = () => { if (!document.hidden) void sync.refresh(); };
document.addEventListener("visibilitychange", refresh);
window.addEventListener("beforeunload", () => {
  clearInterval(timer);
  sync.dispose();
  document.removeEventListener("visibilitychange", refresh);
}, { once: true });