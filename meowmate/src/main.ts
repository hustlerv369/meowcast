// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent, type DragDropPayload } from "./core/bridge";
import type { DockEdge } from "./core/popup-preview";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { registerActivityHandlers, syncActivities } from "./island/activity";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  const island = new Island(root);

  /** Pause has to reach Rust too, or the pollers keep calling out. */
  const setPaused = (on: boolean) => {
    if (State.paused === on) return;
    State.paused = on;
    void Bridge.setPaused(on);
  };

  // Register before boot: a hover can arrive as soon as the WebView exists.
  let dockEventSeen = false;
  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        setPaused(false);
        island.alert("settings");
        break;
      case "open":
        dockEventSeen = true;
        setPaused(false);
        island.open();
        break;
      case "hover":
        dockEventSeen = true;
        setPaused(false);
        island.open(true);
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
    }
  });

  await onEvent<null>("dock-closed", () => {
    dockEventSeen = true;
    island.closeToTaskbar();
  });
  await onEvent<{ edge: DockEdge }>("dock-placement", ({ edge }) => island.setDockEdge(edge));
  await onEvent<DragDropPayload>("dock-drop", event => island.onDragDrop(event));

  const boot = await Bridge.boot();
  if (boot) State.settings = { ...State.settings, ...boot.settings };
  island.applySettings();
  State.loadIntegrationTasks();
  // Events received during the request take precedence over its snapshot.
  if (boot && !dockEventSeen && !boot.collapsed) island.open();

  await onEvent<{ x: number; y: number; dock?: boolean }>("cursor", ({ x, y, dock }) => island.onCursor(x, y, dock));
  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    State.settings = { ...State.settings, ...s };
    island.applySettings();
    State.loadIntegrationTasks();
    void refreshConfigured();
    syncActivities(island);
  });

  registerHookHandlers(island);
  await registerActivityHandlers(island);
  registerIntegrationHandlers(island);

  island.launch();
  await Bridge.dockReady();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
