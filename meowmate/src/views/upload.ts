// Drop zone, upload progress and the "what do you want to do with it" card —
// ports of UploadView / UploadingView / ChooseView from IslandViewContent.swift.
//
// Sending a file by email is not in the Windows v1, so `choose` offers the one
// action the spec asks for: ask a question about it.

import { h, clear } from "./dom";
import { State } from "../core/state";
import type { ViewActions, ViewHost } from "./views";
import { fileDrop } from "../core/file-drop";

/** Dashed rounded rect drawn as SVG so the dashes can march like on macOS. */
function dashedFrame(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("class", "drop-frame");
  el.setAttribute("preserveAspectRatio", "none");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "0.75");
  rect.setAttribute("y", "0.75");
  rect.setAttribute("width", "calc(100% - 1.5px)");
  rect.setAttribute("height", "calc(100% - 1.5px)");
  rect.setAttribute("rx", "20");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke-width", "1.5");
  rect.setAttribute("stroke-dasharray", "6 5");
  el.append(rect);
  return el;
}

export function buildUpload(): ViewHost {
  const frame = dashedFrame();
  const title = h("div", { class: "drop-title", text: "Drop one file here" });
  const tags = h(
    "div",
    { class: "drop-tags" },
    ...["Text UTF-8 · 200 kB", "PNG / JPEG / WebP · 10 MB"].map((t) => h("span", { text: t })),
  );
  const card = h(
    "div",
    { class: "card drop-card" },
    frame,
    h("div", { class: "drop-body" }, title, tags),
  );
  const el = h("div", { class: "view attachment-view" }, card);

  return {
    el,
    sync() {
      card.classList.toggle("over", State.fileDragOver);
    },
  };
}

export function buildUploading(): ViewHost {
  const label = h("span", { class: "up-name", style: "display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" });
  const card = h(
    "div",
    { class: "card", role: "status", "aria-live": "polite" },
    h("div", { class: "stack", style: "padding:0 22px 0 98px;min-width:0" },
      h("div", { class: "title", text: "Preparing attachment…" }), label,
      h("div", { class: "sub", text: "Once ready, ask a question about the file." })),
  );
  const el = h("div", { class: "view attachment-view" }, card);

  return {
    el,
    sync() {
      label.textContent = fileDrop.pendingName || "File";
      label.title = label.textContent;
    },
  };
}

export function buildChoose(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub", text: "What would you like to do with this file?" });
  const row = h(
    "div",
    { class: "actions" },
    h("button", {
      class: "btn primary",
      text: "Open in chat",
      onclick: () => actions.setView("prompt"),
    }),
    h("button", {
      class: "btn secondary",
      text: "Back",
      onclick: () => actions.setView(State.defaultView()),
    }),
  );
  const el = h(
    "div",
    { class: "view attachment-view" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title, sub, row),
    ),
  );

  return {
    el,
    sync() {
      clear(title);
      title.append(
        h("b", { text: State.droppedFile?.name ?? "File" }),
        document.createTextNode(" is ready."),
      );
    },
  };
}
