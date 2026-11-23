// The captured homepage leaderboard's scope markup/classes and animations,
// with local options only. A body-level menu avoids clipping inside panels.
let sequence = 0;
let activeClose;
const node = (tag, cls, text) => {
  const value = document.createElement(tag);
  if (cls) value.className = cls;
  if (text != null) value.textContent = text;
  return value;
};
export function createScopeDropdown({label, value = "", options = [], onChange = () => {}}) {
  let entries = options, selected = options.some(entry=>entry.value===value&&!entry.disabled) ? value :
    options.find(entry=>!entry.disabled)?.value ?? "", menu, observer;
  const root = node("div", "mm-sp-scope offline-scope-dropdown");
  const trigger = node("button", "mm-sp-scope-btn");
  trigger.type = "button";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const menuId = "offline-scope-menu-" + ++sequence;
  trigger.setAttribute("aria-controls", menuId);
  root.append(trigger);
  const current = () => entries.find(entry => entry.value === selected) ?? entries[0];
  const contents = (target, entry) => {
    target.replaceChildren();
    if (entry?.dot) {
      const dot = node("i", "mm-sp-dot");
      dot.setAttribute("aria-hidden", "true");
      dot.style.setProperty("--sky", entry.dot.sky);
      dot.style.setProperty("--gr", entry.dot.ground);
      target.append(dot);
    } else if (entry?.icon) {
      const image = typeof entry.icon === "function" ? entry.icon() : node("img", "uiicon");
      if (typeof entry.icon === "string") image.src = `assets/ui/icons/${entry.icon}.png`;
      image.alt = ""; image.classList.add("offline-scope-icon"); target.append(image);
    }
    const text = node("span");
    text.append(node("b", null, entry?.title ?? "No options"));
    if (entry?.subtitle) text.append(node("small", null, entry.subtitle));
    target.append(text);
  };
  const paintTrigger = () => {
    contents(trigger, current());
    const caret = node("i", "mm-sp-caret");
    caret.setAttribute("aria-hidden", "true"); trigger.append(caret);
    trigger.disabled = !entries.some(entry => !entry.disabled);
  };
  function position() {
    if (!menu) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(rect.width, innerWidth - 16);
    const below = innerHeight - rect.bottom - 14, above = rect.top - 14;
    const down = below >= 220 || below >= above;
    menu.style.width = width + "px";
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + "px";
    menu.style.maxHeight = Math.max(70, Math.min(340, down ? below : above)) + "px";
    menu.style.top = down ? rect.bottom + 6 + "px" : "auto";
    menu.style.bottom = down ? "auto" : innerHeight - rect.top + 6 + "px";
    menu.style.transformOrigin = down ? "top center" : "bottom center";
  }
  function close(restoreFocus = false) {
    if (!menu) return;
    menu.remove(); menu = null; observer?.disconnect(); observer = null;
    if(activeClose===close)activeClose=null;
    root.classList.remove("open"); trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keys, true);
    removeEventListener("resize", position); removeEventListener("scroll", scroll, true);
    if (restoreFocus && trigger.isConnected) trigger.focus({preventScroll: true});
  }
  function paintMenu() {
    if (!menu) return;
    const active = menu.contains(document.activeElement) ? document.activeElement?.dataset.value : null;
    menu.replaceChildren();
    let group = null;
    for (const entry of entries) {
      if (entry.group && entry.group !== group) {
        const heading = node("small", "mm-sp-menu-h", entry.group);
        heading.setAttribute("role", "presentation"); menu.append(heading);
      }
      group = entry.group ?? null;
      const option = node("button", entry.value === selected ? "on" : "");
      option.type = "button"; option.disabled = Boolean(entry.disabled);
      option.dataset.value = entry.value;
      option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(entry.value === selected));
      contents(option, entry);
      option.addEventListener("click", () => {
        const changed = selected !== entry.value;
        selected = entry.value; close(true); paintTrigger();
        if (changed) onChange(selected);
      });
      menu.append(option);
    }
    if (active != null) [...menu.querySelectorAll("[role=option]")].find(option => option.dataset.value === active)?.focus({preventScroll:true});
    position();
  }
  function open(last = false) {
    if (menu || trigger.disabled) return;
    activeClose?.();activeClose=close;
    menu = node("div", "mm-sp-menu offline-scope-menu scroll");
    menu.id = menuId; menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", label);
    root.classList.add("open"); trigger.setAttribute("aria-expanded", "true");
    document.body.append(menu); paintMenu(); position();
    const available = [...menu.querySelectorAll("[role=option]:not(:disabled)")];
    (last ? available.at(-1) : available.find(option => option.dataset.value === selected) ?? available[0])?.focus({preventScroll:true});
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
    addEventListener("resize", position); addEventListener("scroll", scroll, true);
    observer = new MutationObserver(() => { if (!trigger.isConnected) close(); });
    observer.observe(document.body, {childList:true, subtree:true});
  }
  function outside(event) {
    if (!root.contains(event.target) && !menu?.contains(event.target)) close();
  }
  function scroll(event) { if (!menu?.contains(event.target)) position(); }
  function keys(event) {
    if (!menu) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    if (!["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const list = [...menu.querySelectorAll("[role=option]:not(:disabled)")];
    const at = list.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 :
      (at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus({preventScroll:true}); list[next]?.scrollIntoView({block:"nearest"});
  }
  trigger.addEventListener("click", () => menu ? close() : open());
  trigger.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation(); open(event.key === "ArrowUp");
    }
  });
  paintTrigger();
  return {
    el:root, button:trigger, get value() { return current()?.value ?? ""; },
    setOptions(next, preferred = selected) {
      entries = next;
      selected = entries.some(entry => entry.value === preferred && !entry.disabled) ? preferred :
        entries.find(entry => !entry.disabled)?.value ?? "";
      paintTrigger(); paintMenu();
    },
    close, destroy() { close(); root.remove(); },
  };
}
