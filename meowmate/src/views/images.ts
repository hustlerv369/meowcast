import { h } from "./dom";
import { IS_TAURI } from "../core/bridge";
import { invoke } from "@tauri-apps/api/core";
import type { ViewHost } from "./views";
import "./images.css";
import { IMAGE_PROMPT_LIMIT, ImageReferencePreview, improveImagePrompt } from "../core/image-prompt";
export { IMAGE_PROMPT_LIMIT } from "../core/image-prompt";

export const GEMINI_IMAGES_URL = "https://gemini.google.com/app";

export interface ImagesActions {
  copy(text: string): Promise<void>;
  open(): Promise<void>;
}

const defaultActions: ImagesActions = {
  copy: async (text) => {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
  },
  open: async () => {
    if (!IS_TAURI) throw new Error("Open Gemini from the desktop application");
    await invoke<void>("open_gemini");
  },
};

/** Browser handoff only. No account probing, prompt submission or generation. */
export function buildImages(actions: ImagesActions = defaultActions): ViewHost {
  const input = h("textarea", {
    class: "images-prompt", rows: "3", maxlength: String(IMAGE_PROMPT_LIMIT),
    placeholder: "Describe your image…", "aria-label": "Image prompt", spellcheck: "true",
  });
  const feedback = h("div", { class: "images-feedback", role: "status", "aria-live": "polite" });
  const copy = h("button", { class: "images-button", type: "button", text: "Copy prompt", disabled: true });
  const open = h("button", { class: "images-button images-open", type: "button", text: "Open in Gemini" });
  const improve = h("button", { class: "images-button", type: "button", text: "Improve prompt", disabled: true });
  const restore = h("button", { class: "images-button", type: "button", text: "Restore original", disabled: true });
  const select = (label: string, options: string[]) => h("label", { class: "images-option" },
    h("span", { text: label }), h("select", { "aria-label": label }, ...options.map(value => h("option", { value, text: value }))));
  const styleLabel = select("Style", ["Keep my style", "Photographic", "Illustration", "Product photography", "Minimal graphic"]);
  const aspectLabel = select("Framing", ["Auto", "1:1", "16:9", "9:16", "4:3"]);
  const style = styleLabel.querySelector("select")!;
  const aspect = aspectLabel.querySelector("select")!;
  const reference = new ImageReferencePreview();
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "images-file", "aria-label": "Reference image" });
  const thumbnail = h("img", { class: "images-thumbnail", alt: "Local reference preview" });
  const name = h("span", { class: "images-reference-name" });
  const remove = h("button", { class: "images-button", type: "button", text: "Remove reference" });
  const preview = h("div", { class: "images-reference", hidden: true }, thumbnail, name, remove);
  const attach = h("label", { class: "images-attach" }, h("span", { text: "Reference image · PNG, JPEG or WebP · up to 10 MB" }), file);
  const el = h("div", { class: "view" }, h("section", { class: "card images-card", "aria-label": "Images" },
    h("div", { class: "images-heading" }, h("strong", { text: "Images" }), h("span", { text: "Gemini web" })),
    h("p", { class: "images-help", text: "Copy your prompt, then generate and download in Gemini using your own Google account." }),
    input,
    h("div", { class: "images-options" }, styleLabel, aspectLabel),
    h("div", { class: "images-actions" }, improve, restore),
    h("p", { class: "images-help", text: "Prompt Master structures your idea offline. Review and edit it before copying." }),
    attach, preview,
    h("p", { class: "images-help", text: "References stay on this device. Attach the same file in Gemini; opening Gemini does not upload it." }),
    h("div", { class: "images-actions" }, copy, open),
    feedback,
  ));
  let copying = false;
  let original: string | null = null;
  let lastGenerated: string | null = null;
  let lastBase: string | null = null;
  const update = () => {
    copy.disabled = copying || !input.value.trim() || input.value.length > IMAGE_PROMPT_LIMIT;
    improve.disabled = !input.value.trim() || input.value.length > IMAGE_PROMPT_LIMIT;
    restore.disabled = original === null;
  };
  improve.addEventListener("click", () => {
    if (improve.disabled) return;
    try {
      const base = input.value === lastGenerated ? lastBase ?? input.value : input.value;
      const next = improveImagePrompt(base, style.value, aspect.value, !!reference.url);
      if (original === null) original = input.value;
      input.value = next;
      lastGenerated = next;
      lastBase = base;
      feedback.textContent = "Prompt structured offline. Review the wording before copying.";
    } catch { feedback.textContent = "Shorten your idea to leave room for the prompt structure."; }
    update();
  });
  restore.addEventListener("click", () => {
    if (original === null) return;
    input.value = original; original = null; lastGenerated = null; lastBase = null;
    feedback.textContent = "Original idea restored."; update();
  });
  const clearReference = () => {
    reference.clear(); thumbnail.removeAttribute("src"); preview.hidden = true; name.textContent = ""; file.value = "";
  };
  remove.addEventListener("click", () => { clearReference(); feedback.textContent = "Reference removed. Review any reference instructions in your prompt."; });
  thumbnail.addEventListener("error", () => { clearReference(); feedback.textContent = "This image could not be previewed. Choose another PNG, JPEG or WebP."; });
  file.addEventListener("change", async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      if (!await reference.set(selected)) return;
      thumbnail.src = reference.url; name.textContent = selected.name; preview.hidden = false;
      feedback.textContent = "Local preview ready. Attach this file in Gemini yourself.";
    } catch { feedback.textContent = "Choose a valid PNG, JPEG or WebP image up to 10 MB."; }
    finally { file.value = ""; }
  });
  window.addEventListener("pagehide", clearReference);
  input.addEventListener("input", () => { feedback.textContent = ""; update(); });
  copy.addEventListener("click", async () => {
    if (copy.disabled) return;
    const prompt = input.value.trim();
    if (!prompt || prompt.length > IMAGE_PROMPT_LIMIT) return;
    copying = true;
    update();
    try {
      await actions.copy(prompt);
      feedback.textContent = "Prompt copied. Paste it into Gemini.";
    } catch {
      feedback.textContent = "Could not copy. Select the prompt and press Ctrl+C.";
      input.focus();
      input.select();
    } finally {
      copying = false;
      update();
    }
  });
  open.addEventListener("click", async () => {
    open.disabled = true;
    try {
      await actions.open();
      feedback.textContent = "Continue in your browser. Sign in to Google there if needed.";
    } catch {
      feedback.textContent = "Open gemini.google.com in your browser to continue.";
    } finally { open.disabled = false; }
  });
  return { el, sync: update, focus: () => input.focus() };
}
