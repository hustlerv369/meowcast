import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent, type ChatContext, type ChatDelta } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";
import { createProjectPicker } from "../components/project-picker";
import "../components/model-picker.css";
import { fileDrop } from "../core/file-drop";

let nextId = 1;
let activeChatSend = false;
export const chatIsSending = () => activeChatSend;

function bubble(message: ChatMessage): HTMLElement {
  return h("div", { class: "chat-row" + (message.role === "user" ? " user" : "") },
    h("div", { class: message.role === "user" ? "bubble" : "reply", text: message.content }));
}

function typingDots(): HTMLElement {
  return h("div", { class: "chat-row" }, h("div", { class: "typing" }, h("i"), h("i"), h("i")));
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const status = h("span", { class: "chat-connection", text: "Codex · subscription" });
  const fresh = h("button", { class: "chat-new", text: "New chat", title: "Clear this chat" });
  let modelSaving = false;
  let resetRequired = false;
  let pendingModel: string | null = null;
  let models: {id:string;label:string}[] = [];
  const model = createProjectPicker({label:"Chat model",className:"inline-model",placeholder:"Loading models…",onChange(value){
    model.value=State.settings.codexModel;
    if(sending || modelSaving || checking || resetRequired)return;
    if(value===State.settings.codexModel)return;
    if(State.chatHistory.length){pendingModel=value;confirmation.hidden=false;syncLocks();}
    else void changeModel(value);
  }});
  const confirmSwitch=h("button",{type:"button",text:"Switch model and start a new chat"});
  const keepModel=h("button",{type:"button",text:"Keep current"});
  const confirmation=h("div",{class:"model-confirm",hidden:true,role:"group","aria-label":"Changing model starts a new chat"},confirmSwitch,keepModel);
  confirmSwitch.addEventListener("click",()=>{if(pendingModel!==null)void changeModel(pendingModel);});
  keepModel.addEventListener("click",()=>{pendingModel=null;confirmation.hidden=true;syncLocks();});
  const toolbar = h("div", { class: "chat-toolbar" }, status, fresh);
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log", role: "log", "aria-label": "Chat with Codex" });
  const feedback = h("div", { class: "chat-feedback", role: "status" });
  const input = h("input", {
    type: "text", class: "chat-input", placeholder: "Ask Codex…",
    spellcheck: "true", "aria-label": "Message for Codex", maxlength: "8000",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send", "aria-label": "Send" }, svg(ICONS.arrowUp, 11));
  const stop = h("button", { class: "chat-stop", text: "Stop", hidden: "true" });
  const bar = h("div", { class: "chat-bar" }, input, send, stop);
  const el = h("div", { class: "view" }, h("div", { class: "card wash chat-card" },
    h("div", { class: "chat-body" }, toolbar, model.el, confirmation, chipRow, log, feedback, bar)));
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(52,211,153,0.24)");

  let sending = false;
  let activeRequest = "";
  let activeReply: ChatMessage | null = null;
  let renderedHistory: ChatMessage[] | null = null;
  let renderedCount = -1;
  let renderedText = "";
  let renderedSending = false;
  let generation = 0;
  let checking = false;

  const setError = (err: unknown) => { feedback.textContent = String(err).replace(/^Error:\s*/, ""); };

  function syncLocks() {
    const busy=sending || modelSaving || checking || fileDrop.busy;
    model.el.disabled=busy || resetRequired || pendingModel!==null || !models.length;
    send.disabled=busy || resetRequired || pendingModel!==null;
    fresh.disabled=busy || pendingModel!==null;
    confirmSwitch.disabled=modelSaving;
    keepModel.disabled=modelSaving;
  }
  async function changeModel(value:string) {
    if(modelSaving || sending || (value!=="" && !models.some(m=>m.id===value)))return;
    modelSaving=true;syncLocks();feedback.textContent="";
    try {
      await Bridge.saveSettings({...State.settings,codexModel:value});
      State.settings.codexModel=value;model.value=value;
      try { await Bridge.chatReset(); State.chatHistory=[]; resetRequired=false; }
      catch {resetRequired=true;feedback.textContent="Model saved, but the new chat could not start. Choose New chat before sending.";}
    } catch(err) {model.value=State.settings.codexModel;setError(err);}
    finally {modelSaving=false;pendingModel=null;confirmation.hidden=true;syncLocks();State.notify();onHeightChange();if(!resetRequired)void connection();}
  }
  async function connection() {
    if (checking || sending || modelSaving) return;
    checking = true;syncLocks();
    try {
      const info = await Bridge.chatStatus();
      models=info.models ?? [];
      model.setOptions([{value:"",label:"Follow Codex default"},...models.map(m=>({value:m.id,label:m.label})),...(State.settings.codexModel && !models.some(m=>m.id===State.settings.codexModel) ? [{value:State.settings.codexModel,label:`Unavailable: ${State.settings.codexModel}`,disabled:true}] : [])]);
      model.value=State.settings.codexModel;
      status.textContent = info.connected ? "Codex · " + info.model : "Codex sign-in required";
      status.title = info.message;
      if (!info.connected) feedback.textContent = info.message;
    } catch (err) {
      status.textContent = "Codex sign-in required";
      setError(err);
    } finally { checking = false;syncLocks(); }
  }

  void onEvent<ChatDelta>("chat-delta", delta => {
    if (delta.requestId !== activeRequest || !activeReply || !State.chatHistory.includes(activeReply)) return;
    activeReply.content = delta.text;
    State.notify();
  });

  void onEvent<null>("chat-reset", () => {
    generation++;
    activeRequest = "";
    activeReply = null;
    State.chatHistory = [];
    State.stateOverride = null;
    feedback.textContent = "";
    State.notify();
    onHeightChange();
  });

  async function submit() {
    const query = input.value.trim();
    if (!query || sending || modelSaving || checking || resetRequired || pendingModel!==null || fileDrop.busy) return;
    const currentGeneration = generation;
    const file = State.droppedFile;
    const context: ChatContext | null = file
      ? { kind: "file", name: file.name, path: file.path } : null;
    input.value = "";
    feedback.textContent = "";
    sending = true;
    activeChatSend = true;
    activeRequest = "typek-" + Date.now() + "-" + nextId;
    const requestId = activeRequest;
    State.chatHistory.push({ id: nextId++, role: "user", content: query + (file ? `\nAttachment: ${file.name}` : "") });
    const reply: ChatMessage = { id: nextId++, role: "assistant", content: "" };
    activeReply = reply;
    State.chatHistory.push(reply);
    State.stateOverride = "thinking";
    Sound.play("send");
    State.notify();
    onHeightChange();
    try {
      const result = await Bridge.chatSend(query, context, requestId);
      if (generation === currentGeneration && State.chatHistory.includes(reply)) {
        reply.content = result.text;
        if (file && State.droppedFile?.path === file.path) {
          State.droppedFile = null;
          State.promptContext = null;
        }
        Sound.play("finish");
      }
    } catch (err) {
      if (generation === currentGeneration && State.chatHistory.includes(reply)) {
        // Keep partial output visible without claiming successful completion.
        if (!reply.content) State.chatHistory = State.chatHistory.filter(m => m !== reply);
        setError(err);
      }
    } finally {
      activeRequest = "";
      activeReply = null;
      sending = false;
      activeChatSend = false;
      stop.disabled = false;
      State.stateOverride = null;
      State.notify();
      onHeightChange();
      if (State.view === "prompt") input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  stop.addEventListener("click", async () => {
    stop.disabled = true;
    const cancelled = await Bridge.chatCancel();
    if (!cancelled) stop.disabled = false;
  });
  fresh.addEventListener("click", async () => {
    if (sending || modelSaving || fileDrop.busy) return;
    fresh.disabled = true;
    try {
      await Bridge.chatReset();
      resetRequired=false;State.chatHistory=[];feedback.textContent="";
      State.droppedFile = null;
      State.promptContext = null;
      State.notify();
      void connection();
    } catch (err) { setError(err); }
    finally { fresh.disabled = false; }
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
    if (event.key !== "Escape") event.stopPropagation();
  });

  return {
    el,
    sync() {
      const label = State.droppedFile?.name ?? "";
      const attachmentKey = State.droppedFile?.path ?? "";
      if (chipRow.dataset.attachment !== attachmentKey) {
        chipRow.dataset.attachment = attachmentKey;
        clear(chipRow);
        if (label) {
          const remove = h("button", { type: "button", class: "chat-new", text: "×", title: "Remove attachment", "aria-label": `Remove attachment ${label}` });
          remove.addEventListener("click", () => {
            if (sending || fileDrop.busy) return;
            State.droppedFile = null;
            State.promptContext = null;
            State.notify();
          });
          chipRow.append(h("div", { class: "chip settled" }, h("i", { class: "chip-dot" }), h("span", { text: label }), remove));
        }
      }
      chipRow.querySelectorAll("button").forEach(button => { button.disabled = sending || fileDrop.busy; });
      const text = State.chatHistory.at(-1)?.content ?? "";
      if (State.chatHistory !== renderedHistory || State.chatHistory.length !== renderedCount || text !== renderedText || sending !== renderedSending) {
        renderedHistory = State.chatHistory;
        renderedCount = State.chatHistory.length;
        renderedText = text;
        renderedSending = sending;
        clear(log);
        for (const message of State.chatHistory) if (message.content) log.append(bubble(message));
        if (sending && !activeReply?.content) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }
      input.placeholder = State.chatHistory.length ? "Continue the conversation…" : "Ask Codex…";
      input.disabled = sending || fileDrop.busy;
      send.disabled = fileDrop.busy;
      send.hidden = sending;
      stop.hidden = !sending;
      fresh.disabled = sending || fileDrop.busy;
      syncLocks();
    },
    focus() {
      input.focus();
      void connection();
    },
  };
}
