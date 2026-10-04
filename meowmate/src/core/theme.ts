export type Appearance = "light" | "dark";
export function resolveSharedTheme(value: unknown, systemDark: boolean): Appearance {
  if (value && typeof value === "object") {
    const theme = value as Record<string, unknown>;
    if (Object.keys(theme).length === 3 && theme.version === 1 &&
      (theme.resolved === "light" || theme.resolved === "dark")) {
      if (theme.source === "system") return systemDark ? "dark" : "light";
      if (theme.source === theme.resolved) return theme.resolved;
    }
  }
  return systemDark ? "dark" : "light";
}

export function createThemeSync(
  read: () => Promise<unknown>,
  media: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">,
  apply: (appearance: Appearance) => void,
) {
  let preference: unknown = null;
  let reading = false;
  let disposed = false;
  const update = () => { if (!disposed) apply(resolveSharedTheme(preference, media.matches)); };
  media.addEventListener("change", update);
  update();
  return {
    async refresh() {
      if (reading || disposed) return;
      reading = true;
      try { preference = await read(); } catch { preference = null; }
      finally { reading = false; update(); }
    },
    dispose() { disposed = true; media.removeEventListener("change", update); },
  };
}