import {isAndroidShell} from "./android-ui.js";

const scope = ':root[data-standard-platform="android"]';
const sizeKey = "--standard-text-outline-size";
const colorKey = "--standard-text-outline-color";
const shadowKey = "--standard-text-original-shadow";
// A text shadow is always behind the fill, including older tablet WebViews
// that accept paint-order in CSS but still paint text strokes over the glyph.
// The visible half of the original centered stroke becomes the shadow radius.
const ring = [
  [-.353553, -.353553], [0, -.5], [.353553, -.353553], [.5, 0],
  [.353553, .353553], [0, .5], [-.353553, .353553], [-.5, 0],
].map(([x,y]) => `${x ? `calc(var(${sizeKey},0px) * ${x})` : "0"} ${y ? `calc(var(${sizeKey},0px) * ${y})` : "0"} 0 var(${colorKey},currentColor)`).join(",");

// Split only at top level: var(), calc(), color-mix(), :is(), quoted strings
// and attribute selectors may themselves contain spaces or commas.
export function splitTextCSS(value, separator = ",") {
  const result = [];
  let start = 0, depth = 0, quote = "";
  for (let at = 0; at < value.length; at++) {
    const char = value[at];
    if (char === "\\") { at++; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (!depth && (separator === " " ? /\s/.test(char) : char === separator)) {
      if (value.slice(start,at).trim()) result.push(value.slice(start,at).trim());
      start = at + 1;
    }
  }
  if (value.slice(start).trim()) result.push(value.slice(start).trim());
  return result;
}

function strokeParts(style) {
  let size = style.getPropertyValue("-webkit-text-stroke-width").trim();
  let color = style.getPropertyValue("-webkit-text-stroke-color").trim();
  const shorthand = style.getPropertyValue("-webkit-text-stroke").trim();
  // CSSOM can leave the two longhands empty for a shorthand containing var().
  if (shorthand && (!size || !color)) {
    const parts = splitTextCSS(shorthand," ");
    const index = parts.findIndex(part => /^(?:0|[\d.]+(?:px|em|rem|vw|vh|vmin|vmax|pt|cm|mm|in)|(?:calc|clamp|min|max)\()/i.test(part));
    if (index >= 0) {
      size ||= parts[index];
      color ||= parts.filter((_,at) => at !== index).join(" ") || "currentColor";
    } else if (parts.length === 2 && parts[0].startsWith("var(")) {
      size ||= parts[0]; color ||= parts[1];
    } else if (["initial","revert"].includes(shorthand)) {
      size = "0px"; color = "currentColor";
    }
  }
  const keywords = {thin:"1px",medium:"3px",thick:"5px"};
  if (Object.prototype.hasOwnProperty.call(keywords,size)) size = keywords[size];
  return {size,color,present:Boolean(shorthand || size || color)};
}

export function androidTextDeclarations(style) {
  const {size,color,present} = strokeParts(style);
  const shadow = style.getPropertyValue("text-shadow").trim();
  const declarations = [];
  const variable = (name,value,property) => {
    if (value) declarations.push(`${name}:${value}${style.getPropertyPriority?.(property) === "important" ? "!important" : ""}`);
  };
  // Preserve the original drop shadow/glow and responsive/state overrides.
  // On ordinary, unoutlined text this custom property changes no rendering.
  if (shadow) variable(shadowKey,shadow === "none" ? "0 0 transparent" : shadow,"text-shadow");
  if (!present) return declarations.join(";");
  variable(sizeKey,size,"-webkit-text-stroke-width");
  variable(colorKey,color,"-webkit-text-stroke-color");
  declarations.push("-webkit-text-stroke:0 transparent!important");
  if (/^0(?:[a-z%]+)?$/i.test(size)) {
    // Keep transparent logo shine layers transparent and without an outline.
    declarations.push(`text-shadow:var(${shadowKey},0 0 transparent)!important`);
  } else {
    declarations.push(`text-shadow:${ring},var(${shadowKey},0 0 transparent)!important`);
  }
  return declarations.join(";");
}

const selectorFor = selector => {
  if (/^:root\b/.test(selector)) return selector.replace(/^:root\b/,scope);
  if (/^html\b/.test(selector)) return selector.replace(/^html\b/,scope);
  return `${scope} ${selector}`;
};

export function androidTextRules(rules) {
  const result = [];
  for (const rule of Array.from(rules ?? [])) {
    if (rule.type === 1 && rule.selectorText && rule.style) {
      const declarations = androidTextDeclarations(rule.style);
      if (declarations) result.push(`${splitTextCSS(rule.selectorText).map(selectorFor).join(",")}{${declarations}}`);
    } else if (rule.type !== 7 && rule.cssRules) {
      // Preserve media/supports/container conditions. Never scope animation
      // frame selectors ("from", "to", percentages) as if they were elements.
      const header = rule.cssText.slice(0,rule.cssText.indexOf("{")).trim();
      const children = androidTextRules(rule.cssRules);
      if (children && /^@(media|supports|container|layer|scope)\b/.test(header))
        result.push(`${header}{${children}}`);
    }
  }
  return result.join("\n");
}

export function installAndroidTextOutlines({window:win=globalThis.window,document:doc=globalThis.document}={}) {
  if (!isAndroidShell(win)) return null;
  const output = doc.createElement("style");
  output.dataset.standardAndroidText = "true";
  const cache = new WeakMap();
  let disposed = false;
  const localGameSheet = sheet => {
    if (!sheet.href || sheet.disabled) return false;
    try {
      const url = new URL(sheet.href,win.location.href), base = new URL(win.location.href);
      return url.protocol === base.protocol && url.host === base.host &&
        /^\/assets\/[^/]+\.css$/.test(url.pathname);
    } catch { return false; }
  };
  function refresh() {
    if (disposed) return;
    const sheets = [];
    for (const sheet of Array.from(doc.styleSheets ?? [])) {
      if (!localGameSheet(sheet)) continue;
      let css = cache.get(sheet);
      if (css === undefined) {
        try {
          const rules = sheet.cssRules;
          if (rules == null) continue;
          css = androidTextRules(rules);
        }
        catch { continue; } // A not-yet-loaded sheet is retried on its load event.
        cache.set(sheet,css);
      }
      if (css) sheets.push(sheet.media?.mediaText ? `@media ${sheet.media.mediaText}{${css}}` : css);
    }
    const css = sheets.join("\n");
    if (output.textContent !== css) output.textContent = css;
  }
  const loaded = event => {
    if (event.target?.tagName === "LINK" && event.target.rel === "stylesheet") {
      if (event.target.sheet) cache.delete(event.target.sheet);
      refresh();
    }
  };
  // Keep the previously reviewed, hand-tuned HP/friendship/logo exceptions
  // later in the cascade. The platform prefix still outranks lazy upstream CSS.
  const exceptions = doc.head.querySelector?.('link[href$="/offline/home.css"]');
  if (exceptions) doc.head.insertBefore(output,exceptions);
  else doc.head.append(output);
  // Vite loads menus/events/Relay CSS lazily. Compile each stylesheet once,
  // before its screen paints; no per-frame work or gameplay DOM observer.
  doc.addEventListener("load",loaded,true);
  refresh();
  return () => {
    disposed = true;
    doc.removeEventListener("load",loaded,true);
    output.remove();
  };
}
