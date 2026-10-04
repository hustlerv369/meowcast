import { h } from "./dom";
import { Bridge, IS_TAURI, type GeminiBrowserResult, type GeminiBrowserReference } from "../core/bridge";
import { invoke } from "@tauri-apps/api/core";
import type { ViewHost } from "./views";
import "./images.css";
import { IMAGE_PROMPT_LIMIT, ImageReferencePreview, improveImagePrompt } from "../core/image-prompt";
export { IMAGE_PROMPT_LIMIT } from "../core/image-prompt";

export const GEMINI_IMAGES_URL = "https://gemini.google.com/app";

export interface ImagesActions {
  copy(text: string): Promise<void>;
  open(): Promise<void>;
  connect?(): Promise<GeminiBrowserResult>;
  cancel?(): Promise<boolean>;
  generate?(prompt: string, reference?: GeminiBrowserReference): Promise<GeminiBrowserResult>;
}

const defaultActions: ImagesActions = {
  connect: () => Bridge.geminiBrowserOpen(),
  cancel: () => Bridge.geminiBrowserCancel(),
  generate: (prompt, reference) => Bridge.geminiBrowserGenerate(prompt, reference),
  copy: async (text) => {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
  },
  open: async () => {
    if (!IS_TAURI) throw new Error("Open Gemini from the desktop application");
    await invoke<void>("open_gemini");
  },
};

