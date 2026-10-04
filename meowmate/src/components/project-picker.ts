export interface ProjectPickerOption {
  value: string;
  label: string;
  detail?: string;
  color?: string;
  disabled?: boolean;
}

interface PickerConfig {
  label: string;
  placeholder?: string;
  className?: string;
  options?: ProjectPickerOption[];
  onChange(value: string): void;
}

let sequence = 0;
let activePicker: { el: HTMLButtonElement; close(restoreFocus?: boolean): void } | null = null;

export function closeProjectPickers() { activePicker?.close(false); }
export function isProjectPickerOpen(): boolean {
  if (activePicker && (!activePicker.el.isConnected || !activePicker.el.getClientRects().length)) closeProjectPickers();
  return activePicker !== null;
}

/** Search both the readable name and its disambiguating path/provider. */
export function filterProjectOptions(options: readonly ProjectPickerOption[], query: string): ProjectPickerOption[] {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("cs");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return options.filter(option => terms.every(term => normalize(`${option.label} ${option.detail ?? ""}`).includes(term)));
}

/** Keep the portal inside the small native WebView, including on upward opening. */
export function projectPickerBounds(anchor: { left: number; top: number; bottom: number; width: number }, viewport: { width: number; height: number }, desiredHeight: number) {
  const margin = 8, gap = 5;
  const width = Math.min(Math.max(anchor.width, 270), Math.max(0, viewport.width - margin * 2));
  const below = Math.max(0, viewport.height - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - margin);
  const upward = below < Math.min(desiredHeight, 150) && above > below;
  const height = Math.min(desiredHeight, upward ? above : below);
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - margin - width)),
    top: upward ? anchor.top - gap - height : anchor.bottom + gap,
    width, height,
  };
}