/** Browser actions run only after an explicit click; no automatic login retries. */
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
  const connect = h("button", { class: "images-button", type: "button", text: "Connect browser" });
  const generate = h("button", { class: "images-button images-generate", type: "button", text: "Send prompt to Gemini", disabled: true });
  const cancel = h("button", { class: "images-button", type: "button", text: "Cancel browser action", disabled: true, hidden: true });
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
    h("p", { class: "images-help", text: "Experimental browser assistance. Connect opens a separate browser profile. Sign in there yourself, then send your prompt and reference." }),
    input,
    h("div", { class: "images-options" }, styleLabel, aspectLabel),
    h("div", { class: "images-actions" }, improve, restore),
    h("p", { class: "images-help", text: "Style and framing apply when you choose Improve prompt. Review the wording before sending." }),
    attach, preview,
    h("p", { class: "images-help", text: "References stay local until you choose Send prompt. Select Gemini’s image tool and download any result in the browser yourself. Meowmate does not save a generated image." }),
    h("div", { class: "images-actions" }, connect, generate, cancel),
    h("p", { class: "images-help", text: "Prefer to do it yourself? Copy the prompt, open Gemini and attach the reference there." }),
    h("div", { class: "images-actions" }, copy, open),
    feedback,
  ));
  let copying = false;
  let busy = false;
  let browserOpened = false;
  let browserAction = false;
  let cancelling = false;
  let cancelRequested = false;
  let preparing = false;
  let selectedFile: File | null = null;
  let original: string | null = null;
  let lastGenerated: string | null = null;
  let lastBase: string | null = null;
  const update = () => {
    const locked = busy || preparing || cancelling;
    const invalid = !input.value.trim() || input.value.length > IMAGE_PROMPT_LIMIT;
    copy.disabled = locked || copying || invalid;
    improve.disabled = locked || invalid;
    restore.disabled = locked || original === null;
    connect.disabled = locked || !actions.connect;
    generate.disabled = locked || copying || invalid || !browserOpened || !actions.generate;
    cancel.hidden = !browserAction;
    cancel.disabled = !browserAction || cancelling || !actions.cancel;
    for (const control of [input, style, aspect, file, remove, open]) control.disabled = locked;
    el.setAttribute("aria-busy", String(locked));
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
    if (restore.disabled || original === null) return;
    input.value = original; original = null; lastGenerated = null; lastBase = null;
    feedback.textContent = "Original idea restored."; update();
  });
  const clearReference = () => {
    reference.clear(); selectedFile = null; thumbnail.removeAttribute("src"); preview.hidden = true; name.textContent = ""; file.value = "";
  };
  remove.addEventListener("click", () => { if (remove.disabled) return; clearReference(); feedback.textContent = "Reference removed. Review any reference instructions in your prompt."; });
  thumbnail.addEventListener("error", () => { clearReference(); feedback.textContent = "This image could not be previewed. Choose another PNG, JPEG or WebP."; });
  file.addEventListener("change", async () => {
    if (busy || preparing) return;
    const selected = file.files?.[0];
    if (!selected) return;
    preparing = true; update();
    try {
      if (!await reference.set(selected)) return;
      selectedFile = selected;
      thumbnail.src = reference.url; name.textContent = selected.name; preview.hidden = false;
      feedback.textContent = actions.generate ? "Local preview ready. Generate will send this reference to Gemini." : "Local preview ready. Attach this file in Gemini yourself.";
    } catch { feedback.textContent = "Choose a valid PNG, JPEG or WebP image up to 10 MB."; }
    finally { file.value = ""; preparing = false; update(); }
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
    if (open.disabled || busy) return;
    busy = true; update();
    try {
      await actions.open();
      feedback.textContent = "Continue in your browser. Sign in to Google there if needed.";
    } catch {
      feedback.textContent = "Open gemini.google.com in your browser to continue.";
    } finally { busy = false; update(); }
  });
  const browserResult = (result: GeminiBrowserResult, sending: boolean) => {
    if (result.status === "cancelled") return "Browser action cancelled. Check Gemini before trying again. A request already sent cannot be recalled.";
    if (result.status === "needs_sign_in") return "Sign in to Google in the separate browser, then choose Send prompt again. Nothing is sent automatically.";
    if (result.status === "not_ready") return "Open Gemini and finish any sign-in or consent in the separate browser, then connect again.";
    if (result.status === "retry_blocked") return "The previous Send result is unknown. Check Gemini manually. Another send is blocked to avoid duplicates.";
    if (sending && result.status === "send_clicked") return "Send clicked in Gemini. Check the browser for acceptance and the result.";
    if (!sending && (result.status === "opened" || result.status === "ready")) return "Browser opened. Sign in there if needed, then choose Send prompt. Nothing has been sent.";
    return "The browser action could not be confirmed. Gemini may already hold a draft or attachment. Check it before trying again. Your local draft is unchanged.";
  };
  connect.addEventListener("click", async () => {
    if (connect.disabled || busy || !actions.connect) return;
    busy = true; browserAction = true; cancelRequested = false; update(); feedback.textContent = "Opening the separate Gemini browser…";
    try {
      const result = await actions.connect();
      browserOpened = ["opened", "ready", "needs_sign_in"].includes(result.status);
      feedback.textContent = browserResult(result, false);
    }
    catch { feedback.textContent = "Could not connect the browser. Your prompt and reference are unchanged."; }
    finally { busy = false; browserAction = false; update(); }
  });
  generate.addEventListener("click", async () => {
    if (generate.disabled || busy || !actions.generate) return;
    const prompt = input.value;
    const attachment = selectedFile;
    busy = true; browserAction = true; cancelRequested = false; update(); feedback.textContent = "Sending to Gemini…";
    try {
      const payload = attachment ? { name: attachment.name, mime: attachment.type, bytes: Array.from(new Uint8Array(await attachment.arrayBuffer())) } : undefined;
      if (cancelRequested) { feedback.textContent = "Cancelled before sending. Your prompt and reference are unchanged."; return; }
      feedback.textContent = browserResult(await actions.generate(prompt, payload), true);
    } catch { feedback.textContent = "The request could not be confirmed. Gemini may already hold a draft or attachment. Check it before trying again. Your local draft is unchanged."; }
    finally { busy = false; browserAction = false; update(); }
  });
  cancel.addEventListener("click", async () => {
    if (cancel.disabled || !actions.cancel) return;
    cancelRequested = true; cancelling = true; update();
    feedback.textContent = "Cancellation requested. Check Gemini before trying again.";
    try { await actions.cancel(); }
    catch { if (busy) feedback.textContent = "Cancellation could not be confirmed. Check Gemini before trying again."; }
    finally { cancelling = false; update(); }
  });
  update();
  return { el, sync: update, focus: () => input.focus() };
}