export function createProjectPicker(config: PickerConfig) {
  const id = `project-picker-${++sequence}`;
  const el = document.createElement("button");
  el.type = "button";
  el.className = `project-picker ${config.className ?? ""}`;
  el.setAttribute("aria-label", config.label);
  el.setAttribute("aria-haspopup", "listbox");
  el.setAttribute("aria-expanded", "false");
  el.setAttribute("aria-controls", `${id}-list`);
  const marker = document.createElement("span");
  marker.className = "project-picker-dot";
  marker.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "project-picker-label";
  const arrow = document.createElement("span");
  arrow.className = "project-picker-arrow";
  arrow.setAttribute("aria-hidden", "true");
  el.append(marker, label, arrow);

  let options: ProjectPickerOption[] = [];
  let value = "";
  let filtered: ProjectPickerOption[] = [];
  let highlighted = -1;
  let popup: HTMLDivElement | null = null;
  let list: HTMLDivElement | null = null;
  let search: HTMLInputElement | null = null;
  let observer: MutationObserver | null = null;

  function updateLabel() {
    const option = options.find(item => item.value === value);
    label.textContent = option?.label ?? config.placeholder ?? config.label;
    marker.hidden = !option?.color;
    marker.style.backgroundColor = option?.color ?? "";
    el.title = option?.detail ? `${option.label}\n${option.detail}` : label.textContent;
    el.setAttribute("aria-label", `${config.label}: ${label.textContent}`);
  }

  function close(restoreFocus = true) {
    if (!popup) return;
    popup.remove(); popup = null; list = null; search = null;
    observer?.disconnect(); observer = null;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("focusin", focusOutside, true);
    window.removeEventListener("resize", position);
    document.removeEventListener("scroll", onScroll, true);
    el.setAttribute("aria-expanded", "false");
    if (activePicker?.el === el) activePicker = null;
    window.dispatchEvent(new CustomEvent("project-picker-change", { detail: { open: isProjectPickerOpen() } }));
    if (restoreFocus && el.isConnected) el.focus({ preventScroll: true });
  }

  function outside(event: PointerEvent) {
    if (!popup?.contains(event.target as Node) && !el.contains(event.target as Node)) close(false);
  }

  function focusOutside(event: FocusEvent) {
    if (!popup?.contains(event.target as Node) && !el.contains(event.target as Node)) close(false);
  }

  function onScroll(event: Event) {
    if (!popup?.contains(event.target as Node)) position();
  }

  function position() {
    if (!popup) return;
    if (!el.isConnected || !el.getClientRects().length) { close(false); return; }
    const bounds = projectPickerBounds(el.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, Math.min(264, (search ? 46 : 0) + Math.max(1, filtered.length) * 45 + 12));
    Object.assign(popup.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  }

  function focusOption(index: number, scroll = true) {
    highlighted = index;
    if (!list) return;
    for (let i = 0; i < list.children.length; i++) (list.children[i] as HTMLElement).classList.toggle("is-active", i === highlighted);
    const option = highlighted >= 0 ? list.children[highlighted] as HTMLElement | undefined : undefined;
    const focusHost = search ?? list;
    if (option) focusHost.setAttribute("aria-activedescendant", option.id);
    else focusHost.removeAttribute("aria-activedescendant");
    if (scroll) option?.scrollIntoView({ block: "nearest" });
  }

  function choose(index: number) {
    const option = filtered[index];
    if (!option || option.disabled) return;
    value = option.value; updateLabel(); close(); config.onChange(value);
  }

  function renderOptions() {
    if (!list) return;
    const previous = filtered[highlighted]?.value;
    filtered = filterProjectOptions(options, search?.value ?? "");
    list.replaceChildren();
    filtered.forEach((option, index) => {
      const row = document.createElement("div");
      row.id = `${id}-option-${index}`;
      row.className = "project-picker-option";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(option.value === value));
      if (option.disabled) row.setAttribute("aria-disabled", "true");
      const color = document.createElement("span");
      color.className = "project-picker-dot";
      color.setAttribute("aria-hidden", "true");
      color.style.backgroundColor = option.color ?? "transparent";
      const copy = document.createElement("span");
      copy.className = "project-picker-copy";
      const name = document.createElement("span"); name.className = "project-picker-name"; name.textContent = option.label;
      copy.append(name);
      if (option.detail) { const detail = document.createElement("span"); detail.className = "project-picker-detail"; detail.textContent = option.detail; copy.append(detail); }
      const check = document.createElement("span"); check.className = "project-picker-check"; check.textContent = option.value === value ? "✓" : ""; check.setAttribute("aria-hidden", "true");
      row.title = option.detail ? `${option.label}\n${option.detail}` : option.label;
      row.append(color, copy, check);
      row.addEventListener("pointermove", () => { if (!option.disabled) focusOption(index, false); });
      row.addEventListener("pointerdown", event => event.preventDefault());
      row.addEventListener("click", () => choose(index));
      list!.append(row);
    });
    if (!filtered.length) {
      const empty = document.createElement("div"); empty.className = "project-picker-empty"; empty.textContent = "No matches. Try another name or path."; empty.setAttribute("role", "status"); list.append(empty);
    }
    let next = filtered.findIndex(option => !option.disabled && option.value === previous);
    if (next < 0) next = filtered.findIndex(option => !option.disabled && option.value === value);
    if (next < 0) next = filtered.findIndex(option => !option.disabled);
    focusOption(next, false); position();
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { close(false); el.focus({ preventScroll: true }); return; }
    if (event.key === "Enter" || (event.key === " " && !search)) { event.preventDefault(); event.stopPropagation(); choose(highlighted); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    // Home/End retain their ordinary editing meaning in the search field.
    if (search?.value && (event.key === "Home" || event.key === "End") && !event.ctrlKey) return;
    event.preventDefault(); event.stopPropagation();
    const enabled = filtered.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
    if (!enabled.length) return;
    const current = enabled.indexOf(highlighted);
    const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : event.key === "ArrowDown" ? Math.min(enabled.length - 1, current + 1) : Math.max(0, current - 1);
    focusOption(enabled[next]);
  }

  function open() {
    if (popup || el.disabled) return;
    closeProjectPickers();
    filtered = []; highlighted = -1;
    popup = document.createElement("div"); popup.className = "project-picker-popover";
    // The body portal avoids clipping by the island's animated card wrappers.
    popup.dataset.projectPicker = "";
    list = document.createElement("div"); list.className = "project-picker-list"; list.id = `${id}-list`;
    list.setAttribute("role", "listbox"); list.setAttribute("aria-label", config.label); list.tabIndex = -1;
    if (options.length > 6) {
      search = document.createElement("input"); search.className = "project-picker-search"; search.type = "text"; search.placeholder = "Search projects or sessions…"; search.autocomplete = "off";
      search.setAttribute("aria-label", `Hledat: ${config.label}`); search.setAttribute("role", "combobox"); search.setAttribute("aria-expanded", "true"); search.setAttribute("aria-controls", list.id); search.setAttribute("aria-autocomplete", "list");
      search.addEventListener("input", renderOptions); popup.append(search);
    }
    popup.append(list); popup.addEventListener("keydown", keydown);
    document.body.append(popup); activePicker = { el, close }; el.setAttribute("aria-expanded", "true");
    window.dispatchEvent(new CustomEvent("project-picker-change", { detail: { open: isProjectPickerOpen() } }));
    renderOptions();
    (search ?? list).focus({ preventScroll: true });
    focusOption(highlighted);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", focusOutside, true);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", onScroll, true);
    observer = new MutationObserver(() => { if (!el.isConnected) close(false); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  el.addEventListener("click", () => popup ? close() : open());
  el.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); open();
      if (event.key === "ArrowUp") { let last = filtered.length - 1; while (last >= 0 && filtered[last].disabled) last--; focusOption(last); }
    }
  });

  function setOptions(next: ProjectPickerOption[]) {
    if (next.length === options.length && next.every((option, index) => {
      const previous = options[index];
      return option.value === previous.value && option.label === previous.label && option.detail === previous.detail && option.color === previous.color && option.disabled === previous.disabled;
    })) return;
    options = next.map(option => ({ ...option }));
    if (!options.some(option => option.value === value)) value = options.find(option => !option.disabled)?.value ?? "";
    updateLabel(); if (popup) renderOptions();
  }
  setOptions(config.options ?? []);
  updateLabel();
  return {
    el, close, setOptions,
    get value() { return value; },
    set value(next: string) {
      const selected = options.some(option => option.value === next) ? next : "";
      if (selected === value) return;
      value = selected; updateLabel(); if (popup) renderOptions();
    },
  };
}
