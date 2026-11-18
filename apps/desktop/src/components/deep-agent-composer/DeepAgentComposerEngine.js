/* Original Deep Agent Composer, ModelThinkingSelector and EffortSlider; UI source preserved. */
// src/lib/DeepAgent/original-entry.js
import * as external0 from "react";
import * as external1 from "react/jsx-runtime";
import * as external2 from "react-dom";
import * as external3 from "react-dom/client";
import * as external4 from "gsap";
import * as external5 from "deep-agent-base-ui/preview-card";
import * as external6 from "deep-agent-lucide";
import * as external7 from "@fortawesome/fontawesome-svg-core";
import * as external8 from "@fortawesome/free-solid-svg-icons";
import * as external9 from "@fortawesome/react-fontawesome";
import * as external10 from "@radix-ui/react-slider";
import * as external11 from "react-circular-progressbar";
import * as external12 from "clsx";
import * as external13 from "tailwind-merge";

// src/lib/DeepAgent/original-host.mjs
import { createElement } from "react";
import { createRoot } from "react-dom/client";
function mountOriginalDeepAgent(target, initial, variant, css, tokens, dictionary, loadOriginal) {
  let options = { ...initial }, destroyed = false;
  const owner = target.ownerDocument, browser = owner.defaultView;
  const element = owner.createElement("div");
  element.dataset.motionSurface = "";
  element.dataset.deepAgentOriginal = variant;
  element.style.cssText = "display:block;position:relative;min-width:0;width:100%;overflow:visible;z-index:40;";
  const root = element.attachShadow({ mode: "open" });
  const style = owner.createElement("style");
  style.textContent = css;
  const appHost = owner.createElement("div"), portals = owner.createElement("div");
  appHost.style.cssText = "display:block;position:relative;min-width:0;width:100%;overflow:visible;";
  portals.dataset.originalPortals = "";
  root.append(style, appHost, portals);
  target.append(element);
  const applyTokens = (nextTokens) => {
    for (const [key, value] of Object.entries(nextTokens || {})) element.style.setProperty(key, value);
  };
  applyTokens(options.themeTokens ? { ...tokens, ...options.themeTokens } : tokens);
  const timers = /* @__PURE__ */ new Set(), mediaListeners = /* @__PURE__ */ new Set(), listeners = [];
  const timeout = (callback, delay, ...args) => {
    const id = browser.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) callback(...args);
    }, delay);
    timers.add(id);
    return id;
  };
  const clear = (id) => {
    browser.clearTimeout(id);
    timers.delete(id);
  };
  const reduced = () => options.reducedMotion ?? browser.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const eventFor = (event) => new Proxy(event, { get(original2, key) {
    if (key === "target") return original2.composedPath()[0] ?? original2.target;
    const value = Reflect.get(original2, key, original2);
    return typeof value === "function" ? value.bind(original2) : value;
  } });
  function trackedEventTarget(original2) {
    return new Proxy(original2, { get(object, key) {
      if (key === "addEventListener") return (type, listener, settings2) => {
        const wrapped = (event) => typeof listener === "function" ? listener.call(original2, eventFor(event)) : listener.handleEvent(eventFor(event));
        original2.addEventListener(type, wrapped, settings2);
        listeners.push({ original: original2, type, listener, wrapped, settings: settings2 });
      };
      if (key === "removeEventListener") return (type, listener, settings2) => {
        const capture = typeof settings2 === "boolean" ? settings2 : Boolean(settings2?.capture);
        for (let index = listeners.length - 1; index >= 0; index--) {
          const record = listeners[index], registeredCapture = typeof record.settings === "boolean" ? record.settings : Boolean(record.settings?.capture);
          if (record.original !== original2 || record.type !== type || record.listener !== listener || registeredCapture !== capture) continue;
          original2.removeEventListener(type, record.wrapped, record.settings);
          listeners.splice(index, 1);
        }
      };
      if (original2 === owner && key === "body") return portals;
      if (original2 === owner && key === "activeElement") {
        let focused = owner.activeElement;
        while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
        return focused === element || !focused || focused === owner.body ? portals : focused;
      }
      if (original2 === browser && key === "document") return document;
      if (original2 === browser && key === "setTimeout") return timeout;
      if (original2 === browser && key === "clearTimeout") return clear;
      if (original2 === browser && key === "matchMedia") return (query) => {
        const media = browser.matchMedia(query);
        if (!query.includes("prefers-reduced-motion")) return media;
        return new Proxy(media, { get(mediaObject, mediaKey) {
          if (mediaKey === "matches") return reduced();
          if (mediaKey === "addEventListener") return (type, listener) => {
            if (type === "change") mediaListeners.add(listener);
          };
          if (mediaKey === "removeEventListener") return (_type, listener) => mediaListeners.delete(listener);
          const value2 = Reflect.get(mediaObject, mediaKey, mediaObject);
          return typeof value2 === "function" ? value2.bind(mediaObject) : value2;
        } });
      };
      const value = Reflect.get(object, key, object);
      if (original2 === browser && typeof key === "string" && /^[A-Z]/.test(key)) return value;
      return typeof value === "function" ? value.bind(object) : value;
    } });
  }
  const document = trackedEventTarget(owner), window = trackedEventTarget(browser);
  const subscribers = /* @__PURE__ */ new Set();
  const settings = { available_models: options.models ?? ["deepseek-chat", "deepseek-reasoner"], chat_model: options.selectedModel ?? options.models?.[0] ?? "deepseek-chat", thinking_depth: options.value ?? "medium", model_capabilities: [] };
  const normalizePermissionPreset = (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "auto" || normalized === "auto_review" || normalized === "auto-review") return "auto_review";
    if (normalized === "full" || normalized === "full_access" || normalized === "full-access" || normalized === "danger-full-access" || normalized === "danger_full_access") return "full_access";
    return "default";
  };
  let permission = normalizePermissionPreset(options.permission);
  const dispatch = (name, detail) => element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  const notify = () => {
    subscribers.forEach((listener) => listener());
    browser.dispatchEvent(new Event(bridge.event));
  };
  const bridge = {
    event: "deep-agent-component:" + crypto.randomUUID(),
    portals,
    settings,
    get options() {
      return options;
    },
    get permission() {
      return permission;
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    t(key, parameters = {}) {
      let value = dictionary;
      for (const part of key.split(".")) value = value?.[part];
      return String(value ?? parameters.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(parameters[name] ?? ""));
    },
    api: {
      async getSettings() {
        return { ...settings };
      },
      async setChatModel(model) {
        settings.chat_model = model;
        options.onModelChange?.(model);
        dispatch("model-change", { model });
        return { ...settings };
      },
      async setThinkingDepth(value) {
        settings.thinking_depth = value;
        options.onValueChange?.(value);
        dispatch("thinking-change", { value });
        subscribers.forEach((listener) => listener());
        return { ...settings };
      },
      async getActivePermissionPreset() {
        return permission;
      },
      async setActivePermissionPreset(value) {
        permission = normalizePermissionPreset(value);
        options.onPermissionChange?.(permission);
        dispatch("permission-change", { value: permission });
        notify();
      },
      async getPermissionPresetVisibility() {
        return { default_enabled: true, auto_review_enabled: true, full_access_enabled: true };
      },
      async getCommands() {
        return [];
      },
      async listSkills() {
        return [];
      },
      async searchProjectFiles() {
        return { entries: [] };
      },
      async attachmentIngest(value) {
        return { id: value.id, size_bytes: value.text ? new Blob([value.text]).size : 0, extracted_text: value.text ?? null, storage_dir: "", original_path: null, sha256: null, message: null };
      },
      async attachmentRemove() {
      }
    },
    submit(text, attachments, skills, mentions) {
      const message = { text, model: settings.chat_model, thinking: settings.thinking_depth, attachments, skills, mentions, permission };
      options.onSubmit?.(message);
      dispatch("agent-submit", message);
    }
  };
  const original = loadOriginal(window, document, timeout, clear, bridge);
  const app = createRoot(appHost);
  const systemMedia = browser.matchMedia("(prefers-reduced-motion: reduce)");
  const syncMedia = () => {
    element.dataset.reducedMotion = String(reduced());
    const event = new browser.MediaQueryListEvent("change", { matches: reduced(), media: systemMedia.media });
    mediaListeners.forEach((listener) => typeof listener === "function" ? listener(event) : listener.handleEvent(event));
  };
  systemMedia.addEventListener("change", syncMedia);
  function render() {
    const motionHeight = options.height ?? (variant === "slider" ? 420 : null);
    if (motionHeight == null) element.style.removeProperty("--motion-height");
    else element.style.setProperty("--motion-height", `${motionHeight}px`);
    element.inert = Boolean(options.disabled);
    app.render(createElement(original.OriginalDemo, { bridge, variant }));
    syncMedia();
  }
  render();
  return {
    element,
    root,
    update(next) {
      if (destroyed) return;
      options = { ...options, ...next };
      if (next.models) settings.available_models = next.models;
      if (next.selectedModel !== void 0) settings.chat_model = next.selectedModel;
      if (next.value !== void 0) settings.thinking_depth = next.value;
      if (next.permission !== void 0) permission = normalizePermissionPreset(next.permission);
      if (next.themeTokens) applyTokens({ ...tokens, ...next.themeTokens });
      notify();
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      element.remove();
      systemMedia.removeEventListener("change", syncMedia);
      queueMicrotask(() => {
        app.unmount();
        original.disposeMessages?.();
        timers.forEach((id) => browser.clearTimeout(id));
        timers.clear();
        listeners.forEach((record) => record.original.removeEventListener(record.type, record.wrapped, record.settings));
        mediaListeners.clear();
        subscribers.clear();
      });
    }
  };
}

// src/lib/DeepAgent/original-entry.js
var STYLE_TEXT = '*, ::before, ::after {\r\n  --tw-border-spacing-x: 0;\r\n  --tw-border-spacing-y: 0;\r\n  --tw-translate-x: 0;\r\n  --tw-translate-y: 0;\r\n  --tw-rotate: 0;\r\n  --tw-skew-x: 0;\r\n  --tw-skew-y: 0;\r\n  --tw-scale-x: 1;\r\n  --tw-scale-y: 1;\r\n  --tw-pan-x:  ;\r\n  --tw-pan-y:  ;\r\n  --tw-pinch-zoom:  ;\r\n  --tw-scroll-snap-strictness: proximity;\r\n  --tw-gradient-from-position:  ;\r\n  --tw-gradient-via-position:  ;\r\n  --tw-gradient-to-position:  ;\r\n  --tw-ordinal:  ;\r\n  --tw-slashed-zero:  ;\r\n  --tw-numeric-figure:  ;\r\n  --tw-numeric-spacing:  ;\r\n  --tw-numeric-fraction:  ;\r\n  --tw-ring-inset:  ;\r\n  --tw-ring-offset-width: 0px;\r\n  --tw-ring-offset-color: #fff;\r\n  --tw-ring-color: rgb(59 130 246 / 0.5);\r\n  --tw-ring-offset-shadow: 0 0 #0000;\r\n  --tw-ring-shadow: 0 0 #0000;\r\n  --tw-shadow: 0 0 #0000;\r\n  --tw-shadow-colored: 0 0 #0000;\r\n  --tw-blur:  ;\r\n  --tw-brightness:  ;\r\n  --tw-contrast:  ;\r\n  --tw-grayscale:  ;\r\n  --tw-hue-rotate:  ;\r\n  --tw-invert:  ;\r\n  --tw-saturate:  ;\r\n  --tw-sepia:  ;\r\n  --tw-drop-shadow:  ;\r\n  --tw-backdrop-blur:  ;\r\n  --tw-backdrop-brightness:  ;\r\n  --tw-backdrop-contrast:  ;\r\n  --tw-backdrop-grayscale:  ;\r\n  --tw-backdrop-hue-rotate:  ;\r\n  --tw-backdrop-invert:  ;\r\n  --tw-backdrop-opacity:  ;\r\n  --tw-backdrop-saturate:  ;\r\n  --tw-backdrop-sepia:  ;\r\n  --tw-contain-size:  ;\r\n  --tw-contain-layout:  ;\r\n  --tw-contain-paint:  ;\r\n  --tw-contain-style:  ;\r\n}\r\n\r\n::backdrop {\r\n  --tw-border-spacing-x: 0;\r\n  --tw-border-spacing-y: 0;\r\n  --tw-translate-x: 0;\r\n  --tw-translate-y: 0;\r\n  --tw-rotate: 0;\r\n  --tw-skew-x: 0;\r\n  --tw-skew-y: 0;\r\n  --tw-scale-x: 1;\r\n  --tw-scale-y: 1;\r\n  --tw-pan-x:  ;\r\n  --tw-pan-y:  ;\r\n  --tw-pinch-zoom:  ;\r\n  --tw-scroll-snap-strictness: proximity;\r\n  --tw-gradient-from-position:  ;\r\n  --tw-gradient-via-position:  ;\r\n  --tw-gradient-to-position:  ;\r\n  --tw-ordinal:  ;\r\n  --tw-slashed-zero:  ;\r\n  --tw-numeric-figure:  ;\r\n  --tw-numeric-spacing:  ;\r\n  --tw-numeric-fraction:  ;\r\n  --tw-ring-inset:  ;\r\n  --tw-ring-offset-width: 0px;\r\n  --tw-ring-offset-color: #fff;\r\n  --tw-ring-color: rgb(59 130 246 / 0.5);\r\n  --tw-ring-offset-shadow: 0 0 #0000;\r\n  --tw-ring-shadow: 0 0 #0000;\r\n  --tw-shadow: 0 0 #0000;\r\n  --tw-shadow-colored: 0 0 #0000;\r\n  --tw-blur:  ;\r\n  --tw-brightness:  ;\r\n  --tw-contrast:  ;\r\n  --tw-grayscale:  ;\r\n  --tw-hue-rotate:  ;\r\n  --tw-invert:  ;\r\n  --tw-saturate:  ;\r\n  --tw-sepia:  ;\r\n  --tw-drop-shadow:  ;\r\n  --tw-backdrop-blur:  ;\r\n  --tw-backdrop-brightness:  ;\r\n  --tw-backdrop-contrast:  ;\r\n  --tw-backdrop-grayscale:  ;\r\n  --tw-backdrop-hue-rotate:  ;\r\n  --tw-backdrop-invert:  ;\r\n  --tw-backdrop-opacity:  ;\r\n  --tw-backdrop-saturate:  ;\r\n  --tw-backdrop-sepia:  ;\r\n  --tw-contain-size:  ;\r\n  --tw-contain-layout:  ;\r\n  --tw-contain-paint:  ;\r\n  --tw-contain-style:  ;\r\n}/*\r\n! tailwindcss v3.4.19 | MIT License | https://tailwindcss.com\r\n*//*\r\n1. Prevent padding and border from affecting element width. (https://github.com/mozdevs/cssremedy/issues/4)\r\n2. Allow adding a border to an element by just adding a border-width. (https://github.com/tailwindcss/tailwindcss/pull/116)\r\n*/\r\n\r\n*,\r\n::before,\r\n::after {\r\n  box-sizing: border-box; /* 1 */\r\n  border-width: 0; /* 2 */\r\n  border-style: solid; /* 2 */\r\n  border-color: #e5e7eb; /* 2 */\r\n}\r\n\r\n::before,\r\n::after {\r\n  --tw-content: \'\';\r\n}\r\n\r\n/*\r\n1. Use a consistent sensible line-height in all browsers.\r\n2. Prevent adjustments of font size after orientation changes in iOS.\r\n3. Use a more readable tab size.\r\n4. Use the user\'s configured `sans` font-family by default.\r\n5. Use the user\'s configured `sans` font-feature-settings by default.\r\n6. Use the user\'s configured `sans` font-variation-settings by default.\r\n7. Disable tap highlights on iOS\r\n*/\r\n\r\nhtml,\r\n:host {\r\n  line-height: 1.5; /* 1 */\r\n  -webkit-text-size-adjust: 100%; /* 2 */\r\n  -moz-tab-size: 4; /* 3 */\r\n  tab-size: 4; /* 3 */\r\n  font-family: var(--ui-font, Inter), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; /* 4 */\r\n  font-feature-settings: normal; /* 5 */\r\n  font-variation-settings: normal; /* 6 */\r\n  -webkit-tap-highlight-color: transparent; /* 7 */\r\n}\r\n\r\n/*\r\n1. Remove the margin in all browsers.\r\n2. Inherit line-height from `html` so users can set them as a class directly on the `html` element.\r\n*/\r\n\r\nbody {\r\n  margin: 0; /* 1 */\r\n  line-height: inherit; /* 2 */\r\n}\r\n\r\n/*\r\n1. Add the correct height in Firefox.\r\n2. Correct the inheritance of border color in Firefox. (https://bugzilla.mozilla.org/show_bug.cgi?id=190655)\r\n3. Ensure horizontal rules are visible by default.\r\n*/\r\n\r\nhr {\r\n  height: 0; /* 1 */\r\n  color: inherit; /* 2 */\r\n  border-top-width: 1px; /* 3 */\r\n}\r\n\r\n/*\r\nAdd the correct text decoration in Chrome, Edge, and Safari.\r\n*/\r\n\r\nabbr:where([title]) {\r\n  text-decoration: underline dotted;\r\n}\r\n\r\n/*\r\nRemove the default font size and weight for headings.\r\n*/\r\n\r\nh1,\r\nh2,\r\nh3,\r\nh4,\r\nh5,\r\nh6 {\r\n  font-size: inherit;\r\n  font-weight: inherit;\r\n}\r\n\r\n/*\r\nReset links to optimize for opt-in styling instead of opt-out.\r\n*/\r\n\r\na {\r\n  color: inherit;\r\n  text-decoration: inherit;\r\n}\r\n\r\n/*\r\nAdd the correct font weight in Edge and Safari.\r\n*/\r\n\r\nb,\r\nstrong {\r\n  font-weight: bolder;\r\n}\r\n\r\n/*\r\n1. Use the user\'s configured `mono` font-family by default.\r\n2. Use the user\'s configured `mono` font-feature-settings by default.\r\n3. Use the user\'s configured `mono` font-variation-settings by default.\r\n4. Correct the odd `em` font sizing in all browsers.\r\n*/\r\n\r\ncode,\r\nkbd,\r\nsamp,\r\npre {\r\n  font-family: var(--code-font, ui-monospace), SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; /* 1 */\r\n  font-feature-settings: normal; /* 2 */\r\n  font-variation-settings: normal; /* 3 */\r\n  font-size: 1em; /* 4 */\r\n}\r\n\r\n/*\r\nAdd the correct font size in all browsers.\r\n*/\r\n\r\nsmall {\r\n  font-size: 80%;\r\n}\r\n\r\n/*\r\nPrevent `sub` and `sup` elements from affecting the line height in all browsers.\r\n*/\r\n\r\nsub,\r\nsup {\r\n  font-size: 75%;\r\n  line-height: 0;\r\n  position: relative;\r\n  vertical-align: baseline;\r\n}\r\n\r\nsub {\r\n  bottom: -0.25em;\r\n}\r\n\r\nsup {\r\n  top: -0.5em;\r\n}\r\n\r\n/*\r\n1. Remove text indentation from table contents in Chrome and Safari. (https://bugs.chromium.org/p/chromium/issues/detail?id=999088, https://bugs.webkit.org/show_bug.cgi?id=201297)\r\n2. Correct table border color inheritance in all Chrome and Safari. (https://bugs.chromium.org/p/chromium/issues/detail?id=935729, https://bugs.webkit.org/show_bug.cgi?id=195016)\r\n3. Remove gaps between table borders by default.\r\n*/\r\n\r\ntable {\r\n  text-indent: 0; /* 1 */\r\n  border-color: inherit; /* 2 */\r\n  border-collapse: collapse; /* 3 */\r\n}\r\n\r\n/*\r\n1. Change the font styles in all browsers.\r\n2. Remove the margin in Firefox and Safari.\r\n3. Remove default padding in all browsers.\r\n*/\r\n\r\nbutton,\r\ninput,\r\noptgroup,\r\nselect,\r\ntextarea {\r\n  font-family: inherit; /* 1 */\r\n  font-feature-settings: inherit; /* 1 */\r\n  font-variation-settings: inherit; /* 1 */\r\n  font-size: 100%; /* 1 */\r\n  font-weight: inherit; /* 1 */\r\n  line-height: inherit; /* 1 */\r\n  letter-spacing: inherit; /* 1 */\r\n  color: inherit; /* 1 */\r\n  margin: 0; /* 2 */\r\n  padding: 0; /* 3 */\r\n}\r\n\r\n/*\r\nRemove the inheritance of text transform in Edge and Firefox.\r\n*/\r\n\r\nbutton,\r\nselect {\r\n  text-transform: none;\r\n}\r\n\r\n/*\r\n1. Correct the inability to style clickable types in iOS and Safari.\r\n2. Remove default button styles.\r\n*/\r\n\r\nbutton,\r\ninput:where([type=\'button\']),\r\ninput:where([type=\'reset\']),\r\ninput:where([type=\'submit\']) {\r\n  -webkit-appearance: button; /* 1 */\r\n  background-color: transparent; /* 2 */\r\n  background-image: none; /* 2 */\r\n}\r\n\r\n/*\r\nUse the modern Firefox focus style for all focusable elements.\r\n*/\r\n\r\n:-moz-focusring {\r\n  outline: auto;\r\n}\r\n\r\n/*\r\nRemove the additional `:invalid` styles in Firefox. (https://github.com/mozilla/gecko-dev/blob/2f9eacd9d3d995c937b4251a5557d95d494c9be1/layout/style/res/forms.css#L728-L737)\r\n*/\r\n\r\n:-moz-ui-invalid {\r\n  box-shadow: none;\r\n}\r\n\r\n/*\r\nAdd the correct vertical alignment in Chrome and Firefox.\r\n*/\r\n\r\nprogress {\r\n  vertical-align: baseline;\r\n}\r\n\r\n/*\r\nCorrect the cursor style of increment and decrement buttons in Safari.\r\n*/\r\n\r\n::-webkit-inner-spin-button,\r\n::-webkit-outer-spin-button {\r\n  height: auto;\r\n}\r\n\r\n/*\r\n1. Correct the odd appearance in Chrome and Safari.\r\n2. Correct the outline style in Safari.\r\n*/\r\n\r\n[type=\'search\'] {\r\n  -webkit-appearance: textfield; /* 1 */\r\n  outline-offset: -2px; /* 2 */\r\n}\r\n\r\n/*\r\nRemove the inner padding in Chrome and Safari on macOS.\r\n*/\r\n\r\n::-webkit-search-decoration {\r\n  -webkit-appearance: none;\r\n}\r\n\r\n/*\r\n1. Correct the inability to style clickable types in iOS and Safari.\r\n2. Change font properties to `inherit` in Safari.\r\n*/\r\n\r\n::-webkit-file-upload-button {\r\n  -webkit-appearance: button; /* 1 */\r\n  font: inherit; /* 2 */\r\n}\r\n\r\n/*\r\nAdd the correct display in Chrome and Safari.\r\n*/\r\n\r\nsummary {\r\n  display: list-item;\r\n}\r\n\r\n/*\r\nRemoves the default spacing and border for appropriate elements.\r\n*/\r\n\r\nblockquote,\r\ndl,\r\ndd,\r\nh1,\r\nh2,\r\nh3,\r\nh4,\r\nh5,\r\nh6,\r\nhr,\r\nfigure,\r\np,\r\npre {\r\n  margin: 0;\r\n}\r\n\r\nfieldset {\r\n  margin: 0;\r\n  padding: 0;\r\n}\r\n\r\nlegend {\r\n  padding: 0;\r\n}\r\n\r\nol,\r\nul,\r\nmenu {\r\n  list-style: none;\r\n  margin: 0;\r\n  padding: 0;\r\n}\r\n\r\n/*\r\nReset default styling for dialogs.\r\n*/\r\ndialog {\r\n  padding: 0;\r\n}\r\n\r\n/*\r\nPrevent resizing textareas horizontally by default.\r\n*/\r\n\r\ntextarea {\r\n  resize: vertical;\r\n}\r\n\r\n/*\r\n1. Reset the default placeholder opacity in Firefox. (https://github.com/tailwindlabs/tailwindcss/issues/3300)\r\n2. Set the default placeholder color to the user\'s configured gray 400 color.\r\n*/\r\n\r\ninput::placeholder,\r\ntextarea::placeholder {\r\n  opacity: 1; /* 1 */\r\n  color: #9ca3af; /* 2 */\r\n}\r\n\r\n/*\r\nSet the default cursor for buttons.\r\n*/\r\n\r\nbutton,\r\n[role="button"] {\r\n  cursor: pointer;\r\n}\r\n\r\n/*\r\nMake sure disabled buttons don\'t get the pointer cursor.\r\n*/\r\n:disabled {\r\n  cursor: default;\r\n}\r\n\r\n/*\r\n1. Make replaced elements `display: block` by default. (https://github.com/mozdevs/cssremedy/issues/14)\r\n2. Add `vertical-align: middle` to align replaced elements more sensibly by default. (https://github.com/jensimmons/cssremedy/issues/14#issuecomment-634934210)\r\n   This can trigger a poorly considered lint error in some tools but is included by design.\r\n*/\r\n\r\nimg,\r\nsvg,\r\nvideo,\r\ncanvas,\r\naudio,\r\niframe,\r\nembed,\r\nobject {\r\n  display: block; /* 1 */\r\n  vertical-align: middle; /* 2 */\r\n}\r\n\r\n/*\r\nConstrain images and videos to the parent width and preserve their intrinsic aspect ratio. (https://github.com/mozdevs/cssremedy/issues/14)\r\n*/\r\n\r\nimg,\r\nvideo {\r\n  max-width: 100%;\r\n  height: auto;\r\n}\r\n\r\n/* Make elements with the HTML hidden attribute stay hidden by default */\r\n[hidden]:where(:not([hidden="until-found"])) {\r\n  display: none;\r\n}\r\n  html,\r\n  body,\r\n  #root {\r\n    width: 100%;\r\n    height: 100%;\r\n    margin: 0;\r\n    overflow: hidden;\r\n  }\r\n\r\n  body {\r\n    background-color: var(--theme-bg, #ffffff);\r\n    color: var(--theme-fg, #1F2937);\r\n  }\r\n\r\n  html {\r\n    overflow-x: hidden;\r\n  }\r\n.\\!container {\r\n  width: 100% !important;\r\n}\r\n.container {\r\n  width: 100%;\r\n}\r\n@media (min-width: 640px) {\r\n\r\n  .\\!container {\r\n    max-width: 640px !important;\r\n  }\r\n\r\n  .container {\r\n    max-width: 640px;\r\n  }\r\n}\r\n@media (min-width: 768px) {\r\n\r\n  .\\!container {\r\n    max-width: 768px !important;\r\n  }\r\n\r\n  .container {\r\n    max-width: 768px;\r\n  }\r\n}\r\n@media (min-width: 1024px) {\r\n\r\n  .\\!container {\r\n    max-width: 1024px !important;\r\n  }\r\n\r\n  .container {\r\n    max-width: 1024px;\r\n  }\r\n}\r\n@media (min-width: 1280px) {\r\n\r\n  .\\!container {\r\n    max-width: 1280px !important;\r\n  }\r\n\r\n  .container {\r\n    max-width: 1280px;\r\n  }\r\n}\r\n@media (min-width: 1536px) {\r\n\r\n  .\\!container {\r\n    max-width: 1536px !important;\r\n  }\r\n\r\n  .container {\r\n    max-width: 1536px;\r\n  }\r\n}\r\n.sr-only {\r\n  position: absolute;\r\n  width: 1px;\r\n  height: 1px;\r\n  padding: 0;\r\n  margin: -1px;\r\n  overflow: hidden;\r\n  clip: rect(0, 0, 0, 0);\r\n  white-space: nowrap;\r\n  border-width: 0;\r\n}\r\n.pointer-events-none {\r\n  pointer-events: none;\r\n}\r\n.pointer-events-auto {\r\n  pointer-events: auto;\r\n}\r\n.visible {\r\n  visibility: visible;\r\n}\r\n.fixed {\r\n  position: fixed;\r\n}\r\n.absolute {\r\n  position: absolute;\r\n}\r\n.relative {\r\n  position: relative;\r\n}\r\n.inset-0 {\r\n  inset: 0px;\r\n}\r\n.inset-x-0 {\r\n  left: 0px;\r\n  right: 0px;\r\n}\r\n.inset-x-1 {\r\n  left: 0.25rem;\r\n  right: 0.25rem;\r\n}\r\n.-right-1 {\r\n  right: -0.25rem;\r\n}\r\n.-top-1 {\r\n  top: -0.25rem;\r\n}\r\n.bottom-1 {\r\n  bottom: 0.25rem;\r\n}\r\n.bottom-full {\r\n  bottom: 100%;\r\n}\r\n.left-0 {\r\n  left: 0px;\r\n}\r\n.left-1\\.5 {\r\n  left: 0.375rem;\r\n}\r\n.left-3 {\r\n  left: 0.75rem;\r\n}\r\n.right-0 {\r\n  right: 0px;\r\n}\r\n.right-1\\.5 {\r\n  right: 0.375rem;\r\n}\r\n.right-2 {\r\n  right: 0.5rem;\r\n}\r\n.right-3 {\r\n  right: 0.75rem;\r\n}\r\n.top-0 {\r\n  top: 0px;\r\n}\r\n.top-3 {\r\n  top: 0.75rem;\r\n}\r\n.top-4 {\r\n  top: 1rem;\r\n}\r\n.top-\\[11px\\] {\r\n  top: 11px;\r\n}\r\n.isolate {\r\n  isolation: isolate;\r\n}\r\n.z-0 {\r\n  z-index: 0;\r\n}\r\n.z-10 {\r\n  z-index: 10;\r\n}\r\n.z-50 {\r\n  z-index: 50;\r\n}\r\n.z-\\[1\\] {\r\n  z-index: 1;\r\n}\r\n.z-\\[200\\] {\r\n  z-index: 200;\r\n}\r\n.z-\\[70\\] {\r\n  z-index: 70;\r\n}\r\n.z-\\[9999\\] {\r\n  z-index: 9999;\r\n}\r\n.-mx-1 {\r\n  margin-left: -0.25rem;\r\n  margin-right: -0.25rem;\r\n}\r\n.mx-0\\.5 {\r\n  margin-left: 0.125rem;\r\n  margin-right: 0.125rem;\r\n}\r\n.mx-3 {\r\n  margin-left: 0.75rem;\r\n  margin-right: 0.75rem;\r\n}\r\n.mx-3\\.5 {\r\n  margin-left: 0.875rem;\r\n  margin-right: 0.875rem;\r\n}\r\n.my-1\\.5 {\r\n  margin-top: 0.375rem;\r\n  margin-bottom: 0.375rem;\r\n}\r\n.my-2 {\r\n  margin-top: 0.5rem;\r\n  margin-bottom: 0.5rem;\r\n}\r\n.mb-2 {\r\n  margin-bottom: 0.5rem;\r\n}\r\n.mb-2\\.5 {\r\n  margin-bottom: 0.625rem;\r\n}\r\n.ml-1 {\r\n  margin-left: 0.25rem;\r\n}\r\n.ml-1\\.5 {\r\n  margin-left: 0.375rem;\r\n}\r\n.ml-2 {\r\n  margin-left: 0.5rem;\r\n}\r\n.ml-3 {\r\n  margin-left: 0.75rem;\r\n}\r\n.mr-1 {\r\n  margin-right: 0.25rem;\r\n}\r\n.mr-1\\.5 {\r\n  margin-right: 0.375rem;\r\n}\r\n.mr-2 {\r\n  margin-right: 0.5rem;\r\n}\r\n.mt-0\\.5 {\r\n  margin-top: 0.125rem;\r\n}\r\n.mt-1 {\r\n  margin-top: 0.25rem;\r\n}\r\n.mt-1\\.5 {\r\n  margin-top: 0.375rem;\r\n}\r\n.mt-2 {\r\n  margin-top: 0.5rem;\r\n}\r\n.mt-2\\.5 {\r\n  margin-top: 0.625rem;\r\n}\r\n.block {\r\n  display: block;\r\n}\r\n.inline {\r\n  display: inline;\r\n}\r\n.flex {\r\n  display: flex;\r\n}\r\n.inline-flex {\r\n  display: inline-flex;\r\n}\r\n.flow-root {\r\n  display: flow-root;\r\n}\r\n.grid {\r\n  display: grid;\r\n}\r\n.hidden {\r\n  display: none;\r\n}\r\n.\\!h-fit {\r\n  height: fit-content !important;\r\n}\r\n.h-1\\.5 {\r\n  height: 0.375rem;\r\n}\r\n.h-10 {\r\n  height: 2.5rem;\r\n}\r\n.h-14 {\r\n  height: 3.5rem;\r\n}\r\n.h-2\\.5 {\r\n  height: 0.625rem;\r\n}\r\n.h-3 {\r\n  height: 0.75rem;\r\n}\r\n.h-3\\.5 {\r\n  height: 0.875rem;\r\n}\r\n.h-4 {\r\n  height: 1rem;\r\n}\r\n.h-5 {\r\n  height: 1.25rem;\r\n}\r\n.h-6 {\r\n  height: 1.5rem;\r\n}\r\n.h-7 {\r\n  height: 1.75rem;\r\n}\r\n.h-8 {\r\n  height: 2rem;\r\n}\r\n.h-9 {\r\n  height: 2.25rem;\r\n}\r\n.h-\\[20px\\] {\r\n  height: 20px;\r\n}\r\n.h-\\[68px\\] {\r\n  height: 68px;\r\n}\r\n.h-auto {\r\n  height: auto;\r\n}\r\n.h-full {\r\n  height: 100%;\r\n}\r\n.h-px {\r\n  height: 1px;\r\n}\r\n.\\!max-h-none {\r\n  max-height: none !important;\r\n}\r\n.max-h-\\[88vh\\] {\r\n  max-height: 88vh;\r\n}\r\n.max-h-\\[96px\\] {\r\n  max-height: 96px;\r\n}\r\n.max-h-\\[min\\(75dvh\\2c 760px\\)\\] {\r\n  max-height: min(75dvh, 760px);\r\n}\r\n.max-h-\\[var\\(--suggest-list-height\\2c 240px\\)\\] {\r\n  max-height: var(--suggest-list-height,240px);\r\n}\r\n.min-h-\\[48px\\] {\r\n  min-height: 48px;\r\n}\r\n.\\!w-fit {\r\n  width: fit-content !important;\r\n}\r\n.w-10 {\r\n  width: 2.5rem;\r\n}\r\n.w-2\\.5 {\r\n  width: 0.625rem;\r\n}\r\n.w-3 {\r\n  width: 0.75rem;\r\n}\r\n.w-3\\.5 {\r\n  width: 0.875rem;\r\n}\r\n.w-4 {\r\n  width: 1rem;\r\n}\r\n.w-5 {\r\n  width: 1.25rem;\r\n}\r\n.w-6 {\r\n  width: 1.5rem;\r\n}\r\n.w-7 {\r\n  width: 1.75rem;\r\n}\r\n.w-8 {\r\n  width: 2rem;\r\n}\r\n.w-9 {\r\n  width: 2.25rem;\r\n}\r\n.w-\\[240px\\] {\r\n  width: 240px;\r\n}\r\n.w-\\[264px\\] {\r\n  width: 264px;\r\n}\r\n.w-\\[68px\\] {\r\n  width: 68px;\r\n}\r\n.w-\\[min\\(288px\\2c calc\\(100vw-48px\\)\\)\\] {\r\n  width: min(288px, calc(100vw - 48px));\r\n}\r\n.w-auto {\r\n  width: auto;\r\n}\r\n.w-fit {\r\n  width: fit-content;\r\n}\r\n.w-full {\r\n  width: 100%;\r\n}\r\n.w-max {\r\n  width: max-content;\r\n}\r\n.min-w-0 {\r\n  min-width: 0px;\r\n}\r\n.\\!max-w-none {\r\n  max-width: none !important;\r\n}\r\n.max-w-\\[180px\\] {\r\n  max-width: 180px;\r\n}\r\n.max-w-\\[210px\\] {\r\n  max-width: 210px;\r\n}\r\n.max-w-\\[220px\\] {\r\n  max-width: 220px;\r\n}\r\n.max-w-\\[480px\\] {\r\n  max-width: 480px;\r\n}\r\n.max-w-\\[620px\\] {\r\n  max-width: 620px;\r\n}\r\n.max-w-\\[calc\\(100vw-32px\\)\\] {\r\n  max-width: calc(100vw - 32px);\r\n}\r\n.max-w-\\[min\\(80vw\\2c 1120px\\)\\] {\r\n  max-width: min(80vw, 1120px);\r\n}\r\n.max-w-full {\r\n  max-width: 100%;\r\n}\r\n.max-w-sm {\r\n  max-width: 24rem;\r\n}\r\n.flex-1 {\r\n  flex: 1 1 0%;\r\n}\r\n.flex-shrink {\r\n  flex-shrink: 1;\r\n}\r\n.flex-shrink-0 {\r\n  flex-shrink: 0;\r\n}\r\n.shrink-0 {\r\n  flex-shrink: 0;\r\n}\r\n.grow {\r\n  flex-grow: 1;\r\n}\r\n.transform {\r\n  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));\r\n}\r\n@keyframes spin {\r\n\r\n  to {\r\n    transform: rotate(360deg);\r\n  }\r\n}\r\n.animate-spin {\r\n  animation: spin 1s linear infinite;\r\n}\r\n.cursor-not-allowed {\r\n  cursor: not-allowed;\r\n}\r\n.cursor-pointer {\r\n  cursor: pointer;\r\n}\r\n.cursor-zoom-in {\r\n  cursor: zoom-in;\r\n}\r\n.touch-none {\r\n  touch-action: none;\r\n}\r\n.select-none {\r\n  user-select: none;\r\n}\r\n.resize-none {\r\n  resize: none;\r\n}\r\n.resize {\r\n  resize: both;\r\n}\r\n.appearance-none {\r\n  appearance: none;\r\n}\r\n.grid-cols-\\[130px_minmax\\(0\\2c 1fr\\)_64px\\] {\r\n  grid-template-columns: 130px minmax(0,1fr) 64px;\r\n}\r\n.grid-cols-\\[18px_minmax\\(0\\2c 1fr\\)\\] {\r\n  grid-template-columns: 18px minmax(0,1fr);\r\n}\r\n.flex-col {\r\n  flex-direction: column;\r\n}\r\n.flex-wrap {\r\n  flex-wrap: wrap;\r\n}\r\n.items-start {\r\n  align-items: flex-start;\r\n}\r\n.items-center {\r\n  align-items: center;\r\n}\r\n.items-baseline {\r\n  align-items: baseline;\r\n}\r\n.justify-end {\r\n  justify-content: flex-end;\r\n}\r\n.justify-center {\r\n  justify-content: center;\r\n}\r\n.justify-between {\r\n  justify-content: space-between;\r\n}\r\n.gap-0 {\r\n  gap: 0px;\r\n}\r\n.gap-0\\.5 {\r\n  gap: 0.125rem;\r\n}\r\n.gap-1\\.5 {\r\n  gap: 0.375rem;\r\n}\r\n.gap-2 {\r\n  gap: 0.5rem;\r\n}\r\n.gap-2\\.5 {\r\n  gap: 0.625rem;\r\n}\r\n.gap-3 {\r\n  gap: 0.75rem;\r\n}\r\n.gap-4 {\r\n  gap: 1rem;\r\n}\r\n.gap-\\[7px\\] {\r\n  gap: 7px;\r\n}\r\n.space-y-1\\.5 > :not([hidden]) ~ :not([hidden]) {\r\n  --tw-space-y-reverse: 0;\r\n  margin-top: calc(0.375rem * calc(1 - var(--tw-space-y-reverse)));\r\n  margin-bottom: calc(0.375rem * var(--tw-space-y-reverse));\r\n}\r\n.overflow-hidden {\r\n  overflow: hidden;\r\n}\r\n.\\!overflow-visible {\r\n  overflow: visible !important;\r\n}\r\n.overflow-visible {\r\n  overflow: visible;\r\n}\r\n.overflow-x-auto {\r\n  overflow-x: auto;\r\n}\r\n.overflow-y-auto {\r\n  overflow-y: auto;\r\n}\r\n.overscroll-contain {\r\n  overscroll-behavior: contain;\r\n}\r\n.truncate {\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.whitespace-nowrap {\r\n  white-space: nowrap;\r\n}\r\n.whitespace-pre-wrap {\r\n  white-space: pre-wrap;\r\n}\r\n.break-words {\r\n  overflow-wrap: break-word;\r\n}\r\n.\\!rounded-none {\r\n  border-radius: 0px !important;\r\n}\r\n.rounded {\r\n  border-radius: calc((0.25rem) * var(--continuous-corner-scale));\r\n}\r\n.rounded-2xl {\r\n  border-radius: calc((1rem) * var(--continuous-corner-scale));\r\n}\r\n.rounded-\\[10px\\] {\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n}\r\n.rounded-\\[20px\\] {\r\n  border-radius: calc((20px) * var(--continuous-corner-scale));\r\n}\r\n.rounded-\\[24px\\] {\r\n  border-radius: calc((24px) * var(--continuous-corner-scale));\r\n}\r\n.rounded-\\[2px\\] {\r\n  border-radius: calc((2px) * var(--continuous-corner-scale));\r\n}\r\n.rounded-\\[3px\\] {\r\n  border-radius: calc((3px) * var(--continuous-corner-scale));\r\n}\r\n.rounded-full {\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n}\r\n.rounded-lg {\r\n  border-radius: calc((0.5rem) * var(--continuous-corner-scale));\r\n}\r\n.rounded-md {\r\n  border-radius: calc((0.375rem) * var(--continuous-corner-scale));\r\n}\r\n.rounded-none {\r\n  border-radius: 0px;\r\n}\r\n.rounded-xl {\r\n  border-radius: calc((0.75rem) * var(--continuous-corner-scale));\r\n}\r\n.border {\r\n  border-width: 1px;\r\n}\r\n.border-0 {\r\n  border-width: 0px;\r\n}\r\n.border-2 {\r\n  border-width: 2px;\r\n}\r\n.border-t {\r\n  border-top-width: 1px;\r\n}\r\n.border-border-theme {\r\n  border-color: var(--theme-border, #E5E7EB);\r\n}\r\n.border-elevated-bg {\r\n  border-color: var(--theme-elevated, #FFFFFF);\r\n}\r\n.border-gray-300 {\r\n  --tw-border-opacity: 1;\r\n  border-color: rgb(209 213 219 / var(--tw-border-opacity, 1));\r\n}\r\n.border-white\\/40 {\r\n  border-color: rgb(255 255 255 / 0.4);\r\n}\r\n.\\!bg-black\\/85 {\r\n  background-color: rgb(0 0 0 / 0.85) !important;\r\n}\r\n.\\!bg-transparent {\r\n  background-color: transparent !important;\r\n}\r\n.bg-\\[\\#e25507\\]\\/10 {\r\n  background-color: rgb(226 85 7 / 0.1);\r\n}\r\n.bg-\\[\\#f5f5f5\\] {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(245 245 245 / var(--tw-bg-opacity, 1));\r\n}\r\n.bg-amber-500\\/10 {\r\n  background-color: rgb(245 158 11 / 0.1);\r\n}\r\n.bg-bg-base {\r\n  background-color: var(--theme-bg, #ffffff);\r\n}\r\n.bg-black\\/0 {\r\n  background-color: rgb(0 0 0 / 0);\r\n}\r\n.bg-black\\/10 {\r\n  background-color: rgb(0 0 0 / 0.1);\r\n}\r\n.bg-black\\/20 {\r\n  background-color: rgb(0 0 0 / 0.2);\r\n}\r\n.bg-black\\/5 {\r\n  background-color: rgb(0 0 0 / 0.05);\r\n}\r\n.bg-black\\/55 {\r\n  background-color: rgb(0 0 0 / 0.55);\r\n}\r\n.bg-border-theme {\r\n  background-color: var(--theme-border, #E5E7EB);\r\n}\r\n.bg-elevated-bg {\r\n  background-color: var(--theme-elevated, #FFFFFF);\r\n}\r\n.bg-gray-100 {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(243 244 246 / var(--tw-bg-opacity, 1));\r\n}\r\n.bg-neutral-600 {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(82 82 82 / var(--tw-bg-opacity, 1));\r\n}\r\n.bg-primary {\r\n  background-color: var(--theme-accent, #111827);\r\n}\r\n.bg-red-600 {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(220 38 38 / var(--tw-bg-opacity, 1));\r\n}\r\n.bg-sidebar-bg {\r\n  background-color: var(--theme-sidebar, #F9F8F6);\r\n}\r\n.bg-text-base {\r\n  background-color: var(--theme-fg, #1F2937);\r\n}\r\n.bg-transparent {\r\n  background-color: transparent;\r\n}\r\n.bg-white {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(255 255 255 / var(--tw-bg-opacity, 1));\r\n}\r\n.bg-white\\/10 {\r\n  background-color: rgb(255 255 255 / 0.1);\r\n}\r\n.bg-white\\/80 {\r\n  background-color: rgb(255 255 255 / 0.8);\r\n}\r\n.bg-gradient-to-r {\r\n  background-image: linear-gradient(to right, var(--tw-gradient-stops));\r\n}\r\n.from-hover-bg {\r\n  --tw-gradient-from: var(--theme-hover, #F3F4F6) var(--tw-gradient-from-position);\r\n  --tw-gradient-to: rgb(255 255 255 / 0) var(--tw-gradient-to-position);\r\n  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to);\r\n}\r\n.object-contain {\r\n  object-fit: contain;\r\n}\r\n.object-cover {\r\n  object-fit: cover;\r\n}\r\n.p-0 {\r\n  padding: 0px;\r\n}\r\n.p-1\\.5 {\r\n  padding: 0.375rem;\r\n}\r\n.p-2 {\r\n  padding: 0.5rem;\r\n}\r\n.p-3\\.5 {\r\n  padding: 0.875rem;\r\n}\r\n.px-0\\.5 {\r\n  padding-left: 0.125rem;\r\n  padding-right: 0.125rem;\r\n}\r\n.px-1 {\r\n  padding-left: 0.25rem;\r\n  padding-right: 0.25rem;\r\n}\r\n.px-1\\.5 {\r\n  padding-left: 0.375rem;\r\n  padding-right: 0.375rem;\r\n}\r\n.px-2 {\r\n  padding-left: 0.5rem;\r\n  padding-right: 0.5rem;\r\n}\r\n.px-2\\.5 {\r\n  padding-left: 0.625rem;\r\n  padding-right: 0.625rem;\r\n}\r\n.px-3 {\r\n  padding-left: 0.75rem;\r\n  padding-right: 0.75rem;\r\n}\r\n.px-3\\.5 {\r\n  padding-left: 0.875rem;\r\n  padding-right: 0.875rem;\r\n}\r\n.px-4 {\r\n  padding-left: 1rem;\r\n  padding-right: 1rem;\r\n}\r\n.px-6 {\r\n  padding-left: 1.5rem;\r\n  padding-right: 1.5rem;\r\n}\r\n.py-0\\.5 {\r\n  padding-top: 0.125rem;\r\n  padding-bottom: 0.125rem;\r\n}\r\n.py-1 {\r\n  padding-top: 0.25rem;\r\n  padding-bottom: 0.25rem;\r\n}\r\n.py-1\\.5 {\r\n  padding-top: 0.375rem;\r\n  padding-bottom: 0.375rem;\r\n}\r\n.py-2 {\r\n  padding-top: 0.5rem;\r\n  padding-bottom: 0.5rem;\r\n}\r\n.py-2\\.5 {\r\n  padding-top: 0.625rem;\r\n  padding-bottom: 0.625rem;\r\n}\r\n.py-3 {\r\n  padding-top: 0.75rem;\r\n  padding-bottom: 0.75rem;\r\n}\r\n.py-4 {\r\n  padding-top: 1rem;\r\n  padding-bottom: 1rem;\r\n}\r\n.py-5 {\r\n  padding-top: 1.25rem;\r\n  padding-bottom: 1.25rem;\r\n}\r\n.py-6 {\r\n  padding-top: 1.5rem;\r\n  padding-bottom: 1.5rem;\r\n}\r\n.py-\\[3px\\] {\r\n  padding-top: 3px;\r\n  padding-bottom: 3px;\r\n}\r\n.pb-0\\.5 {\r\n  padding-bottom: 0.125rem;\r\n}\r\n.pb-1 {\r\n  padding-bottom: 0.25rem;\r\n}\r\n.pb-2\\.5 {\r\n  padding-bottom: 0.625rem;\r\n}\r\n.pr-3\\.5 {\r\n  padding-right: 0.875rem;\r\n}\r\n.pt-0\\.5 {\r\n  padding-top: 0.125rem;\r\n}\r\n.pt-1\\.5 {\r\n  padding-top: 0.375rem;\r\n}\r\n.pt-2 {\r\n  padding-top: 0.5rem;\r\n}\r\n.pt-3 {\r\n  padding-top: 0.75rem;\r\n}\r\n.text-left {\r\n  text-align: left;\r\n}\r\n.text-right {\r\n  text-align: right;\r\n}\r\n.align-baseline {\r\n  vertical-align: baseline;\r\n}\r\n.align-top {\r\n  vertical-align: top;\r\n}\r\n.text-\\[10px\\] {\r\n  font-size: 10px;\r\n}\r\n.text-\\[11px\\] {\r\n  font-size: 11px;\r\n}\r\n.text-\\[12px\\] {\r\n  font-size: 12px;\r\n}\r\n.text-\\[13px\\] {\r\n  font-size: 13px;\r\n}\r\n.text-\\[18px\\] {\r\n  font-size: 18px;\r\n}\r\n.text-sm {\r\n  font-size: 0.875rem;\r\n  line-height: 1.25rem;\r\n}\r\n.text-xl {\r\n  font-size: 1.25rem;\r\n  line-height: 1.75rem;\r\n}\r\n.text-xs {\r\n  font-size: 0.75rem;\r\n  line-height: 1rem;\r\n}\r\n.font-medium {\r\n  font-weight: 500;\r\n}\r\n.font-normal {\r\n  font-weight: 400;\r\n}\r\n.font-semibold {\r\n  font-weight: 600;\r\n}\r\n.uppercase {\r\n  text-transform: uppercase;\r\n}\r\n.lowercase {\r\n  text-transform: lowercase;\r\n}\r\n.leading-4 {\r\n  line-height: 1rem;\r\n}\r\n.leading-5 {\r\n  line-height: 1.25rem;\r\n}\r\n.leading-6 {\r\n  line-height: 1.5rem;\r\n}\r\n.leading-\\[15px\\] {\r\n  line-height: 15px;\r\n}\r\n.leading-\\[17px\\] {\r\n  line-height: 17px;\r\n}\r\n.leading-none {\r\n  line-height: 1;\r\n}\r\n.leading-snug {\r\n  line-height: 1.375;\r\n}\r\n.text-\\[\\#8c8c8c\\] {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(140 140 140 / var(--tw-text-opacity, 1));\r\n}\r\n.text-\\[\\#e25507\\] {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(226 85 7 / var(--tw-text-opacity, 1));\r\n}\r\n.text-\\[\\#e25507\\]\\/80 {\r\n  color: rgb(226 85 7 / 0.8);\r\n}\r\n.text-amber-500 {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(245 158 11 / var(--tw-text-opacity, 1));\r\n}\r\n.text-amber-700 {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(180 83 9 / var(--tw-text-opacity, 1));\r\n}\r\n.text-black {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(0 0 0 / var(--tw-text-opacity, 1));\r\n}\r\n.text-blue-500 {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(59 130 246 / var(--tw-text-opacity, 1));\r\n}\r\n.text-gray-400 {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(156 163 175 / var(--tw-text-opacity, 1));\r\n}\r\n.text-gray-600 {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(75 85 99 / var(--tw-text-opacity, 1));\r\n}\r\n.text-green-500 {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(34 197 94 / var(--tw-text-opacity, 1));\r\n}\r\n.text-primary {\r\n  color: var(--theme-accent, #111827);\r\n}\r\n.text-red-500 {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(239 68 68 / var(--tw-text-opacity, 1));\r\n}\r\n.text-text-base {\r\n  color: var(--theme-fg, #1F2937);\r\n}\r\n.text-text-secondary {\r\n  color: var(--theme-text-secondary, #6B7280);\r\n}\r\n.text-transparent {\r\n  color: transparent;\r\n}\r\n.text-white {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(255 255 255 / var(--tw-text-opacity, 1));\r\n}\r\n.\\!no-underline {\r\n  text-decoration-line: none !important;\r\n}\r\n.placeholder-transparent::placeholder {\r\n  color: transparent;\r\n}\r\n.opacity-0 {\r\n  opacity: 0;\r\n}\r\n.opacity-40 {\r\n  opacity: 0.4;\r\n}\r\n.opacity-\\[0\\.55\\] {\r\n  opacity: 0.55;\r\n}\r\n.\\!shadow-none {\r\n  --tw-shadow: 0 0 #0000 !important;\r\n  --tw-shadow-colored: 0 0 #0000 !important;\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow) !important;\r\n}\r\n.shadow {\r\n  --tw-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);\r\n  --tw-shadow-colored: 0 1px 3px 0 var(--tw-shadow-color), 0 1px 2px -1px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-2xl {\r\n  --tw-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);\r\n  --tw-shadow-colored: 0 25px 50px -12px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-\\[0_2px_8px_rgba\\(0\\2c 0\\2c 0\\2c 0\\.35\\)\\] {\r\n  --tw-shadow: 0 2px 8px rgba(0,0,0,0.35);\r\n  --tw-shadow-colored: 0 2px 8px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-\\[0_6px_20px_rgba\\(0\\2c 0\\2c 0\\2c 0\\.06\\)\\] {\r\n  --tw-shadow: 0 6px 20px rgba(0,0,0,0.06);\r\n  --tw-shadow-colored: 0 6px 20px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-\\[0_6px_20px_rgba\\(31\\2c 38\\2c 48\\2c 0\\.08\\)\\] {\r\n  --tw-shadow: 0 6px 20px rgba(31,38,48,0.08);\r\n  --tw-shadow-colored: 0 6px 20px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-\\[0_6px_24px_rgb\\(0\\2c 0\\2c 0\\2c 0\\.12\\)\\] {\r\n  --tw-shadow: 0 6px 24px rgb(0,0,0,0.12);\r\n  --tw-shadow-colored: 0 6px 24px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-\\[0_6px_24px_rgba\\(0\\2c 0\\2c 0\\2c 0\\.10\\)\\] {\r\n  --tw-shadow: 0 6px 24px rgba(0,0,0,0.10);\r\n  --tw-shadow-colored: 0 6px 24px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-\\[0_6px_24px_rgba\\(0\\2c 0\\2c 0\\2c 0\\.12\\)\\] {\r\n  --tw-shadow: 0 6px 24px rgba(0,0,0,0.12);\r\n  --tw-shadow-colored: 0 6px 24px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-\\[0_8px_24px_rgba\\(31\\2c 38\\2c 48\\2c 0\\.09\\)\\] {\r\n  --tw-shadow: 0 8px 24px rgba(31,38,48,0.09);\r\n  --tw-shadow-colored: 0 8px 24px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-none {\r\n  --tw-shadow: 0 0 #0000;\r\n  --tw-shadow-colored: 0 0 #0000;\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.shadow-sm {\r\n  --tw-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);\r\n  --tw-shadow-colored: 0 1px 2px 0 var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.outline-none {\r\n  outline: 2px solid transparent;\r\n  outline-offset: 2px;\r\n}\r\n.outline {\r\n  outline-style: solid;\r\n}\r\n.ring {\r\n  --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);\r\n  --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color);\r\n  box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000);\r\n}\r\n.blur {\r\n  --tw-blur: blur(8px);\r\n  filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow);\r\n}\r\n.drop-shadow {\r\n  --tw-drop-shadow: drop-shadow(0 1px 2px rgb(0 0 0 / 0.1)) drop-shadow(0 1px 1px rgb(0 0 0 / 0.06));\r\n  filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow);\r\n}\r\n.invert {\r\n  --tw-invert: invert(100%);\r\n  filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow);\r\n}\r\n.filter {\r\n  filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow);\r\n}\r\n.backdrop-filter {\r\n  -webkit-backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);\r\n  backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);\r\n}\r\n.transition {\r\n  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;\r\n  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\r\n  transition-duration: 150ms;\r\n}\r\n.transition-all {\r\n  transition-property: all;\r\n  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\r\n  transition-duration: 150ms;\r\n}\r\n.transition-colors {\r\n  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;\r\n  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\r\n  transition-duration: 150ms;\r\n}\r\n.transition-none {\r\n  transition-property: none;\r\n}\r\n.transition-opacity {\r\n  transition-property: opacity;\r\n  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\r\n  transition-duration: 150ms;\r\n}\r\n.transition-transform {\r\n  transition-property: transform;\r\n  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\r\n  transition-duration: 150ms;\r\n}\r\n.duration-150 {\r\n  transition-duration: 150ms;\r\n}\r\n.duration-300 {\r\n  transition-duration: 300ms;\r\n}\r\n.duration-\\[400ms\\] {\r\n  transition-duration: 400ms;\r\n}\r\n.ease-in-out {\r\n  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\r\n}\r\n.ease-out {\r\n  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);\r\n}\r\n.bg-ui-tint {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 5%, transparent);\r\n  }\r\n.bg-ui-tint-strong {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 10%, transparent);\r\n  }\r\n.bg-ui-tint-medium {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 20%, transparent);\r\n  }\r\n/* WebView \u539F\u751F button \u4F1A\u76D6\u6389 Tailwind \u5706\u89D2\uFF0Chover \u5E95\u53D8\u65B9 \u2014\u2014 \u5F3A\u5236\u6B63\u5706 */\r\n.ui-circle-icon-btn {\r\n    appearance: none;\r\n    -webkit-appearance: none;\r\n    border: none;\r\n    border-radius: 9999px;\r\n    corner-shape: round;\r\n    overflow: hidden;\r\n    background-color: transparent;\r\n  }\r\n/* Sidebar highlight \u2014 \u4E0E Composer chip \u540C\u8BED\u8A00\uFF08\u4E2D\u6027 fg 5%\uFF09\uFF1B\u6697\u8272\u7565\u52A0\u5F3A */\r\n.bg-sidebar-highlight {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 5%, transparent);\r\n  }\r\nhtml.dark .bg-sidebar-highlight {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 10%, transparent);\r\n  }\r\nhtml.dark .hover\\:bg-sidebar-highlight:hover {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 10%, transparent);\r\n  }\r\n.\\[a-zA-Z0-9_\\:-\\] {\r\n  a-z-a--z0-9_: -;\r\n}\r\n\r\n:host {\r\n  --ui-interactive-radius: 12px;\r\n  --app-rail-width: 56px;\r\n  --app-titlebar-height: 56px;\r\n  --app-nav-button-size: 36px;\r\n  --app-nav-icon-size: 20px;\r\n  --app-nav-gap: 10px;\r\n}\r\n\r\n/* One policy for Tailwind, authored CSS, portal surfaces and canvas controls. */\r\n:host {\r\n  --continuous-corner-scale: 1;\r\n  --continuous-corner-curvature: 1;\r\n}\r\n@supports (corner-shape: superellipse(2)) {\r\n\r\n  :host {\r\n    --continuous-corner-scale: 1.6;\r\n    --continuous-corner-curvature: 1.7774679256350856;\r\n  }\r\n\r\n  :where(*, *::before, *::after) {\r\n    corner-shape: superellipse(var(--continuous-corner-curvature));\r\n  }\r\n}\r\n\r\n/* Match the interactive face and the sliding hover background. Keep explicit\r\n   circles, capsules, square edges and larger surface radii as authored. */\r\n:where(\r\n  button, [role="button"], [role="tab"], [role="option"],\r\n  [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"],\r\n  [data-menu-item], .ui-hover-highlight, .cursor-pointer\r\n):is(.rounded, .rounded-sm, .rounded-md, .rounded-lg, .rounded-xl):not(.rounded-full, .rounded-none) {\r\n  border-radius: calc((var(--ui-interactive-radius, 12px)) * var(--continuous-corner-scale));\r\n}\r\n\r\n.onboarding-primary {\r\n  corner-shape: superellipse(var(--connect-corner-curvature, var(--continuous-corner-curvature)));\r\n}\r\n.morph-menu-shell {\r\n  corner-shape: superellipse(var(--morph-corner-curvature, var(--continuous-corner-curvature)));\r\n}\r\n[data-spring-shell] {\r\n  corner-shape: superellipse(var(--spring-corner-curvature, var(--continuous-corner-curvature)));\r\n}\r\n\r\n/* The context sidebar and work surface share one frame beside the feature rail. */\r\n.app-workspace {\r\n  position: relative;\r\n  display: flex;\r\n  flex: 1;\r\n  min-width: 0;\r\n  min-height: 0;\r\n  overflow: hidden;\r\n  padding: 8px 8px 8px 0;\r\n}\r\n.app-titlebar-spacer { height: var(--app-titlebar-height); }\r\n.app-titlebar-navigation {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: var(--app-nav-gap);\r\n  height: 100%;\r\n  padding-left: calc((var(--app-rail-width) - var(--app-nav-button-size)) / 2);\r\n}\r\n.app-titlebar-navigation .app-titlebar-button {\r\n  width: var(--app-nav-button-size);\r\n  height: var(--app-nav-button-size);\r\n  padding: 0;\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n}\r\n.app-titlebar-button > svg,\r\n.app-navigation-rail button > svg {\r\n  width: var(--app-nav-icon-size);\r\n  height: var(--app-nav-icon-size);\r\n  flex-shrink: 0;\r\n}\r\n.app-navigation-rail {\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  flex-shrink: 0;\r\n  width: var(--app-rail-width);\r\n  padding: 12px 4px 8px;\r\n  gap: var(--app-nav-gap);\r\n}\r\n.app-navigation-rail .app-navigation-home {\r\n  width: var(--app-nav-button-size);\r\n  height: var(--app-nav-button-size);\r\n  padding: 0;\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n  color: var(--theme-text-secondary);\r\n  background: transparent;\r\n}\r\n.app-navigation-rail .app-navigation-home:hover,\r\n.app-navigation-rail .app-navigation-home[aria-current="page"] { color: var(--theme-fg); background: var(--theme-hover); }\r\n.app-navigation-items, .app-navigation-bottom {\r\n  position: relative;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: var(--app-nav-gap);\r\n  width: var(--app-nav-button-size);\r\n}\r\n.app-navigation-bottom { margin-top: auto; }\r\n.app-navigation-rail .app-navigation-button {\r\n  width: var(--app-nav-button-size);\r\n  height: var(--app-nav-button-size);\r\n  padding: 0;\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n  color: var(--theme-text-secondary);\r\n  background: transparent;\r\n}\r\n.app-navigation-button[aria-current="page"] { color: var(--theme-fg); }\r\n.app-navigation-rail .app-navigation-button:hover { background: var(--theme-hover); color: var(--theme-fg); }\r\n.app-navigation-rail .app-navigation-items .app-navigation-button:hover { background: transparent; }\r\n.app-navigation-rail button:focus-visible, .app-conversation-sidebar button:focus-visible {\r\n  outline: 2px solid var(--theme-accent);\r\n  outline-offset: 2px;\r\n}\r\n.app-content-frame {\r\n  position: relative;\r\n  display: flex;\r\n  flex: 1;\r\n  min-width: 0;\r\n  min-height: 0;\r\n  overflow: hidden;\r\n  border: 1px solid var(--theme-border);\r\n  border-radius: calc((24px) * var(--continuous-corner-scale));\r\n}\r\n.app-sidebar-region { display: flex; min-height: 0; flex-shrink: 0; }\r\n.app-workspace[data-sidebar-open="true"] .app-sidebar-region { border-right: 1px solid var(--theme-border); }\r\n.app-conversation-sidebar {\r\n  display: flex;\r\n  flex-direction: column;\r\n  width: 256px;\r\n  height: 100%;\r\n  min-height: 0;\r\n  flex-shrink: 0;\r\n  padding-top: 12px;\r\n  background: transparent;\r\n  font-size: 14px;\r\n  font-weight: 400;\r\n}\r\n.app-conversation-sidebar-header {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  min-height: 44px;\r\n  padding: 0 10px 10px 18px;\r\n  margin-bottom: 8px;\r\n}\r\n.app-conversation-sidebar-header strong { font-size: 18px; font-weight: 600; line-height: 26px; letter-spacing: -.025em; }\r\n.sidebar-section-heading { min-height: 28px; font-size: 13px; font-weight: 500; line-height: 20px; color: var(--theme-text-secondary); }\r\n.sidebar-project-row { min-height: 34px; border-radius: calc((8px) * var(--continuous-corner-scale)); font-size: 14px; font-weight: 500; line-height: 20px; }\r\n.sidebar-project-row:hover .sidebar-project-title,\r\n.sidebar-project-row:focus-within .sidebar-project-title,\r\n.sidebar-project-row[data-actions-visible="true"] .sidebar-project-title { padding-right: 64px; }\r\n.sidebar-session-row { border-radius: calc((8px) * var(--continuous-corner-scale)); }\r\n.sidebar-session-trigger { font-size: 14px; line-height: 20px; font-weight: 400; }\r\n.sidebar-session-row:hover .sidebar-session-content,\r\n.sidebar-session-row:focus-within .sidebar-session-content,\r\n.sidebar-session-row[data-running="true"] .sidebar-session-content { padding-right: 44px; }\r\n.app-content-frame > .app-main-surface {\r\n  min-width: 0;\r\n  min-height: 0;\r\n  border: 0;\r\n  border-radius: 0;\r\n}\r\n/* The selected variant has no rule underneath the conversation title. */\r\n.app-chat-header { border-bottom: 0; box-shadow: none; }\r\n.app-sidebar-backdrop { display: none; }\r\n@media (max-width: 740px) {\r\n  :host { --app-rail-width: 48px; --app-titlebar-height: 48px; }\r\n  .app-workspace { padding-right: 6px; }\r\n  .app-navigation-rail { padding-top: 10px; }\r\n  .app-sidebar-region { position: absolute; inset: 0 auto 0 0; z-index: 80; }\r\n  .app-workspace[data-sidebar-open="true"] .app-sidebar-region { border-right: 0; }\r\n  .app-sidebar-region > [data-spring-disclosure] { max-width: calc(100vw - 72px); background: var(--theme-sidebar); box-shadow: 8px 0 30px #0002; }\r\n  .app-workspace .app-sidebar-backdrop { display: block; position: absolute; inset: 0; width: auto; height: auto; padding: 0; border: 0; border-radius: 0; background: #0006; z-index: 70; }\r\n  .app-content-frame { border-radius: calc((22px) * var(--continuous-corner-scale)); }\r\n}\r\n.composer-suggest-scroll { scrollbar-gutter: stable; }\r\n@media (max-width: 640px) {\r\n  .composer-slash-row { grid-template-columns: 88px minmax(0, 1fr); }\r\n  .composer-slash-category { display: none; }\r\n}\r\n@media (max-width: 950px) {\r\n  .app-workspace .composer-toolbar { height: auto; min-height: 32px; flex-wrap: wrap; gap: 6px; }\r\n  .app-workspace .composer-primary-tools { flex: 1 0 auto; }\r\n  .app-workspace .composer-model-tools { margin-left: auto; }\r\n}\r\n\r\n/* Hide scrollbar on creative library sidebar */\r\n.creative-sidebar-scroll::-webkit-scrollbar {\r\n  display: none;\r\n}\r\n.creative-sidebar-scroll {\r\n  -ms-overflow-style: none;\r\n  scrollbar-width: none;\r\n}\r\n\r\n.node-picker-scroll {\r\n  -ms-overflow-style: none;\r\n  scrollbar-width: none;\r\n}\r\n.node-picker-scroll::-webkit-scrollbar {\r\n  display: none;\r\n  width: 0;\r\n  height: 0;\r\n}\r\n\r\n.theme-switch-reveal-overlay {\r\n  position: fixed;\r\n  inset: 0;\r\n  z-index: 2147483000;\r\n  pointer-events: none;\r\n  contain: strict;\r\n  will-change: mask-image, -webkit-mask-image;\r\n}\r\n\r\nhtml.theme-color-transition body,\r\nhtml.theme-color-transition #root,\r\nhtml.theme-color-transition .app-main-surface,\r\nhtml.theme-color-transition .bg-white,\r\nhtml.theme-color-transition .bg-gray-50,\r\nhtml.theme-color-transition .bg-gray-100,\r\nhtml.theme-color-transition .bg-sidebar-bg,\r\nhtml.theme-color-transition .border-border-theme,\r\nhtml.theme-color-transition .text-text-base,\r\nhtml.theme-color-transition .text-text-secondary {\r\n  transition-property: background-color, border-color, color, fill, stroke;\r\n  transition-duration: 180ms;\r\n  transition-timing-function: ease-out;\r\n}\r\n\r\n.dark .bg-white { background-color: var(--theme-bg) !important; }\r\n.dark .canvas-field { background-color: rgba(255, 255, 255, 0.06) !important; }\r\n.dark .text-gray-900, .dark .text-gray-800, .dark .text-black { color: var(--theme-fg) !important; }\r\n.dark .bg-gray-50, .dark .bg-gray-100 { background-color: var(--theme-sidebar) !important; }\r\n.dark .hover\\:bg-gray-100:hover, .dark .hover\\:bg-gray-50:hover { background-color: var(--theme-border) !important; }\r\n.dark .border-gray-200, .dark .border-gray-300 { border-color: var(--theme-border) !important; }\r\n.dark .text-gray-500, .dark .text-gray-600 { color: var(--theme-text-secondary) !important; }\r\n\r\n/* Theme-aware silent tints \u2014 replace bg-black/N which vanish in dark mode */\r\n\r\n/* Composer send \u2014 fg/bg invert per theme (ref: light=dark btn, dark=light btn) */\r\n.composer-send-btn {\r\n  flex-shrink: 0;\r\n  display: inline-flex;\r\n  height: 2rem;\r\n  width: 2rem;\r\n  align-items: center;\r\n  justify-content: center;\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n  transition: background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),\r\n    color 150ms cubic-bezier(0.4, 0, 0.2, 1);\r\n}\r\n.composer-send-btn--idle {\r\n  cursor: not-allowed;\r\n  background-color: color-mix(in srgb, var(--theme-fg) 22%, transparent);\r\n  color: color-mix(in srgb, var(--theme-bg) 90%, var(--theme-fg));\r\n}\r\n.composer-send-btn--ready,\r\n.composer-send-btn--stop {\r\n  cursor: pointer;\r\n  background-color: var(--theme-fg);\r\n  color: var(--theme-bg);\r\n}\r\n.composer-send-btn--ready:hover,\r\n.composer-send-btn--stop:hover {\r\n  background-color: color-mix(in srgb, var(--theme-fg) 88%, var(--theme-bg));\r\n}\r\n.composer-send-btn--plan {\r\n  cursor: pointer;\r\n  background-color: #d97706;\r\n  color: #fff;\r\n}\r\n.composer-send-btn--plan:hover {\r\n  background-color: #b45309;\r\n}\r\n\r\n/* \u8054\u7CFB\u5F00\u53D1\u8005 \xB7 \u590D\u5236\u72B6\u6001 */\r\n.contact-copy-field.is-copied {\r\n  background: color-mix(in srgb, #22c55e 14%, transparent);\r\n}\r\n.contact-copy-field.is-copied .block {\r\n  color: color-mix(in srgb, #15803d 88%, var(--theme-fg));\r\n}\r\nhtml.dark .contact-copy-field.is-copied .block {\r\n  color: #86efac;\r\n}\r\n\r\n/* Codex-style polish: slim scrollbars, no resize handles, focus rings off. */\r\n::-webkit-scrollbar {\r\n  width: 4px;\r\n  height: 4px;\r\n}\r\n::-webkit-scrollbar-track {\r\n  background: transparent;\r\n}\r\n::-webkit-scrollbar-thumb {\r\n  background: #e5e7eb;\r\n  border-radius: calc((4px) * var(--continuous-corner-scale));\r\n}\r\n::-webkit-scrollbar-thumb:hover {\r\n  background: #d1d5db;\r\n}\r\n\r\ntextarea {\r\n  resize: none;\r\n}\r\ntextarea:focus,\r\ninput:focus,\r\nbutton:focus {\r\n  outline: none;\r\n}\r\n\r\n/*\r\n * Translucent sidebar: when enabled on <html>, the window uses Tauri\'s Mica\r\n * effect and sidebar surfaces render at reduced opacity so the OS material\r\n * shows through. Body/root are transparent only in that mode; the main\r\n * content column keeps its own opaque background (bg-white / bg-bg-base),\r\n * so only the sidebar band actually reveals Mica.\r\n */\r\nhtml.theme-translucent-sidebar,\r\nhtml.theme-translucent-sidebar body,\r\nhtml.theme-translucent-sidebar #root {\r\n  background-color: transparent !important;\r\n}\r\n\r\nhtml.theme-translucent-sidebar .bg-sidebar-bg {\r\n  background-color: color-mix(in srgb, var(--theme-sidebar) 55%, transparent) !important;\r\n  backdrop-filter: saturate(180%) blur(18px);\r\n  -webkit-backdrop-filter: saturate(180%) blur(18px);\r\n}\r\nhtml.theme-translucent-sidebar.dark .bg-sidebar-bg {\r\n  background-color: color-mix(in srgb, var(--theme-sidebar) 65%, transparent) !important;\r\n}\r\n\r\n/*\r\n * The composer renders rich inline context chips in a mirror layer above a\r\n * transparent textarea. Hide the textarea\'s native selection so it cannot leak\r\n * private marker characters; Composer.tsx paints the visible selection itself.\r\n */\r\n.composer-textarea {\r\n  caret-color: transparent;\r\n}\r\n\r\n.composer-textarea.composer-textarea--empty {\r\n  caret-color: var(--theme-fg, #111827);\r\n}\r\n\r\n.composer-textarea::selection {\r\n  background: transparent;\r\n  color: transparent;\r\n}\r\n\r\n.composer-textarea::-moz-selection {\r\n  background: transparent;\r\n  color: transparent;\r\n}\r\n\r\n.composer-mirror-caret {\r\n  display: inline-block;\r\n  width: 1px;\r\n  height: 1.25em;\r\n  margin: 0 -0.5px;\r\n  vertical-align: -0.2em;\r\n  background: var(--theme-fg, #111827);\r\n  animation: composer-caret-blink 1.05s steps(1) infinite;\r\n}\r\n\r\n@keyframes composer-caret-blink {\r\n  0%,\r\n  52% {\r\n    opacity: 1;\r\n  }\r\n  53%,\r\n  100% {\r\n    opacity: 0;\r\n  }\r\n}\r\n\r\n.no-select {\r\n  user-select: none;\r\n}\r\n\r\n.stable-scrollbar-gutter {\r\n  scrollbar-gutter: stable;\r\n}\r\n\r\n.terminal-surface .xterm {\r\n  height: 100%;\r\n  width: 100%;\r\n}\r\n\r\n.terminal-surface .xterm-viewport {\r\n  overflow-y: auto !important;\r\n  background: var(--theme-bg, #ffffff) !important;\r\n  scrollbar-width: thin;\r\n  scrollbar-color: rgba(148, 163, 184, 0.7) transparent;\r\n}\r\n\r\n.terminal-surface .xterm-viewport::-webkit-scrollbar {\r\n  width: 10px;\r\n}\r\n\r\n.terminal-surface .xterm-viewport::-webkit-scrollbar-track {\r\n  background: transparent;\r\n}\r\n\r\n.terminal-surface .xterm-viewport::-webkit-scrollbar-thumb {\r\n  background: rgba(148, 163, 184, 0.7);\r\n  border: 3px solid transparent;\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n  background-clip: content-box;\r\n  min-height: 48px;\r\n}\r\n\r\n.terminal-surface .xterm-viewport::-webkit-scrollbar-thumb:hover {\r\n  background: rgba(100, 116, 139, 0.78);\r\n  border: 3px solid transparent;\r\n  background-clip: content-box;\r\n}\r\n\r\n.terminal-surface .xterm-screen canvas {\r\n  background: var(--theme-bg, #ffffff) !important;\r\n}\r\n\r\n.panel-resize-handle-col {\r\n  position: absolute;\r\n  top: 0;\r\n  bottom: 0;\r\n  left: 0;\r\n  width: 10px;\r\n  margin-left: -5px;\r\n  cursor: col-resize;\r\n  z-index: 50;\r\n}\r\n\r\n.panel-resize-handle-col::after {\r\n  content: "";\r\n  position: absolute;\r\n  top: 12px;\r\n  bottom: 12px;\r\n  left: 50%;\r\n  width: 1px;\r\n  transform: translateX(-50%);\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n  background: rgba(148, 163, 184, 0.28);\r\n  transition:\r\n    background-color 160ms ease,\r\n    box-shadow 160ms ease,\r\n    width 160ms ease,\r\n    opacity 160ms ease;\r\n}\r\n\r\n.panel-resize-handle-col:hover::after {\r\n  background: rgba(100, 116, 139, 0.42);\r\n}\r\n\r\n.panel-resize-handle-col.is-active::after {\r\n  width: 1px;\r\n  background: rgba(100, 116, 139, 0.42);\r\n  box-shadow: none;\r\n}\r\n\r\n.panel-resize-handle-row {\r\n  position: absolute;\r\n  left: 0;\r\n  right: 0;\r\n  top: 0;\r\n  height: 10px;\r\n  margin-top: -5px;\r\n  cursor: row-resize;\r\n  z-index: 50;\r\n}\r\n\r\n.panel-resize-handle-row::after {\r\n  content: "";\r\n  position: absolute;\r\n  left: 12px;\r\n  right: 12px;\r\n  top: 50%;\r\n  height: 1px;\r\n  transform: translateY(-50%);\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n  background: rgba(148, 163, 184, 0.24);\r\n  transition:\r\n    background-color 160ms ease,\r\n    box-shadow 160ms ease,\r\n    height 160ms ease,\r\n    opacity 160ms ease;\r\n}\r\n\r\n.panel-resize-handle-row:hover::after {\r\n  background: rgba(100, 116, 139, 0.36);\r\n}\r\n\r\n.panel-resize-handle-row.is-active::after {\r\n  height: 1px;\r\n  background: rgba(100, 116, 139, 0.36);\r\n  box-shadow: none;\r\n}\r\n\r\n.view-frame {\r\n  display: flex;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 0;\r\n  flex-direction: column;\r\n  animation: view-frame-in 220ms cubic-bezier(0.16, 1, 0.3, 1);\r\n  will-change: opacity, transform;\r\n}\r\n\r\n.app-main-surface {\r\n  contain: layout paint;\r\n  view-transition-name: app-main-surface;\r\n}\r\n\r\n.popover-menu,\r\n.floating-menu-panel {\r\n  animation: floating-menu-panel-in 300ms cubic-bezier(0.4, 0, 0.2, 1);\r\n  will-change: opacity, transform;\r\n}\r\n\r\n/* \u5165\u573A\u52A8\u753B\u53EA\u914D open \u6001\uFF1A\u5173\u95ED\u65F6\u5FC5\u987B\u663E\u5F0F\u6E05\u6389 animation\uFF0C\u5426\u5219 Radix Presence\r\n   \u68C0\u6D4B\u5230 animationName \u975E none \u4F1A\u4E00\u76F4\u7B49 animationend\uFF08\u5DF2\u64AD\u5B8C\u4E0D\u518D\u89E6\u53D1\uFF09\uFF0C\r\n   \u9762\u677F\u6C38\u4E0D\u5378\u8F7D\u5E76\u6301\u7EED\u5360\u636E\u7126\u70B9\uFF08\u884C\u5185\u8F93\u5165\u6846 autoFocus \u88AB\u541E\u7684\u6839\u56E0\uFF09\u3002 */\r\n.popover-menu[data-state="closed"],\r\n.floating-menu-panel[data-state="closed"] {\r\n  animation: none;\r\n  will-change: auto;\r\n}\r\n\r\n.floating-menu-item {\r\n  animation: floating-menu-item-in 220ms cubic-bezier(0.4, 0, 0.2, 1) 60ms both;\r\n}\r\n\r\n/* These surfaces use GSAP; do not run a second CSS entrance on their children. */\r\n.spring-surface,\r\n.spring-surface .floating-menu-panel,\r\n.spring-surface .floating-menu-item {\r\n  animation: none !important;\r\n  transition: none;\r\n}\r\n.spring-surface-content { min-width: 0; }\r\n.spring-settings-section { animation: none !important; }\r\n.spring-surface[data-state="closed"],\r\n.spring-surface[data-closed] { pointer-events: none; }\r\n\r\n.morph-menu-shell .floating-menu-panel,\r\n.morph-menu-shell .floating-menu-item {\r\n  animation: none !important;\r\n}\r\n.morph-menu-expanded .morph-menu-content { border-radius: inherit; corner-shape: inherit; }\r\n\r\n@keyframes floating-menu-panel-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(8px) scale(0.96);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0) scale(1);\r\n  }\r\n}\r\n\r\n@keyframes floating-menu-item-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(4px);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0);\r\n  }\r\n}\r\n\r\n/* MorphingSelect \u2014 goo morph + stagger items + label roll */\r\n.morph-select-item-in {\r\n  animation: morph-select-item-in 360ms cubic-bezier(0.19, 1, 0.22, 1) both;\r\n}\r\n\r\n@keyframes morph-select-item-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(10px);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0);\r\n  }\r\n}\r\n\r\n.morph-select-label {\r\n  display: inline-block;\r\n  animation: morph-select-label-roll 320ms cubic-bezier(0.19, 1, 0.22, 1) both;\r\n}\r\n\r\n@keyframes morph-select-label-roll {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(12px);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0);\r\n  }\r\n}\r\n\r\n@media (prefers-reduced-motion: reduce) {\r\n  .morph-select-item-in,\r\n  .morph-select-label {\r\n    animation: none !important;\r\n  }\r\n}\r\n\r\n.message-notice {\r\n  animation: message-notice-in 160ms ease-out;\r\n  will-change: opacity, transform;\r\n}\r\n\r\n.right-sidebar-workbench {\r\n  display: flex;\r\n  flex-shrink: 0;\r\n  transition: width 400ms cubic-bezier(0.22, 1, 0.36, 1);\r\n  will-change: width;\r\n}\r\n\r\n.right-sidebar-workbench > div {\r\n  transition: opacity 320ms ease 60ms;\r\n  will-change: opacity;\r\n}\r\n\r\n.right-sidebar-workbench .panel-resize-handle-col::after {\r\n  top: 0;\r\n  bottom: 0;\r\n  width: 1px;\r\n  border-radius: 0;\r\n  background: rgba(15, 23, 42, 0.08);\r\n}\r\n\r\n.right-sidebar-workbench .panel-resize-handle-col:hover::after,\r\n.right-sidebar-workbench .panel-resize-handle-col.is-active::after {\r\n  width: 1px;\r\n  background: rgba(15, 23, 42, 0.14);\r\n}\r\n\r\n.right-sidebar-workbench.is-maximized {\r\n  position: absolute;\r\n  inset: 0;\r\n  z-index: 40;\r\n  width: 100% !important;\r\n  animation: none;\r\n  transition: opacity 180ms ease;\r\n  will-change: opacity;\r\n}\r\n\r\n.right-sidebar-workbench.is-maximized > div {\r\n  transform: none;\r\n  transition: opacity 180ms ease;\r\n  will-change: opacity;\r\n}\r\n\r\n.right-sidebar-workbench.is-resizing,\r\n.right-sidebar-workbench.is-resizing > div {\r\n  transition: none;\r\n  cursor: col-resize;\r\n}\r\n\r\n.right-sidebar-workbench.is-resizing * {\r\n  cursor: col-resize;\r\n  user-select: none;\r\n}\r\n\r\n.right-sidebar-workbench .panel-resize-handle-col {\r\n  width: 12px;\r\n  margin-left: -6px;\r\n}\r\n\r\n.right-sidebar-workbench.is-opening > div,\r\n.right-sidebar-workbench:not(.is-closing):not(.is-resizing) > div {\r\n  opacity: 1;\r\n}\r\n\r\n.right-sidebar-workbench.is-closing {\r\n  opacity: 1;\r\n}\r\n\r\n.right-sidebar-workbench.is-closing > div {\r\n  opacity: 0;\r\n  transition: opacity 220ms ease;\r\n}\r\n\r\n.right-sidebar-workbench[data-spring-panel],\r\n.right-sidebar-workbench[data-spring-panel] > div {\r\n  transition: none;\r\n}\r\n\r\n.bottom-panel-workbench {\r\n  transition:\r\n    height 400ms cubic-bezier(0.22, 1, 0.36, 1),\r\n    min-height 400ms cubic-bezier(0.22, 1, 0.36, 1);\r\n  will-change: height;\r\n}\r\n\r\n.bottom-panel-workbench.is-resizing {\r\n  transition: none;\r\n}\r\n\r\n.bottom-panel-workbench.is-resizing .bottom-panel-workbench-inner {\r\n  transition: none;\r\n}\r\n\r\n.bottom-panel-workbench .bottom-panel-workbench-inner {\r\n  transition: opacity 320ms ease 60ms;\r\n  will-change: opacity;\r\n}\r\n\r\n.bottom-panel-workbench.is-opening .bottom-panel-workbench-inner,\r\n.bottom-panel-workbench:not(.is-closing):not(.is-resizing) .bottom-panel-workbench-inner {\r\n  opacity: 1;\r\n}\r\n\r\n.bottom-panel-workbench.is-closing .bottom-panel-workbench-inner {\r\n  opacity: 0;\r\n  transition: opacity 220ms ease;\r\n}\r\n\r\n.project-map-view {\r\n  animation: view-frame-in 120ms ease-out;\r\n}\r\n\r\n.settings-section {\r\n  animation: view-frame-in 180ms cubic-bezier(0.16, 1, 0.3, 1);\r\n  will-change: opacity, transform;\r\n}\r\n\r\n.approval-card {\r\n  animation: approval-card-in 140ms ease-out;\r\n}\r\n\r\n.modal-layer {\r\n  animation: modal-layer-in 120ms ease-out;\r\n}\r\n\r\n.modal-panel {\r\n  animation: modal-panel-in 140ms ease-out;\r\n  will-change: opacity, transform;\r\n}\r\n\r\n.onboarding-door-line {\r\n  height: 100%;\r\n  opacity: 0;\r\n}\r\n\r\n.onboarding-transition-dot {\r\n  opacity: 0;\r\n  transform: translate(-50%, -50%);\r\n  transform-origin: center;\r\n}\r\n\r\n.onboarding-welcome-text {\r\n  visibility: hidden;\r\n  opacity: 0;\r\n  white-space: nowrap;\r\n  transform-origin: center;\r\n  font-size: clamp(18px, 2.4vw, 30px);\r\n}\r\n\r\n.onboarding-card {\r\n  opacity: 1;\r\n  transform: scale(1);\r\n  filter: blur(0);\r\n  width: min(512px, calc(100% - 40px));\r\n  padding: 40px;\r\n  animation: onboarding-card-in 350ms ease-out;\r\n}\r\n\r\n.onboarding-panel-header { margin-bottom: 32px; }\r\n.onboarding-emblem {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  width: 64px;\r\n  height: 64px;\r\n  margin: 0 auto 24px;\r\n  border: 1px solid var(--theme-border);\r\n  border-radius: calc((16px) * var(--continuous-corner-scale));\r\n  background: var(--theme-sidebar);\r\n}\r\n.onboarding-emblem > svg { width: 24px; height: 24px; }\r\n.onboarding-brand { width: 80px; height: 80px; border: 0; background: transparent; }\r\n.onboarding-brand img { width: 80px; height: 80px; object-fit: contain; }\r\n.onboarding-actions { display: flex; justify-content: center; gap: 12px; margin-top: 32px; }\r\n.onboarding-actions-connect { margin-top: 24px; }\r\n.onboarding-primary, .onboarding-back { height: 46px; border-radius: calc((12px) * var(--continuous-corner-scale)); font-size: 14px; }\r\n.onboarding-primary { color: var(--theme-bg); background: var(--theme-fg); }\r\n.onboarding-primary:hover { background: var(--theme-fg); opacity: .9; }\r\n.onboarding-back { padding-inline: 24px; color: var(--theme-text-secondary); background: transparent; }\r\n.onboarding-back:hover { background: var(--theme-sidebar); }\r\n.onboarding-key-field {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 12px;\r\n  height: 46px;\r\n  padding: 0 13px;\r\n  border: 1px solid var(--theme-border);\r\n  border-radius: calc((12px) * var(--continuous-corner-scale));\r\n  transition: border-color 150ms, box-shadow 150ms;\r\n}\r\n.onboarding-key-field:focus-within { border-color: var(--theme-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-accent) 12%, transparent); }\r\n.onboarding-key-field.onboarding-key-invalid { border-color: #c44949; }\r\n.onboarding-inline-error { display: grid; grid-template-rows: 0fr; opacity: 0; color: #c44949; font-size: 11px; line-height: 19px; transition: grid-template-rows 200ms, opacity 200ms; }\r\n.onboarding-inline-error > div { min-height: 0; overflow: hidden; }\r\n.onboarding-error-visible { grid-template-rows: 1fr; opacity: 1; }\r\n.onboarding-error-visible > div { padding-top: 8px; }\r\n.dark .onboarding-inline-error { color: #f18c8c; }\r\n.dark .onboarding-key-field.onboarding-key-invalid { border-color: #f18c8c; }\r\n.onboarding-choices { display: grid; gap: 10px; }\r\n.onboarding-choices-theme { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }\r\n.onboarding-choices-work { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }\r\n.onboarding-choice {\r\n  position: relative;\r\n  display: flex;\r\n  align-items: flex-start;\r\n  justify-content: flex-start;\r\n  gap: 12px;\r\n  width: 100%;\r\n  height: auto;\r\n  padding: 16px;\r\n  border: 1px solid var(--theme-border);\r\n  border-radius: calc((12px) * var(--continuous-corner-scale));\r\n  background: transparent;\r\n  color: var(--theme-text-secondary);\r\n  text-align: left;\r\n  white-space: normal;\r\n}\r\n.onboarding-choice:hover { background: transparent; color: var(--theme-fg); }\r\n.onboarding-choice[aria-checked=true] { border-color: transparent; color: var(--theme-fg); }\r\n.onboarding-choice > * { position: relative; z-index: 1; }\r\n.onboarding-choice > .onboarding-choice-surface { position: absolute; z-index: 0; inset: -1px; border: 1px solid var(--theme-fg); border-radius: calc((12px) * var(--continuous-corner-scale)); background: var(--theme-sidebar); pointer-events: none; }\r\n.onboarding-choice-copy { min-width: 0; flex: 1; order: 1; }\r\n.onboarding-choice-title { display: block; font-size: 14px; font-weight: 500; line-height: 20px; }\r\n.onboarding-choice-description { display: block; margin-top: 4px; font-size: 12px; font-weight: 400; line-height: 20px; }\r\n.onboarding-choice-icon { width: 16px; height: 16px; margin-top: 1px; flex-shrink: 0; order: 2; }\r\n.onboarding-choices-theme .onboarding-choice { flex-direction: column; align-items: center; gap: 8px; padding: 24px 8px; text-align: center; }\r\n.onboarding-choices-theme .onboarding-choice-icon { width: 18px; height: 18px; margin: 0; order: 0; }\r\n.onboarding-choices-work .onboarding-choice { display: grid; grid-template-columns: 1fr auto; gap: 11px; padding: 16px; }\r\n.onboarding-choices-work .onboarding-choice-copy { grid-column: 1 / -1; order: 2; }\r\n.onboarding-choices-work .onboarding-choice-icon { order: 1; }\r\n.onboarding-radio { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-top: 1px; border: 2px solid var(--theme-border); border-radius: 50%; corner-shape: round; flex-shrink: 0; transition: border-color 160ms; }\r\n.onboarding-radio::after { content: ""; width: 10px; height: 10px; border-radius: 50%; corner-shape: round; background: var(--theme-fg); transform: scale(0); transition: transform 180ms; }\r\n.onboarding-choice[aria-checked=true] .onboarding-radio { border-color: var(--theme-fg); }\r\n.onboarding-choice[aria-checked=true] .onboarding-radio::after { transform: scale(1); }\r\n.onboarding-language-menu[data-state=open] { animation: onboarding-menu-in 160ms ease-out; }\r\n.onboarding-language-menu[data-state=closed] { animation: onboarding-menu-out 140ms ease-in; }\r\n.onboarding-language-trigger { color: var(--theme-fg); }\r\n.onboarding-overlay { transition: color 180ms; }\r\n.onboarding-overlay .onboarding-card, .onboarding-overlay .onboarding-door, .onboarding-overlay .onboarding-emblem { transition: background-color 180ms, border-color 180ms, color 180ms; }\r\n\r\n@keyframes onboarding-card-in { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }\r\n@keyframes onboarding-menu-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }\r\n@keyframes onboarding-menu-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(-4px) scale(.98); } }\r\n@media (max-width: 560px) {\r\n  .onboarding-card { width: calc(100% - 24px); padding: 24px; }\r\n}\r\n@media (max-height: 690px) {\r\n  .onboarding-card { max-height: calc(100% - 24px); overflow-y: auto; padding-block: 24px; }\r\n  .onboarding-panel-header { margin-bottom: 24px; }\r\n}\r\n@media (prefers-reduced-motion: reduce) {\r\n  .onboarding-card, .onboarding-language-menu { animation: none !important; }\r\n  .onboarding-overlay *, .onboarding-language-menu { transition: none !important; }\r\n}\r\n\r\n@keyframes view-frame-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(8px) scale(0.995);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0) scale(1);\r\n  }\r\n}\r\n\r\n::view-transition-old(app-main-surface),\r\n::view-transition-new(app-main-surface) {\r\n  height: 100%;\r\n  overflow: hidden;\r\n  animation-duration: 240ms;\r\n  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);\r\n  mix-blend-mode: normal;\r\n}\r\n\r\n::view-transition-old(app-main-surface) {\r\n  animation-name: app-main-surface-out;\r\n}\r\n\r\n::view-transition-new(app-main-surface) {\r\n  animation-name: app-main-surface-in;\r\n}\r\n\r\n@keyframes app-main-surface-out {\r\n  from {\r\n    opacity: 1;\r\n    transform: translateX(0) scale(1);\r\n    filter: blur(0);\r\n  }\r\n  to {\r\n    opacity: 0.42;\r\n    transform: translateX(-10px) scale(0.996);\r\n    filter: blur(0.35px);\r\n  }\r\n}\r\n\r\n@keyframes app-main-surface-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateX(14px) scale(0.996);\r\n    filter: blur(0.35px);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateX(0) scale(1);\r\n    filter: blur(0);\r\n  }\r\n}\r\n\r\n@media (prefers-reduced-motion: reduce) {\r\n  .view-frame,\r\n  .settings-section,\r\n  .project-map-view,\r\n  .right-sidebar-workbench,\r\n  .right-sidebar-workbench > div,\r\n  .bottom-panel-workbench,\r\n  .bottom-panel-workbench .bottom-panel-workbench-inner,\r\n  .modal-layer,\r\n  .modal-panel,\r\n  .popover-menu,\r\n  .floating-menu-panel,\r\n  .floating-menu-item,\r\n  .message-notice,\r\n  .approval-card {\r\n    animation: none !important;\r\n    transition: none !important;\r\n  }\r\n\r\n  ::view-transition-old(app-main-surface),\r\n  ::view-transition-new(app-main-surface) {\r\n    animation: none !important;\r\n  }\r\n}\r\n\r\n@keyframes popover-menu-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(5px) scale(0.98);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0) scale(1);\r\n  }\r\n}\r\n\r\n@keyframes message-notice-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(-10px) scale(0.98);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0) scale(1);\r\n  }\r\n}\r\n\r\n@keyframes right-sidebar-workbench-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateX(18px);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateX(0);\r\n  }\r\n}\r\n\r\n@keyframes approval-card-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(8px) scale(0.99);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0) scale(1);\r\n  }\r\n}\r\n\r\n@keyframes modal-layer-in {\r\n  from {\r\n    opacity: 0;\r\n  }\r\n  to {\r\n    opacity: 1;\r\n  }\r\n}\r\n\r\n@keyframes modal-panel-in {\r\n  from {\r\n    opacity: 0;\r\n    transform: translateY(-8px) scale(0.98);\r\n  }\r\n  to {\r\n    opacity: 1;\r\n    transform: translateY(0) scale(1);\r\n  }\r\n}\r\n\r\n.studio-infinite-canvas {\r\n  background: var(--theme-bg, #ffffff);\r\n}\r\n\r\n.studio-infinite-canvas.is-tool-pan .react-flow__pane {\r\n  cursor: grab;\r\n}\r\n\r\n.studio-infinite-canvas.is-tool-pan .react-flow__pane.dragging {\r\n  cursor: grabbing;\r\n}\r\n\r\n.studio-infinite-canvas.is-tool-select .react-flow__pane {\r\n  cursor: default;\r\n}\r\n\r\n.studio-canvas-toolbar {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 2px;\r\n  margin: 12px 0 0 12px !important;\r\n  padding: 4px;\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 94%, transparent);\r\n  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.09);\r\n  backdrop-filter: blur(12px);\r\n  transition: box-shadow 160ms ease, background-color 160ms ease;\r\n}\r\n\r\n.studio-canvas-toolbar.is-collapsed {\r\n  gap: 0;\r\n}\r\n\r\n.studio-canvas-toolbar button {\r\n  display: grid;\r\n  width: 30px;\r\n  height: 30px;\r\n  place-items: center;\r\n  border: 0;\r\n  border-radius: calc((7px) * var(--continuous-corner-scale));\r\n  background: transparent;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 12px;\r\n  transition: background-color 140ms ease, color 140ms ease, transform 140ms ease;\r\n}\r\n\r\n.studio-canvas-toolbar button:hover:not(:disabled) {\r\n  background: var(--theme-sidebar, #f8f7f5);\r\n  color: var(--theme-fg, #1f2937);\r\n}\r\n\r\n.studio-canvas-toolbar button:active:not(:disabled) {\r\n  transform: scale(0.94);\r\n}\r\n\r\n.studio-canvas-toolbar button.is-active {\r\n  background: color-mix(in srgb, var(--theme-primary, #3b82f6) 12%, transparent);\r\n  color: var(--theme-primary, #2563eb);\r\n}\r\n\r\n.studio-canvas-toolbar .studio-toolbar-collapse {\r\n  color: color-mix(in srgb, var(--theme-text-secondary, #6b7280) 82%, transparent);\r\n}\r\n\r\n.studio-canvas-toolbar button:disabled {\r\n  opacity: 0.3;\r\n  cursor: default;\r\n}\r\n\r\n.studio-toolbar-divider {\r\n  width: 1px;\r\n  height: 18px;\r\n  margin: 0 2px;\r\n  background: var(--theme-border, #e5e7eb);\r\n}\r\n\r\n.studio-note-node {\r\n  position: relative;\r\n  display: flex;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 192px;\r\n  min-height: 120px;\r\n  flex-direction: column;\r\n  overflow: hidden;\r\n  border: 1px solid color-mix(in srgb, var(--theme-border, #e5e7eb) 88%, transparent);\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 97%, #fef3c7 3%);\r\n  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);\r\n  transition: border-color 140ms ease, box-shadow 140ms ease;\r\n}\r\n\r\n.studio-note-node:hover {\r\n  border-color: color-mix(in srgb, var(--theme-text-secondary, #6b7280) 40%, transparent);\r\n}\r\n\r\n.studio-note-node.is-selected {\r\n  border-color: var(--theme-primary, #3b82f6);\r\n  box-shadow: 0 0 0 1px color-mix(in srgb, var(--theme-primary, #3b82f6) 22%, transparent),\r\n    0 12px 32px rgba(15, 23, 42, 0.1);\r\n}\r\n\r\n.studio-note-header {\r\n  display: flex;\r\n  width: 100%;\r\n  flex: 0 0 auto;\r\n  align-items: center;\r\n  border-bottom: 1px solid color-mix(in srgb, var(--theme-border, #e5e7eb) 70%, transparent);\r\n}\r\n\r\n.studio-note-drag-handle {\r\n  display: grid;\r\n  width: 30px;\r\n  height: 40px;\r\n  flex: 0 0 30px;\r\n  place-items: center;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  cursor: grab;\r\n  font-size: 12px;\r\n  opacity: 0.42;\r\n  transition: color 140ms ease, opacity 140ms ease;\r\n}\r\n\r\n.studio-note-node:hover .studio-note-drag-handle,\r\n.studio-note-node.is-selected .studio-note-drag-handle {\r\n  color: var(--theme-primary, #3b82f6);\r\n  opacity: 0.85;\r\n}\r\n\r\n.studio-note-drag-handle:active {\r\n  cursor: grabbing;\r\n}\r\n\r\n.studio-note-title {\r\n  width: 100%;\r\n  min-width: 0;\r\n  border: 0;\r\n  background: transparent;\r\n  padding: 12px 14px 10px 2px;\r\n  color: var(--theme-fg, #1f2937);\r\n  font-size: 13px;\r\n  font-weight: 600;\r\n  line-height: 1.2;\r\n}\r\n\r\n.studio-note-body {\r\n  width: 100%;\r\n  min-height: 0;\r\n  flex: 1 1 auto;\r\n  border: 0;\r\n  background: transparent;\r\n  padding: 10px 14px 14px;\r\n  color: var(--theme-fg, #1f2937);\r\n  font-family: inherit;\r\n  font-size: 12px;\r\n  line-height: 1.55;\r\n}\r\n\r\n.studio-note-title::placeholder,\r\n.studio-note-body::placeholder {\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  opacity: 0.68;\r\n}\r\n\r\n.studio-note-handle {\r\n  width: 8px !important;\r\n  height: 8px !important;\r\n  border: 2px solid var(--theme-bg, #ffffff) !important;\r\n  background: var(--theme-primary, #3b82f6) !important;\r\n  opacity: 0;\r\n  transition: opacity 140ms ease, transform 140ms ease;\r\n}\r\n\r\n.studio-note-node:hover .studio-note-handle,\r\n.studio-note-node.is-selected .studio-note-handle {\r\n  opacity: 1;\r\n}\r\n\r\n.studio-note-handle:hover {\r\n  transform: scale(1.28);\r\n}\r\n\r\n.studio-note-resize-line {\r\n  border-color: transparent !important;\r\n}\r\n\r\n.studio-note-resize-handle {\r\n  width: 7px !important;\r\n  height: 7px !important;\r\n  border: 1px solid var(--theme-bg, #ffffff) !important;\r\n  border-radius: calc((2px) * var(--continuous-corner-scale)) !important;\r\n  background: var(--theme-primary, #3b82f6) !important;\r\n}\r\n\r\n.studio-infinite-canvas .react-flow__selection,\r\n.studio-infinite-canvas .react-flow__nodesselection-rect {\r\n  border: 1px solid color-mix(in srgb, var(--theme-primary, #3b82f6) 70%, transparent);\r\n  background: color-mix(in srgb, var(--theme-primary, #3b82f6) 7%, transparent);\r\n}\r\n\r\n.studio-infinite-canvas .react-flow__edge-path {\r\n  stroke: color-mix(in srgb, var(--theme-text-secondary, #6b7280) 70%, transparent);\r\n  stroke-width: 1.5;\r\n}\r\n\r\n.studio-infinite-canvas .react-flow__edge.selected .react-flow__edge-path {\r\n  stroke: var(--theme-primary, #3b82f6);\r\n  stroke-width: 2;\r\n}\r\n\r\n.studio-canvas-toolbar {\r\n  z-index: 40;\r\n}\r\n\r\n.studio-node-toolbar {\r\n  display: flex;\r\n  overflow: hidden;\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: calc((8px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 96%, transparent);\r\n  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);\r\n  backdrop-filter: blur(12px);\r\n}\r\n\r\n.studio-node-toolbar button {\r\n  border: 0;\r\n  border-right: 1px solid var(--theme-border, #e5e7eb);\r\n  background: transparent;\r\n  padding: 6px 9px;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 10px;\r\n  line-height: 1;\r\n}\r\n\r\n.studio-node-toolbar button:last-child {\r\n  border-right: 0;\r\n}\r\n\r\n.studio-node-toolbar button:hover {\r\n  background: var(--theme-sidebar, #f8f7f5);\r\n  color: var(--theme-fg, #1f2937);\r\n}\r\n\r\n.studio-note-node.is-locked,\r\n.studio-text-node.is-locked,\r\n.studio-shape-node.is-locked,\r\n.studio-drawing-node.is-locked,\r\n.studio-group-node.is-locked,\r\n.studio-miniapp-node.is-locked {\r\n  cursor: not-allowed;\r\n}\r\n\r\n.studio-note-node.is-locked::after,\r\n.studio-text-node.is-locked::after,\r\n.studio-shape-node.is-locked::after,\r\n.studio-drawing-node.is-locked::after,\r\n.studio-group-node.is-locked::after,\r\n.studio-miniapp-node.is-locked::after {\r\n  content: "\u5DF2\u9501\u5B9A";\r\n  position: absolute;\r\n  z-index: 3;\r\n  top: 6px;\r\n  right: 7px;\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 90%, transparent);\r\n  padding: 3px 6px;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 8px;\r\n  font-weight: 600;\r\n  line-height: 1;\r\n  pointer-events: none;\r\n}\r\n\r\n.studio-text-node {\r\n  position: relative;\r\n  display: flex;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 120px;\r\n  min-height: 48px;\r\n  align-items: flex-start;\r\n  border: 1px solid transparent;\r\n  border-radius: calc((8px) * var(--continuous-corner-scale));\r\n  background: transparent;\r\n}\r\n\r\n.studio-text-node:hover,\r\n.studio-text-node.is-selected {\r\n  border-color: color-mix(in srgb, var(--theme-primary, #3b82f6) 55%, transparent);\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 82%, transparent);\r\n}\r\n\r\n.studio-text-node .studio-note-drag-handle {\r\n  height: 34px;\r\n  flex-basis: 26px;\r\n  width: 26px;\r\n}\r\n\r\n.studio-text-editor {\r\n  width: 100%;\r\n  height: 100%;\r\n  min-height: 48px;\r\n  border: 0;\r\n  background: transparent;\r\n  padding: 10px 12px 10px 0;\r\n  color: var(--theme-fg, #1f2937);\r\n  font-family: inherit;\r\n  font-size: 15px;\r\n  line-height: 1.5;\r\n}\r\n\r\n.studio-shape-node {\r\n  position: relative;\r\n  display: grid;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 48px;\r\n  min-height: 48px;\r\n  place-items: center;\r\n  border: 1.5px solid color-mix(in srgb, var(--theme-primary, #3b82f6) 58%, var(--theme-border, #e5e7eb));\r\n  border-radius: calc((8px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-primary, #3b82f6) 7%, var(--theme-bg, #ffffff));\r\n  color: var(--theme-text-secondary, #6b7280);\r\n}\r\n\r\n.studio-shape-node.is-ellipse {\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n}\r\n\r\n.studio-shape-node.is-selected,\r\n.studio-drawing-node.is-selected,\r\n.studio-group-node.is-selected {\r\n  border-color: var(--theme-primary, #3b82f6);\r\n  box-shadow: 0 0 0 1px color-mix(in srgb, var(--theme-primary, #3b82f6) 22%, transparent);\r\n}\r\n\r\n.studio-shape-drag-label {\r\n  padding: 12px;\r\n  font-size: 12px;\r\n  pointer-events: none;\r\n}\r\n\r\n.studio-drawing-node {\r\n  position: relative;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 24px;\r\n  min-height: 24px;\r\n  border: 1px solid transparent;\r\n}\r\n\r\n.studio-drawing-node svg {\r\n  width: 100%;\r\n  height: 100%;\r\n  overflow: visible;\r\n}\r\n\r\n.studio-drawing-node polyline,\r\n.studio-whiteboard-overlay polyline {\r\n  fill: none;\r\n  stroke: var(--theme-fg, #1f2937);\r\n  stroke-width: 2;\r\n  stroke-linecap: round;\r\n  stroke-linejoin: round;\r\n}\r\n\r\n.studio-group-node {\r\n  position: relative;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 160px;\r\n  min-height: 120px;\r\n  border: 1px dashed color-mix(in srgb, var(--theme-text-secondary, #6b7280) 45%, transparent);\r\n  border-radius: calc((12px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-sidebar, #f8f7f5) 30%, transparent);\r\n}\r\n\r\n.studio-group-title {\r\n  display: flex;\r\n  height: 34px;\r\n  align-items: center;\r\n  gap: 7px;\r\n  padding: 0 11px;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  cursor: grab;\r\n  font-size: 11px;\r\n  font-weight: 600;\r\n}\r\n\r\n.studio-miniapp-node {\r\n  position: relative;\r\n  display: flex;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 340px;\r\n  min-height: 500px;\r\n  flex-direction: column;\r\n  overflow: hidden;\r\n  border: 1px solid color-mix(in srgb, var(--theme-border, #e5e7eb) 92%, transparent);\r\n  border-radius: calc((14px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 98%, #eff6ff 2%);\r\n  box-shadow: 0 16px 44px rgba(15, 23, 42, 0.13);\r\n  transition: border-color 150ms ease, box-shadow 150ms ease;\r\n}\r\n\r\n.studio-miniapp-node:hover {\r\n  border-color: color-mix(in srgb, var(--theme-text-secondary, #6b7280) 42%, transparent);\r\n}\r\n\r\n.studio-miniapp-node.is-selected {\r\n  border-color: var(--theme-primary, #3b82f6);\r\n  box-shadow: 0 0 0 1px color-mix(in srgb, var(--theme-primary, #3b82f6) 22%, transparent),\r\n    0 18px 50px rgba(15, 23, 42, 0.16);\r\n}\r\n\r\n.studio-miniapp-header {\r\n  display: flex;\r\n  height: 48px;\r\n  flex: 0 0 48px;\r\n  align-items: center;\r\n  gap: 9px;\r\n  border-bottom: 1px solid color-mix(in srgb, var(--theme-border, #e5e7eb) 76%, transparent);\r\n  padding: 0 8px 0 3px;\r\n  cursor: grab;\r\n  user-select: none;\r\n}\r\n\r\n.studio-miniapp-header:active {\r\n  cursor: grabbing;\r\n}\r\n\r\n.studio-miniapp-grip {\r\n  display: grid;\r\n  width: 22px;\r\n  flex: 0 0 22px;\r\n  place-items: center;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 11px;\r\n  opacity: 0.45;\r\n}\r\n\r\n.studio-miniapp-app-icon {\r\n  display: grid;\r\n  width: 28px;\r\n  height: 28px;\r\n  flex: 0 0 28px;\r\n  place-items: center;\r\n  border-radius: calc((8px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-primary, #3b82f6) 12%, transparent);\r\n  color: var(--theme-primary, #2563eb);\r\n  font-size: 12px;\r\n}\r\n\r\n.studio-miniapp-heading {\r\n  display: flex;\r\n  min-width: 0;\r\n  flex: 1 1 auto;\r\n  flex-direction: column;\r\n  gap: 1px;\r\n  line-height: 1.15;\r\n}\r\n\r\n.studio-miniapp-heading strong {\r\n  overflow: hidden;\r\n  color: var(--theme-fg, #1f2937);\r\n  font-size: 12px;\r\n  font-weight: 700;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n.studio-miniapp-heading small {\r\n  overflow: hidden;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 9px;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n.studio-miniapp-runtime-status {\r\n  display: flex;\r\n  flex: 0 0 auto;\r\n  align-items: center;\r\n  gap: 5px;\r\n  border-radius: 999px;\r\n  corner-shape: round;\r\n  background: color-mix(in srgb, #22c55e 9%, transparent);\r\n  padding: 4px 7px;\r\n  color: #15803d;\r\n  font-size: 9px;\r\n  font-weight: 600;\r\n}\r\n\r\n.studio-miniapp-runtime-status i {\r\n  width: 5px;\r\n  height: 5px;\r\n  border-radius: 50%;\r\n  corner-shape: round;\r\n  background: #22c55e;\r\n  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);\r\n}\r\n\r\n.studio-miniapp-header-actions {\r\n  display: flex;\r\n  flex: 0 0 auto;\r\n  gap: 2px;\r\n}\r\n\r\n.studio-miniapp-header-actions button {\r\n  display: grid;\r\n  width: 25px;\r\n  height: 25px;\r\n  place-items: center;\r\n  border: 0;\r\n  border-radius: calc((6px) * var(--continuous-corner-scale));\r\n  background: transparent;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 10px;\r\n  transition: background-color 140ms ease, color 140ms ease, transform 140ms ease;\r\n}\r\n\r\n.studio-miniapp-header-actions button:hover,\r\n.studio-miniapp-header-actions button.is-active {\r\n  background: color-mix(in srgb, var(--theme-primary, #3b82f6) 10%, transparent);\r\n  color: var(--theme-primary, #2563eb);\r\n}\r\n\r\n.studio-miniapp-header-actions button:active {\r\n  transform: scale(0.92);\r\n}\r\n\r\n.studio-miniapp-controls {\r\n  display: flex;\r\n  min-height: 42px;\r\n  flex: 0 0 auto;\r\n  align-items: center;\r\n  gap: 8px;\r\n  border-bottom: 1px solid color-mix(in srgb, var(--theme-border, #e5e7eb) 70%, transparent);\r\n  background: color-mix(in srgb, var(--theme-sidebar, #f8f7f5) 64%, transparent);\r\n  padding: 6px 10px;\r\n}\r\n\r\n.studio-miniapp-controls label {\r\n  display: flex;\r\n  min-width: 0;\r\n  align-items: center;\r\n  gap: 5px;\r\n}\r\n\r\n.studio-miniapp-controls label > span {\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 9px;\r\n  font-weight: 600;\r\n}\r\n\r\n.studio-miniapp-controls select {\r\n  min-width: 0;\r\n  max-width: 116px;\r\n  height: 27px;\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: calc((6px) * var(--continuous-corner-scale));\r\n  outline: none;\r\n  background: var(--theme-bg, #ffffff);\r\n  padding: 0 22px 0 7px;\r\n  color: var(--theme-fg, #1f2937);\r\n  font-size: 9px;\r\n}\r\n\r\n.studio-miniapp-controls select:focus {\r\n  border-color: color-mix(in srgb, var(--theme-primary, #3b82f6) 65%, var(--theme-border, #e5e7eb));\r\n}\r\n\r\n.studio-miniapp-viewport-size {\r\n  margin-left: auto;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-family: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;\r\n  font-size: 8px;\r\n  white-space: nowrap;\r\n}\r\n\r\n.studio-miniapp-stage {\r\n  position: relative;\r\n  display: flex;\r\n  min-height: 0;\r\n  flex: 1 1 auto;\r\n  align-items: center;\r\n  justify-content: center;\r\n  overflow: hidden;\r\n  background:\r\n    radial-gradient(circle at 50% 18%, rgba(59, 130, 246, 0.07), transparent 38%),\r\n    color-mix(in srgb, var(--theme-sidebar, #f8f7f5) 72%, var(--theme-bg, #ffffff));\r\n  padding: 14px;\r\n  transition: opacity 160ms ease, filter 160ms ease;\r\n}\r\n\r\n.studio-miniapp-stage.is-refreshing {\r\n  opacity: 0.55;\r\n  filter: saturate(0.72);\r\n}\r\n\r\n.studio-device-shell {\r\n  position: relative;\r\n  display: flex;\r\n  overflow: hidden;\r\n  border: 7px solid #111827;\r\n  border-radius: calc((27px) * var(--continuous-corner-scale));\r\n  background: #111827;\r\n  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;\r\n  transition: width 220ms ease, height 220ms ease, aspect-ratio 220ms ease;\r\n}\r\n\r\n.studio-device-shell.is-portrait {\r\n  width: auto;\r\n  height: 100%;\r\n  max-width: 100%;\r\n}\r\n\r\n.studio-device-shell.is-landscape {\r\n  width: 100%;\r\n  max-height: 100%;\r\n}\r\n\r\n.studio-device-screen {\r\n  position: relative;\r\n  display: flex;\r\n  width: 100%;\r\n  height: 100%;\r\n  min-width: 0;\r\n  min-height: 0;\r\n  flex-direction: column;\r\n  overflow: hidden;\r\n  border-radius: calc((20px) * var(--continuous-corner-scale));\r\n  background: #f5f7fb;\r\n  color: #172033;\r\n  container-type: size;\r\n}\r\n\r\n.studio-device-statusbar {\r\n  z-index: 3;\r\n  display: flex;\r\n  height: 24px;\r\n  flex: 0 0 24px;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  padding: 0 13px;\r\n  background: rgba(255, 255, 255, 0.94);\r\n  color: #1f2937;\r\n  font-size: 7px;\r\n  font-weight: 700;\r\n}\r\n\r\n.studio-device-statusbar span:last-child {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 5px;\r\n  font-size: 8px;\r\n}\r\n\r\n.studio-mock-app-page {\r\n  display: flex;\r\n  min-height: 0;\r\n  flex: 1 1 auto;\r\n  flex-direction: column;\r\n  overflow: hidden;\r\n  background: #f5f7fb;\r\n}\r\n\r\n.studio-mock-app-page > header {\r\n  display: flex;\r\n  height: 48px;\r\n  flex: 0 0 48px;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  background: rgba(255, 255, 255, 0.94);\r\n  padding: 0 12px;\r\n}\r\n\r\n.studio-mock-app-page > header div {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 2px;\r\n}\r\n\r\n.studio-mock-app-page > header small {\r\n  color: #94a3b8;\r\n  font-size: 6px;\r\n}\r\n\r\n.studio-mock-app-page > header strong {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 4px;\r\n  color: #182033;\r\n  font-size: 10px;\r\n}\r\n\r\n.studio-mock-app-page > header button {\r\n  display: grid;\r\n  width: 28px;\r\n  height: 28px;\r\n  place-items: center;\r\n  border: 0;\r\n  border-radius: 50%;\r\n  corner-shape: round;\r\n  background: #eff6ff;\r\n  color: #2563eb;\r\n  font-size: 9px;\r\n}\r\n\r\n.studio-mock-app-page > main {\r\n  min-height: 0;\r\n  flex: 1 1 auto;\r\n  overflow: auto;\r\n  padding: 9px 10px 16px;\r\n  scrollbar-width: none;\r\n}\r\n\r\n.studio-mock-app-page > main::-webkit-scrollbar {\r\n  display: none;\r\n}\r\n\r\n.studio-mock-hero {\r\n  position: relative;\r\n  min-height: 80px;\r\n  overflow: hidden;\r\n  border-radius: calc((14px) * var(--continuous-corner-scale));\r\n  background: linear-gradient(135deg, #1d4ed8 0%, #3b82f6 58%, #60a5fa 100%);\r\n  padding: 13px 66px 13px 14px;\r\n  color: #ffffff;\r\n  box-shadow: 0 8px 22px rgba(37, 99, 235, 0.22);\r\n}\r\n\r\n.studio-mock-hero > svg {\r\n  position: absolute;\r\n  right: 19px;\r\n  bottom: 12px;\r\n  color: rgba(255, 255, 255, 0.9);\r\n  font-size: 34px;\r\n  transform: rotate(-8deg);\r\n}\r\n\r\n.studio-mock-hero small {\r\n  font-size: 6px;\r\n  font-weight: 700;\r\n  letter-spacing: 0.08em;\r\n  opacity: 0.76;\r\n}\r\n\r\n.studio-mock-hero h3 {\r\n  margin: 5px 0 3px;\r\n  font-size: 15px;\r\n  font-weight: 800;\r\n  line-height: 1.15;\r\n}\r\n\r\n.studio-mock-hero p {\r\n  margin: 0;\r\n  font-size: 7px;\r\n  opacity: 0.86;\r\n}\r\n\r\n.studio-mock-search {\r\n  display: flex;\r\n  height: 30px;\r\n  align-items: center;\r\n  gap: 7px;\r\n  margin-top: 9px;\r\n  border: 1px solid #e5eaf1;\r\n  border-radius: calc((9px) * var(--continuous-corner-scale));\r\n  background: #ffffff;\r\n  padding: 0 10px;\r\n  color: #94a3b8;\r\n  font-size: 7px;\r\n}\r\n\r\n.studio-mock-section {\r\n  margin-top: 11px;\r\n}\r\n\r\n.studio-mock-section-title {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  margin-bottom: 7px;\r\n}\r\n\r\n.studio-mock-section-title strong {\r\n  font-size: 10px;\r\n}\r\n\r\n.studio-mock-section-title span {\r\n  color: #94a3b8;\r\n  font-size: 6px;\r\n}\r\n\r\n.studio-mock-products {\r\n  display: grid;\r\n  grid-template-columns: repeat(2, minmax(0, 1fr));\r\n  gap: 7px;\r\n}\r\n\r\n.studio-mock-products button {\r\n  display: flex;\r\n  min-width: 0;\r\n  flex-direction: column;\r\n  align-items: flex-start;\r\n  border: 1px solid #e8edf4;\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n  background: #ffffff;\r\n  padding: 7px;\r\n  color: #172033;\r\n  text-align: left;\r\n}\r\n\r\n.studio-product-art {\r\n  display: grid;\r\n  width: 100%;\r\n  height: 48px;\r\n  place-items: center;\r\n  border-radius: calc((8px) * var(--continuous-corner-scale));\r\n  margin-bottom: 6px;\r\n  color: #ffffff;\r\n  font-size: 22px;\r\n}\r\n\r\n.studio-product-art.is-coconut {\r\n  background: linear-gradient(145deg, #1e3a5f, #3b82f6);\r\n}\r\n\r\n.studio-product-art.is-orange {\r\n  background: linear-gradient(145deg, #c2410c, #fb923c);\r\n}\r\n\r\n.studio-mock-products strong {\r\n  font-size: 8px;\r\n}\r\n\r\n.studio-mock-products small {\r\n  margin-top: 2px;\r\n  color: #94a3b8;\r\n  font-size: 6px;\r\n}\r\n\r\n.studio-mock-products b {\r\n  margin-top: 5px;\r\n  color: #2563eb;\r\n  font-size: 8px;\r\n}\r\n\r\n.studio-order-tabs {\r\n  display: grid;\r\n  grid-template-columns: repeat(3, 1fr);\r\n  border-bottom: 1px solid #e5eaf1;\r\n  margin: -3px 0 9px;\r\n}\r\n\r\n.studio-order-tabs button {\r\n  border: 0;\r\n  border-bottom: 2px solid transparent;\r\n  background: transparent;\r\n  padding: 8px 2px 6px;\r\n  color: #94a3b8;\r\n  font-size: 7px;\r\n}\r\n\r\n.studio-order-tabs button.is-active {\r\n  border-bottom-color: #2563eb;\r\n  color: #2563eb;\r\n  font-weight: 700;\r\n}\r\n\r\n.studio-order-card {\r\n  border: 1px solid #e5eaf1;\r\n  border-radius: calc((11px) * var(--continuous-corner-scale));\r\n  background: #ffffff;\r\n  padding: 9px;\r\n  box-shadow: 0 5px 15px rgba(15, 23, 42, 0.05);\r\n}\r\n\r\n.studio-order-card > div,\r\n.studio-order-card p,\r\n.studio-order-card footer {\r\n  display: flex;\r\n  align-items: center;\r\n}\r\n\r\n.studio-order-card > div {\r\n  justify-content: space-between;\r\n  font-size: 8px;\r\n  font-weight: 700;\r\n}\r\n\r\n.studio-order-card > div small {\r\n  border-radius: 999px;\r\n  corner-shape: round;\r\n  background: #eff6ff;\r\n  padding: 3px 5px;\r\n  color: #2563eb;\r\n  font-size: 6px;\r\n}\r\n\r\n.studio-order-card p {\r\n  gap: 7px;\r\n  margin: 9px 0;\r\n}\r\n\r\n.studio-order-card p strong {\r\n  flex: 1;\r\n  font-size: 7px;\r\n}\r\n\r\n.studio-order-card p b {\r\n  font-size: 8px;\r\n}\r\n\r\n.studio-order-thumb {\r\n  display: grid;\r\n  width: 30px;\r\n  height: 30px;\r\n  place-items: center;\r\n  border-radius: calc((8px) * var(--continuous-corner-scale));\r\n  background: linear-gradient(145deg, #1d4ed8, #60a5fa);\r\n  color: #ffffff;\r\n}\r\n\r\n.studio-order-card footer {\r\n  gap: 5px;\r\n  border-top: 1px solid #eef2f7;\r\n  padding-top: 7px;\r\n  color: #64748b;\r\n  font-size: 6px;\r\n}\r\n\r\n.studio-order-empty {\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  gap: 5px;\r\n  padding: 28px 10px 8px;\r\n  color: #94a3b8;\r\n  text-align: center;\r\n}\r\n\r\n.studio-order-empty > svg {\r\n  margin-bottom: 3px;\r\n  font-size: 20px;\r\n}\r\n\r\n.studio-order-empty strong {\r\n  color: #475569;\r\n  font-size: 8px;\r\n}\r\n\r\n.studio-order-empty small {\r\n  font-size: 6px;\r\n}\r\n\r\n.studio-mock-tabbar {\r\n  z-index: 2;\r\n  display: grid;\r\n  height: 42px;\r\n  flex: 0 0 42px;\r\n  grid-template-columns: repeat(3, 1fr);\r\n  border-top: 1px solid #e5eaf1;\r\n  background: rgba(255, 255, 255, 0.96);\r\n}\r\n\r\n.studio-mock-tabbar button {\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  justify-content: center;\r\n  gap: 2px;\r\n  border: 0;\r\n  background: transparent;\r\n  color: #94a3b8;\r\n  font-size: 8px;\r\n}\r\n\r\n.studio-mock-tabbar button span {\r\n  font-size: 5px;\r\n}\r\n\r\n.studio-mock-tabbar button.is-active {\r\n  color: #2563eb;\r\n}\r\n\r\n.studio-device-screen [data-mini-node] {\r\n  transition: outline-color 120ms ease, background-color 120ms ease;\r\n}\r\n\r\n.studio-device-screen [data-mini-selected="true"] {\r\n  outline: 2px solid #2563eb;\r\n  outline-offset: -2px;\r\n  background-color: rgba(59, 130, 246, 0.08);\r\n}\r\n\r\n.studio-inspector-hint {\r\n  position: absolute;\r\n  z-index: 8;\r\n  right: 7px;\r\n  bottom: 48px;\r\n  left: 7px;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 5px;\r\n  border: 1px solid rgba(59, 130, 246, 0.2);\r\n  border-radius: calc((7px) * var(--continuous-corner-scale));\r\n  background: rgba(239, 246, 255, 0.96);\r\n  padding: 6px 8px;\r\n  color: #1d4ed8;\r\n  font-size: 7px;\r\n  font-weight: 600;\r\n  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);\r\n  pointer-events: none;\r\n}\r\n\r\n.studio-miniapp-footer {\r\n  display: flex;\r\n  height: 27px;\r\n  flex: 0 0 27px;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  border-top: 1px solid color-mix(in srgb, var(--theme-border, #e5e7eb) 68%, transparent);\r\n  padding: 0 10px;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 8px;\r\n}\r\n\r\n@container (max-height: 390px) {\r\n  .studio-mock-hero {\r\n    min-height: 60px;\r\n    padding-top: 9px;\r\n    padding-bottom: 9px;\r\n  }\r\n\r\n  .studio-mock-hero h3 {\r\n    font-size: 12px;\r\n  }\r\n\r\n  .studio-product-art {\r\n    height: 34px;\r\n  }\r\n}\r\n\r\n.studio-search-panel {\r\n  width: 260px;\r\n  margin: 12px 12px 0 0 !important;\r\n  overflow: hidden;\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 96%, transparent);\r\n  box-shadow: 0 12px 34px rgba(15, 23, 42, 0.13);\r\n  backdrop-filter: blur(14px);\r\n}\r\n\r\n.studio-search-panel > input {\r\n  width: 100%;\r\n  border: 0;\r\n  border-bottom: 1px solid var(--theme-border, #e5e7eb);\r\n  background: transparent;\r\n  padding: 10px 12px;\r\n  color: var(--theme-fg, #1f2937);\r\n  font-size: 12px;\r\n}\r\n\r\n.studio-search-results {\r\n  max-height: 280px;\r\n  overflow: auto;\r\n  padding: 4px;\r\n}\r\n\r\n.studio-search-results button {\r\n  display: flex;\r\n  width: 100%;\r\n  flex-direction: column;\r\n  align-items: flex-start;\r\n  gap: 3px;\r\n  border: 0;\r\n  border-radius: calc((7px) * var(--continuous-corner-scale));\r\n  background: transparent;\r\n  padding: 8px;\r\n  color: var(--theme-fg, #1f2937);\r\n  text-align: left;\r\n}\r\n\r\n.studio-search-results button:hover {\r\n  background: var(--theme-sidebar, #f8f7f5);\r\n}\r\n\r\n.studio-search-results small,\r\n.studio-search-results p {\r\n  margin: 0;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 10px;\r\n}\r\n\r\n.studio-more-menu {\r\n  z-index: 45;\r\n  display: grid;\r\n  width: 650px;\r\n  grid-template-columns: repeat(5, minmax(0, 1fr));\r\n  gap: 1px;\r\n  margin: 58px 0 0 12px !important;\r\n  overflow: hidden;\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: calc((11px) * var(--continuous-corner-scale));\r\n  background: var(--theme-border, #e5e7eb);\r\n  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.15);\r\n}\r\n\r\n.studio-menu-section {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 1px;\r\n  background: var(--theme-bg, #ffffff);\r\n  padding: 7px;\r\n}\r\n\r\n.studio-menu-section > span {\r\n  padding: 5px 7px;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 9px;\r\n  font-weight: 700;\r\n  letter-spacing: 0.08em;\r\n  text-transform: uppercase;\r\n}\r\n\r\n.studio-menu-section button,\r\n.studio-context-menu button {\r\n  display: flex;\r\n  min-height: 28px;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  gap: 8px;\r\n  border: 0;\r\n  border-radius: calc((6px) * var(--continuous-corner-scale));\r\n  background: transparent;\r\n  padding: 6px 7px;\r\n  color: var(--theme-fg, #1f2937);\r\n  font-size: 10px;\r\n  text-align: left;\r\n}\r\n\r\n.studio-menu-section button:hover,\r\n.studio-context-menu button:hover {\r\n  background: var(--theme-sidebar, #f8f7f5);\r\n}\r\n\r\n.studio-menu-section button:disabled {\r\n  background: transparent;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  cursor: not-allowed;\r\n  opacity: 0.38;\r\n}\r\n\r\n.studio-menu-section button.is-danger {\r\n  color: #dc2626;\r\n}\r\n\r\n.studio-menu-section kbd {\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-family: inherit;\r\n  font-size: 8px;\r\n}\r\n\r\n.studio-context-menu {\r\n  position: fixed;\r\n  z-index: 100;\r\n  display: flex;\r\n  width: 150px;\r\n  flex-direction: column;\r\n  gap: 1px;\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: calc((9px) * var(--continuous-corner-scale));\r\n  background: var(--theme-bg, #ffffff);\r\n  padding: 5px;\r\n  box-shadow: 0 12px 34px rgba(15, 23, 42, 0.16);\r\n}\r\n\r\n.studio-context-menu button {\r\n  width: 100%;\r\n}\r\n\r\n.studio-command-notice {\r\n  position: absolute;\r\n  z-index: 80;\r\n  left: 50%;\r\n  bottom: 42px;\r\n  transform: translateX(-50%);\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 94%, transparent);\r\n  padding: 7px 12px;\r\n  color: var(--theme-fg, #1f2937);\r\n  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);\r\n  backdrop-filter: blur(12px);\r\n  font-size: 11px;\r\n  line-height: 1;\r\n  pointer-events: none;\r\n  animation: studio-command-notice-in 160ms ease-out;\r\n}\r\n\r\n@keyframes studio-command-notice-in {\r\n  from { opacity: 0; transform: translate(-50%, 5px); }\r\n  to { opacity: 1; transform: translate(-50%, 0); }\r\n}\r\n\r\n.studio-canvas-minimap {\r\n  right: 54px !important;\r\n  bottom: 12px !important;\r\n  overflow: hidden;\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 94%, transparent) !important;\r\n  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.1);\r\n}\r\n\r\n.studio-whiteboard-overlay {\r\n  position: absolute;\r\n  z-index: 20;\r\n  inset: 0;\r\n  cursor: crosshair;\r\n  touch-action: none;\r\n}\r\n\r\n.studio-whiteboard-overlay > svg {\r\n  position: absolute;\r\n  inset: 0;\r\n  width: 100%;\r\n  height: 100%;\r\n  pointer-events: none;\r\n}\r\n\r\n.studio-shape-draft {\r\n  position: absolute;\r\n  border: 1.5px solid var(--theme-primary, #3b82f6);\r\n  border-radius: calc((8px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-primary, #3b82f6) 8%, transparent);\r\n  pointer-events: none;\r\n}\r\n\r\n.studio-lasso-draft {\r\n  fill: color-mix(in srgb, var(--theme-primary, #3b82f6) 8%, transparent);\r\n  stroke: var(--theme-primary, #3b82f6);\r\n  stroke-width: 1.5;\r\n  stroke-dasharray: 6 4;\r\n}\r\n\r\n.studio-whiteboard-overlay .studio-eraser-draft {\r\n  stroke: rgba(239, 68, 68, 0.28);\r\n  stroke-width: 14;\r\n}\r\n\r\n@media (max-width: 820px) {\r\n  .studio-more-menu {\r\n    width: min(650px, calc(100vw - 24px));\r\n    grid-template-columns: repeat(2, minmax(0, 1fr));\r\n  }\r\n}\r\n\r\n.studio-infinite-canvas .react-flow__controls {\r\n  overflow: hidden;\r\n  border: 1px solid var(--theme-border, #e5e7eb);\r\n  border-radius: calc((10px) * var(--continuous-corner-scale));\r\n  background: color-mix(in srgb, var(--theme-bg, #ffffff) 92%, transparent);\r\n  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.1);\r\n  backdrop-filter: blur(12px);\r\n}\r\n\r\n.studio-infinite-canvas .react-flow__controls-button {\r\n  width: 30px;\r\n  height: 30px;\r\n  border: 0;\r\n  border-bottom: 1px solid var(--theme-border, #e5e7eb);\r\n  background: transparent;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  transition: background-color 150ms ease, color 150ms ease;\r\n}\r\n\r\n.studio-infinite-canvas .react-flow__controls-button:last-child {\r\n  border-bottom: 0;\r\n}\r\n\r\n.studio-infinite-canvas .react-flow__controls-button:hover {\r\n  background: var(--theme-sidebar, #f8f7f5);\r\n  color: var(--theme-fg, #1f2937);\r\n}\r\n\r\n.studio-infinite-canvas .react-flow__controls-button svg {\r\n  fill: currentColor;\r\n}\r\n\r\n.studio-canvas-hint {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  margin: 0 0 12px 12px !important;\r\n  color: var(--theme-text-secondary, #6b7280);\r\n  font-size: 11px;\r\n  line-height: 1;\r\n  user-select: none;\r\n  pointer-events: none;\r\n}\r\n\r\n.studio-canvas-hint-separator {\r\n  width: 2px;\r\n  height: 2px;\r\n  border-radius: 9999px;\r\n  corner-shape: round;\r\n  background: currentColor;\r\n  opacity: 0.55;\r\n}\r\n\r\n.reasoning-effort {\r\n  --effort-ratio: 0;\r\n  --effort-hue: calc(210 + var(--effort-ratio) * var(--effort-ratio) * 63);\r\n  min-width: 0;\r\n}\r\n\r\n.reasoning-effort-input { height: 30px; cursor: grab; }\r\n.reasoning-effort[data-dragging] .reasoning-effort-input { cursor: grabbing; }\r\n.reasoning-effort-track {\r\n  position: relative;\r\n  width: 100%;\r\n  height: 30px;\r\n  overflow: hidden;\r\n  border-radius: 999px;\r\n  corner-shape: round;\r\n  background: color-mix(in srgb, var(--theme-fg) 10%, var(--theme-bg));\r\n}\r\n\r\n.reasoning-effort-fill {\r\n  position: absolute;\r\n  inset: 0;\r\n  pointer-events: none;\r\n  clip-path: inset(0 calc((100% - 32px) * (1 - var(--effort-ratio))) 0 0 round 999px);\r\n}\r\n\r\n.reasoning-effort-fill canvas { width: 100%; height: 100%; }\r\n.reasoning-effort-dots {\r\n  position: absolute;\r\n  inset: 0 16px;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  pointer-events: none;\r\n  transition: opacity 300ms;\r\n}\r\n.reasoning-effort-dots span {\r\n  width: 4px;\r\n  height: 4px;\r\n  border-radius: 50%;\r\n  corner-shape: round;\r\n  background: color-mix(in srgb, var(--theme-fg) 30%, transparent);\r\n}\r\n.reasoning-effort[data-maximum] .reasoning-effort-dots { opacity: 0; }\r\n.reasoning-effort-thumb {\r\n  position: absolute;\r\n  left: calc((100% - 32px) * var(--effort-ratio) + 3px);\r\n  top: 2px;\r\n  width: 26px;\r\n  height: 26px;\r\n  border-radius: var(--effort-jelly-left, 50%) var(--effort-jelly-right, 50%)\r\n    var(--effort-jelly-right, 50%) var(--effort-jelly-left, 50%) / 50%;\r\n  corner-shape: round;\r\n  border: 1px solid color-mix(in srgb, var(--theme-fg) 10%, transparent);\r\n  background: #fafafa;\r\n  box-shadow: 0 1px 3px #0002;\r\n  pointer-events: none;\r\n  scale: var(--effort-press, 1);\r\n  transform: translateX(var(--effort-jelly-offset, 0px))\r\n    skewX(var(--effort-jelly-skew, 0deg))\r\n    scale(var(--effort-jelly-x, 1), var(--effort-jelly-y, 1));\r\n  transform-origin: center;\r\n  transition: border-color 180ms, box-shadow 180ms;\r\n}\r\n.reasoning-effort-input:hover .reasoning-effort-thumb {\r\n  border-color: color-mix(in srgb, var(--theme-fg) 20%, transparent);\r\n}\r\n.reasoning-effort[data-dragging] .reasoning-effort-thumb {\r\n  transition-duration: 0ms;\r\n  box-shadow: 0 2px 5px #0003;\r\n}\r\n.reasoning-effort-input-thumb {\r\n  display: block;\r\n  width: 32px;\r\n  height: 30px;\r\n  background: transparent;\r\n  outline: none;\r\n}\r\n.reasoning-effort-input:has(:focus-visible) {\r\n  border-radius: 999px;\r\n  corner-shape: round;\r\n  outline: 2px solid color-mix(in srgb, var(--theme-fg) 60%, transparent);\r\n  outline-offset: 2px;\r\n}\r\n.reasoning-effort-stops {\r\n  display: grid;\r\n  grid-template-columns: repeat(3, minmax(0, 1fr));\r\n  align-items: center;\r\n  margin-top: 6px;\r\n  font-size: 11px;\r\n}\r\n.reasoning-effort-stops button {\r\n  min-width: 32px;\r\n  justify-self: center;\r\n  padding: 3px 2px;\r\n  background: transparent;\r\n  color: var(--theme-text-secondary);\r\n  cursor: pointer;\r\n  border-radius: calc((3px) * var(--continuous-corner-scale));\r\n}\r\n.reasoning-effort-stops button:first-child { justify-self: start; }\r\n.reasoning-effort-stops button:last-child { justify-self: end; }\r\n.reasoning-effort-stops button[aria-pressed="true"] { color: hsl(var(--effort-hue) 75% 43%); font-weight: 600; }\r\n.dark .reasoning-effort-stops button[aria-pressed="true"] { color: hsl(var(--effort-hue) 75% 70%); }\r\n.reasoning-effort-stops button:focus-visible { outline: 2px solid var(--theme-fg); outline-offset: 2px; }\r\n.reasoning-effort[data-disabled] { opacity: .5; pointer-events: none; }\r\n@media (prefers-reduced-motion: reduce) {\r\n  .reasoning-effort *, .reasoning-effort *::after { transition: none !important; }\r\n}\r\n\r\n.reasoning-slider-track {\r\n  background: #f2f2f2;\r\n  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);\r\n}\r\n\r\n.reasoning-slider-fill {\r\n  isolation: isolate;\r\n  overflow: hidden;\r\n  filter: saturate(1.02);\r\n}\r\n\r\n.reasoning-slider-d-energy {\r\n  z-index: 0;\r\n  background:\r\n    radial-gradient(ellipse 58% 190% at 78% 112%, rgba(62, 123, 98, 0.72) 0%, rgba(45, 86, 69, 0.5) 39%, rgba(31, 55, 47, 0.22) 67%, transparent 84%),\r\n    radial-gradient(ellipse 34% 130% at 96% 70%, rgba(38, 117, 109, 0.38), transparent 76%),\r\n    linear-gradient(90deg,\r\n      #214a4a 0%,\r\n      #2d686a 12%,\r\n      #32797c 18%,\r\n      #2e6a68 27%,\r\n      #285550 36%,\r\n      #24433b 45%,\r\n      #263f34 55%,\r\n      #31513c 65%,\r\n      #3c644a 75%,\r\n      #3f6d55 84%,\r\n      #3a645c 92%,\r\n      #334948 100%);\r\n}\r\n\r\n.reasoning-slider-d-flow {\r\n  position: absolute;\r\n  inset: -45% -18%;\r\n  z-index: 1;\r\n  pointer-events: none;\r\n  background:\r\n    radial-gradient(ellipse 20% 52% at 42% 74%, rgba(72, 138, 103, 0.24), transparent 72%),\r\n    radial-gradient(ellipse 24% 58% at 68% 28%, rgba(85, 159, 117, 0.3), transparent 70%),\r\n    radial-gradient(ellipse 28% 54% at 91% 76%, rgba(47, 139, 126, 0.28), transparent 74%);\r\n  background-size: 132% 118%, 145% 132%, 138% 126%;\r\n  mix-blend-mode: screen;\r\n  will-change: transform, background-position;\r\n  animation: reasoning-irregular-flow 8.2s cubic-bezier(0.45, 0.05, 0.35, 1) infinite alternate;\r\n}\r\n\r\n.reasoning-slider-d-particles {\r\n  z-index: 3;\r\n  pointer-events: none;\r\n  mask-image: linear-gradient(90deg, #000 0%, rgba(0, 0, 0, 0.82) 45%, rgba(0, 0, 0, 0.22) 78%, transparent 100%);\r\n  will-change: background-position;\r\n}\r\n\r\n.reasoning-slider-d-particles-1 {\r\n  opacity: 0.82;\r\n  background-image:\r\n    radial-gradient(circle, rgba(220, 255, 248, 0.72) 0 0.7px, transparent 1px),\r\n    radial-gradient(circle, rgba(255, 255, 255, 0.5) 0 0.55px, transparent 0.9px);\r\n  background-size: 41px 24px, 57px 33px;\r\n  background-position: 0 0, 14px 11px;\r\n  animation: reasoning-g-drift-1 7.3s linear infinite;\r\n}\r\n\r\n.reasoning-slider-d-particles-2 {\r\n  opacity: 0.68;\r\n  background-image:\r\n    radial-gradient(circle, rgba(171, 230, 221, 0.58) 0 0.65px, transparent 1px),\r\n    radial-gradient(circle, rgba(255, 255, 255, 0.42) 0 0.5px, transparent 0.85px);\r\n  background-size: 53px 29px, 47px 21px;\r\n  background-position: 8px 6px, 22px 18px;\r\n  animation: reasoning-g-drift-2 11.7s linear infinite reverse;\r\n}\r\n\r\n.reasoning-slider-d-particles-3 {\r\n  opacity: 0.58;\r\n  background-image:\r\n    radial-gradient(circle, rgba(255, 255, 255, 0.55) 0 0.5px, transparent 0.85px),\r\n    radial-gradient(circle, rgba(200, 240, 230, 0.48) 0 0.45px, transparent 0.8px);\r\n  background-size: 37px 19px, 63px 35px;\r\n  background-position: 5px 14px, 19px 4px;\r\n  animation: reasoning-g-drift-3 13.9s linear infinite;\r\n}\r\n\r\n.reasoning-slider-d-particles-4 {\r\n  opacity: 0.48;\r\n  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.46) 0 0.45px, transparent 0.8px);\r\n  background-size: 49px 27px;\r\n  background-position: 11px 9px;\r\n  animation: reasoning-g-drift-4 17.3s linear infinite reverse;\r\n}\r\n\r\n.reasoning-slider-d-particles-5 {\r\n  opacity: 0.38;\r\n  background-image: radial-gradient(circle, rgba(186, 240, 228, 0.42) 0 0.4px, transparent 0.75px);\r\n  background-size: 31px 17px;\r\n  background-position: 3px 7px;\r\n  animation: reasoning-g-drift-5 19.1s linear infinite;\r\n}\r\n\r\n.reasoning-slider-d-breathe {\r\n  inset: -55% -12%;\r\n  z-index: 2;\r\n  pointer-events: none;\r\n  opacity: 0.42;\r\n  background:\r\n    radial-gradient(ellipse 34% 78% at 76% 70%, rgba(94, 171, 125, 0.32), transparent 72%),\r\n    radial-gradient(ellipse 25% 68% at 94% 34%, rgba(55, 150, 139, 0.24), transparent 74%);\r\n  animation: reasoning-d-green-breathe 5.8s ease-in-out infinite alternate;\r\n}\r\n\r\n.reasoning-slider-fill::after {\r\n  content: none;\r\n}\r\n\r\nhtml:not(.dark) .reasoning-slider-fill {\r\n  filter: saturate(0.96) brightness(1.18);\r\n}\r\n\r\n.reasoning-slider-thumb {\r\n  background: var(--theme-elevated);\r\n  box-shadow:\r\n    0 3px 9px color-mix(in srgb, var(--theme-fg) 18%, transparent),\r\n    0 0 0 1px color-mix(in srgb, var(--theme-fg) 3%, transparent);\r\n}\r\n\r\n.dark .reasoning-slider-thumb {\r\n  background: color-mix(in srgb, var(--theme-fg) 94%, var(--theme-bg));\r\n  box-shadow:\r\n    0 3px 12px color-mix(in srgb, var(--theme-bg) 78%, transparent),\r\n    0 0 0 1px color-mix(in srgb, var(--theme-fg) 18%, transparent),\r\n    0 0 14px color-mix(in srgb, var(--theme-fg) 8%, transparent);\r\n}\r\n\r\n.reasoning-slider-thumb-settle {\r\n  animation: reasoning-thumb-elastic-land 280ms cubic-bezier(0.16, 1, 0.3, 1);\r\n}\r\n\r\n@keyframes reasoning-g-drift-1 {\r\n  to {\r\n    background-position: 41px 24px, 71px 44px;\r\n  }\r\n}\r\n\r\n@keyframes reasoning-g-drift-2 {\r\n  to {\r\n    background-position: -45px 23px, -25px 39px;\r\n  }\r\n}\r\n\r\n@keyframes reasoning-g-drift-3 {\r\n  to {\r\n    background-position: 37px -19px, 63px 35px;\r\n  }\r\n}\r\n\r\n@keyframes reasoning-g-drift-4 {\r\n  to {\r\n    background-position: -49px 27px;\r\n  }\r\n}\r\n\r\n@keyframes reasoning-g-drift-5 {\r\n  to {\r\n    background-position: 31px 17px;\r\n  }\r\n}\r\n\r\n@keyframes reasoning-irregular-flow {\r\n  0% {\r\n    background-position: -16% 24%, 38% -12%, 112% 32%;\r\n    transform: translate3d(-4%, 4%, 0) scale(0.94) rotate(-1deg);\r\n  }\r\n\r\n  37% {\r\n    background-position: 18% 72%, 62% 24%, 82% -16%;\r\n    transform: translate3d(3%, -7%, 0) scale(1.05) rotate(1.4deg);\r\n  }\r\n\r\n  68% {\r\n    background-position: 44% 8%, 28% 78%, 66% 48%;\r\n    transform: translate3d(-2%, 5%, 0) scale(1.01) rotate(-0.8deg);\r\n  }\r\n\r\n  100% {\r\n    background-position: 72% 60%, 8% 18%, 36% 84%;\r\n    transform: translate3d(5%, -3%, 0) scale(1.08) rotate(1deg);\r\n  }\r\n}\r\n\r\n@keyframes reasoning-d-green-breathe {\r\n  from {\r\n    opacity: 0.28;\r\n    transform: translate3d(-4%, 5%, 0) scale(0.9);\r\n  }\r\n\r\n  to {\r\n    opacity: 0.56;\r\n    transform: translate3d(5%, -4%, 0) scale(1.1);\r\n  }\r\n}\r\n\r\n@keyframes reasoning-thumb-elastic-land {\r\n  0% {\r\n    transform: translate(-50%, -50%) scale(1.06);\r\n  }\r\n\r\n  100% {\r\n    transform: translate(-50%, -50%) scale(1);\r\n  }\r\n}\r\n\r\n@media (prefers-reduced-motion: reduce) {\r\n  .reasoning-slider-fill,\r\n  .reasoning-slider-d-energy,\r\n  .reasoning-slider-d-flow,\r\n  .reasoning-slider-d-breathe,\r\n  .reasoning-slider-d-particles-1,\r\n  .reasoning-slider-d-particles-2,\r\n  .reasoning-slider-d-particles-3,\r\n  .reasoning-slider-d-particles-4,\r\n  .reasoning-slider-d-particles-5,\r\n  .reasoning-slider-thumb-settle {\r\n    animation: none !important;\r\n  }\r\n}\r\n\r\n/* \u2500\u2500 Workflow Canvas (\u65E0\u9650\u753B\u5E03) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\r\n\r\n@property --glow-angle {\r\n  syntax: "<angle>";\r\n  inherits: false;\r\n  initial-value: 0deg;\r\n}\r\n\r\n@keyframes wfGlowRotate {\r\n  to { --glow-angle: 360deg; }\r\n}\r\n\r\n@keyframes wfSlideIn {\r\n  from { transform: translateX(100%); opacity: 0; }\r\n  to { transform: translateX(0); opacity: 1; }\r\n}\r\n\r\n@keyframes wfPulse {\r\n  0%, 100% { opacity: 1; }\r\n  50% { opacity: 0.5; }\r\n}\r\n\r\n.studio-workflow-canvas {\r\n  background: transparent !important;\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__node {\r\n  cursor: pointer;\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__node.selected {\r\n  z-index: 20 !important;\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__edge.selected .react-flow__edge-path {\r\n  stroke: rgba(139, 124, 247, 0.7) !important;\r\n  stroke-width: 2.4 !important;\r\n  filter: drop-shadow(0 0 5px rgba(139, 124, 247, 0.3));\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__handle {\r\n  opacity: 0;\r\n  width: 16px !important;\r\n  height: 16px !important;\r\n  background: rgba(156,163,175,0.8);\r\n  border: 2px solid rgba(30,30,35,0.95);\r\n  border-radius: 50%;\r\n  corner-shape: round;\r\n  transition: opacity 0.2s, transform 0.15s, background 0.2s;\r\n  cursor: crosshair;\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__handle::before {\r\n  content: "";\r\n  position: absolute;\r\n  top: 50%;\r\n  left: 50%;\r\n  transform: translate(-50%, -50%);\r\n  width: 48px;\r\n  height: 48px;\r\n  border-radius: 50%;\r\n  corner-shape: round;\r\n  background: transparent;\r\n  pointer-events: auto;\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__node:hover .react-flow__handle {\r\n  opacity: 1;\r\n  transform: scale(1.15);\r\n  background: rgba(95,201,209,0.9);\r\n  border-color: rgba(95,201,209,0.6);\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__background {\r\n  background: transparent !important;\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__node:hover {\r\n  z-index: 15 !important;\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__edge:hover .react-flow__edge-path {\r\n  stroke: rgba(255, 255, 255, 0.48) !important;\r\n  stroke-width: 2.2 !important;\r\n  filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.22));\r\n}\r\n\r\n.studio-workflow-canvas .react-flow__edge-path {\r\n  stroke: rgba(255, 255, 255, 0.18);\r\n  stroke-width: 1.8;\r\n  transition: stroke 0.3s, stroke-width 0.2s, filter 0.3s;\r\n}\r\n\r\n@keyframes wfEdgeFlow {\r\n  0% { stroke-dashoffset: 24; }\r\n  100% { stroke-dashoffset: 0; }\r\n}\r\n\r\n.studio-workflow-canvas .wf-edge-running .react-flow__edge-path {\r\n  stroke: rgba(59, 130, 246, 0.7);\r\n  stroke-width: 2;\r\n  stroke-dasharray: 8 4;\r\n  animation: wfEdgeFlow 0.6s linear infinite;\r\n  filter: drop-shadow(0 0 6px rgba(59, 130, 246, 0.3));\r\n}\r\n\r\n/* System default cursors (ReactFlow defaults to grab/grabbing hand icons) */\r\n.studio-workflow-canvas .react-flow__pane,\r\n.studio-workflow-canvas .react-flow__pane.draggable,\r\n.studio-workflow-canvas .react-flow__pane.dragging,\r\n.studio-workflow-canvas .react-flow__pane.selection,\r\n.studio-workflow-canvas .react-flow__node,\r\n.studio-workflow-canvas .react-flow__node.selectable,\r\n.studio-workflow-canvas .react-flow__node.draggable,\r\n.studio-workflow-canvas .react-flow__node.draggable.dragging,\r\n.studio-workflow-canvas .react-flow__nodesselection-rect {\r\n  cursor: default;\r\n}\r\n\r\n/* Selection box */\r\n.wf-selection-box {\r\n  position: absolute;\r\n  border: 2px solid rgba(255, 255, 255, 0.52);\r\n  background-color: rgba(255, 255, 255, 0.1);\r\n  border-radius: calc((4px) * var(--continuous-corner-scale));\r\n  pointer-events: none;\r\n  z-index: 50;\r\n}\r\n\r\n/* ===== tauri-plugin-decorum titlebar ===== */\r\ndiv[data-tauri-decorum-tb] {\r\n  height: var(--app-titlebar-height) !important;\r\n  background: transparent !important;\r\n  border-bottom: none !important;\r\n}\r\n\r\nbutton.decorum-tb-btn {\r\n  height: var(--app-titlebar-height) !important;\r\n  color: color-mix(in srgb, var(--theme-fg) 55%, transparent) !important;\r\n  transition: background-color 150ms, color 150ms;\r\n}\r\n\r\nbutton.decorum-tb-btn:hover {\r\n  color: var(--theme-fg) !important;\r\n  background-color: color-mix(in srgb, var(--theme-fg) 8%, transparent) !important;\r\n}\r\n\r\nbutton#decorum-tb-close:hover {\r\n  color: #fff !important;\r\n  background-color: #e81123 !important;\r\n}\r\n\r\n:host {\r\n  --ui-menu-border:color-mix(in srgb, var(--theme-border, #dfe2e7) 75%, transparent);\r\n}\r\n/* An inset outline stays inside the existing geometry and keeps the menu\'s\r\n   continuous corners without adding a second line or changing its dimensions. */\r\n.ui-menu-surface {\r\n  border-width:0;\r\n  outline:1px solid var(--ui-menu-border);\r\n  outline-offset:-1px;\r\n}\r\n/* A morphing menu paints through its inner shell, not its positioning box. */\r\n.spring-surface.ui-menu-surface[data-spring-tone="menu"] {\r\n  outline:none;\r\n}\r\n.spring-surface.ui-menu-surface[data-spring-tone="menu"] > [data-spring-shell] {\r\n  outline:1px solid var(--ui-menu-border);\r\n  outline-offset:-1px;\r\n}\r\n\r\n.message-send-flight-root {\r\n  position:fixed;\r\n  inset:0;\r\n  z-index:80;\r\n  pointer-events:none;\r\n  overflow:hidden;\r\n}\r\n.message-send-carrier {\r\n  position:absolute;\r\n  box-sizing:border-box;\r\n  overflow:hidden;\r\n  white-space:pre-wrap;\r\n  overflow-wrap:anywhere;\r\n  transform-origin:50% 50%;\r\n  will-change:transform;\r\n}\r\n[data-message-send-hidden] {\r\n  visibility:hidden !important;\r\n}\r\n.placeholder\\:text-text-secondary::placeholder {\r\n  color: var(--theme-text-secondary, #6B7280);\r\n}\r\n.focus-within\\:shadow-\\[0_10px_30px_rgba\\(31\\2c 38\\2c 48\\2c 0\\.13\\)\\]:focus-within {\r\n  --tw-shadow: 0 10px 30px rgba(31,38,48,0.13);\r\n  --tw-shadow-colored: 0 10px 30px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.focus-within\\:shadow-\\[0_8px_26px_rgba\\(31\\2c 38\\2c 48\\2c 0\\.12\\)\\]:focus-within {\r\n  --tw-shadow: 0 8px 26px rgba(31,38,48,0.12);\r\n  --tw-shadow-colored: 0 8px 26px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.hover\\:scale-110:hover {\r\n  --tw-scale-x: 1.1;\r\n  --tw-scale-y: 1.1;\r\n  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));\r\n}\r\n.hover\\:bg-black:hover {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(0 0 0 / var(--tw-bg-opacity, 1));\r\n}\r\n.hover\\:bg-black\\/10:hover {\r\n  background-color: rgb(0 0 0 / 0.1);\r\n}\r\n.hover\\:bg-black\\/75:hover {\r\n  background-color: rgb(0 0 0 / 0.75);\r\n}\r\n.hover\\:bg-gray-100:hover {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(243 244 246 / var(--tw-bg-opacity, 1));\r\n}\r\n.hover\\:bg-gray-200:hover {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(229 231 235 / var(--tw-bg-opacity, 1));\r\n}\r\n.hover\\:bg-gray-50:hover {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(249 250 251 / var(--tw-bg-opacity, 1));\r\n}\r\n.hover\\:bg-neutral-800:hover {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(38 38 38 / var(--tw-bg-opacity, 1));\r\n}\r\n.hover\\:bg-primary-hover:hover {\r\n  background-color: var(--theme-accent-hover, #000000);\r\n}\r\n.hover\\:bg-red-700:hover {\r\n  --tw-bg-opacity: 1;\r\n  background-color: rgb(185 28 28 / var(--tw-bg-opacity, 1));\r\n}\r\n.hover\\:bg-transparent:hover {\r\n  background-color: transparent;\r\n}\r\n.hover\\:text-text-base:hover {\r\n  color: var(--theme-fg, #1F2937);\r\n}\r\n.hover\\:text-white:hover {\r\n  --tw-text-opacity: 1;\r\n  color: rgb(255 255 255 / var(--tw-text-opacity, 1));\r\n}\r\n.hover\\:\\!no-underline:hover {\r\n  text-decoration-line: none !important;\r\n}\r\n.hover\\:bg-ui-tint:hover {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 5%, transparent);\r\n  }\r\n.hover\\:bg-ui-tint-strong:hover {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 10%, transparent);\r\n  }\r\n.focus-visible\\:outline-none:focus-visible {\r\n  outline: 2px solid transparent;\r\n  outline-offset: 2px;\r\n}\r\n.focus-visible\\:ring-2:focus-visible {\r\n  --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);\r\n  --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);\r\n  box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000);\r\n}\r\n.focus-visible\\:ring-primary:focus-visible {\r\n  --tw-ring-color: var(--theme-accent, #111827);\r\n}\r\n.focus-visible\\:ring-white\\/40:focus-visible {\r\n  --tw-ring-color: rgb(255 255 255 / 0.4);\r\n}\r\n.focus-visible\\:ring-offset-2:focus-visible {\r\n  --tw-ring-offset-width: 2px;\r\n}\r\n.active\\:bg-black\\/\\[0\\.12\\]:active {\r\n  background-color: rgb(0 0 0 / 0.12);\r\n}\r\n.active\\:bg-ui-tint-strong:active {\r\n    background-color: color-mix(in srgb, var(--theme-fg) 10%, transparent);\r\n  }\r\n.disabled\\:pointer-events-none:disabled {\r\n  pointer-events: none;\r\n}\r\n.disabled\\:cursor-not-allowed:disabled {\r\n  cursor: not-allowed;\r\n}\r\n.disabled\\:opacity-40:disabled {\r\n  opacity: 0.4;\r\n}\r\n.disabled\\:opacity-45:disabled {\r\n  opacity: 0.45;\r\n}\r\n.disabled\\:opacity-50:disabled {\r\n  opacity: 0.5;\r\n}\r\n.disabled\\:hover\\:bg-transparent:hover:disabled {\r\n  background-color: transparent;\r\n}\r\n.group\\/attachment:focus-within .group-focus-within\\/attachment\\:opacity-100 {\r\n  opacity: 1;\r\n}\r\n.group\\/composer:focus-within .group-focus-within\\/composer\\:shadow-\\[0_8px_24px_rgba\\(0\\2c 0\\2c 0\\2c 0\\.10\\)\\] {\r\n  --tw-shadow: 0 8px 24px rgba(0,0,0,0.10);\r\n  --tw-shadow-colored: 0 8px 24px var(--tw-shadow-color);\r\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\r\n}\r\n.group\\/image-preview:hover .group-hover\\/image-preview\\:bg-black\\/10 {\r\n  background-color: rgb(0 0 0 / 0.1);\r\n}\r\n.group\\/attachment:hover .group-hover\\/attachment\\:opacity-100 {\r\n  opacity: 1;\r\n}\r\n@media (prefers-reduced-motion: no-preference) {\r\n\r\n  @keyframes spin {\r\n\r\n    to {\r\n      transform: rotate(360deg);\r\n    }\r\n  }\r\n\r\n  .motion-safe\\:animate-spin {\r\n    animation: spin 1s linear infinite;\r\n  }\r\n}\r\n@media (prefers-reduced-motion: reduce) {\r\n\r\n  .motion-reduce\\:transition-none {\r\n    transition-property: none;\r\n  }\r\n}\r\n.\\[\\&_\\.CircularProgressbar-path\\]\\:transition-\\[stroke-dashoffset\\] .CircularProgressbar-path {\r\n  transition-property: stroke-dashoffset;\r\n  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\r\n  transition-duration: 150ms;\r\n}\r\n.\\[\\&_\\.CircularProgressbar-path\\]\\:duration-300 .CircularProgressbar-path {\r\n  transition-duration: 300ms;\r\n}\r\n@media (prefers-reduced-motion: reduce) {\r\n\r\n  .motion-reduce\\:\\[\\&_\\.CircularProgressbar-path\\]\\:transition-none .CircularProgressbar-path {\r\n    transition-property: none;\r\n  }\r\n}\r\n@media(hover:none) {\r\n\r\n  .\\[\\@media\\(hover\\:none\\)\\]\\:opacity-100 {\r\n    opacity: 1;\r\n  }\r\n}\r\n\n:root, :host {\n  --fa-font-solid: normal 900 1em/1 "Font Awesome 6 Free";\n  --fa-font-regular: normal 400 1em/1 "Font Awesome 6 Free";\n  --fa-font-light: normal 300 1em/1 "Font Awesome 6 Pro";\n  --fa-font-thin: normal 100 1em/1 "Font Awesome 6 Pro";\n  --fa-font-duotone: normal 900 1em/1 "Font Awesome 6 Duotone";\n  --fa-font-duotone-regular: normal 400 1em/1 "Font Awesome 6 Duotone";\n  --fa-font-duotone-light: normal 300 1em/1 "Font Awesome 6 Duotone";\n  --fa-font-duotone-thin: normal 100 1em/1 "Font Awesome 6 Duotone";\n  --fa-font-brands: normal 400 1em/1 "Font Awesome 6 Brands";\n  --fa-font-sharp-solid: normal 900 1em/1 "Font Awesome 6 Sharp";\n  --fa-font-sharp-regular: normal 400 1em/1 "Font Awesome 6 Sharp";\n  --fa-font-sharp-light: normal 300 1em/1 "Font Awesome 6 Sharp";\n  --fa-font-sharp-thin: normal 100 1em/1 "Font Awesome 6 Sharp";\n  --fa-font-sharp-duotone-solid: normal 900 1em/1 "Font Awesome 6 Sharp Duotone";\n  --fa-font-sharp-duotone-regular: normal 400 1em/1 "Font Awesome 6 Sharp Duotone";\n  --fa-font-sharp-duotone-light: normal 300 1em/1 "Font Awesome 6 Sharp Duotone";\n  --fa-font-sharp-duotone-thin: normal 100 1em/1 "Font Awesome 6 Sharp Duotone";\n}\n\nsvg:not(:root).svg-inline--fa, svg:not(:host).svg-inline--fa {\n  overflow: visible;\n  box-sizing: content-box;\n}\n\n.svg-inline--fa {\n  display: var(--fa-display, inline-block);\n  height: 1em;\n  overflow: visible;\n  vertical-align: -0.125em;\n}\n.svg-inline--fa.fa-2xs {\n  vertical-align: 0.1em;\n}\n.svg-inline--fa.fa-xs {\n  vertical-align: 0em;\n}\n.svg-inline--fa.fa-sm {\n  vertical-align: -0.0714285705em;\n}\n.svg-inline--fa.fa-lg {\n  vertical-align: -0.2em;\n}\n.svg-inline--fa.fa-xl {\n  vertical-align: -0.25em;\n}\n.svg-inline--fa.fa-2xl {\n  vertical-align: -0.3125em;\n}\n.svg-inline--fa.fa-pull-left {\n  margin-right: var(--fa-pull-margin, 0.3em);\n  width: auto;\n}\n.svg-inline--fa.fa-pull-right {\n  margin-left: var(--fa-pull-margin, 0.3em);\n  width: auto;\n}\n.svg-inline--fa.fa-li {\n  width: var(--fa-li-width, 2em);\n  top: 0.25em;\n}\n.svg-inline--fa.fa-fw {\n  width: var(--fa-fw-width, 1.25em);\n}\n\n.fa-layers svg.svg-inline--fa {\n  bottom: 0;\n  left: 0;\n  margin: auto;\n  position: absolute;\n  right: 0;\n  top: 0;\n}\n\n.fa-layers-counter, .fa-layers-text {\n  display: inline-block;\n  position: absolute;\n  text-align: center;\n}\n\n.fa-layers {\n  display: inline-block;\n  height: 1em;\n  position: relative;\n  text-align: center;\n  vertical-align: -0.125em;\n  width: 1em;\n}\n.fa-layers svg.svg-inline--fa {\n  transform-origin: center center;\n}\n\n.fa-layers-text {\n  left: 50%;\n  top: 50%;\n  transform: translate(-50%, -50%);\n  transform-origin: center center;\n}\n\n.fa-layers-counter {\n  background-color: var(--fa-counter-background-color, #ff253a);\n  border-radius: var(--fa-counter-border-radius, 1em);\n  box-sizing: border-box;\n  color: var(--fa-inverse, #fff);\n  line-height: var(--fa-counter-line-height, 1);\n  max-width: var(--fa-counter-max-width, 5em);\n  min-width: var(--fa-counter-min-width, 1.5em);\n  overflow: hidden;\n  padding: var(--fa-counter-padding, 0.25em 0.5em);\n  right: var(--fa-right, 0);\n  text-overflow: ellipsis;\n  top: var(--fa-top, 0);\n  transform: scale(var(--fa-counter-scale, 0.25));\n  transform-origin: top right;\n}\n\n.fa-layers-bottom-right {\n  bottom: var(--fa-bottom, 0);\n  right: var(--fa-right, 0);\n  top: auto;\n  transform: scale(var(--fa-layers-scale, 0.25));\n  transform-origin: bottom right;\n}\n\n.fa-layers-bottom-left {\n  bottom: var(--fa-bottom, 0);\n  left: var(--fa-left, 0);\n  right: auto;\n  top: auto;\n  transform: scale(var(--fa-layers-scale, 0.25));\n  transform-origin: bottom left;\n}\n\n.fa-layers-top-right {\n  top: var(--fa-top, 0);\n  right: var(--fa-right, 0);\n  transform: scale(var(--fa-layers-scale, 0.25));\n  transform-origin: top right;\n}\n\n.fa-layers-top-left {\n  left: var(--fa-left, 0);\n  right: auto;\n  top: var(--fa-top, 0);\n  transform: scale(var(--fa-layers-scale, 0.25));\n  transform-origin: top left;\n}\n\n.fa-1x {\n  font-size: 1em;\n}\n\n.fa-2x {\n  font-size: 2em;\n}\n\n.fa-3x {\n  font-size: 3em;\n}\n\n.fa-4x {\n  font-size: 4em;\n}\n\n.fa-5x {\n  font-size: 5em;\n}\n\n.fa-6x {\n  font-size: 6em;\n}\n\n.fa-7x {\n  font-size: 7em;\n}\n\n.fa-8x {\n  font-size: 8em;\n}\n\n.fa-9x {\n  font-size: 9em;\n}\n\n.fa-10x {\n  font-size: 10em;\n}\n\n.fa-2xs {\n  font-size: 0.625em;\n  line-height: 0.1em;\n  vertical-align: 0.225em;\n}\n\n.fa-xs {\n  font-size: 0.75em;\n  line-height: 0.0833333337em;\n  vertical-align: 0.125em;\n}\n\n.fa-sm {\n  font-size: 0.875em;\n  line-height: 0.0714285718em;\n  vertical-align: 0.0535714295em;\n}\n\n.fa-lg {\n  font-size: 1.25em;\n  line-height: 0.05em;\n  vertical-align: -0.075em;\n}\n\n.fa-xl {\n  font-size: 1.5em;\n  line-height: 0.0416666682em;\n  vertical-align: -0.125em;\n}\n\n.fa-2xl {\n  font-size: 2em;\n  line-height: 0.03125em;\n  vertical-align: -0.1875em;\n}\n\n.fa-fw {\n  text-align: center;\n  width: 1.25em;\n}\n\n.fa-ul {\n  list-style-type: none;\n  margin-left: var(--fa-li-margin, 2.5em);\n  padding-left: 0;\n}\n.fa-ul > li {\n  position: relative;\n}\n\n.fa-li {\n  left: calc(-1 * var(--fa-li-width, 2em));\n  position: absolute;\n  text-align: center;\n  width: var(--fa-li-width, 2em);\n  line-height: inherit;\n}\n\n.fa-border {\n  border-color: var(--fa-border-color, #eee);\n  border-radius: var(--fa-border-radius, 0.1em);\n  border-style: var(--fa-border-style, solid);\n  border-width: var(--fa-border-width, 0.08em);\n  padding: var(--fa-border-padding, 0.2em 0.25em 0.15em);\n}\n\n.fa-pull-left {\n  float: left;\n  margin-right: var(--fa-pull-margin, 0.3em);\n}\n\n.fa-pull-right {\n  float: right;\n  margin-left: var(--fa-pull-margin, 0.3em);\n}\n\n.fa-beat {\n  animation-name: fa-beat;\n  animation-delay: var(--fa-animation-delay, 0s);\n  animation-direction: var(--fa-animation-direction, normal);\n  animation-duration: var(--fa-animation-duration, 1s);\n  animation-iteration-count: var(--fa-animation-iteration-count, infinite);\n  animation-timing-function: var(--fa-animation-timing, ease-in-out);\n}\n\n.fa-bounce {\n  animation-name: fa-bounce;\n  animation-delay: var(--fa-animation-delay, 0s);\n  animation-direction: var(--fa-animation-direction, normal);\n  animation-duration: var(--fa-animation-duration, 1s);\n  animation-iteration-count: var(--fa-animation-iteration-count, infinite);\n  animation-timing-function: var(--fa-animation-timing, cubic-bezier(0.28, 0.84, 0.42, 1));\n}\n\n.fa-fade {\n  animation-name: fa-fade;\n  animation-delay: var(--fa-animation-delay, 0s);\n  animation-direction: var(--fa-animation-direction, normal);\n  animation-duration: var(--fa-animation-duration, 1s);\n  animation-iteration-count: var(--fa-animation-iteration-count, infinite);\n  animation-timing-function: var(--fa-animation-timing, cubic-bezier(0.4, 0, 0.6, 1));\n}\n\n.fa-beat-fade {\n  animation-name: fa-beat-fade;\n  animation-delay: var(--fa-animation-delay, 0s);\n  animation-direction: var(--fa-animation-direction, normal);\n  animation-duration: var(--fa-animation-duration, 1s);\n  animation-iteration-count: var(--fa-animation-iteration-count, infinite);\n  animation-timing-function: var(--fa-animation-timing, cubic-bezier(0.4, 0, 0.6, 1));\n}\n\n.fa-flip {\n  animation-name: fa-flip;\n  animation-delay: var(--fa-animation-delay, 0s);\n  animation-direction: var(--fa-animation-direction, normal);\n  animation-duration: var(--fa-animation-duration, 1s);\n  animation-iteration-count: var(--fa-animation-iteration-count, infinite);\n  animation-timing-function: var(--fa-animation-timing, ease-in-out);\n}\n\n.fa-shake {\n  animation-name: fa-shake;\n  animation-delay: var(--fa-animation-delay, 0s);\n  animation-direction: var(--fa-animation-direction, normal);\n  animation-duration: var(--fa-animation-duration, 1s);\n  animation-iteration-count: var(--fa-animation-iteration-count, infinite);\n  animation-timing-function: var(--fa-animation-timing, linear);\n}\n\n.fa-spin {\n  animation-name: fa-spin;\n  animation-delay: var(--fa-animation-delay, 0s);\n  animation-direction: var(--fa-animation-direction, normal);\n  animation-duration: var(--fa-animation-duration, 2s);\n  animation-iteration-count: var(--fa-animation-iteration-count, infinite);\n  animation-timing-function: var(--fa-animation-timing, linear);\n}\n\n.fa-spin-reverse {\n  --fa-animation-direction: reverse;\n}\n\n.fa-pulse,\n.fa-spin-pulse {\n  animation-name: fa-spin;\n  animation-direction: var(--fa-animation-direction, normal);\n  animation-duration: var(--fa-animation-duration, 1s);\n  animation-iteration-count: var(--fa-animation-iteration-count, infinite);\n  animation-timing-function: var(--fa-animation-timing, steps(8));\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .fa-beat,\n.fa-bounce,\n.fa-fade,\n.fa-beat-fade,\n.fa-flip,\n.fa-pulse,\n.fa-shake,\n.fa-spin,\n.fa-spin-pulse {\n    animation-delay: -1ms;\n    animation-duration: 1ms;\n    animation-iteration-count: 1;\n    transition-delay: 0s;\n    transition-duration: 0s;\n  }\n}\n@keyframes fa-beat {\n  0%, 90% {\n    transform: scale(1);\n  }\n  45% {\n    transform: scale(var(--fa-beat-scale, 1.25));\n  }\n}\n@keyframes fa-bounce {\n  0% {\n    transform: scale(1, 1) translateY(0);\n  }\n  10% {\n    transform: scale(var(--fa-bounce-start-scale-x, 1.1), var(--fa-bounce-start-scale-y, 0.9)) translateY(0);\n  }\n  30% {\n    transform: scale(var(--fa-bounce-jump-scale-x, 0.9), var(--fa-bounce-jump-scale-y, 1.1)) translateY(var(--fa-bounce-height, -0.5em));\n  }\n  50% {\n    transform: scale(var(--fa-bounce-land-scale-x, 1.05), var(--fa-bounce-land-scale-y, 0.95)) translateY(0);\n  }\n  57% {\n    transform: scale(1, 1) translateY(var(--fa-bounce-rebound, -0.125em));\n  }\n  64% {\n    transform: scale(1, 1) translateY(0);\n  }\n  100% {\n    transform: scale(1, 1) translateY(0);\n  }\n}\n@keyframes fa-fade {\n  50% {\n    opacity: var(--fa-fade-opacity, 0.4);\n  }\n}\n@keyframes fa-beat-fade {\n  0%, 100% {\n    opacity: var(--fa-beat-fade-opacity, 0.4);\n    transform: scale(1);\n  }\n  50% {\n    opacity: 1;\n    transform: scale(var(--fa-beat-fade-scale, 1.125));\n  }\n}\n@keyframes fa-flip {\n  50% {\n    transform: rotate3d(var(--fa-flip-x, 0), var(--fa-flip-y, 1), var(--fa-flip-z, 0), var(--fa-flip-angle, -180deg));\n  }\n}\n@keyframes fa-shake {\n  0% {\n    transform: rotate(-15deg);\n  }\n  4% {\n    transform: rotate(15deg);\n  }\n  8%, 24% {\n    transform: rotate(-18deg);\n  }\n  12%, 28% {\n    transform: rotate(18deg);\n  }\n  16% {\n    transform: rotate(-22deg);\n  }\n  20% {\n    transform: rotate(22deg);\n  }\n  32% {\n    transform: rotate(-12deg);\n  }\n  36% {\n    transform: rotate(12deg);\n  }\n  40%, 100% {\n    transform: rotate(0deg);\n  }\n}\n@keyframes fa-spin {\n  0% {\n    transform: rotate(0deg);\n  }\n  100% {\n    transform: rotate(360deg);\n  }\n}\n.fa-rotate-90 {\n  transform: rotate(90deg);\n}\n\n.fa-rotate-180 {\n  transform: rotate(180deg);\n}\n\n.fa-rotate-270 {\n  transform: rotate(270deg);\n}\n\n.fa-flip-horizontal {\n  transform: scale(-1, 1);\n}\n\n.fa-flip-vertical {\n  transform: scale(1, -1);\n}\n\n.fa-flip-both,\n.fa-flip-horizontal.fa-flip-vertical {\n  transform: scale(-1, -1);\n}\n\n.fa-rotate-by {\n  transform: rotate(var(--fa-rotate-angle, 0));\n}\n\n.fa-stack {\n  display: inline-block;\n  vertical-align: middle;\n  height: 2em;\n  position: relative;\n  width: 2.5em;\n}\n\n.fa-stack-1x,\n.fa-stack-2x {\n  bottom: 0;\n  left: 0;\n  margin: auto;\n  position: absolute;\n  right: 0;\n  top: 0;\n  z-index: var(--fa-stack-z-index, auto);\n}\n\n.svg-inline--fa.fa-stack-1x {\n  height: 1em;\n  width: 1.25em;\n}\n.svg-inline--fa.fa-stack-2x {\n  height: 2em;\n  width: 2.5em;\n}\n\n.fa-inverse {\n  color: var(--fa-inverse, #fff);\n}\n\n.sr-only,\n.fa-sr-only {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  padding: 0;\n  margin: -1px;\n  overflow: hidden;\n  clip: rect(0, 0, 0, 0);\n  white-space: nowrap;\n  border-width: 0;\n}\n\n.sr-only-focusable:not(:focus),\n.fa-sr-only-focusable:not(:focus) {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  padding: 0;\n  margin: -1px;\n  overflow: hidden;\n  clip: rect(0, 0, 0, 0);\n  white-space: nowrap;\n  border-width: 0;\n}\n\n.svg-inline--fa .fa-primary {\n  fill: var(--fa-primary-color, currentColor);\n  opacity: var(--fa-primary-opacity, 1);\n}\n\n.svg-inline--fa .fa-secondary {\n  fill: var(--fa-secondary-color, currentColor);\n  opacity: var(--fa-secondary-opacity, 0.4);\n}\n\n.svg-inline--fa.fa-swap-opacity .fa-primary {\n  opacity: var(--fa-secondary-opacity, 0.4);\n}\n\n.svg-inline--fa.fa-swap-opacity .fa-secondary {\n  opacity: var(--fa-primary-opacity, 1);\n}\n\n.svg-inline--fa mask .fa-primary,\n.svg-inline--fa mask .fa-secondary {\n  fill: black;\n}\n.original-deep-agent-stage{display:flex;align-items:stretch;justify-content:center;min-height:0;height:auto;padding:0;background:transparent;box-sizing:border-box;overflow:visible}.original-composer-container{width:100%;max-width:none;overflow:visible;position:relative}.original-effort-section{width:264px;max-width:100%}.original-effort-section{width:264px;max-width:100%}';
var TOKENS = { "--theme-accent": "#339CFF", "--theme-accent-hover": "#2563EB", "--theme-bg": "#FFFFFF", "--theme-sidebar": "#F9F8F6", "--theme-elevated": "#FFFFFF", "--theme-fg": "#1F2937", "--theme-text-secondary": "#707784", "--theme-border": "#E6E8EC", "--theme-hover": "#F4F4F6", "--theme-selection": "#DCEBFE" };
var COPY = { "sidebar": { "home": "\u9996\u9875", "recent": "\u6700\u8FD1", "navigation": "\u529F\u80FD\u5BFC\u822A", "projectsAndChats": "\u9879\u76EE\u4E0E\u5BF9\u8BDD", "collapseSidebar": "\u6536\u8D77\u9879\u76EE\u4E0E\u5BF9\u8BDD", "expandSidebar": "\u5C55\u5F00\u9879\u76EE\u4E0E\u5BF9\u8BDD", "projects": "\u9879\u76EE", "recentChats": "\u6700\u8FD1\u5BF9\u8BDD", "collapseRecentChats": "\u6536\u8D77\u6700\u8FD1\u5BF9\u8BDD", "expandRecentChats": "\u5C55\u5F00\u6700\u8FD1\u5BF9\u8BDD", "pinned": "\u7F6E\u9876", "search": "\u641C\u7D22", "skills": "\u6280\u80FD", "knowledge": "\u77E5\u8BC6\u5E93", "plugins": "\u63D2\u4EF6", "automation": "\u81EA\u52A8\u5316", "running": "\u6267\u884C\u4E2D", "newChat": "\u65B0\u5BF9\u8BDD", "settings": "\u8BBE\u7F6E", "collapseProjects": "\u6536\u8D77\u9879\u76EE\u5217\u8868", "expandProjects": "\u5C55\u5F00\u9879\u76EE\u5217\u8868", "more": "\u66F4\u591A", "other": "\u5176\u4ED6", "canvas": "\u65E0\u9650\u753B\u5E03", "remote": "\u8FDC\u7A0B\u8FDE\u63A5", "newProject": "\u65B0\u5EFA\u9879\u76EE", "noProjects": "\u6682\u65E0\u9879\u76EE", "noChats": "\u6682\u65E0\u5BF9\u8BDD", "archiveAll": "\u5F52\u6863\u6240\u6709\u804A\u5929", "organizeSidebar": "\u6574\u7406\u4FA7\u8FB9\u680F", "sortCriteria": "\u6392\u5E8F\u6761\u4EF6", "organizeByProject": "\u6309\u9879\u76EE", "organizeRecentProjects": "\u8FD1\u671F\u9879\u76EE", "organizeByTime": "\u6309\u65F6\u95F4\u987A\u5E8F", "organizeMoveDown": "\u4E0B\u79FB", "sortByCreated": "\u521B\u5EFA\u65F6\u95F4", "sortByUpdated": "\u66F4\u65B0\u65F6\u95F4", "newBlankProject": "\u65B0\u5EFA\u7A7A\u767D\u9879\u76EE", "useExistingFolder": "\u4F7F\u7528\u73B0\u6709\u6587\u4EF6\u5939", "pin": "\u7F6E\u9876", "unpin": "\u53D6\u6D88\u7F6E\u9876", "archive": "\u5F52\u6863\u5BF9\u8BDD", "pinProject": "\u7F6E\u9876\u9879\u76EE", "unpinProject": "\u53D6\u6D88\u7F6E\u9876\u9879\u76EE", "openInExplorer": "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u6253\u5F00", "edit": "\u7F16\u8F91", "addSection": "\u6DFB\u52A0\u5206\u533A", "archiveChats": "\u5F52\u6863\u804A\u5929", "removeProject": "\u79FB\u9664\u9879\u76EE", "renameProject": "\u91CD\u547D\u540D\u9879\u76EE", "remove": "\u79FB\u9664", "renameProjectDialog": { "title": "\u91CD\u547D\u540D\u9879\u76EE", "placeholder": "\u9879\u76EE\u540D\u79F0", "cancel": "\u53D6\u6D88", "confirm": "\u4FDD\u5B58" }, "removeProjectDialog": { "title": "\u79FB\u9664\u9879\u76EE\uFF1F", "description": "\u8FD9\u4F1A\u4ECE\u4FA7\u8FB9\u680F\u79FB\u9664 {{project}}\uFF0C\u4E0D\u4F1A\u5220\u9664\u672C\u5730\u6587\u4EF6\u6216\u5386\u53F2\u5BF9\u8BDD\u3002", "cancel": "\u53D6\u6D88", "confirm": "\u79FB\u9664" }, "archiveProjectDialog": { "title": "\u5F52\u6863\u5F53\u524D\u9879\u76EE\u5BF9\u8BDD\uFF1F", "description": "\u8FD9\u4F1A\u5C06 {{project}} \u9879\u76EE\u4E2D\u7684\u5BF9\u8BDD\u5F52\u6863\u3002\u4E4B\u540E\u4F60\u53EF\u4EE5\u5728\u5DF2\u5F52\u6863\u5BF9\u8BDD\u4E2D\u627E\u5230\u5B83\u4EEC\u3002", "cancel": "\u53D6\u6D88", "confirm": "\u5F52\u6863" }, "loginApi": "\u5DF2\u901A\u8FC7 API \u5BC6\u94A5\u767B\u5F55", "logout": "\u9000\u51FA\u767B\u5F55" }, "remote": { "back": "\u8FD4\u56DE\u4E3B\u7A97\u53E3", "newConnection": "\u65B0\u5EFA\u8FDE\u63A5", "selectConnection": "\u9009\u62E9\u8FDE\u63A5", "backToList": "\u8FD4\u56DE\u5217\u8868", "connecting": "\u6B63\u5728\u8FDE\u63A5\uFF0C\u5373\u5C06\u8FDB\u5165\u7EC8\u7AEF...", "reconnectHint": "\u8BF7\u4ECE\u5DE6\u4FA7\u91CD\u65B0\u9009\u62E9\u8FDE\u63A5\u540E\u91CD\u8BD5", "allConnections": "\u6240\u6709\u8FDE\u63A5", "searchFiles": "\u641C\u7D22\u6587\u4EF6", "searchPlaceholder": "\u641C\u7D22\u5DF2\u52A0\u8F7D\u7684\u6587\u4EF6...", "noConnections": "\u5C1A\u65E0 SSH \u8FDE\u63A5\uFF0C\u70B9\u51FB\u201C\u65B0\u5EFA\u8FDE\u63A5\u201D\u6DFB\u52A0", "noMatch": "\u65E0\u5339\u914D\u6587\u4EF6", "emptyTree": "\u8FDE\u63A5\u540E\u5C55\u793A\u8FDC\u7A0B\u76EE\u5F55", "loadFailed": "\u76EE\u5F55\u52A0\u8F7D\u5931\u8D25", "createFailed": "\u521B\u5EFA\u8FDE\u63A5\u5931\u8D25", "connectFailed": "\u8FDE\u63A5\u5931\u8D25", "emptyTitle": "\u672A\u9009\u62E9\u8FDE\u63A5", "emptyDesc": "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A SSH \u8FDE\u63A5\uFF0C\u6216\u65B0\u5EFA\u8FDE\u63A5\u5F00\u59CB\u6D4F\u89C8\u8FDC\u7A0B\u6587\u4EF6", "tabTerminal": "\u7EC8\u7AEF", "previewLoading": "\u6B63\u5728\u8BFB\u53D6\u6587\u4EF6...", "previewTruncated": "\u6587\u4EF6\u8F83\u5927\uFF0C\u4EC5\u663E\u793A\u524D 1 MB", "previewTooLarge": "\u6587\u4EF6\u8D85\u8FC7 10 MB\uFF0C\u8FDC\u7A0B\u9884\u89C8\u6682\u4E0D\u652F\u6301", "previewLoadFailed": "\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25", "notConnected": "\u8BF7\u5148\u8FDE\u63A5\u8FDC\u7A0B\u670D\u52A1\u5668", "treeNewFolder": "\u65B0\u5EFA\u6587\u4EF6\u5939", "treeNewFile": "\u65B0\u5EFA\u6587\u4EF6", "treeRefresh": "\u5237\u65B0", "treeRename": "\u91CD\u547D\u540D", "treeDelete": "\u5220\u9664", "treeConfirmDelete": "\u518D\u6B21\u70B9\u51FB\u786E\u8BA4\u5220\u9664", "treeConfirmDeleteDir": "\u786E\u8BA4\u5220\u9664\u6574\u4E2A\u76EE\u5F55", "treeNamePlaceholder": "\u8F93\u5165\u540D\u79F0\uFF0CEnter \u786E\u8BA4", "treeOpFailed": "\u64CD\u4F5C\u5931\u8D25", "uploads": "\u4E0A\u4F20", "connEdit": "\u7F16\u8F91", "editConnection": "\u7F16\u8F91\u8FDE\u63A5", "connConfirmDelete": "\u518D\u6B21\u70B9\u51FB\u786E\u8BA4\u5220\u9664\u8FDE\u63A5", "editPasswordHint": "\u4FDD\u5B58\u524D\u9700\u91CD\u65B0\u8F93\u5165\u5BC6\u7801", "updateFailed": "\u4FDD\u5B58\u5931\u8D25", "deleteFailed": "\u5220\u9664\u5931\u8D25", "tabRename": "\u91CD\u547D\u540D", "tabClose": "\u5173\u95ED", "tabNewTerminal": "\u65B0\u5EFA\u7EC8\u7AEF" }, "contextMenu": { "copy": "\u590D\u5236", "selectAll": "\u5168\u9009" }, "settings": { "general": { "title": "\u5E38\u89C4", "workMode": { "title": "\u5DE5\u4F5C\u6A21\u5F0F", "desc": "\u9009\u62E9 Codex \u663E\u793A\u591A\u5C11\u6280\u672F\u7EC6\u8282", "code": "\u9002\u7528\u4E8E\u7F16\u7A0B", "codeDesc": "\u66F4\u5177\u6280\u672F\u6027\u7684\u56DE\u590D\u548C\u63A7\u5236", "daily": "\u9002\u7528\u4E8E\u65E5\u5E38\u5DE5\u4F5C", "dailyDesc": "\u540C\u6837\u5F3A\u5927\uFF0C\u6280\u672F\u7EC6\u8282\u66F4\u5C11" }, "permissions": { "title": "\u6743\u9650", "default": "\u9ED8\u8BA4\u6743\u9650", "defaultDesc": "\u9ED8\u8BA4\u60C5\u51B5\u4E0B\uFF0CCodex \u53EF\u4EE5\u8BFB\u53D6\u5E76\u7F16\u8F91\u5176\u5DE5\u4F5C\u533A\u4E2D\u7684\u6587\u4EF6\u3002\u5FC5\u8981\u65F6\uFF0C\u5B83\u53EF\u4EE5\u8BF7\u6C42\u989D\u5916\u7684\u8BBF\u95EE\u6743\u9650\u3002", "auto": "\u81EA\u52A8\u5BA1\u6838", "autoDesc": "Codex \u53EF\u4EE5\u8BFB\u53D6\u548C\u7F16\u8F91\u5176\u5DE5\u4F5C\u533A\u4E2D\u7684\u6587\u4EF6\u3002Codex \u4F1A\u81EA\u52A8\u5BA1\u6838\u989D\u5916\u8BBF\u95EE\u6743\u9650\u8BF7\u6C42\u3002\u81EA\u52A8\u5BA1\u6838\u53EF\u80FD\u4F1A\u51FA\u9519\u3002\u4E86\u89E3\u66F4\u591A\u6709\u5173\u98CE\u9669\u7684\u4FE1\u606F\u3002", "full": "\u5B8C\u5168\u8BBF\u95EE\u6743\u9650", "fullDesc": "\u5F53 Codex \u4EE5\u5B8C\u5168\u8BBF\u95EE\u6743\u9650\u8FD0\u884C\u65F6\uFF0C\u65E0\u9700\u4F60\u6279\u51C6\uFF0C\u5373\u53EF\u7F16\u8F91\u4F60\u7684\u7535\u8111\u4E0A\u7684\u4EFB\u4F55\u6587\u4EF6\u5E76\u8FD0\u884C\u8054\u7F51\u547D\u4EE4\u3002\u8FD9\u4F1A\u663E\u8457\u589E\u52A0\u6570\u636E\u4E22\u5931\u3001\u6CC4\u9732\u6216\u610F\u5916\u884C\u4E3A\u7684\u98CE\u9669\u3002\u4E86\u89E3\u66F4\u591A\u6709\u5173\u9AD8\u98CE\u9669\u7684\u4FE1\u606F\u3002" }, "generalSection": { "title": "\u5E38\u89C4", "defaultTarget": "\u9ED8\u8BA4\u6253\u5F00\u76EE\u6807", "defaultTargetDesc": "\u9ED8\u8BA4\u6253\u5F00\u6587\u4EF6\u548C\u6587\u4EF6\u5939\u7684\u4F4D\u7F6E", "agentEnv": "\u667A\u80FD\u4F53\u73AF\u5883", "agentEnvDesc": "\u9009\u62E9\u667A\u80FD\u4F53\u5728 Windows \u4E0A\u7684\u8FD0\u884C\u4F4D\u7F6E", "shell": "\u96C6\u6210\u7EC8\u7AEF Shell", "shellDesc": "\u9009\u62E9\u8981\u5728\u96C6\u6210\u7EC8\u7AEF\u4E2D\u6253\u5F00\u7684 Shell\u3002", "language": "\u8BED\u8A00", "languageDesc": "\u5E94\u7528 UI \u8BED\u8A00", "searchLanguage": "\u641C\u7D22\u8BED\u8A00", "noLanguageFound": "\u672A\u627E\u5230\u76F8\u5173\u8BED\u8A00", "longText": "\u9700\u6309 ^ - \u56DE\u8F66\u952E\u53D1\u9001\u957F\u6587\u672C\u63D0\u793A", "longTextDesc": "\u542F\u7528\u540E\uFF0C\u957F\u6587\u672C\u63D0\u793A\u9700\u6309 ^ + \u56DE\u8F66\u952E\u53D1\u9001\u3002", "followUp": "\u8DDF\u8FDB\u884C\u4E3A", "followUpDesc": "\u5728 Codex \u8FD0\u884C\u65F6\u5C06\u540E\u7EED\u64CD\u4F5C\u52A0\u5165\u961F\u5217\uFF0C\u6216\u5F15\u5BFC\u5F53\u524D\u8FD0\u884C\u3002\u6309\u4E0B\u201CCtrl+\u21B5\u201D\u53EF\u5BF9\u5355\u6761\u6D88\u606F\u6267\u884C\u76F8\u53CD\u64CD\u4F5C", "queue": "\u6392\u961F", "guide": "\u5F15\u5BFC", "codeReview": "\u4EE3\u7801\u5BA1\u67E5", "codeReviewDesc": "\u5C3D\u53EF\u80FD\u5728\u5F53\u524D\u5BF9\u8BDD\u4E2D\u542F\u52A8 /review\uFF0C\u6216\u53D1\u8D77\u5355\u72EC\u7684\u5BA1\u67E5\u5BF9\u8BDD", "inline": "\u884C\u5185\u89C6\u56FE", "split": "\u5206\u79BB\u89C6\u56FE", "suggestions": "\u5EFA\u8BAE\u63D0\u793A", "suggestionsDesc": "\u641C\u7D22\u9879\u76EE\u6587\u4EF6\u548C\u5DF2\u8FDE\u63A5\u5E94\u7528\uFF0C\u5EFA\u8BAE\u4E0B\u4E00\u6B65\u64CD\u4F5C", "import": "\u4ECE\u5176\u4ED6 AI \u5E94\u7528\u5BFC\u5165\u5DE5\u4F5C\u5185\u5BB9", "importDesc": "\u5BFC\u5165\u60A8\u7684\u8BBE\u7F6E\u3001\u9879\u76EE\u548C\u6700\u8FD1\u804A\u5929\u8BB0\u5F55", "importBtn": "\u5BFC\u5165" }, "popup": { "title": "\u5F39\u51FA\u7A97\u53E3", "shortcut": "\u5F39\u51FA\u7A97\u53E3\u5FEB\u6377\u952E", "shortcutDesc": "\u4E3A\u5F39\u51FA\u7A97\u53E3\u8BBE\u7F6E\u5168\u5C40\u5FEB\u6377\u952E\u3002\u7559\u7A7A\u5219\u4FDD\u6301\u5173\u95ED\u3002", "disabled": "\u7981\u7528", "set": "\u8BBE\u7F6E", "noProject": "\u9ED8\u8BA4\u4F7F\u7528\u65E0\u9879\u76EE\u804A\u5929", "noProjectDesc": "\u65E0\u9700\u9879\u76EE\u5373\u53EF\u5F00\u59CB\u65B0\u804A\u5929" }, "dictation": { "title": "\u542C\u5199", "hold": "\u6309\u4F4F\u542C\u5199\u5FEB\u6377\u952E", "holdDesc": "\u5728\u684C\u9762\u4EFB\u610F\u4F4D\u7F6E\u6309\u4F4F\uFF0C\u5373\u53EF\u5728\u5149\u6807\u5904\u542C\u5199", "off": "\u5173\u95ED", "set": "\u8BBE\u7F6E", "toggle": "\u5207\u6362\u542C\u5199\u5FEB\u6377\u952E", "toggleDesc": "\u5728\u684C\u9762\u4EFB\u610F\u4F4D\u7F6E\u6309\u4E00\u6B21\u5F00\u59CB\u542C\u5199\uFF0C\u518D\u6309\u4E00\u6B21\u505C\u6B62", "dictionary": "\u542C\u5199\u8BCD\u5178", "dictionaryDesc": "\u542C\u5199\u5E94\u80FD\u8BC6\u522B\u7684\u5355\u8BCD\u6216\u77ED\u8BED", "recent": "\u6700\u8FD1\u7684\u542C\u5199\u8BB0\u5F55", "recentDesc": "\u4F60\u6700\u8FD1\u7684\u542C\u5199\u8BB0\u5F55\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\uFF0C\u4FBF\u4E8E\u5728\u6587\u672C\u6CA1\u6709\u51FA\u73B0\u5728\u9884\u671F\u4F4D\u7F6E\u65F6\u627E\u56DE\u5185\u5BB9" }, "notifications": { "title": "\u901A\u77E5", "turnDone": "\u8F6E\u6B21\u5B8C\u6210\u901A\u77E5", "turnDoneDesc": "\u8BBE\u7F6E Codex \u5B8C\u6210\u4EFB\u52A1\u65F6\u7684\u63D0\u9192", "always": "\u59CB\u7EC8", "unfocused": "\u4EC5\u5F53\u5E94\u7528\u5931\u7126\u65F6", "never": "\u4ECE\u4E0D", "permission": "\u542F\u7528\u6743\u9650\u901A\u77E5", "permissionDesc": "\u5728\u5BA1\u67E5\u901A\u77E5\u9650\u65F6\u663E\u793A\u63D0\u9192", "issue": "\u542F\u7528\u95EE\u9898\u901A\u77E5", "issueDesc": "\u9700\u8981\u8F93\u5165\u6216\u53D1\u751F\u9519\u8BEF\u65F6\u663E\u793A\u63D0\u9192" } }, "tabs": { "back": "\u8FD4\u56DE\u5E94\u7528", "general": "\u5E38\u89C4", "appearance": "\u5916\u89C2", "config": "\u914D\u7F6E", "personalize": "\u4E2A\u6027\u5316", "shortcuts": "\u952E\u76D8\u5FEB\u6377\u952E", "mcp": "MCP \u670D\u52A1\u5668", "hooks": "\u94A9\u5B50", "connections": "\u8FDE\u63A5", "git": "Git", "env": "\u73AF\u5883", "worktree": "\u5DE5\u4F5C\u6811", "browser": "\u6D4F\u89C8\u5668", "computer": "\u7535\u8111\u64CD\u63A7", "project_map_debug": "\u9879\u76EE\u5730\u56FE\u8C03\u8BD5", "archive": "\u5DF2\u5F52\u6863\u5BF9\u8BDD", "about": "\u5173\u4E8E" }, "about": { "title": "\u5173\u4E8E DeepAgent Studio", "subtitle": "\u9762\u5411 DeepSeek \u7684 Agent \u8FD0\u884C\u65F6\u5E73\u53F0\u4E0E\u684C\u9762\u5DE5\u4F5C\u53F0\u3002", "project": { "title": "\u9879\u76EE\u4FE1\u606F", "version": "\u684C\u9762\u7AEF v0.0.8", "description": "DeepAgent Studio \u4E0D\u53EA\u662F\u804A\u5929\u5E94\u7528\uFF0C\u800C\u662F\u4E00\u4E2A\u53EF\u9A8C\u8BC1\u3001\u53EF\u56DE\u653E\u7684 Agent \u8FD0\u884C\u65F6\u5E73\u53F0\uFF0C\u63D0\u4F9B\u4E0A\u4E0B\u6587\u5DE5\u7A0B\u3001\u5DE5\u5177\u6267\u884C\u3001\u6743\u9650\u63A7\u5236\u3001MCP \u6269\u5C55\u4E0E\u684C\u9762\u5DE5\u4F5C\u6D41\u3002\u672C\u7CFB\u7EDF\u5DF2\u8F6F\u8457\u767B\u8BB0\u3002" }, "stack": { "title": "\u6280\u672F\u6808" }, "developer": { "title": "\u5F00\u53D1\u8005", "name": "\u7A0B\u5E8F\u5458Eighteen", "role": "DeepAgent Studio \u53D1\u8D77\u4EBA\u4E0E\u4E3B\u8981\u5F00\u53D1\u8005" }, "contact": { "title": "\u5FEB\u901F\u8054\u7CFB", "github": "\u5728 GitHub \u67E5\u770B\u9879\u76EE\u3001\u63D0\u4EA4 Issue \u6216\u53C2\u4E0E\u8D21\u732E", "repository": "\u4E2A\u4EBA\u4EE3\u7801\u4ED3\u5E93\u9996\u9875" }, "actions": { "contact": "\u5FEB\u901F\u8054\u7CFB", "support": "\u9879\u76EE\u652F\u6301", "close": "\u5173\u95ED" }, "contactDialog": { "title": "\u8054\u7CFB\u5F00\u53D1\u8005", "email": "\u90AE\u7BB1", "phone": "\u624B\u673A\u53F7", "qq": "QQ", "wechat": "\u5FAE\u4FE1", "clickToCopy": "\u70B9\u51FB\u590D\u5236", "copied": "\u5DF2\u590D\u5236" }, "developers": { "eighteen": { "name": "\u7A0B\u5E8F\u5458Eighteen", "role": "\u5168\u6808\u5F00\u53D1", "bio": "\u8D1F\u8D23 DeepAgent Studio \u7684\u5168\u6808\u5F00\u53D1\uFF0C\u6784\u5EFA\u684C\u9762\u5E94\u7528\u3001Agent \u8FD0\u884C\u65F6\u548C\u5DE5\u5177\u751F\u6001\u3002", "repository": "https://github.com/eighteendreamer", "contact": { "email": "eighteendreamer@gmail.com", "phone": "\u5F85\u914D\u7F6E", "qq": "3273495516", "wechat": "Eighteenth_year" } }, "designer": { "name": "\u8BBE\u8BA1\u5E08\u96F7\u5E08\u5085", "role": "\u7CFB\u7EDF\u8BBE\u8BA1", "bio": "\u8D1F\u8D23\u7CFB\u7EDF\u67B6\u6784\u4E0E\u4EA7\u54C1\u8BBE\u8BA1\uFF0C\u5173\u6CE8 Agent \u80FD\u529B\u3001\u4EA4\u4E92\u6D41\u7A0B\u548C\u957F\u671F\u53EF\u7EF4\u62A4\u6027\u3002", "repository": "https://github.com/leishifu666", "contact": { "email": "2934546967@qq.com", "phone": "19277413890", "qq": "2934546967@qq.com", "wechat": "Capper2934546967" } } }, "support": { "title": "\u9879\u76EE\u652F\u6301", "heading": "\u652F\u6301 DeepAgent Studio \u6301\u7EED\u5F00\u53D1", "description": "\u4F60\u7684\u652F\u6301\u4F1A\u7528\u4E8E\u9879\u76EE\u7EF4\u62A4\u3001\u8FD0\u884C\u65F6\u80FD\u529B\u5EFA\u8BBE\u548C\u684C\u9762\u7AEF\u4F53\u9A8C\u6539\u8FDB\u3002", "pending": "\u4ED8\u6B3E\u7801\u8D44\u6E90\u5F85\u914D\u7F6E" }, "supportDialog": { "title": "\u9879\u76EE\u652F\u6301", "heading": "\u652F\u6301 DeepAgent Studio \u6301\u7EED\u5F00\u53D1", "pending": "\u611F\u8C22\u4F60\u7684\u652F\u6301\u3002", "wechat": "\u5FAE\u4FE1\u652F\u4ED8", "alipay": "\u652F\u4ED8\u5B9D", "notAvailable": "\u8BE5\u5F00\u53D1\u8005\u7684\u4ED8\u6B3E\u7801\u5F85\u914D\u7F6E" } }, "hooks": { "title": "\u94A9\u5B50", "desc": "\u901A\u8FC7\u914D\u7F6E\u548C\u5DF2\u542F\u7528\u7684\u63D2\u4EF6\u7BA1\u7406\u751F\u547D\u5468\u671F\u94A9\u5B50\u3002", "learnMore": "\u4E86\u89E3\u66F4\u591A\u3002", "noHooks": "\u672A\u627E\u5230\u94A9\u5B50", "noHooksDesc": "\u5DF2\u914D\u7F6E\u94A9\u5B50\u7684\u9879\u76EE\u5C06\u663E\u793A\u5728\u6B64\u5904", "editorTitle": "hooks.json", "editorDesc": "\u58F0\u660E\u5728\u751F\u547D\u5468\u671F\u8282\u70B9\uFF08PreToolUse / PostToolUse / UserPromptSubmit / Stop\uFF09\u8FD0\u884C\u7684\u5916\u90E8\u547D\u4EE4\u94A9\u5B50\u3002PreToolUse \u547D\u4EE4\u4EE5\u9000\u51FA\u7801 2 \u7ED3\u675F\u65F6\uFF0C\u4F1A\u963B\u65AD\u8BE5\u5DE5\u5177\u8C03\u7528\u5E76\u628A stderr \u56DE\u5582\u7ED9\u6A21\u578B\u3002", "save": "\u4FDD\u5B58", "saved": "\u5DF2\u4FDD\u5B58", "invalidJson": "JSON \u65E0\u6548", "format": "\u683C\u5F0F\u5316", "actionsRegistered": "\u5DF2\u58F0\u660E {{count}} \u4E2A\u94A9\u5B50\u52A8\u4F5C" }, "mcp": { "back": "\u8FD4\u56DE", "connectCustom": "\u8FDE\u63A5\u81F3\u81EA\u5B9A\u4E49 MCP", "connectCustomDesc": "\u914D\u7F6E\u4E00\u4E2A\u5916\u90E8 MCP \u670D\u52A1\u5668\uFF08stdio \u6216\u6D41\u5F0F HTTP\uFF09\u3002", "name": "\u540D\u79F0", "streamingHttp": "\u6D41\u5F0F HTTP", "startCommand": "\u542F\u52A8\u547D\u4EE4", "args": "\u53C2\u6570", "addArg": "+ \u6DFB\u52A0\u53C2\u6570", "serverUrl": "\u670D\u52A1\u5668 URL", "urlDesc": "\u5FC5\u987B\u4F7F\u7528 https://\uFF08localhost \u53EF\u7528 http://\uFF09\u3002", "envVars": "\u73AF\u5883\u53D8\u91CF", "key": "\u952E", "value": "\u503C", "addEnvVar": "+ \u6DFB\u52A0\u73AF\u5883\u53D8\u91CF", "save": "\u4FDD\u5B58", "title": "MCP \u670D\u52A1\u5668", "desc": "\u8FDE\u63A5\u5916\u90E8\u5DE5\u5177\u548C\u6570\u636E\u6E90\u3002", "learnMore": "\u4E86\u89E3\u66F4\u591A\u3002", "servers": "\u670D\u52A1\u5668", "addServer": "\u6DFB\u52A0\u670D\u52A1\u5668", "noServers": "\u8FD8\u6CA1\u6709 MCP \u670D\u52A1\u5668\u3002\u70B9\u51FB\u300C\u6DFB\u52A0\u670D\u52A1\u5668\u300D\u8FDE\u63A5\u5916\u90E8\u5DE5\u5177\u3002", "edit": "\u7F16\u8F91", "delete": "\u5220\u9664", "testConnection": "\u6D4B\u8BD5\u8FDE\u63A5", "refreshStatus": "\u5237\u65B0\u72B6\u6001", "statusConnected": "\u5DF2\u8FDE\u63A5", "statusFailed": "\u8FDE\u63A5\u5931\u8D25", "statusDisabled": "\u5DF2\u7981\u7528", "statusPreparing": "\u51C6\u5907\u4E2D", "toolsFound": "{{count}} \u4E2A\u5DE5\u5177" }, "personalize": { "title": "\u4E2A\u6027\u5316", "greeting": "\u6B22\u8FCE\u8BED", "greetingDesc": "\u8BBE\u7F6E\u8FDB\u5165\u5E94\u7528\u65F6\u6B22\u8FCE\u8BED\u4E2D\u663E\u793A\u7684\u81EA\u5B9A\u4E49\u540D\u79F0", "greetingPrefix": "\u6B22\u8FCE\u4F7F\u7528\uFF0C", "greetingPlaceholder": "\u81EA\u5B9A\u4E49\u540D\u79F0", "greetingDefaultName": "\u5F00\u53D1\u8005", "personality": "\u4E2A\u6027", "personalityDesc": "\u9009\u62E9 Codex \u56DE\u590D\u7684\u9ED8\u8BA4\u8BED\u6C14", "affable": "\u4EB2\u548C", "affableDesc": "\u6E29\u6696\u3001\u534F\u4F5C\u3001\u8D34\u5FC3", "pragmatic": "\u52A1\u5B9E", "pragmaticDesc": "\u7B80\u6D01\u3001\u4E13\u6CE8\u3001\u76F4\u63A5", "customInstructions": "\u81EA\u5B9A\u4E49\u6307\u4EE4", "customInstructionsDesc": "\u4E3A\u4F60\u7684\u9879\u76EE\u5411 Codex \u63D0\u4F9B\u989D\u5916\u8BF4\u660E\u548C\u4E0A\u4E0B\u6587\u3002", "learnMore": "\u4E86\u89E3\u66F4\u591A", "customInstructionsPlaceholder": "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u6307\u4EE4..", "save": "\u4FDD\u5B58", "memory": "\u8BB0\u5FC6\uFF08\u5B9E\u9A8C\u6027\uFF09", "memoryDesc": "\u8BBE\u7F6E Codex \u5982\u4F55\u6536\u96C6\u3001\u4FDD\u7559\u548C\u6574\u5408\u8BB0\u5FC6\u3002", "enableMemory": "\u542F\u7528\u8BB0\u5FC6", "enableMemoryDesc": "\u4ECE\u804A\u5929\u4E2D\u751F\u6210\u65B0\u8BB0\u5FC6\uFF0C\u5E76\u5C06\u5176\u5E26\u5165\u65B0\u804A\u5929", "skipToolMemory": "\u8DF3\u8FC7\u5DE5\u5177\u8F85\u52A9\u5BF9\u8BDD", "skipToolMemoryDesc": "\u8BF7\u52FF\u4ECE\u4F7F\u7528\u4E86 MCP \u5DE5\u5177\u6216\u7F51\u9875\u641C\u7D22\u7684\u5BF9\u8BDD\u4E2D\u751F\u6210\u8BB0\u5FC6", "resetMemory": "\u91CD\u7F6E\u8BB0\u5FC6", "resetMemoryDesc": "\u5220\u9664\u6240\u6709 Codex \u8BB0\u5FC6", "reset": "\u91CD\u7F6E" }, "shortcuts": { "title": "\u952E\u76D8\u5FEB\u6377\u952E", "searchPlaceholder": "\u641C\u7D22\u5FEB\u6377\u952E", "command": "\u547D\u4EE4", "keybinding": "\u6309\u952E\u7ED1\u5B9A", "unassigned": "\u672A\u6307\u5B9A", "noShortcuts": "\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u5FEB\u6377\u952E", "archiveChat": "\u5F52\u6863\u804A\u5929", "archiveChatDesc": "\u5F52\u6863\u5F53\u524D\u804A\u5929", "newChat": "\u65B0\u5BF9\u8BDD", "newChatDesc": "\u5F00\u59CB\u65B0\u804A\u5929", "openSideChat": "\u6253\u5F00\u4FA7\u8FB9\u804A\u5929", "openSideChatDesc": "\u5728\u4FA7\u8FB9\u680F\u6253\u5F00\u5F53\u524D\u804A\u5929", "openNewWindow": "\u5728\u65B0\u7A97\u53E3\u4E2D\u6253\u5F00", "openNewWindowDesc": "\u5728\u65B0\u7A97\u53E3\u4E2D\u6253\u5F00\u5F53\u524D\u804A\u5929", "newQuickChat": "\u65B0\u5EFA\u5FEB\u901F\u5BF9\u8BDD", "newQuickChatDesc": "\u5728\u5FEB\u901F\u7EC4\u4EF6\u4E2D\u5F00\u59CB\u8F7B\u91CF\u7EA7\u804A\u5929", "togglePin": "\u5207\u6362\u7F6E\u9876\u72B6\u6001", "togglePinDesc": "\u7F6E\u9876\u6216\u53D6\u6D88\u7F6E\u9876\u5F53\u524D\u804A\u5929", "search": "\u67E5\u627E", "searchDesc": "\u641C\u7D22\u5F53\u524D\u804A\u5929", "focusBrowserAddress": "\u805A\u7126\u6D4F\u89C8\u5668\u5730\u5740\u680F", "focusBrowserAddressDesc": "\u805A\u7126\u5185\u7F6E\u6D4F\u89C8\u5668\u5730\u5740\u680F", "goBack": "\u8FD4\u56DE", "goBackDesc": "\u5728\u5BFC\u822A\u5386\u53F2\u8BB0\u5F55\u4E2D\u8FD4\u56DE", "goForward": "\u524D\u8FDB", "goForwardDesc": "\u5728\u5BFC\u822A\u5386\u53F2\u8BB0\u5F55\u4E2D\u524D\u8FDB", "nextChat": "\u4E0B\u4E00\u4E2A\u5BF9\u8BDD", "nextChatDesc": "\u5207\u6362\u5230\u4E0B\u4E00\u4E2A\u5BF9\u8BDD", "prevChat": "\u4E0A\u4E00\u4E2A\u5BF9\u8BDD", "prevChatDesc": "\u5207\u6362\u5230\u4E0A\u4E00\u4E2A\u5BF9\u8BDD", "openBrowserTab": "\u6253\u5F00\u6D4F\u89C8\u5668\u6807\u7B7E\u9875", "openBrowserTabDesc": "\u6253\u5F00\u6D4F\u89C8\u5668\u6807\u7B7E\u9875", "openReviewTab": "\u6253\u5F00\u5BA1\u67E5\u9009\u9879\u5361", "openReviewTabDesc": "\u6253\u5F00\u5BA1\u67E5\u9009\u9879\u5361", "toggleBrowserPanel": "\u663E\u793A/\u9690\u85CF\u6D4F\u89C8\u5668\u9762\u677F", "toggleBrowserPanelDesc": "\u663E\u793A\u6216\u9690\u85CF\u6D4F\u89C8\u5668\u9762\u677F", "toggleSidebar": "\u5207\u6362\u8FB9\u680F", "toggleSidebarDesc": "\u663E\u793A\u6216\u9690\u85CF\u4FA7\u8FB9\u680F", "toggleSidePanel": "\u5207\u6362\u4FA7\u8FB9\u9762\u677F", "toggleSidePanelDesc": "\u663E\u793A\u6216\u9690\u85CF\u4FA7\u8FB9\u9762\u677F", "toggleTerminal": "\u5207\u6362\u7EC8\u7AEF", "toggleTerminalDesc": "\u663E\u793A\u6216\u9690\u85CF\u7EC8\u7AEF\u9762\u677F", "openFolder": "\u6253\u5F00\u6587\u4EF6\u5939", "openFolderDesc": "\u5411 Codex \u6DFB\u52A0\u672C\u5730\u9879\u76EE", "forceReloadSkill": "\u5F3A\u5236\u91CD\u65B0\u52A0\u8F7D\u6280\u80FD", "forceReloadSkillDesc": "\u5237\u65B0\u5F53\u524D\u4E0A\u4E0B\u6587\u7684\u6280\u80FD\u76EE\u5F55", "goToSkill": "\u524D\u5F80\u6280\u80FD", "goToSkillDesc": "\u6D4F\u89C8\u5DF2\u5B89\u88C5\u548C\u63A8\u8350\u7684\u6280\u80FD", "installCodexWorkspace": "\u5B89\u88C5 Codex \u5DE5\u4F5C\u7A7A\u95F4", "installCodexWorkspaceDesc": "\u5B89\u88C5\u9AD8\u7EA7\u672C\u5730\u529F\u80FD\u7684\u4F9D\u8D56\u9879", "keyboardShortcuts": "\u952E\u76D8\u5FEB\u6377\u65B9\u5F0F", "keyboardShortcutsDesc": "\u81EA\u5B9A\u4E49\u952E\u76D8\u5FEB\u6377\u952E", "mcp": "MCP", "mcpDesc": "\u914D\u7F6E MCP \u670D\u52A1\u5668", "personality": "\u4E2A\u6027", "personalityDesc": "\u8C03\u6574\u8BED\u6C14\u548C\u54CD\u5E94\u98CE\u683C", "feedback": "\u53CD\u9988", "feedbackDesc": "\u5411 Codex \u56E2\u961F\u53D1\u9001\u4EA7\u54C1\u53CD\u9988", "signOut": "\u6CE8\u9500", "signOutDesc": "\u6CE8\u9500 Codex", "manageAutomations": "\u7BA1\u7406\u81EA\u52A8\u5316\u529F\u80FD", "manageAutomationsDesc": "\u521B\u5EFA\u6216\u7BA1\u7406\u81EA\u52A8\u5316", "wakePet": "\u5524\u9192\u5BA0\u7269", "wakePetDesc": "\u5524\u9192\u5BA0\u7269", "openControlWindow": "\u6253\u5F00\u63A7\u5236\u7A97\u53E3", "openControlWindowDesc": "\u6253\u5F00\u63A7\u5236\u7A97\u53E3", "settings": "\u8BBE\u7F6E", "settingsDesc": "\u6253\u5F00 Codex \u8BBE\u7F6E", "approveRequest": "\u6279\u51C6\u8BF7\u6C42", "approveRequestDesc": "\u6279\u51C6\u6D3B\u8DC3\u8BF7\u6C42", "declineRequest": "\u62D2\u7EDD\u8BF7\u6C42", "declineRequestDesc": "\u62D2\u7EDD\u6D3B\u8DC3\u8BF7\u6C42", "close": "\u5173\u95ED", "closeDesc": "\u5173\u95ED\u6D3B\u8DC3\u7684\u6807\u7B7E\u9875\u6216\u7A97\u53E3", "openModelPicker": "\u6253\u5F00\u6A21\u578B\u9009\u62E9\u5668", "openModelPickerDesc": "\u6253\u5F00\u6A21\u578B\u9009\u62E9\u5668", "startDictation": "\u5F00\u59CB\u542C\u5199", "startDictationDesc": "\u5F00\u59CB\u542C\u5199", "toggleVoiceMode": "\u5207\u6362\u8BED\u97F3\u6A21\u5F0F", "toggleVoiceModeDesc": "\u5F00\u59CB\u6216\u505C\u6B62\u8BED\u97F3\u6A21\u5F0F", "copyAsMarkdown": "\u590D\u5236\u4E3A Markdown", "copyAsMarkdownDesc": "\u5C06\u5F53\u524D\u804A\u5929\u590D\u5236\u4E3A Markdown", "copyConversationPath": "\u590D\u5236\u5BF9\u8BDD\u8DEF\u5F84", "copyConversationPathDesc": "\u590D\u5236\u5BF9\u8BDD\u8DEF\u5F84", "copyDeeplink": "\u590D\u5236\u6DF1\u5C42\u94FE\u63A5", "copyDeeplinkDesc": "\u590D\u5236\u5230\u5F53\u524D\u804A\u5929\u7684\u6DF1\u5C42\u94FE\u63A5", "copySessionId": "\u590D\u5236\u4F1A\u8BDD ID", "copySessionIdDesc": "\u590D\u5236\u5F53\u524D\u804A\u5929\u7684\u4F1A\u8BDD ID", "copyWorkingDirectory": "\u590D\u5236\u5DE5\u4F5C\u76EE\u5F55", "copyWorkingDirectoryDesc": "\u590D\u5236\u5DE5\u4F5C\u76EE\u5F55", "holdDictationShortcut": "\u6309\u4F4F\u542C\u5199\u5FEB\u6377\u952E", "holdDictationShortcutDesc": "\u5728\u684C\u9762\u4EFB\u610F\u4F4D\u7F6E\u6309\u4F4F\u4EE5\u542C\u5199", "toggleDictationShortcut": "\u5207\u6362\u542C\u5199\u5FEB\u6377\u952E", "toggleDictationShortcutDesc": "\u5728\u684C\u9762\u4EFB\u610F\u4F4D\u7F6E\u6309\u4E00\u6B21\u542C\u5199\uFF0C\u518D\u6309\u4E00\u6B21\u505C\u6B62", "forceReloadBrowserPage": "\u5F3A\u5236\u91CD\u65B0\u52A0\u8F7D\u6D4F\u89C8\u5668\u9875\u9762", "forceReloadBrowserPageDesc": "\u5F3A\u5236\u91CD\u65B0\u52A0\u8F7D\u6D3B\u8DC3\u7684\u6D4F\u89C8\u5668\u9875\u9762", "popupShortcut": "\u5F39\u51FA\u7A97\u53E3\u5FEB\u6377\u952E", "popupShortcutDesc": "\u4ECE\u4EFB\u4F55\u5730\u65B9\u663E\u793A\u6216\u9690\u85CF\u5F39\u51FA\u7A97\u53E3", "newWindow": "\u65B0\u7A97\u53E3", "newWindowDesc": "\u6253\u5F00\u65B0\u7A97\u53E3", "nextRecentChat": "\u4E0B\u4E00\u4E2A\u6700\u8FD1\u67E5\u770B\u7684\u804A\u5929", "nextRecentChatDesc": "\u5FAA\u73AF\u5230\u4E0B\u4E00\u4E2A\u6700\u8FD1\u67E5\u770B\u7684\u804A\u5929", "openCommandMenu": "\u6253\u5F00\u547D\u4EE4\u83DC\u5355", "openCommandMenuDesc": "\u6253\u5F00\u547D\u4EE4\u83DC\u5355", "prevRecentChat": "\u4E0A\u4E00\u4E2A\u6700\u8FD1\u67E5\u770B\u7684\u804A\u5929", "prevRecentChatDesc": "\u5FAA\u73AF\u5230\u4E0A\u4E00\u4E2A\u6700\u8FD1\u67E5\u770B\u7684\u804A\u5929", "reloadBrowserPage": "\u91CD\u65B0\u52A0\u8F7D\u6D4F\u89C8\u5668\u9875\u9762", "reloadBrowserPageDesc": "\u91CD\u65B0\u52A0\u8F7D\u6D3B\u8DC3\u7684\u6D4F\u89C8\u5668\u9875\u9762", "renameChat": "\u91CD\u547D\u540D\u804A\u5929", "renameChatDesc": "\u91CD\u547D\u540D\u5F53\u524D\u804A\u5929", "searchChats": "\u641C\u7D22\u5BF9\u8BDD...", "searchChatsDesc": "\u641C\u7D22\u5BF9\u8BDD", "searchFiles": "\u641C\u7D22\u6587\u4EF6...", "searchFilesDesc": "\u641C\u7D22\u6587\u4EF6", "showShortcuts": "\u663E\u793A\u952E\u76D8\u5FEB\u6377\u952E", "showShortcutsDesc": "\u663E\u793A\u5FEB\u6377\u952E", "goToChat1": "\u8F6C\u5230\u804A\u5929 1", "goToChat1Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "goToChat2": "\u8F6C\u5230\u804A\u5929 2", "goToChat2Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "goToChat3": "\u8F6C\u5230\u804A\u5929 3", "goToChat3Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "goToChat4": "\u8F6C\u5230\u804A\u5929 4", "goToChat4Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "goToChat5": "\u8F6C\u5230\u804A\u5929 5", "goToChat5Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "goToChat6": "\u8F6C\u5230\u804A\u5929 6", "goToChat6Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "goToChat7": "\u8F6C\u5230\u804A\u5929 7", "goToChat7Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "goToChat8": "\u8F6C\u5230\u804A\u5929 8", "goToChat8Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "goToChat9": "\u8F6C\u5230\u804A\u5929 9", "goToChat9Desc": "\u6253\u5F00\u8BE5\u5FEB\u6377\u69FD\u4E2D\u7684\u53EF\u89C1\u804A\u5929", "toggleFileTree": "\u5207\u6362\u6587\u4EF6\u6811", "toggleFileTreeDesc": "\u5207\u6362\u6587\u4EF6\u6811", "startTraceRecording": "\u5F00\u59CB\u5F55\u5236\u8DDF\u8E2A", "startTraceRecordingDesc": "\u5F00\u59CB\u5F55\u5236\u8DDF\u8E2A" }, "worktrees": { "title": "\u5DE5\u4F5C\u6811", "noWorktrees": "\u5C1A\u65E0\u5DE5\u4F5C\u6811", "noWorktreesDesc": "Codex \u521B\u5EFA\u7684\u5DE5\u4F5C\u6811\u5C06\u663E\u793A\u5728\u6B64\u5904\u3002" }, "appearance": { "selected": "\u5DF2\u9009", "select": "\u9009\u62E9", "title": "\u5916\u89C2", "theme": "\u4E3B\u9898", "themeDesc": "\u4F7F\u7528\u6D45\u8272\u3001\u6DF1\u8272\uFF0C\u6216\u5339\u914D\u7CFB\u7EDF\u8BBE\u7F6E", "light": "\u6D45\u8272", "dark": "\u6DF1\u8272", "system": "\u7CFB\u7EDF", "lightTheme": "\u6D45\u8272\u4E3B\u9898", "import": "\u5BFC\u5165", "copyTheme": "\u590D\u5236\u4E3B\u9898", "accentColor": "\u5F3A\u8C03\u8272", "background": "\u80CC\u666F", "foreground": "\u524D\u666F", "uiFont": "UI \u5B57\u4F53", "codeFont": "\u4EE3\u7801\u5B57\u4F53", "translucentSidebar": "\u534A\u900F\u660E\u4FA7\u8FB9\u680F", "contrast": "\u5BF9\u6BD4\u5EA6", "darkTheme": "\u6DF1\u8272\u4E3B\u9898", "usePointerCursor": "\u4F7F\u7528\u6307\u9488\u5149\u6807", "usePointerCursorDesc": "\u60AC\u505C\u4EA4\u4E92\u5143\u7D20\u65F6\u5207\u6362\u4E3A\u6307\u9488\u5149\u6807", "reduceMotion": "\u51CF\u5C11\u52A8\u6001\u6548\u679C", "reduceMotionDesc": "\u51CF\u5C11\u52A8\u753B\u6548\u679C\u6216\u5339\u914D\u7CFB\u7EDF\u8BBE\u7F6E", "on": "\u5F00\u542F", "off": "\u5173\u95ED", "uiFontSize": "UI \u5B57\u53F7", "uiFontSizeDesc": "\u8C03\u6574 Codex UI \u4F7F\u7528\u7684\u57FA\u7840\u5B57\u53F7", "codeFontSize": "\u4EE3\u7801\u5B57\u4F53\u5927\u5C0F", "codeFontSizeDesc": "\u8C03\u6574\u804A\u5929\u548C\u5DEE\u5F02\u89C6\u56FE\u4E2D\u4EE3\u7801\u4F7F\u7528\u7684\u57FA\u7840\u5B57\u53F7", "diffMarkers": "\u5DEE\u5F02\u6807\u8BB0", "diffMarkersDesc": '\u4F7F\u7528\u5F69\u8272\u6761\u548C\u80CC\u666F\uFF0C\u6216\u5728\u6BCF\u4E2A\u66F4\u6539\u884C\u4E0A\u663E\u793A "+" \u548C "-" \u7B26\u53F7', "color": "\u989C\u8272", "pet": "\u5BA0\u7269", "selectedPet": "\u5DF2\u9009\u62E9 {{pet}}", "createPet": "\u521B\u5EFA\u81EA\u5DF1\u7684\u5BA0\u7269", "refresh": "\u5237\u65B0", "wakePet": "\u5524\u9192\u5BA0\u7269" }, "config": { "title": "\u914D\u7F6E", "desc": "\u7BA1\u7406\u9AD8\u7EA7\u914D\u7F6E\u3002", "learnMore": "\u4E86\u89E3\u66F4\u591A\u3002", "customSettings": "\u81EA\u5B9A\u4E49\u8BBE\u7F6E", "userConfig": "\u7528\u6237\u914D\u7F6E", "openConfig": "\u6253\u5F00\u914D\u7F6E", "approvalStrategy": "\u5BA1\u6279\u7B56\u7565", "approvalDesc": "\u8BBE\u7F6E Codex \u5982\u4F55\u8BF7\u6C42\u5DE5\u5177\u548C\u547D\u4EE4\u5BA1\u6279\u3002", "sandboxSettings": "\u6C99\u76D2\u8BBE\u7F6E", "sandboxDesc": "\u914D\u7F6E\u6C99\u76D2\u9694\u79BB\u7EA7\u522B\u3002", "dependencies": "\u4F9D\u8D56", "currentVersion": "\u5F53\u524D\u7248\u672C", "codexDependencies": "Codex \u4F9D\u8D56", "codexDependenciesDesc": "\u91CD\u65B0\u5B89\u88C5\u6216\u9A8C\u8BC1\u7CFB\u7EDF\u4F9D\u8D56\u3002", "diagnose": "\u8BCA\u65AD", "diagnoseDesc": "\u8FD0\u884C\u8BCA\u65AD\u68C0\u67E5\u3002", "diagnoseBtn": "\u8BCA\u65AD", "resetWorkspace": "\u91CD\u7F6E\u5DE5\u4F5C\u533A", "resetDesc": "\u91CD\u7F6E\u4F60\u7684\u5DE5\u4F5C\u533A\u3002", "reinstall": "\u91CD\u65B0\u5B89\u88C5", "untrusted": "\u4E0D\u53EF\u4FE1", "untrustedDesc": "\u6240\u6709\u64CD\u4F5C\u90FD\u8BE2\u95EE", "onFailure": "\u5931\u8D25\u65F6", "onFailureDesc": "\u5982\u679C\u5931\u8D25\u5219\u8BE2\u95EE", "onDemand": "\u6309\u9700", "onDemandDesc": "\u9700\u8981\u65F6\u8BE2\u95EE", "never": "\u4ECE\u4E0D", "neverDesc": "\u4ECE\u4E0D\u8BE2\u95EE", "readOnly": "\u53EA\u8BFB", "readOnlyDesc": "\u4EC5\u8BFB\u53D6\u6587\u4EF6", "workspaceWrite": "\u5DE5\u4F5C\u533A\u5199\u5165", "workspaceWriteDesc": "\u5141\u8BB8\u5199\u5165\u5DE5\u4F5C\u533A", "fullAccess": "\u5B8C\u5168\u8BBF\u95EE", "fullAccessDesc": "\u653e\u5f00\u5de5\u4f5c\u533a\u56f4\u680f\uff0c\u5e76\u81ea\u52a8\u901a\u8fc7\u5de5\u5177\u6388\u6743", "webSearch": { "title": "\u7F51\u9875\u641C\u7D22", "descBefore": "\u914D\u7F6E\u5185\u7F6E", "descAfter": "\u5DE5\u5177\u3002DeepSeek first \u4F1A\u4F18\u5148\u4E0E DeepSeek \u4FDD\u6301\u4E00\u81F4\uFF0CSearXNG \u53EF\u4F5C\u4E3A\u5B8C\u6574\u7F51\u9875\u641C\u7D22\u6865\u63A5\u3002", "enableTitle": "\u542F\u7528 web_search", "enableDescBefore": "\u5173\u95ED\u540E\uFF0C\u4EC5\u4FDD\u7559", "enableDescAfter": "\u5DE5\u5177\u6CE8\u518C\u3002", "providerTitle": "\u63D0\u4F9B\u65B9", "providerDesc": "DeepSeek first \u4F7F\u7528\u5DF2\u914D\u7F6E\u7684 DeepSeek key\uFF0C\u5FC5\u8981\u65F6\u56DE\u9000\u5230 SearXNG \u548C DuckDuckGo\u3002", "searxngUrlTitle": "SearXNG URL", "searxngUrlDescBefore": "\u53EF\u9009\u7684\u6865\u63A5\u57FA\u7840 URL\uFF0C\u4F8B\u5982", "saveFailed": "web_search \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25", "providers": { "deepseekFirst": "DeepSeek \u4F18\u5148", "deepseekFirstDesc": "\u4F18\u5148\u4F7F\u7528 DeepSeek \u670D\u52A1\u7AEF\u7F51\u9875\u641C\u7D22\uFF0C\u518D\u4F7F\u7528\u5DF2\u914D\u7F6E\u7684\u6865\u63A5", "searxng": "SearXNG \u6865\u63A5", "searxngDesc": "\u4F7F\u7528\u4F60\u7684 SearXNG \u5B8C\u6574\u7F51\u9875\u6865\u63A5\uFF0C\u7136\u540E\u56DE\u9000\u5230 DuckDuckGo", "duckduckgo": "DuckDuckGo", "duckduckgoDesc": "\u4F7F\u7528\u65E0\u9700 key \u7684 DuckDuckGo HTML \u4F5C\u4E3A\u6700\u7EC8\u56DE\u9000" } }, "responses": { "title": "DeepSeek Responses \u53C2\u6570", "desc": "\u6240\u6709\u751F\u6210\u8BF7\u6C42\u4F7F\u7528 Responses API\uFF1B\u7CFB\u7EDF\u7EDF\u4E00\u6821\u9A8C\u53C2\u6570\u5E76\u8BB0\u5F55\u751F\u6548\u72B6\u6001\u3002", "creativity": "\u521B\u610F\u7A0B\u5EA6", "creativityDesc": "\u5F71\u54CD\u9ED8\u8BA4 temperature\uFF1B\u4EE3\u7801\u3001\u5206\u7C7B\u7B49\u5185\u90E8\u8C03\u7528\u4ECD\u53D7\u540E\u7AEF\u786C\u4E0A\u9650\u4FDD\u62A4\u3002", "scenes": { "code": "\u5199\u4EE3\u7801", "email": "\u5199\u90AE\u4EF6", "analysis": "\u5206\u6790", "creative": "\u521B\u610F\u5199\u4F5C" }, "advanced": "\u9AD8\u7EA7\u53C2\u6570", "advancedDesc": "temperature \xB7 top_p \xB7 \u8F93\u51FA\u4E0A\u9650 \xB7 reasoning \xB7 text.format", "advancedMeta": "6 \u9879", "temperature": "\u6E29\u5EA6", "topP": "Top P", "maxOutputTokens": "\u6700\u5927\u8F93\u51FA Token", "topLogprobs": "Top logprobs", "reasoningEffort": "\u63A8\u7406\u5F3A\u5EA6", "textFormat": "\u6587\u672C\u683C\u5F0F", "providerDefault": "\u63D0\u4F9B\u65B9\u9ED8\u8BA4", "developer": "\u5F00\u53D1\u8005 Responses JSON", "developerDesc": "\u4E25\u683C\u6821\u9A8C\uFF1B\u672A\u77E5\u548C\u7CFB\u7EDF\u7BA1\u7406\u5B57\u6BB5\u4F1A\u62D2\u7EDD\uFF0C\u65E0\u6548\u679C\u5B57\u6BB5\u4F1A\u8B66\u544A\u3002", "developerMeta": "JSON", "validateSave": "\u6821\u9A8C\u5E76\u4FDD\u5B58", "saved": "Responses JSON \u5DF2\u4FDD\u5B58", "saveFailed": "Responses \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF1A{{error}}", "ineffective": "\u5DF2\u4FDD\u5B58\u4F46 DeepSeek \u4E0D\u4EA7\u751F\u5B9E\u9645\u6548\u679C\uFF1A{{fields}}", "previewTitle": "\u751F\u6548\u8BF7\u6C42\u9884\u89C8", "previewDesc": "\u6309\u7CFB\u7EDF\u5B57\u6BB5\u3001\u5F00\u53D1\u8005 JSON\u3001\u9AD8\u7EA7\u53C2\u6570\u3001\u573A\u666F\u548C\u521B\u610F\u7A0B\u5EA6\u7684\u771F\u5B9E\u5408\u5E76\u987A\u5E8F\u5C55\u793A\u3002", "previewReady": "Responses", "requestTitle": "\u4E0B\u4E00\u6B21\u8BF7\u6C42\u9AA8\u67B6" } }, "git": { "title": "Git", "branchPrefix": "\u5206\u652F\u524D\u7F00", "branchPrefixDesc": "Codex \u521B\u5EFA\u5206\u652F\u7684\u524D\u7F00", "prMergeMethod": "PR \u5408\u5E76\u65B9\u5F0F", "prMergeMethodDesc": "\u5408\u5E76 PR \u65F6\u4F7F\u7528\u7684\u65B9\u5F0F", "merge": "Merge", "squash": "Squash", "showPrIcon": "\u663E\u793A PR \u56FE\u6807", "showPrIconDesc": "\u5728\u804A\u5929\u4E2D\u663E\u793A PR \u56FE\u6807", "alwaysForcePush": "\u59CB\u7EC8\u5F3A\u5236\u63A8\u9001", "forcePushDesc": "\u66F4\u65B0\u5206\u652F\u65F6\u59CB\u7EC8\u5F3A\u5236\u63A8\u9001", "draftPr": "\u8349\u7A3F PR", "draftPrDesc": "\u9ED8\u8BA4\u521B\u5EFA\u8349\u7A3F PR", "autoDelete": "\u81EA\u52A8\u5220\u9664", "autoDeleteDesc": "\u5408\u5E76\u540E\u81EA\u52A8\u5220\u9664\u5206\u652F", "autoDeleteLimit": "\u81EA\u52A8\u5220\u9664\u9650\u5236", "autoDeleteLimitDesc": "\u4FDD\u7559\u5408\u5E76\u7684\u5206\u652F\u6570\u91CF", "commitInstructions": "\u63D0\u4EA4\u8BF4\u660E", "commitInstructionsDesc": "\u751F\u6210\u63D0\u4EA4\u4FE1\u606F\u7684\u989D\u5916\u8BF4\u660E", "save": "\u4FDD\u5B58", "commitInstructionsPlaceholder": "\u6DFB\u52A0\u63D0\u4EA4\u8BF4\u660E...", "prInstructions": "PR \u8BF4\u660E", "prInstructionsDesc": "\u751F\u6210 PR \u63CF\u8FF0\u7684\u989D\u5916\u8BF4\u660E", "prInstructionsPlaceholder": "\u6DFB\u52A0 PR \u8BF4\u660E..." }, "browser": { "title": "\u6D4F\u89C8\u5668", "desc1": "Codex \u53EF\u4EE5\u6D4F\u89C8\u7F51\u7EDC\u5E76\u4E0E\u9875\u9762\u4EA4\u4E92\u3002", "desc2": "\u4E86\u89E3\u66F4\u591A\u3002", "desc3": "", "allowControl": "\u5141\u8BB8\u63A7\u5236", "dataTitle": "\u6570\u636E", "browsingData": "\u6D4F\u89C8\u6570\u636E", "clearDataDesc": "\u6E05\u9664 Cookie\u3001\u7F51\u7AD9\u6570\u636E\u548C\u7F13\u5B58\u56FE\u7247", "clearAllData": "\u6E05\u9664\u6240\u6709\u6570\u636E", "cookie": "Cookies", "deleteCookie": "\u5220\u9664 Cookies", "websiteData": "\u7F51\u7AD9\u6570\u636E", "deleteWebsiteData": "\u5220\u9664\u7F51\u7AD9\u6570\u636E", "cachedImages": "\u7F13\u5B58\u56FE\u7247", "deleteCachedImages": "\u5220\u9664\u7F13\u5B58\u56FE\u7247", "screenshots": "\u5C4F\u5E55\u622A\u56FE", "screenshotsDesc": "\u5728\u804A\u5929\u8BB0\u5F55\u4E2D\u5305\u542B\u6D4F\u89C8\u5668\u622A\u56FE", "alwaysInclude": "\u59CB\u7EC8\u5305\u542B", "onlySelected": "\u4EC5\u9009\u5B9A", "permissions": "\u6743\u9650", "approval": "\u5BA1\u6279", "approvalDesc": "\u8BBE\u7F6E Codex \u5982\u4F55\u8BF7\u6C42\u6D4F\u89C8\u57DF\u540D\u3002", "learnMore": "\u4E86\u89E3\u66F4\u591A\u3002", "alwaysAsk": "\u59CB\u7EC8\u8BE2\u95EE", "alwaysAllow": "\u59CB\u7EC8\u5141\u8BB8", "askBeforeOpen": "\u6253\u5F00\u65B0\u57DF\u540D\u4E4B\u524D\u8BE2\u95EE", "allowWithoutAsking": "\u5141\u8BB8\u4E0D\u7ECF\u8BE2\u95EE\u6D4F\u89C8", "highRisk": "\u9AD8\u98CE\u9669", "blockedDomains": "\u53D7\u963B\u57DF\u540D", "blockedDesc": "Codex \u4E0D\u88AB\u5141\u8BB8\u6D4F\u89C8\u7684\u57DF\u540D", "add": "\u6DFB\u52A0", "noBlocked": "\u65E0\u53D7\u963B\u57DF\u540D", "allowedDomains": "\u5141\u8BB8\u57DF\u540D", "allowedDesc": "Codex \u53EF\u4EE5\u4E0D\u7ECF\u8BE2\u95EE\u6D4F\u89C8\u7684\u57DF\u540D", "noAllowed": "\u65E0\u5141\u8BB8\u57DF\u540D" }, "connections": { "title": "\u8FDE\u63A5", "desc1": "\u5C06 Codex \u8FDE\u63A5\u5230\u5916\u90E8\u670D\u52A1\u3002", "desc2": "\u4E86\u89E3\u66F4\u591A\u3002", "desc3": "", "connected": "\u5DF2\u8FDE\u63A5", "connecting": "\u8FDE\u63A5\u4E2D...", "disconnected": "\u672A\u8FDE\u63A5", "error": "\u9519\u8BEF", "available": "\u53EF\u7528", "notConnected": "\u672A\u8FDE\u63A5", "configure": "\u914D\u7F6E", "connect": "\u8FDE\u63A5", "disconnect": "\u65AD\u5F00", "noConnections": "\u5C1A\u65E0\u8FDE\u63A5", "sshConnections": "SSH \u8FDE\u63A5", "sshDesc": "\u901A\u8FC7 SSH \u8FDE\u63A5\u5230\u8FDC\u7A0B\u670D\u52A1\u5668", "add": "\u6DFB\u52A0", "addSsh": "\u6DFB\u52A0 SSH \u8FDE\u63A5", "addManually": "\u624B\u52A8\u6DFB\u52A0", "displayName": "\u663E\u793A\u540D\u79F0", "hostname": "\u4E3B\u673A\u540D", "hostPlaceholder": "\u4F8B\u5982 user@example.com", "sshPort": "SSH \u7AEF\u53E3", "optional": "(\u53EF\u9009)", "username": "\u7528\u6237\u540D", "password": "\u5BC6\u7801", "noAuth": "\u65E0\u8BA4\u8BC1", "identityFile": "\u5BC6\u94A5\u6587\u4EF6", "identityFilePath": "\u5BC6\u94A5\u6587\u4EF6\u8DEF\u5F84", "selectIdentityFile": "\u70B9\u51FB\u6D4F\u89C8\u9009\u62E9\u5BC6\u94A5\u6587\u4EF6", "browse": "\u6D4F\u89C8", "testing": "\u6D4B\u8BD5\u8FDE\u63A5\u4E2D...", "test": "\u6D4B\u8BD5", "testOk": "\u8FDE\u63A5\u6210\u529F", "testFailed": "\u8FDE\u63A5\u5931\u8D25", "online": "\u5728\u7EBF", "offline": "\u672A\u5728\u7EBF", "checking": "\u68C0\u67E5\u4E2D...", "unknown": "\u672A\u77E5", "edit": "\u7F16\u8F91", "delete": "\u5220\u9664", "cancel": "\u53D6\u6D88", "save": "\u4FDD\u5B58", "errors": { "generic": "\u65E0\u6CD5\u8FDE\u63A5\uFF0C\u8BF7\u68C0\u67E5 SSH \u914D\u7F6E\u3002", "refused": "\u8FDE\u63A5\u88AB\u62D2\u7EDD\u3002\u8BF7\u68C0\u67E5\u4E3B\u673A\u548C\u7AEF\u53E3\u662F\u5426\u6B63\u786E\uFF0C\u4EE5\u53CA\u8FDC\u7A0B SSH \u670D\u52A1\u662F\u5426\u5DF2\u542F\u52A8\u3002", "timeout": "\u8FDE\u63A5\u8D85\u65F6\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u3001\u9632\u706B\u5899\u3001\u4E3B\u673A\u548C\u7AEF\u53E3\u3002", "auth": "\u8BA4\u8BC1\u5931\u8D25\u3002\u8BF7\u68C0\u67E5\u7528\u6237\u540D\u3001\u5BC6\u7801\u6216\u5BC6\u94A5\u6587\u4EF6\u3002", "resolve": "\u65E0\u6CD5\u89E3\u6790\u4E3B\u673A\u3002\u8BF7\u68C0\u67E5\u4E3B\u673A\u540D\u6216 IP \u5730\u5740\u3002", "unreachable": "\u4E3B\u673A\u4E0D\u53EF\u8FBE\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8DEF\u7531\u3001\u9632\u706B\u5899\u548C\u670D\u52A1\u5668\u72B6\u6001\u3002" } }, "env": { "title": "\u73AF\u5883\u53D8\u91CF", "desc1": "\u7BA1\u7406\u4F60\u7684\u9879\u76EE\u7684\u73AF\u5883\u53D8\u91CF\u3002", "desc2": "\u4E86\u89E3\u66F4\u591A\u3002", "desc3": "", "add": "\u6DFB\u52A0\u53D8\u91CF", "key": "\u952E", "value": "\u503C", "save": "\u4FDD\u5B58", "delete": "\u5220\u9664", "edit": "\u7F16\u8F91", "noVars": "\u6CA1\u6709\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF", "back": "\u8FD4\u56DE", "project": "\u9879\u76EE", "envDetails": "\u73AF\u5883\u8BE6\u60C5", "noLocalEnv": "\u672A\u914D\u7F6E\u672C\u5730\u73AF\u5883", "createLocalEnv": "\u521B\u5EFA\u672C\u5730\u73AF\u5883", "localEnv": "\u672C\u5730\u73AF\u5883", "name": "\u540D\u79F0", "setupScript": "\u542F\u52A8\u811A\u672C", "setupScriptDesc": "\u7528\u4E8E\u521D\u59CB\u5316\u73AF\u5883\u7684\u811A\u672C", "default": "\u9ED8\u8BA4", "variables": "\u53D8\u91CF", "cleanupScript": "\u6E05\u7406\u811A\u672C", "cleanupScriptDesc": "\u7528\u4E8E\u6E05\u7406\u73AF\u5883\u7684\u811A\u672C", "actions": "\u64CD\u4F5C", "actionsDesc": "\u6B64\u73AF\u5883\u7684\u81EA\u5B9A\u4E49\u64CD\u4F5C", "addAction": "\u6DFB\u52A0\u64CD\u4F5C", "addActionDesc": "\u521B\u5EFA\u81EA\u5B9A\u4E49\u64CD\u4F5C\uFF0C\u5982\u6784\u5EFA\u3001\u6D4B\u8BD5\u6216\u90E8\u7F72", "learnMore": "\u4E86\u89E3\u66F4\u591A\u3002", "selectProject": "\u9009\u62E9\u9879\u76EE", "addProject": "\u6DFB\u52A0\u9879\u76EE" }, "archive": { "title": "\u5F52\u6863", "deleteAll": "\u5168\u90E8\u5220\u9664", "unarchive": "\u53D6\u6D88\u5F52\u6863", "noArchivedChats": "\u6682\u65E0\u5DF2\u5F52\u6863\u5BF9\u8BDD", "untitled": "\u672A\u547D\u540D\u5BF9\u8BDD", "unknownProject": "\u672A\u77E5\u9879\u76EE", "chatUnarchived": "\u5BF9\u8BDD\u5DF2\u53D6\u6D88\u5F52\u6863", "archiveDeleted": "\u5DF2\u4ECE\u5F52\u6863\u4E2D\u5220\u9664", "archiveCleared": "\u5DF2\u6E05\u7A7A\u5F52\u6863\u5BF9\u8BDD", "loadFailed": "\u52A0\u8F7D\u5F52\u6863\u5BF9\u8BDD\u5931\u8D25", "actionFailed": "\u64CD\u4F5C\u5931\u8D25" }, "computer": { "title": "\u7535\u8111\u63A7\u5236", "desc": "\u5141\u8BB8 Codex \u63A7\u5236\u4F60\u7684\u7535\u8111\u3002", "control": "\u63A7\u5236", "extensionNotConnected": "\u6269\u5C55\u672A\u8FDE\u63A5", "install": "\u5B89\u88C5", "alwaysAllowed": "\u59CB\u7EC8\u5141\u8BB8", "none": "\u65E0", "installChrome": "\u5B89\u88C5 Chrome \u96C6\u6210", "close": "\u5173\u95ED", "developedBy": "\u7531 OpenAI \u5F00\u53D1", "providedBy": "\u63D0\u4F9B\u8005: OpenAI", "category": "\u7C7B\u522B: \u6D4F\u89C8\u5668\u96C6\u6210", "about": "\u5173\u4E8E", "includes": "\u5305\u542B", "browserExtension": "\u6D4F\u89C8\u5668\u6269\u5C55", "skills": "\u6280\u80FD", "features": "\u7279\u6027" } }, "titleBar": { "file": "\u6587\u4EF6", "edit": "\u7F16\u8F91", "view": "\u67E5\u770B", "window": "\u7A97\u53E3", "help": "\u5E2E\u52A9", "update": "\u66F4\u65B0", "downloadUpdate": "\u4E0B\u8F7D\u66F4\u65B0", "downloadingUpdate": "\u4E0B\u8F7D\u4E2D", "downloadingUpdatePercent": "\u4E0B\u8F7D\u4E2D {{percent}}%", "downloadingUpdateMB": "{{mb}} MB", "updateReady": "\u66F4\u65B0\u5DF2\u4E0B\u8F7D\uFF0C\u5173\u95ED\u5E94\u7528\u540E\u5C06\u81EA\u52A8\u5B89\u88C5", "updateDownloadFailed": "\u4E0B\u8F7D\u66F4\u65B0\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", "updateInstallFailed": "\u5B89\u88C5\u66F4\u65B0\u5931\u8D25\uFF0C\u8BF7\u5173\u95ED\u5E94\u7528\u540E\u91CD\u8BD5" }, "startView": { "greeting": "\u6211\u4EEC\u5E94\u8BE5\u5728{{projectName}}\u4E2D\u505A\u4E9B\u4EC0\u4E48\uFF1F", "greetingNoProject": "\u6211\u4EEC\u5E94\u8BE5\u505A\u4E9B\u4EC0\u4E48\uFF1F", "placeholder": "\u5C3D\u7BA1\u95EE...", "searchProject": "\u641C\u7D22\u9879\u76EE", "addNewProject": "\u6DFB\u52A0\u65B0\u9879\u76EE", "noProject": "\u4E0D\u4F7F\u7528\u9879\u76EE" }, "composer": { "attachments": { "limit": "\u6700\u591A\u53EF\u6DFB\u52A0 {{count}} \u4E2A\u9644\u4EF6", "recognizing": "\u8BC6\u522B\u4E2D", "processing": "\u5904\u7406\u4E2D", "failed": "\u5904\u7406\u5931\u8D25", "readFailed": "\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25", "text": "\u6587\u672C", "file": "\u6587\u4EF6", "removeImage": "\u79FB\u9664\u56FE\u7247\uFF1A{{name}}", "removeAttachment": "\u79FB\u9664\u9644\u4EF6\uFF1A{{name}}", "previewImage": "\u9884\u89C8\u56FE\u7247", "previewNamedImage": "\u9884\u89C8\u56FE\u7247\uFF1A{{name}}", "closePreview": "\u5173\u95ED\u56FE\u7247\u9884\u89C8", "statusLabel": "{{name}}\uFF1A{{status}}" }, "placeholder": "\u5C3D\u7BA1\u95EE...", "selectModel": "\u9009\u62E9\u6A21\u578B", "noModels": "\u6682\u65E0\u53EF\u7528\u6A21\u578B\uFF0C\u8BF7\u5148\u5728\u767B\u5F55\u65F6\u586B\u5199 API Key", "modelSwitched": "\u5DF2\u5207\u6362\u6A21\u578B\uFF1A{{model}}", "modelSwitchFailed": "\u5207\u6362\u6A21\u578B\u5931\u8D25", "approvalSwitchFailed": "\u5207\u6362\u6743\u9650\u7EA7\u522B\u5931\u8D25", "selectThinking": "\u601D\u8003", "thinkingSimple": "\u7B80\u5355", "thinkingMedium": "\u4E2D\u5EA6", "thinkingDeep": "\u6DF1\u5EA6", "effortFaster": "\u66F4\u5FEB", "effortSmarter": "\u66F4\u6DF1\u5165", "thinkingSwitchFailed": "\u5207\u6362\u601D\u8003\u6863\u4F4D\u5931\u8D25", "send": "\u53D1\u9001", "stop": "\u505C\u6B62", "stopping": "\u6B63\u5728\u505C\u6B62\u2026", "cancelFailed": "\u505C\u6B62\u8BF7\u6C42\u5931\u8D25\uFF1A{{error}}", "cancelNotFound": "\u8FD0\u884C\u5DF2\u7ED3\u675F\u6216\u4E0D\u518D\u53EF\u7528", "systemCommands": "\u7CFB\u7EDF\u547D\u4EE4", "skillsGroup": "\u6280\u80FD", "models": { "lingsiAPI": "\u7075\u601DAPI", "lingsiAPI_5_5_zh": "5.5 \u4E2D" }, "defaultPermission": "\u8BF7\u6C42\u6279\u51C6", "defaultPermissionDesc": "\u5de5\u4f5c\u533a\u5185\u53ef\u5199\uff1b\u654f\u611f\u64cd\u4f5c\u9700\u4f60\u786e\u8ba4", "autoReview": "\u66ff\u6211\u5ba1\u6279", "autoReviewDesc": "\u5de5\u4f5c\u533a\u5185\u53ef\u5199\uff1b\u81ea\u52a8\u901a\u8fc7\u5de5\u5177\u6388\u6743", "fullAccess": "\u5B8C\u5168\u8BBF\u95EE\u6743\u9650", "fullAccessDesc": "\u53EF\u4E0D\u53D7\u9650\u5236\u5730\u8BBF\u95EE\u4E92\u8054\u7F51\u548C\u60A8\u7535\u8111\u4E0A\u7684\u4EFB\u4F55\u6587\u4EF6", "addMenu": { "addFiles": "\u6DFB\u52A0\u6587\u4EF6", "addFilesDesc": "\u4ECE\u672C\u673A\u9009\u62E9", "hoverLabel": "\u6DFB\u52A0\u6587\u4EF6", "tooltipDesc": "\u4ECE\u672C\u673A\u9009\u62E9\u6587\u4EF6\uFF0C\u6216\u7C98\u8D34\u56FE\u7247\u4E0E\u6587\u672C" } }, "balanceChip": { "label": "\u4F59\u989D", "loading": "\u67E5\u8BE2\u4F59\u989D\u2026", "unavailable": "\u4F59\u989D\u4E0D\u53EF\u7528", "notSet": "\u8BF7\u5148\u914D\u7F6E API Key", "granted": "\u8D60\u9001\u989D\u5EA6", "toppedUp": "\u5145\u503C\u989D\u5EA6", "depleted": "\u4F59\u989D\u5DF2\u7528\u5C3D\uFF0C\u8BF7\u5145\u503C\u540E\u518D\u7EE7\u7EED", "refreshHint": "\u70B9\u51FB\u5237\u65B0\u4F59\u989D" }, "toolCard": { "running": "\u6267\u884C\u4E2D", "ok": "\u5B8C\u6210", "error": "\u5931\u8D25", "blocked": "\u5DF2\u62E6\u622A", "arguments": "\u53C2\u6570", "result": "\u7ED3\u679C", "errorDetail": "\u9519\u8BEF" }, "approvalDialog": { "risk": "{{risk}} \u98CE\u9669", "pending": "\u8FD8\u6709 {{count}} \u4E2A\u5F85\u5BA1\u6279", "requestTool": "\u8BF7\u6C42\u6267\u884C\u5DE5\u5177\uFF1A", "approve": "\u6279\u51C6", "approveSession": "\u672C\u4F1A\u8BDD\u5185\u5141\u8BB8\u8BE5\u5DE5\u5177", "approvePrefix": "\u59CB\u7EC8\u5141\u8BB8\u300C{{prefix}}\u300D", "grantRefused": "\u65E0\u6CD5\u4FDD\u5B58\u8FD9\u6761\u653E\u884C\u89C4\u5219\uFF1A{{error}}", "reject": "\u62D2\u7EDD" }, "askUserDialog": { "of": "{{current}} / {{total}}", "previous": "\u4E0A\u4E00\u9898", "next": "\u4E0B\u4E00\u9898", "multiHint": "\uFF08\u53EF\u591A\u9009\uFF09", "recommended": "\u63A8\u8350", "pending": "\u8FD8\u6709 {{count}} \u4E2A\u95EE\u9898\u5F85\u56DE\u7B54", "other": "\u5176\u4ED6", "otherPlaceholder": "\u8F93\u5165\u4F60\u7684\u7B54\u6848", "submit": "\u63D0\u4EA4\u7B54\u6848", "skip": "\u8DF3\u8FC7" }, "automationView": { "viewTemplates": "\u67E5\u770B\u6A21\u677F", "createViaChat": "\u901A\u8FC7\u804A\u5929\u521B\u5EFA", "title": "\u81EA\u52A8\u5316", "subtitle": "\u6309\u8BA1\u5212\u6216\u6309\u9700\u8FD0\u884C\u804A\u5929\u3002 ", "learnMore": "\u4E86\u89E3\u66F4\u591A", "createFirst": "\u521B\u5EFA\u9996\u4E2A\u81EA\u52A8\u5316", "dailyBriefing": "\u6BCF\u65E5\u7B80\u62A5", "weeklyReview": "\u6BCF\u5468\u56DE\u987E", "projectMonitoring": "\u9879\u76EE\u76D1\u63A7" }, "chatView": { "tools": { "files": "\u6587\u4EF6", "filesDesc": "\u6D4F\u89C8\u9879\u76EE\u6587\u4EF6", "chat": "\u4FA7\u8FB9\u804A\u5929", "chatDesc": "\u53D1\u8D77\u4FA7\u8FB9\u5BF9\u8BDD", "browser": "\u6D4F\u89C8\u5668", "browserDesc": "\u6253\u5F00\u7F51\u7AD9", "terminal": "\u7EC8\u7AEF", "terminalDesc": "\u542F\u52A8\u4EA4\u4E92\u5F0F shell", "project_map": "\u9879\u76EE\u5730\u56FE", "project_mapDesc": "\u67E5\u770B\u6A21\u5757\u5173\u7CFB", "recording": "\u5F55\u97F3", "recordingDesc": "\u4F1A\u8BAE\u5F55\u97F3\u4E0E\u8F6C\u5199", "file_preview": "\u6587\u4EF6\u9884\u89C8", "file_previewDesc": "\u9884\u89C8\u529E\u516C\u6587\u4EF6", "canvas": "\u5DE5\u4F5C\u753B\u5E03", "canvasDesc": "\u6253\u5F00\u53EF\u6269\u5C55\u5DE5\u4F5C\u533A" }, "chat": "\u5BF9\u8BDD", "pinChat": "\u7F6E\u9876\u5BF9\u8BDD", "renameChat": "\u91CD\u547D\u540D\u5BF9\u8BDD", "archiveChat": "\u5F52\u6863\u5BF9\u8BDD", "openSideChat": "\u6253\u5F00\u4FA7\u8FB9\u804A\u5929", "copy": "\u590D\u5236", "exportJson": "\u5BFC\u51FA\u4E3A JSON", "branch": "\u5206\u652F", "rewind": "\u56DE\u9000\u5230\u2026", "noRewindPoints": "\u6682\u65E0\u65F6\u95F4\u7EBF\u8282\u70B9", "addAutomation": "\u6DFB\u52A0\u81EA\u52A8\u5316...", "openInNewWindow": "\u5728\u65B0\u7A97\u53E3\u4E2D\u6253\u5F00", "requestFollowUp": "\u8981\u6C42\u540E\u7EED\u53D8\u66F4", "working": "\u5904\u7406\u4E2D\u2026", "assistant": "\u52A9\u624B", "reasoning": "\u63A8\u7406\u8FC7\u7A0B", "processSteps": "\u6267\u884C\u8FC7\u7A0B \xB7 {{count}} \u6B21\u5DE5\u5177\u8C03\u7528", "processStepsNoTools": "\u6267\u884C\u8FC7\u7A0B", "clickToExpand": "\u70B9\u51FB\u5C55\u5F00", "tokensInput": "\u8F93\u5165", "tokensOutput": "\u8F93\u51FA", "tokensTotal": "\u603B\u8BA1", "tokensCacheHit": "\u547D\u4E2D\u7F13\u5B58", "totalDuration": "\u603B\u8017\u65F6", "turnCost": "\u672C\u8F6E\u82B1\u8D39", "copyAnswer": "\u590D\u5236", "addWorktree": "\u6DFB\u52A0\u5DE5\u4F5C\u6811", "environmentInfo": "\u73AF\u5883\u4FE1\u606F", "environmentSettings": "\u73AF\u5883\u8BBE\u7F6E", "changes": "\u53D8\u66F4", "local": "\u672C\u5730", "localMode": "\u672C\u5730\u6A21\u5F0F", "remoteMode": "\u8FDC\u7A0B\u6A21\u5F0F", "existingSshConnections": "\u5DF2\u6709 SSH \u8FDE\u63A5", "noSshConnections": "\u6682\u65E0 SSH \u8FDE\u63A5", "noProject": "\u6682\u65E0\u9879\u76EE", "noGitRepository": "\u65E0 Git \u4ED3\u5E93", "commitOrPush": "\u63D0\u4EA4\u6216\u63A8\u9001", "githubCliAvailable": "GitHub CLI \u53EF\u7528", "githubCliUnavailable": "GitHub CLI \u4E0D\u53EF\u7528", "loading": "\u52A0\u8F7D\u4E2D\u2026", "output": "\u8F93\u51FA", "noOutput": "\u6682\u65E0\u8F93\u51FA", "outputCreated": "\u65B0\u5EFA", "outputEdited": "\u4FEE\u6539", "sources": "\u6765\u6E90", "noSources": "\u6682\u65E0\u6765\u6E90", "recommended": "\u63A8\u8350" }, "git": { "title": "Git", "close": "\u5173\u95ED Git", "closeChanges": "\u5173\u95ED Git \u53D8\u66F4", "branchChangedSummary": "{{branch}} \xB7 {{count}} \u4E2A\u53D8\u66F4", "tabs": { "changes": "\u53D8\u66F4", "branches": "\u5206\u652F", "push": "\u4E0A\u4F20", "log": "\u4FEE\u6539\u8BB0\u5F55" }, "changesTitle": "Git \u53D8\u66F4", "filesCount": "{{count}} \u4E2A\u6587\u4EF6", "groups": { "conflicted": "\u51B2\u7A81", "staged": "\u5DF2\u6682\u5B58", "unstaged": "\u672A\u6682\u5B58", "untracked": "\u672A\u8DDF\u8E2A" }, "loadingChanges": "\u6B63\u5728\u8BFB\u53D6 Git \u53D8\u66F4...", "workingTreeClean": "\u5DE5\u4F5C\u533A\u5E72\u51C0", "draftedFromStaged": "\u57FA\u4E8E\u5DF2\u6682\u5B58\u53D8\u66F4\u751F\u6210", "draftedFromWorkingTree": "\u57FA\u4E8E\u5DE5\u4F5C\u533A\u751F\u6210", "commitMessage": "\u63D0\u4EA4\u4FE1\u606F", "draftMessage": "\u751F\u6210\u4FE1\u606F", "draftingMessage": "\u751F\u6210\u4E2D...", "committing": "\u63D0\u4EA4\u4E2D...", "commitStagedFiles": "\u63D0\u4EA4 {{count}} \u4E2A\u5DF2\u6682\u5B58\u6587\u4EF6", "commitMessageRequired": "\u63D0\u4EA4\u4FE1\u606F\u4E0D\u80FD\u4E3A\u7A7A\u3002", "stageBeforeCommit": "\u8BF7\u81F3\u5C11\u6682\u5B58\u4E00\u4E2A\u6587\u4EF6\u540E\u518D\u63D0\u4EA4\u3002", "selectFilesBeforeStage": "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u540E\u518D\u6682\u5B58\u3002", "selectStagedFilesBeforeUnstage": "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5DF2\u6682\u5B58\u6587\u4EF6\u540E\u518D\u53D6\u6D88\u6682\u5B58\u3002", "selectStagedFilesBeforeCommit": "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5DF2\u6682\u5B58\u6587\u4EF6\u540E\u518D\u63D0\u4EA4\u3002", "selectedFileHasUnstagedChanges": "\u9009\u4E2D\u7684\u6587\u4EF6\u540C\u65F6\u5B58\u5728\u672A\u6682\u5B58\u4FEE\u6539\u3002\u8BF7\u5148\u6682\u5B58\u6216\u4E22\u5F03\u8FD9\u90E8\u5206\u4FEE\u6539\u540E\uFF0C\u518D\u63D0\u4EA4\u9009\u4E2D\u7684\u6587\u4EF6\u3002", "commitConfirm": "\u786E\u8BA4\u57FA\u4E8E {{count}} \u4E2A\u5DF2\u6682\u5B58\u6587\u4EF6\u521B\u5EFA\u672C\u5730\u63D0\u4EA4\u5417\uFF1F", "selectAll": "\u5168\u9009", "deselectAll": "\u53D6\u6D88\u5168\u9009", "selectFileToViewDiff": "\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u67E5\u770B diff\u3002", "operationFailed": "{{action}}\u5931\u8D25\u3002", "operationCompleted": "{{action}}\u5B8C\u6210\u3002", "actions": { "stage": "\u6682\u5B58", "unstage": "\u53D6\u6D88\u6682\u5B58", "commit": "\u63D0\u4EA4", "checkout": "\u68C0\u51FA", "createBranch": "\u521B\u5EFA\u5206\u652F", "fetch": "\u62C9\u53D6" }, "stage": "\u6682\u5B58", "unstage": "\u53D6\u6D88\u6682\u5B58", "stageSelected": "\u6682\u5B58 {{count}}", "unstageSelected": "\u53D6\u6D88 {{count}}", "applyHunkFailed": "\u5E94\u7528 hunk \u5931\u8D25\u3002", "truncated": "\u5DF2\u622A\u65AD", "loadingDiff": "\u6B63\u5728\u52A0\u8F7D diff...", "noUntrackedDiff": "\u8FD9\u4E2A\u672A\u8DDF\u8E2A\u6587\u4EF6\u6CA1\u6709\u53EF\u663E\u793A\u7684\u6587\u672C diff\u3002", "noDisplayableDiff": "\u8FD9\u4E2A\u6587\u4EF6\u6CA1\u6709\u53EF\u663E\u793A\u7684 diff\u3002", "diffMode": { "unified": "\u7EDF\u4E00", "split": "\u5206\u680F" }, "diffColumns": { "old": "\u65E7", "before": "\u53D8\u66F4\u524D", "new": "\u65B0", "after": "\u53D8\u66F4\u540E" }, "stageHunk": "\u6682\u5B58 hunk", "unstageHunk": "\u53D6\u6D88\u6682\u5B58 hunk", "branchAlreadyCheckedOut": "\u8BE5\u5206\u652F\u5DF2\u5728 {{path}} \u68C0\u51FA", "switchBranchConfirm": "\u5207\u6362\u5230 {{branch}} \u5417\uFF1F\u5982\u679C\u672C\u5730\u6539\u52A8\u4F1A\u88AB\u8986\u76D6\uFF0CGit \u4F1A\u963B\u6B62\u8FD9\u6B21\u5207\u6362\u3002", "newBranchName": "\u65B0\u5206\u652F\u540D\u79F0", "searchBranches": "\u641C\u7D22\u5206\u652F", "detachedHead": "\u5206\u79BB\u5934\u6307\u9488", "rebasing": "\u53D8\u57FA\u4E2D", "merging": "\u5408\u5E76\u4E2D", "changedFilesCount": "{{count}} \u4E2A\u53D8\u66F4\u6587\u4EF6", "loadingState": "\u6B63\u5728\u52A0\u8F7D Git \u72B6\u6001...", "noBranchesFound": "\u6CA1\u6709\u627E\u5230\u5206\u652F", "localBranches": "\u672C\u5730\u5206\u652F", "remoteBranches": "\u8FDC\u7A0B\u5206\u652F", "fetch": "\u62C9\u53D6", "fetching": "\u62C9\u53D6\u4E2D...", "aheadCount": "\u9886\u5148 {{count}}", "behindCount": "\u843D\u540E {{count}}", "worktreeAt": "\u5DE5\u4F5C\u6811\uFF1A{{path}}", "createBranchDialog": { "title": "\u521B\u5EFA\u5206\u652F", "cancel": "\u53D6\u6D88", "placeholder": "\u8BF7\u8F93\u5165\u5206\u652F\u540D\u79F0" }, "pushPanel": { "title": "\u4E0A\u4F20", "refresh": "\u5237\u65B0", "loadingPreview": "\u6B63\u5728\u52A0\u8F7D\u4E0A\u4F20\u9884\u89C8...", "currentBranch": "\u5F53\u524D\u5206\u652F", "upstream": "\u4E0A\u6E38\u5206\u652F", "target": "\u76EE\u6807", "aheadBehind": "\u9886\u5148 / \u843D\u540E", "notConfigured": "\u672A\u914D\u7F6E", "confirmHighRisk": "\u672C\u6B21\u4E0A\u4F20\u5305\u542B {{count}} \u6761\u9AD8\u98CE\u9669\u53D1\u73B0\u3002\u8BF7\u5148\u786E\u8BA4\u98CE\u9669\uFF0C\u4ECD\u8981\u7EE7\u7EED\u5417\uFF1F", "confirmPush": "\u786E\u8BA4\u5411 {{target}} \u4E0A\u4F20 {{count}} \u4E2A\u63D0\u4EA4\u5417\uFF1F", "pushFailed": "\u4E0A\u4F20\u5931\u8D25", "pushing": "\u4E0A\u4F20\u4E2D...", "pushCommits": "\u4E0A\u4F20 {{count}} \u4E2A\u63D0\u4EA4", "pushCompleted": "\u4E0A\u4F20\u5B8C\u6210\u3002", "commitsTitle": "\u5F85\u4E0A\u4F20\u63D0\u4EA4", "commitsCount": "{{count}} \u4E2A\u63D0\u4EA4", "noOutgoingCommits": "\u6CA1\u6709\u53EF\u4E0A\u4F20\u7684\u63D0\u4EA4\u3002", "noPreview": "\u6682\u65E0\u4E0A\u4F20\u9884\u89C8\u3002", "riskScanTitle": "\u4E0A\u4F20\u98CE\u9669\u626B\u63CF", "riskSummary": "{{files}} \u4E2A\u6587\u4EF6\uFF0C{{findings}} \u6761\u53D1\u73B0", "noLocalRisks": "\u672A\u53D1\u73B0\u672C\u5730\u98CE\u9669\u3002", "severity": { "high": "\u9AD8", "medium": "\u4E2D", "low": "\u4F4E" }, "reasons": { "nothingToPush": "\u6CA1\u6709\u53EF\u4E0A\u4F20\u7684\u5185\u5BB9", "notGitRepository": "\u5F53\u524D\u76EE\u5F55\u4E0D\u662F Git \u4ED3\u5E93", "noUpstream": "\u5F53\u524D\u5206\u652F\u672A\u914D\u7F6E\u4E0A\u6E38\u5206\u652F", "upstreamAhead": "\u4E0A\u6E38\u5206\u652F\u5DF2\u6709\u65B0\u63D0\u4EA4\uFF0C\u8BF7\u5148\u66F4\u65B0\u540E\u518D\u4E0A\u4F20", "detachedHead": "\u5F53\u524D\u4E3A\u5206\u79BB\u5934\u6307\u9488\u72B6\u6001\uFF0C\u65E0\u6CD5\u5728\u6B64\u89C6\u56FE\u4E0A\u4F20", "finishMerge": "\u8BF7\u5148\u5B8C\u6210\u6216\u7EC8\u6B62\u5F53\u524D\u5408\u5E76\uFF0C\u518D\u6267\u884C\u4E0A\u4F20", "finishRebase": "\u8BF7\u5148\u5B8C\u6210\u6216\u7EC8\u6B62\u5F53\u524D\u53D8\u57FA\uFF0C\u518D\u6267\u884C\u4E0A\u4F20" } }, "logPanel": { "title": "\u4FEE\u6539\u8BB0\u5F55", "commitsCount": "{{count}} \u4E2A\u63D0\u4EA4", "loadingLog": "\u6B63\u5728\u52A0\u8F7D Git \u63D0\u4EA4\u8BB0\u5F55...", "noCommitsFound": "\u6CA1\u6709\u627E\u5230\u63D0\u4EA4\u8BB0\u5F55\u3002", "newBranchName": "\u65B0\u5206\u652F\u540D\u79F0", "branchCreated": "\u5DF2\u521B\u5EFA\u5E76\u68C0\u51FA {{name}}", "createBranch": "\u521B\u5EFA\u5206\u652F", "noFileList": "\u8FD9\u4E2A\u63D0\u4EA4\u6CA1\u6709\u6587\u4EF6\u5217\u8868\u3002", "loadingCommitDiff": "\u6B63\u5728\u52A0\u8F7D\u63D0\u4EA4 diff...", "selectFile": "\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u67E5\u770B\u8BE5\u63D0\u4EA4\u7684 diff\u3002", "selectCommit": "\u9009\u62E9\u4E00\u4E2A\u63D0\u4EA4\u3002", "mergeCount": "\u5408\u5E76 {{count}}", "filesCount": "{{count}} \u4E2A\u6587\u4EF6" }, "projectsPanel": { "title": "\u5206\u652F\u7BA1\u7406", "gitProjectsCount": "{{count}} \u4E2A Git \u9879\u76EE", "commitSelected": "\u63D0\u4EA4\u9009\u4E2D", "commitAndPushSelected": "\u63D0\u4EA4\u5E76\u4E0A\u4F20", "handleIndividually": "\u9010\u4E2A\u5904\u7406", "fetchingAll": "\u62C9\u53D6\u4E2D...", "fetchAll": "\u5168\u90E8\u62C9\u53D6", "refresh": "\u5237\u65B0", "loadingBranches": "\u6B63\u5728\u8BFB\u53D6 Git \u5206\u652F\u72B6\u6001...", "noOpenGitProjects": "\u6CA1\u6709\u68C0\u6D4B\u5230\u5DF2\u6253\u5F00\u7684 Git \u9879\u76EE\u3002", "branchGroupsCount": "{{count}} \u4E2A\u5206\u652F\u7EC4", "projectCount": "{{count}} \u4E2A\u9879\u76EE", "commit": "\u63D0\u4EA4", "commitAndPush": "\u63D0\u4EA4\u5E76\u4E0A\u4F20", "updating": "\u66F4\u65B0\u4E2D...", "update": "\u66F4\u65B0", "pushing": "\u4E0A\u4F20\u4E2D...", "push": "\u4E0A\u4F20", "current": "\u5F53\u524D", "selectProject": "\u9009\u62E9 {{path}}", "metrics": { "changed": "\u53D8\u66F4", "ahead": "\u9886\u5148", "behind": "\u843D\u540E" }, "badges": { "merge": "\u5408\u5E76", "rebase": "\u53D8\u57FA", "detached": "\u5206\u79BB" }, "baseRef": "\u57FA\u51C6\u5F15\u7528", "targetRef": "\u76EE\u6807\u5F15\u7528", "compare": "\u6BD4\u8F83", "comparing": "\u6BD4\u8F83\u4E2D...", "mergeBase": "\u516C\u5171\u57FA\u7EBF {{hash}}", "targetOnly": "\u4EC5\u76EE\u6807\u5206\u652F", "noTargetOnlyCommits": "\u6CA1\u6709\u4EC5\u76EE\u6807\u5206\u652F\u7684\u63D0\u4EA4", "baseOnly": "\u4EC5\u57FA\u51C6\u5206\u652F", "noBaseOnlyCommits": "\u6CA1\u6709\u4EC5\u57FA\u51C6\u5206\u652F\u7684\u63D0\u4EA4", "changedFiles": "\u53D8\u66F4\u6587\u4EF6", "noFileChanges": "\u6CA1\u6709\u6587\u4EF6\u53D8\u66F4", "loadingDiff": "\u6B63\u5728\u52A0\u8F7D diff...", "noDiffForFile": "\u8BE5\u6587\u4EF6\u6CA1\u6709 diff\u3002", "selectFileToViewDiff": "\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u67E5\u770B diff\u3002", "moreCount": "+{{count}} \u6761\u66F4\u591A", "batchCommit": "\u6279\u91CF\u63D0\u4EA4", "batchCommitAndPush": "\u6279\u91CF\u63D0\u4EA4\u5E76\u4E0A\u4F20", "batchSummary": "{{projects}} \u4E2A\u9879\u76EE\uFF0C{{files}} \u4E2A\u53D8\u66F4\u6587\u4EF6", "closeBatchCommit": "\u5173\u95ED\u6279\u91CF\u63D0\u4EA4", "autoStageAll": "\u81EA\u52A8\u6682\u5B58\u6BCF\u4E2A\u9879\u76EE\u7684\u5168\u90E8\u53D8\u66F4", "blockedProjectsCount": "\u5F53\u524D\u6709 {{count}} \u4E2A\u9879\u76EE\u88AB\u963B\u6B62\uFF0C\u6267\u884C\u540E\u4F1A\u9010\u9879\u663E\u793A\u539F\u56E0\u3002", "running": "\u6267\u884C\u4E2D...", "refreshPreview": "\u5237\u65B0\u9884\u89C8", "projectPreview": "\u9879\u76EE\u9884\u89C8", "loading": "\u52A0\u8F7D\u4E2D...", "noTargets": "\u6CA1\u6709\u76EE\u6807\u9879\u76EE\u3002", "previewChanged": "\u53D8\u66F4 {{count}}", "previewStaged": "\u6682\u5B58 {{count}}", "singleProjectCommitNote": "\u5355\u9879\u76EE\u63D0\u4EA4\u8BF4\u660E\uFF0C\u53EF\u9009", "executionResults": "\u6267\u884C\u7ED3\u679C", "ok": "\u6210\u529F", "failed": "\u5931\u8D25", "batchPushRiskScan": "\u6279\u91CF\u4E0A\u4F20\u98CE\u9669\u626B\u63CF", "targetCount": "{{count}} \u4E2A\u76EE\u6807", "severityCount": { "high": "\u9AD8 {{count}}", "medium": "\u4E2D {{count}}", "low": "\u4F4E {{count}}" }, "noLocalRiskFindingsBeforePush": "\u5728\u4E0A\u4F20 {{branch}} \u524D\u672A\u53D1\u73B0\u672C\u5730\u98CE\u9669\u3002", "moreFindings": "+{{count}} \u6761\u66F4\u591A\u53D1\u73B0", "confirm": { "pushRiskHigh": "\u4E0A\u4F20\u98CE\u9669\u626B\u63CF\u5728 {{targets}} \u4E2A\u76EE\u6807\u4E2D\u53D1\u73B0 {{findings}} \u6761\u9AD8\u98CE\u9669\u95EE\u9898\u3002\u4ECD\u8981\u7EE7\u7EED\u5417\uFF1F", "pushRiskAny": "\u4E0A\u4F20\u98CE\u9669\u626B\u63CF\u5728 {{targets}} \u4E2A\u76EE\u6807\u4E2D\u53D1\u73B0 {{findings}} \u6761\u95EE\u9898\u3002\u7EE7\u7EED\u5417\uFF1F", "pushBranchGroup": "\u786E\u8BA4\u5728 {{branch}} \u4E0A\u4ECE {{targets}} \u4E2A\u9879\u76EE\u76EE\u6807\u4E0A\u4F20 {{commits}} \u4E2A\u5916\u53D1\u63D0\u4EA4\u5417\uFF1F", "fetchRepos": "\u786E\u8BA4\u62C9\u53D6 {{count}} \u4E2A\u552F\u4E00\u4ED3\u5E93\u5417\uFF1F", "updateBranchGroup": "\u786E\u8BA4\u5728 {{branch}} \u4E0A\u5FEB\u8FDB\u66F4\u65B0 {{count}} \u4E2A\u9879\u76EE\u76EE\u6807\u5417\uFF1F", "continuePushingHighRisk": "\u4E0A\u4F20\u98CE\u9669\u626B\u63CF\u53D1\u73B0 {{findings}} \u6761\u9AD8\u98CE\u9669\u95EE\u9898\u3002\u7EE7\u7EED\u4E0A\u4F20 {{targets}} \u4E2A\u76EE\u6807\u5417\uFF1F", "continuePushingRisk": "\u4E0A\u4F20\u98CE\u9669\u626B\u63CF\u53D1\u73B0 {{findings}} \u6761\u95EE\u9898\u3002\u7EE7\u7EED\u4E0A\u4F20 {{targets}} \u4E2A\u76EE\u6807\u5417\uFF1F", "pushCommittedTargets": "\u786E\u8BA4\u4E0A\u4F20 {{count}} \u4E2A\u5DF2\u63D0\u4EA4\u7684\u9879\u76EE\u76EE\u6807\u5417\uFF1F", "commitThenPushRiskScan": "\u786E\u8BA4\u5148\u63D0\u4EA4 {{count}} \u4E2A\u9879\u76EE\u76EE\u6807\uFF0C\u518D\u6267\u884C\u4E0A\u4F20\u98CE\u9669\u626B\u63CF\u5417\uFF1F" }, "errors": { "noProjectTargetsSelected": "\u672A\u9009\u62E9\u9879\u76EE\u76EE\u6807\u3002", "noUniqueProjectTargets": "\u8BE5\u5206\u652F\u7EC4\u91CC\u6CA1\u6709\u53EF\u552F\u4E00\u5904\u7406\u7684\u9879\u76EE\u76EE\u6807\u3002", "noOutgoingCommitsToPush": "\u6CA1\u6709\u53EF\u4E0A\u4F20\u7684\u5916\u53D1\u63D0\u4EA4\u3002", "pushRiskScanUnavailable": "\u65E0\u6CD5\u6267\u884C\u4E0A\u4F20\u98CE\u9669\u626B\u63CF\u3002", "onePushFailed": "\u6709\u4E00\u4E2A\u4E0A\u4F20\u5931\u8D25\u3002", "noGitRepositoriesToFetch": "\u6CA1\u6709\u53EF\u62C9\u53D6\u7684 Git \u4ED3\u5E93\u3002", "oneFetchFailed": "\u6709\u4E00\u4E2A\u62C9\u53D6\u5931\u8D25\u3002", "noProjectTargetsUpdatable": "\u8BE5\u5206\u652F\u7EC4\u91CC\u6CA1\u6709\u53EF\u66F4\u65B0\u7684\u9879\u76EE\u76EE\u6807\u3002", "noBehindCommits": "\u6CA1\u6709\u9700\u8981\u66F4\u65B0\u7684\u843D\u540E\u63D0\u4EA4\u3002", "oneUpdateFailed": "\u6709\u4E00\u4E2A\u66F4\u65B0\u5931\u8D25\u3002", "noProjectTargetInRepositoryGroup": "\u8BE5\u4ED3\u5E93\u7EC4\u91CC\u6CA1\u6709\u53EF\u7528\u7684\u9879\u76EE\u76EE\u6807\u3002" }, "results": { "pushedTargets": "\u5DF2\u4E0A\u4F20 {{count}} \u4E2A\u76EE\u6807\u3002", "fetchedRepos": "\u5DF2\u62C9\u53D6 {{count}} \u4E2A\u4ED3\u5E93\u3002", "updatedTargets": "\u5DF2\u66F4\u65B0 {{count}} \u4E2A\u76EE\u6807\u3002", "commitPushRiskScanFailed": "\u5DF2\u63D0\u4EA4\uFF0C\u4F46\u4E0A\u4F20\u98CE\u9669\u626B\u63CF\u5931\u8D25\uFF1A{{reason}}", "commitPushCancelledAfterRiskScan": "\u5DF2\u63D0\u4EA4\uFF0C\u98CE\u9669\u626B\u63CF\u540E\u53D6\u6D88\u4E0A\u4F20\u3002", "commitPushCancelled": "\u5DF2\u63D0\u4EA4\uFF0C\u5DF2\u53D6\u6D88\u4E0A\u4F20\u3002", "committedAndPushed": "\u5DF2\u63D0\u4EA4\u5E76\u4E0A\u4F20", "committedButPushFailed": "\u5DF2\u63D0\u4EA4\uFF0C\u4F46\u4E0A\u4F20\u5931\u8D25\uFF1A{{message}}" }, "reasons": { "notGitRepository": "\u5F53\u524D\u76EE\u5F55\u4E0D\u662F Git \u4ED3\u5E93", "nothingToPush": "\u6CA1\u6709\u53EF\u4E0A\u4F20\u7684\u5185\u5BB9", "noUpstream": "\u5F53\u524D\u5206\u652F\u672A\u914D\u7F6E\u4E0A\u6E38\u5206\u652F", "upstreamAhead": "\u4E0A\u6E38\u5206\u652F\u5DF2\u6709\u65B0\u63D0\u4EA4\uFF0C\u8BF7\u5148\u66F4\u65B0\u540E\u518D\u4E0A\u4F20", "detachedHeadPush": "\u5F53\u524D\u4E3A\u5206\u79BB\u5934\u6307\u9488\u72B6\u6001\uFF0C\u65E0\u6CD5\u5728\u6B64\u89C6\u56FE\u4E0A\u4F20", "finishMergePush": "\u8BF7\u5148\u5B8C\u6210\u6216\u7EC8\u6B62\u5F53\u524D\u5408\u5E76\uFF0C\u518D\u6267\u884C\u4E0A\u4F20", "finishRebasePush": "\u8BF7\u5148\u5B8C\u6210\u6216\u7EC8\u6B62\u5F53\u524D\u53D8\u57FA\uFF0C\u518D\u6267\u884C\u4E0A\u4F20", "chooseBaseRef": "\u8BF7\u9009\u62E9\u6BD4\u8F83\u7684\u57FA\u51C6\u5F15\u7528", "chooseTargetRef": "\u8BF7\u9009\u62E9\u6BD4\u8F83\u7684\u76EE\u6807\u5F15\u7528", "baseRefMissing": "\u57FA\u51C6\u5F15\u7528\u4E0D\u5B58\u5728", "targetRefMissing": "\u76EE\u6807\u5F15\u7528\u4E0D\u5B58\u5728", "detachedHeadUpdate": "\u5F53\u524D\u4E3A\u5206\u79BB\u5934\u6307\u9488\u72B6\u6001\uFF0C\u65E0\u6CD5\u5728\u6B64\u89C6\u56FE\u66F4\u65B0\u3002", "finishMergeUpdate": "\u8BF7\u5148\u5B8C\u6210\u6216\u7EC8\u6B62\u5F53\u524D\u5408\u5E76\uFF0C\u518D\u6267\u884C\u66F4\u65B0\u3002", "finishRebaseUpdate": "\u8BF7\u5148\u5B8C\u6210\u6216\u7EC8\u6B62\u5F53\u524D\u53D8\u57FA\uFF0C\u518D\u6267\u884C\u66F4\u65B0\u3002", "commitOrStashBeforeUpdate": "\u8BF7\u5148\u63D0\u4EA4\u6216\u50A8\u85CF\u672C\u5730\u6539\u52A8\uFF0C\u518D\u6267\u884C\u66F4\u65B0\u3002", "noUpstreamUpdate": "\u5F53\u524D\u5206\u652F\u672A\u914D\u7F6E\u4E0A\u6E38\u5206\u652F\u3002", "finishMergeCommit": "\u8BF7\u5148\u5B8C\u6210\u6216\u7EC8\u6B62\u5F53\u524D\u5408\u5E76\uFF0C\u518D\u6267\u884C\u63D0\u4EA4", "finishRebaseCommit": "\u8BF7\u5148\u5B8C\u6210\u6216\u7EC8\u6B62\u5F53\u524D\u53D8\u57FA\uFF0C\u518D\u6267\u884C\u63D0\u4EA4", "noGitChangesToCommit": "\u6CA1\u6709\u53EF\u63D0\u4EA4\u7684 Git \u53D8\u66F4", "noStagedFiles": "\u6CA1\u6709\u5DF2\u6682\u5B58\u6587\u4EF6\uFF0C\u8BF7\u542F\u7528\u5168\u90E8\u6682\u5B58\u6216\u5148\u624B\u52A8\u6682\u5B58\u6587\u4EF6" } }, "createAndCheckoutBranch": "\u521B\u5EFA\u5E76\u68C0\u51FA\u65B0\u5206\u652F...", "openGit": "\u6253\u5F00 Git", "openGitUnavailable": "\u5F53\u524D\u89C6\u56FE\u672A\u6302\u8F7D Git \u9762\u677F\u3002" }, "searchModal": { "searchChats": "\u641C\u7D22\u5BF9\u8BDD", "recentChats": "\u8FD1\u671F\u5BF9\u8BDD" }, "skillsView": { "origin": { "installed": "\u5DF2\u5B89\u88C5", "workspace": "\u5DE5\u4F5C\u533A", "user": "\u7528\u6237", "builtIn": "\u5185\u7F6E" }, "title": "\u6280\u80FD", "subtitle1": "\u7CFB\u7EDF\u4ECE ", "subtitle2": " \u81EA\u52A8\u53D1\u73B0\u6280\u80FD\uFF0C\u6309\u9700\u6E10\u8FDB\u5F0F\u62AB\u9732\u3002", "refresh": "\u5237\u65B0", "searchPlaceholder": "\u641C\u7D22\u6280\u80FD\u6216\u89E6\u53D1\u77ED\u8BED", "discoveredCount": "\u5DF2\u53D1\u73B0 {{count}} \u4E2A\u6280\u80FD", "clickToView": "\u70B9\u51FB\u67E5\u770B\u6280\u80FD\u6B63\u6587\uFF08Level 2 \u62AB\u9732\uFF09\uFF1B\u89E6\u53D1\u77ED\u8BED\u7528\u4E8E\u88AB\u52A8\u6FC0\u6D3B\u3002", "loading": "\u52A0\u8F7D\u4E2D\u2026", "noSkills": "\u6CA1\u6709\u6280\u80FD\u3002\u628A SKILL.md \u653E\u8FDB .deepagent/skills/<name>/ \u5373\u53EF\u88AB\u81EA\u52A8\u53D1\u73B0\u3002", "uninstall": "\u5378\u8F7D", "recommended": "\u63A8\u8350", "add": "\u6DFB\u52A0", "triggerPhrases": "\u89E6\u53D1\u77ED\u8BED ({{count}})", "body": "\u6B63\u6587\uFF08Level 2 \u62AB\u9732\uFF09", "noBody": "\uFF08\u65E0\u6B63\u6587\uFF09", "tab_market": "\u5E02\u573A", "tab_installed": "\u5DF2\u5B89\u88C5", "market_loading": "\u52A0\u8F7D\u4E2D\u2026", "market_no_results": "\u6CA1\u6709\u5339\u914D\u7684\u6280\u80FD\u3002", "market_load_more": "\u52A0\u8F7D\u66F4\u591A", "market_already_installed": "\u5DF2\u5B89\u88C5", "market_install_button": "\u5B89\u88C5", "market_provider_config": "\u914D\u7F6E SkillsMP API Key", "market_search_placeholder": "\u641C\u7D22\u6280\u80FD\u2026" }, "skillsmp": { "title": "SkillsMP \u5E02\u573A", "description": "\u4ECE skillsmp.com \u62C9\u53D6 170 \u4E07+ \u6280\u80FD\u3002", "api_key_label": "API Key\uFF08\u53EF\u9009\uFF09", "api_key_placeholder": "sk_live_\u2026", "save": "\u4FDD\u5B58", "saving": "\u4FDD\u5B58\u4E2D\u2026", "saved": "\u5DF2\u4FDD\u5B58", "test_connection": "\u6D4B\u8BD5\u8FDE\u63A5", "testing": "\u6D4B\u8BD5\u4E2D\u2026", "test_ok": "\u8FDE\u63A5\u6210\u529F", "test_failed": "\u8FDE\u63A5\u5931\u8D25", "daily_remaining": "\u4ECA\u65E5\u5269\u4F59\u914D\u989D\uFF1A{{n}}", "clear_key": "\u6E05\u9664 Key", "clearing": "\u6E05\u9664\u4E2D\u2026", "cleared": "\u5DF2\u6E05\u9664", "clear_key_confirm": "\u786E\u5B9A\u8981\u5220\u9664\u81EA\u5B9A\u4E49 API Key \u5417\uFF1F\u5C06\u56DE\u9000\u5230\u5185\u7F6E Key\u3002", "using_user_key": "\u4F7F\u7528\u81EA\u5B9A\u4E49 Key", "using_builtin_key": "\u4F7F\u7528\u5185\u7F6E Key\uFF08500/\u5929\uFF09", "using_anonymous": "\u533F\u540D\uFF0850/\u5929\uFF09", "get_api_key": "\u83B7\u53D6 API Key", "view_docs": "\u67E5\u770B\u6587\u6863", "empty_key_error": "\u8BF7\u8F93\u5165 API Key\u3002", "close": "\u5173\u95ED" }, "skillRisk": { "category": { "shell": "Shell \u547D\u4EE4", "execution": "\u4EE3\u7801\u6267\u884C", "network": "\u7F51\u7EDC\u8BBF\u95EE", "credential": "\u51ED\u8BC1\u8BFB\u53D6", "filesystem": "\u6587\u4EF6\u7CFB\u7EDF", "exfiltration": "\u6570\u636E\u5916\u53D1" }, "severity": { "safe": "\u5B89\u5168", "warning": "\u8B66\u544A", "danger": "\u5371\u9669" } }, "skillInstallDialog": { "title": "\u5B89\u88C5\u6280\u80FD\uFF1A{{name}}", "scanning": "\u6B63\u5728\u4E0B\u8F7D\u4E0E\u626B\u63CF\u2026", "ai_review": "AI \u5B89\u5168\u590D\u5BA1", "ai_review_running": "\u5BA1\u67E5\u4E2D\u2026", "ai_review_passed": "\u901A\u8FC7", "ai_review_failed": "\u672A\u901A\u8FC7", "ai_review_show_details": "\u67E5\u770B\u8BE6\u60C5", "ai_review_hide_details": "\u9690\u85CF\u8BE6\u60C5", "ai_review_error": "AI \u5BA1\u67E5\u5931\u8D25\uFF1A{{error}}", "static_scan": "\u9759\u6001\u626B\u63CF", "no_risks": "\u672A\u68C0\u6D4B\u5230\u98CE\u9669\u3002", "risk_count": "{{danger}} \u5371\u9669 \xB7 {{warning}} \u8B66\u544A \xB7 {{safe}} \u5B89\u5168", "files": "\u6587\u4EF6", "files_summary": "{{count}} \u4E2A\u6587\u4EF6,{{size}}", "skill_md_preview": "SKILL.md \u9884\u89C8", "cancel": "\u53D6\u6D88", "install_safe": "\u5B89\u5168\u5B89\u88C5", "install_warning": "\u5B89\u88C5", "install_danger": "\u4ECD\u8981\u5B89\u88C5", "installing": "\u5B89\u88C5\u4E2D\u2026", "install_failed": "\u5B89\u88C5\u5931\u8D25\uFF1A{{error}}" }, "skillsPage": { "market": "\u5E02\u573A", "installed": "\u5DF2\u5B89\u88C5", "marketDescription": "\u4ECE\u793E\u533A\u5E02\u573A\u53D1\u73B0\u5E76\u5B89\u88C5\u65B0\u6280\u80FD\u3002", "skillCount": "{{count}} \u4E2A\u6280\u80FD", "searchPlaceholder": "\u641C\u7D22\u6280\u80FD\u6216\u63CF\u8FF0\u2026", "install": "\u5B89\u88C5", "installing": "\u5B89\u88C5\u4E2D\u2026", "installSafe": "\u5B89\u5168\u5B89\u88C5", "installAnyway": "\u4ECD\u8981\u5B89\u88C5", "alreadyInstalled": "\u5DF2\u5B89\u88C5", "scanning": "\u626B\u63CF\u4E2D\u2026", "agentReview": "AI \u5B89\u5168\u590D\u5BA1", "agentReviewing": "\u6B63\u5728\u5BA1\u67E5\u2026", "agentReviewPassed": "\u901A\u8FC7 AI \u5B89\u5168\u5BA1\u67E5", "agentReviewFailed": "AI \u5BA1\u67E5\u53D1\u73B0\u98CE\u9669", "securityReview": "\u5B89\u5168\u5BA1\u67E5", "noRisks": "\u672A\u68C0\u6D4B\u5230\u660E\u663E\u98CE\u9669\u3002", "filesLabel": "\u6587\u4EF6", "filesCount": "{{count}} \u4E2A\u6587\u4EF6,\u5171 {{size}}", "riskSafe": "\u5B89\u5168", "riskWarning": "\u8B66\u544A", "riskDanger": "\u5371\u9669", "riskShellCommand": "Shell \u547D\u4EE4", "riskExecution": "\u4EE3\u7801\u6267\u884C", "riskNetwork": "\u7F51\u7EDC\u8BBF\u95EE", "riskCredential": "\u51ED\u8BC1\u8BFB\u53D6", "riskFileSystem": "\u6587\u4EF6\u7CFB\u7EDF", "riskExfiltration": "\u6570\u636E\u5916\u53D1" }, "skillsmarket": { "title": "\u6280\u80FD\u5E02\u573A", "skillsmpDesc": "\u7531 skillsmp.com \u63D0\u4F9B 1.7M+ \u793E\u533A\u6280\u80FD\u3002", "apiKey": "API Key", "apiKeyPlaceholder": "sk_live_\u2026", "getApiKey": "\u83B7\u53D6 API Key", "openDocs": "\u67E5\u770B\u6587\u6863", "test": "\u6D4B\u8BD5\u8FDE\u63A5", "testOk": "\u8FDE\u63A5\u6210\u529F,\u5269\u4F59\u914D\u989D {{remaining}}/\u5929", "testFail": "\u8FDE\u63A5\u5931\u8D25:{{error}}", "usingBuiltinKey": "\u4F7F\u7528\u5185\u7F6E Key(500/\u5929)", "usingUserKey": "\u4F7F\u7528\u81EA\u5B9A\u4E49 Key" }, "knowledgeView": { "title": "\u77E5\u8BC6\u5E93", "subtitle1": "\u628A\u6C89\u6DC0\u7684\u7ECF\u9A8C\u4EE5 Markdown \u7B14\u8BB0\u4FDD\u5B58\u5728 ", "subtitle2": "\uFF0C\u76F8\u5173\u65F6\u81EA\u52A8\u6CE8\u5165\u5230\u5BF9\u8BDD\u4E0A\u4E0B\u6587\u3002", "passive": "\u81EA\u52A8\u6CE8\u5165", "passiveHint": "\u5F00\u542F\u540E\uFF0C\u6BCF\u8F6E\u5BF9\u8BDD\u4F1A\u81EA\u52A8\u5E26\u5165\u76F8\u5173\u7684\u77E5\u8BC6\u6761\u76EE\u3002", "passiveOn": "\u5DF2\u5F00\u542F\u81EA\u52A8\u6CE8\u5165", "passiveOff": "\u5DF2\u5173\u95ED\u81EA\u52A8\u6CE8\u5165", "autoCapture": "\u81EA\u52A8\u6C89\u6DC0", "autoCaptureHint": "\u5F00\u542F\u540E\uFF0C\u6BCF\u4E00\u6B21\u5B9E\u8D28\u6027\u7684\u4F1A\u8BDD\u7ED3\u675F\u90FD\u4F1A\u8BA9\u6A21\u578B\u5224\u65AD\u662F\u5426\u6709\u53EF\u590D\u7528\u7ECF\u9A8C\uFF1A\u62A5\u9519\u2192\u6062\u590D\u5F27\u81EA\u52A8\u6C89\u6DC0\uFF0C\u666E\u901A\u4F1A\u8BDD\u7531\u6A21\u578B\u51B3\u5B9A\u662F\u5426\u4FDD\u5B58\uFF08\u65E0\u4EF7\u503C\u7684\u4E0D\u5B58\uFF09\u3002", "autoCaptureOn": "\u5DF2\u5F00\u542F\u81EA\u52A8\u6C89\u6DC0", "autoCaptureOff": "\u5DF2\u5173\u95ED\u81EA\u52A8\u6C89\u6DC0", "graphView": "\u56FE\u8C31", "listView": "\u5217\u8868", "tagNode": "\u6807\u7B7E", "noDrafts": "\u6682\u65E0\u5F85\u786E\u8BA4\u8349\u7A3F\u3002", "draftsTitle": "\u5F85\u786E\u8BA4\u8349\u7A3F\uFF08{{count}}\uFF09", "draftsHint": "\u8FD9\u91CC\u663E\u793A\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4\u7684\u8349\u7A3F\u3002\u81EA\u52A8\u6C89\u6DC0\u7684\u5931\u8D25\u6062\u590D\u7ECF\u9A8C\u4F1A\u76F4\u63A5\u8FDB\u5165\u77E5\u8BC6\u5E93\u3002", "accept": "\u91C7\u7EB3", "discard": "\u4E22\u5F03", "draftAccepted": "\u8349\u7A3F\u5DF2\u91C7\u7EB3", "draftDiscarded": "\u8349\u7A3F\u5DF2\u4E22\u5F03", "refresh": "\u5237\u65B0", "searchPlaceholder": "\u641C\u7D22\u6807\u9898\u3001\u6B63\u6587\u6216\u6807\u7B7E", "new": "\u65B0\u5EFA\u6761\u76EE", "count": "\u5171 {{count}} \u6761", "clickToView": "\u70B9\u51FB\u6761\u76EE\u67E5\u770B\u8BE6\u60C5\uFF1B\u76F8\u5173\u6761\u76EE\u4E5F\u4F1A\u81EA\u52A8\u6CE8\u5165\u5230\u5BF9\u8BDD\u4E2D\u3002", "loading": "\u52A0\u8F7D\u4E2D\u2026", "empty": "\u6682\u65E0\u77E5\u8BC6\u3002\u53EF\u5728\u6B64\u6DFB\u52A0\uFF1B\u5F00\u542F\u81EA\u52A8\u6C89\u6DC0\u540E\uFF0C\u5931\u8D25\u540E\u6062\u590D\u7684\u7ECF\u9A8C\u4F1A\u81EA\u52A8\u4FDD\u5B58\u3002\u6216\u8005\u8BA9\u667A\u80FD\u4F53\u7528 knowledge_write \u4E3B\u52A8\u4FDD\u5B58\u3002", "delete": "\u5220\u9664", "edit": "\u7F16\u8F91", "close": "\u5173\u95ED", "newTitle": "\u65B0\u5EFA\u6761\u76EE", "editTitle": "\u7F16\u8F91\u6761\u76EE", "fieldTitle": "\u6807\u9898", "fieldTitlePlaceholder": "\u4E00\u4E2A\u5177\u4F53\u3001\u53EF\u68C0\u7D22\u7684\u6807\u9898", "fieldKind": "\u7C7B\u578B", "fieldScope": "\u4F5C\u7528\u57DF", "fieldTags": "\u6807\u7B7E", "fieldTagsPlaceholder": "\u7528\u9017\u53F7\u5206\u9694\u7684\u6807\u7B7E", "fieldBody": "\u6B63\u6587", "fieldBodyPlaceholder": "\u8BB0\u5F55\u8FD9\u4E2A\u5751/\u89E3\u51B3\u65B9\u6CD5/\u547D\u4EE4/\u914D\u7F6E\u662F\u4EC0\u4E48\uFF0C\u4EE5\u53CA\u5982\u4F55\u5E94\u7528\u3002", "cancel": "\u53D6\u6D88", "save": "\u4FDD\u5B58", "saved": "\u6761\u76EE\u5DF2\u4FDD\u5B58", "deleted": "\u6761\u76EE\u5DF2\u5220\u9664", "titleRequired": "\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A", "bodyRequired": "\u6B63\u6587\u4E0D\u80FD\u4E3A\u7A7A", "saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{{error}}", "deleteFailed": "\u5220\u9664\u5931\u8D25\uFF1A{{error}}", "loadFailed": "\u52A0\u8F7D\u77E5\u8BC6\u5931\u8D25\uFF1A{{error}}", "kind": { "pitfall": "\u5751", "solution": "\u89E3\u51B3\u65B9\u6CD5", "command": "\u547D\u4EE4", "config": "\u914D\u7F6E", "note": "\u7B14\u8BB0", "memory": "\u8BB0\u5FC6" }, "scope": { "project": "\u9879\u76EE", "global": "\u5168\u5C40" } }, "plugins": { "files": { "specTitle": "CPI Trinity \u9274\u6743\u89C4\u8303", "specDesc": "\u672C\u6587\u6863\u9762\u5411\u5B50\u7CFB\u7EDF\u5F00\u53D1\u8005\uFF0C\u63CF\u8FF0\u5982\u4F55\u5BF9\u63A5 Trinity \u7EDF\u4E00\u9274\u6743\u3002", "corePrinciples": "\u6838\u5FC3\u539F\u5219", "p1": "Trinity \u8D1F\u8D23\u7B7E\u53D1\uFF1A\u7528\u6237\u5728 Trinity \u95E8\u6237\u767B\u5F55\uFF0C\u83B7\u5F97 JWT Token", "p2": "\u5B50\u7CFB\u7EDF\u8D1F\u8D23\u9A8C\u8BC1\uFF1A\u5B50\u7CFB\u7EDF\u540E\u7AEF\u53EA\u9700\u9A8C\u8BC1 Token \u7B7E\u540D\uFF0C\u4E0D\u9700\u8981\u7EF4\u62A4\u7528\u6237\u767B\u5F55\u903B\u8F91", "p3": "Token \u7EDF\u4E00\u4F20\u9012\uFF1A\u95E8\u6237\u8DF3\u8F6C\u65F6\u901A\u8FC7 URL/IPC \u4F20\u9012 Token\uFF0C\u5B50\u7CFB\u7EDF\u524D\u7AEF\u5B58\u50A8\u540E\u4F7F\u7528", "tokenSpec": "Token \u89C4\u683C", "field": "\u5B57\u6BB5", "value": "\u503C", "format": "\u683C\u5F0F", "filterPlaceholder": "\u7B5B\u9009\u6587\u4EF6..." }, "terminal": { "copyright": "\u7248\u6743\u6240\u6709 (C) Microsoft Corporation\u3002\u4FDD\u7559\u6240\u6709\u6743\u5229\u3002", "tryNew": "\u5B89\u88C5\u6700\u65B0\u7684 PowerShell\uFF0C\u4E86\u89E3\u65B0\u529F\u80FD\u548C\u6539\u8FDB\uFF01https://aka.ms/PSWindows" }, "filePreview": { "choose": "\u9009\u62E9\u6587\u4EF6", "loading": "\u6B63\u5728\u52A0\u8F7D\u9884\u89C8\u2026", "empty": "\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u5728\u6B64\u9884\u89C8", "unsupported": "\u8BE5\u6587\u4EF6\u7C7B\u578B\u6682\u4E0D\u652F\u6301\u9884\u89C8", "imageUnavailable": "\u56FE\u7247\u65E0\u6CD5\u52A0\u8F7D", "noSheets": "\u672A\u627E\u5230\u5DE5\u4F5C\u8868", "truncated": "\u9884\u89C8\u5185\u5BB9\u5DF2\u622A\u65AD", "truncatedRows": "\uFF08\u4EC5\u663E\u793A\u524D\u82E5\u5E72\u884C\uFF09", "sendToChat": "\u53D1\u9001\u5230\u5BF9\u8BDD" }, "recording": { "title": "\u5F55\u97F3", "idle": "\u51C6\u5907\u5F55\u97F3", "recording": "\u5F55\u97F3\u4E2D", "paused": "\u5DF2\u6682\u505C", "transcribing": "\u8F6C\u5199\u4E2D\u2026", "done": "\u5DF2\u5B8C\u6210", "error": "\u51FA\u9519", "start": "\u5F00\u59CB", "pause": "\u6682\u505C", "resume": "\u7EE7\u7EED", "stop": "\u505C\u6B62", "transcribe": "\u8F6C\u5199\u4E3A\u6587\u5B57", "generateMinutes": "\u751F\u6210\u4F1A\u8BAE\u7EAA\u8981", "modelNeededTitle": "\u9700\u8981\u8BED\u97F3\u6A21\u578B", "modelNeededDesc": "\u8F6C\u5199\u9700\u8981 Whisper \u6A21\u578B\u3002\u6A21\u578B\u4F1A\u4E0B\u8F7D\u5230\u5E94\u7528\u81EA\u8EAB\u76EE\u5F55\uFF0C\u5E76\u5728\u4F7F\u7528\u524D\u6821\u9A8C\u3002", "downloadModel": "\u4E0B\u8F7D\u6A21\u578B", "downloading": "\u4E0B\u8F7D\u4E2D\u2026", "transcript": "\u8F6C\u5199\u6587\u672C", "noSpeech": "\u672A\u68C0\u6D4B\u5230\u8BED\u97F3", "minutes": "\u4F1A\u8BAE\u7EAA\u8981", "exportWord": "\u5BFC\u51FA Word", "exportedTo": "\u5DF2\u4FDD\u5B58\u5230", "sendToChat": "\u53D1\u9001\u5230\u5BF9\u8BDD" } }, "commandPalette": { "placeholder": "\u8F93\u5165\u547D\u4EE4\u2026", "noMatch": "\u6CA1\u6709\u5339\u914D\u7684\u547D\u4EE4" }, "chat": { "nativeWebSearchCompleted": "DeepSeek \u7F51\u9875\u641C\u7D22\u5B8C\u6210\uFF08{{count}} \u4E2A\u67E5\u8BE2\uFF09", "nativeWebSearchStatus": "DeepSeek \u7F51\u9875\u641C\u7D22\uFF1A{{status}}" }, "general": { "languages": { "autoDetect": "\u81EA\u52A8\u68C0\u6D4B", "sq": "\u963F\u5C14\u5DF4\u5C3C\u4E9A\u8BED (\u963F\u5C14\u5DF4\u5C3C\u4E9A)", "is": "\u51B0\u5C9B\u8BED (\u51B0\u5C9B)", "ka": "\u683C\u9C81\u5409\u4E9A\u8BED (\u683C\u9C81\u5409\u4E9A)", "mk": "\u9A6C\u5176\u987F\u8BED (\u5317\u9A6C\u5176\u987F)", "mn": "\u8499\u53E4\u8BED", "my": "\u7F05\u7538\u8BED (\u7F05\u7538)", "ja": "\u65E5\u672C\u8BED (\u65E5\u672C) \xB7 \u65E5\u8BED (\u65E5\u672C)", "so": "\u7D22\u9A6C\u91CC\u8BED (\u7D22\u9A6C\u91CC)", "hy": "\u4E9A\u7F8E\u5C3C\u4E9A\u8BED (\u4E9A\u7F8E\u5C3C\u4E9A)", "zhTW": "\u4E2D\u6587 (\u53F0\u6E7E) \xB7 \u4E2D\u6587 (\u53F0\u6E7E)", "zhHK": "\u4E2D\u6587 (\u9999\u6E2F)", "zhCN": "\u4E2D\u6587 (\u7B80\u4F53)", "enUS": "English (US)" } } };
var dependencies = Object.fromEntries(Object.entries({ "react": external0, "react/jsx-runtime": external1, "react-dom": external2, "react-dom/client": external3, "gsap": external4, "deep-agent-base-ui/preview-card": external5, "deep-agent-lucide": external6, "@fortawesome/fontawesome-svg-core": external7, "@fortawesome/free-solid-svg-icons": external8, "@fortawesome/react-fontawesome": external9, "@radix-ui/react-slider": external10, "react-circular-progressbar": external11, "clsx": external12, "tailwind-merge": external13 }).map(([key, value]) => [key, { ...value, __esModule: true, default: value.default ?? value }]));
function mountDeepAgentComposer(target, options = {}) {
  return mountOriginalDeepAgent(target, options, "composer", STYLE_TEXT, TOKENS, COPY, (window, document, setTimeout, clearTimeout, __deepAgentBridge) => {
    const module = { exports: {} };
    const exports = module.exports;
    const require2 = (name) => {
      if (!dependencies[name]) throw new Error("Missing original UI dependency: " + name);
      return dependencies[name];
    };
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target2, all) => {
      for (var name in all)
        __defProp(target2, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM = (mod, isNodeMode, target2) => (target2 = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp(target2, "default", { value: mod, enumerable: true }) : target2,
      mod
    ));
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
    var original_icons_exports = {};
    __export(original_icons_exports, {
      OriginalDemo: () => OriginalDemo,
      disposeMessages: () => disposeMessages
    });
    module.exports = __toCommonJS(original_icons_exports);
    var import_fontawesome_svg_core = require2("@fortawesome/fontawesome-svg-core");
    var import_free_solid_svg_icons = require2("@fortawesome/free-solid-svg-icons");
    var import_react21 = require2("react");
    var import_lucide_react5 = require2("deep-agent-lucide");
    var import_react4 = require2("react");
    var import_preview_card = require2("deep-agent-base-ui/preview-card");
    var import_clsx = require2("clsx");
    var import_tailwind_merge = require2("tailwind-merge");
    function cn(...inputs) {
      return (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));
    }
    var import_react2 = require2("react");
    var import_gsap = __toESM(require2("gsap"));
    var CONTINUOUS_CORNERS = Object.freeze({ radius: 24, smoothing: 0.6 });
    var CORNER_RADIUS_SCALE = 1 + CONTINUOUS_CORNERS.smoothing;
    var CORNER_CURVATURE = Math.log2(
      -Math.LN2 / Math.log(1 - (1 - Math.SQRT1_2) / CORNER_RADIUS_SCALE)
    );
    function supportsContinuousCorners() {
      return typeof CSS !== "undefined" && CSS.supports("corner-shape", "superellipse(2)");
    }
    function continuousRadius(radius, supported = supportsContinuousCorners()) {
      return supported ? radius * CORNER_RADIUS_SCALE : radius;
    }
    function computedCornerCurvature(style) {
      const shape = style.getPropertyValue("corner-shape");
      if (shape === "round" || !supportsContinuousCorners()) return 1;
      const match = shape.match(/superellipse\(([\d.]+)\)/);
      return match ? Number(match[1]) : CORNER_CURVATURE;
    }
    var SHARE_MOTION = {
      open: {
        width: { stiffness: 306.25, damping: 28, duration: 0.7, delay: 0 },
        height: { stiffness: 196, damping: 18.34, duration: 0.86, delay: 0.057 }
      },
      close: {
        width: { stiffness: 400, damping: 33, duration: 0.64, delay: 0.07 },
        height: { stiffness: 600.25, damping: 40, duration: 0.62, delay: 0 }
      },
      resize: { stiffness: 280, damping: 24, duration: 0.64 }
    };
    function springEase(stiffness, damping, duration) {
      const decay = damping / 2;
      const frequency = Math.sqrt(stiffness - decay * decay);
      return (progress) => {
        if (progress === 0 || progress === 1) return progress;
        const time = progress * duration;
        return 1 - Math.exp(-decay * time) * (Math.cos(frequency * time) + decay / frequency * Math.sin(frequency * time));
      };
    }
    function prefersReducedMotion() {
      return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    function motionColor(color) {
      if (/^rgba?\(/i.test(color)) return color;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) return color;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
    }
    var SOFT_SPRING = { stiffness: 360, damping: 34, duration: 0.42 };
    var import_jsx_runtime = require2("react/jsx-runtime");
    var SpringPopupContext = (0, import_react2.createContext)(null);
    function usePopupMotionRoot(externalActions) {
      const actionsRef = (0, import_react2.useRef)(null);
      const trigger = (0, import_react2.useRef)(null);
      (0, import_react2.useImperativeHandle)(externalActions, () => ({
        unmount: () => actionsRef.current?.unmount(),
        close: () => actionsRef.current?.close()
      }), []);
      const context = (0, import_react2.useMemo)(() => ({ trigger, onExited: () => actionsRef.current?.unmount() }), []);
      const onChange = (open, details) => {
        if (details.isCanceled) return;
        if (open && details.trigger instanceof HTMLElement) trigger.current = details.trigger;
        if (!open && !prefersReducedMotion()) details.preventUnmountOnClose();
      };
      return { actionsRef, context, onChange };
    }
    var SpringSurface = (0, import_react2.forwardRef)(function SpringSurface2({ children, className, motionTone = "menu", anchor, openingPointer, onMotionExit, ...props }, forwardedRef) {
      const nodeRef = (0, import_react2.useRef)(null);
      const surfaceRef = (0, import_react2.useRef)(null);
      const compactRef = (0, import_react2.useRef)(null);
      const bodyRef = (0, import_react2.useRef)(null);
      const popup = (0, import_react2.useContext)(SpringPopupContext);
      const latest = (0, import_react2.useRef)({ anchor, openingPointer, popup, onMotionExit });
      latest.current = { anchor, openingPointer, popup, onMotionExit };
      const setRef = (0, import_react2.useCallback)((node) => {
        nodeRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }, [forwardedRef]);
      (0, import_react2.useLayoutEffect)(() => {
        const node = nodeRef.current, surface = surfaceRef.current, compact = compactRef.current, body = bodyRef.current;
        if (!node || !surface || !compact || !body) return;
        let timeline;
        let resize;
        let previousOpen;
        let disposed = false;
        const targetWidth = node.offsetWidth;
        let targetHeight = node.offsetHeight;
        const css = getComputedStyle(node);
        const paddingX = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight);
        const paddingY = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
        const borderX = parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth);
        const borderY = parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
        const borderLeft = parseFloat(css.borderLeftWidth);
        const borderTop = parseFloat(css.borderTopWidth);
        const radius = parseFloat(css.borderTopLeftRadius) || continuousRadius(16);
        const curvature = computedCornerCurvature(css);
        const maxHeight = parseFloat(css.maxHeight);
        const context = import_gsap.default.context(() => {
        }, node);
        const trigger = (latest.current.anchor ?? latest.current.popup?.trigger)?.current;
        const triggerStyle = trigger?.style.opacity ?? "";
        let ownsTriggerOpacity = false;
        const triggerCss = trigger ? getComputedStyle(trigger) : null;
        const buttonRadius = parseFloat(triggerCss?.borderTopLeftRadius ?? "0");
        const buttonCurvature = triggerCss ? computedCornerCurvature(triggerCss) : curvature;
        const buttonBackground = motionColor(triggerCss?.backgroundColor ?? "transparent");
        const initial = node.getBoundingClientRect();
        const origin = trigger?.getBoundingClientRect();
        const side = node.getAttribute("data-side") ?? (origin && initial.bottom <= origin.top + 12 ? "top" : origin && initial.left >= origin.right ? "right" : "bottom");
        const align = node.getAttribute("data-align") ?? (origin && Math.abs(initial.right - origin.right) < Math.abs(initial.left - origin.left) ? "end" : "start");
        const sideways = side === "left" || side === "right";
        const background = motionColor(css.backgroundColor), shadow = css.boxShadow, borderColor = motionColor(css.borderTopColor);
        const naturalOverflowX = css.overflowX, naturalOverflowY = css.overflowY;
        const restoreTrigger = () => {
          if (trigger && ownsTriggerOpacity) trigger.style.opacity = triggerStyle;
          ownsTriggerOpacity = false;
        };
        context.add(() => import_gsap.default.set(surface, { visibility: "visible" }));
        if (motionTone === "menu") context.add(() => {
          import_gsap.default.set(node, {
            position: "relative",
            width: targetWidth,
            height: targetHeight,
            backgroundColor: "transparent",
            borderColor: "transparent",
            boxShadow: "none",
            overflow: "visible",
            pointerEvents: "none"
          });
          import_gsap.default.set(surface, {
            position: "absolute",
            boxSizing: "border-box",
            width: targetWidth,
            height: targetHeight,
            padding: css.padding,
            borderWidth: css.borderWidth,
            borderStyle: css.borderStyle,
            borderColor,
            borderRadius: radius,
            "--spring-corner-curvature": curvature,
            backgroundColor: background,
            boxShadow: shadow
          });
          body.style.width = `${Math.max(0, targetWidth - paddingX - borderX)}px`;
          if (!sideways && trigger && origin && origin.width > 1 && origin.height > 1) {
            const face = trigger.cloneNode(true);
            face.removeAttribute("id");
            for (const element of face.querySelectorAll("[id], [autofocus]")) {
              element.removeAttribute("id");
              element.removeAttribute("autofocus");
            }
            Object.assign(face.style, {
              width: `${origin.width}px`,
              height: `${origin.height}px`,
              margin: "0",
              maxWidth: "none",
              opacity: triggerCss?.opacity ?? "1",
              transform: "none"
            });
            compact.replaceChildren(face);
            compact.inert = true;
          }
        });
        const dimensions = () => {
          const rect = trigger?.getBoundingClientRect();
          const heightLimit = rect && side === "top" ? rect.bottom - 16 : rect && side === "bottom" ? window.innerHeight - rect.top - 16 : window.innerHeight - 32;
          return { width: Math.min(targetWidth, window.innerWidth - 32), height: Math.min(targetHeight, Math.max(24, heightLimit)) };
        };
        const settleOverflow = () => import_gsap.default.set(surface, {
          overflowX: naturalOverflowX,
          overflowY: dimensions().height < targetHeight ? "auto" : naturalOverflowY
        });
        const place = () => {
          if (motionTone !== "menu" || disposed) return;
          const base = node.getBoundingClientRect(), rect = trigger?.getBoundingClientRect();
          const width = surface.offsetWidth, height = surface.offsetHeight;
          let left = base.left, top = base.top;
          if (rect) {
            if (side === "top" || side === "bottom") {
              left = align === "end" ? rect.right - width : align === "center" ? rect.left + (rect.width - width) / 2 : rect.left;
              top = side === "top" ? rect.bottom - height : rect.top;
            } else {
              left = base.left + (side === "left" ? node.offsetWidth - width : 0);
              top = base.top;
            }
            left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
            top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
            compact.style.left = `${rect.left - left - borderLeft}px`;
            compact.style.top = `${rect.top - top - borderTop}px`;
          }
          surface.style.left = `${left - base.left - borderLeft}px`;
          surface.style.top = `${top - base.top - borderTop}px`;
        };
        const isOpen = () => node.getAttribute("data-state") === "open" || node.hasAttribute("data-open");
        let faceReady = false, pointerHeld = false;
        let releaseFrame = 0;
        const enablePointer = () => {
          if (motionTone === "menu") body.style.pointerEvents = isOpen() && faceReady && !pointerHeld ? "auto" : "none";
        };
        const releasePointer = () => {
          cancelAnimationFrame(releaseFrame);
          releaseFrame = requestAnimationFrame(() => {
            pointerHeld = false;
            if (latest.current.openingPointer) latest.current.openingPointer.current = false;
            enablePointer();
          });
        };
        document.addEventListener("pointerup", releasePointer, true);
        document.addEventListener("pointercancel", releasePointer, true);
        const finishExit = () => {
          if (!disposed && !isOpen()) {
            restoreTrigger();
            surface.style.visibility = "hidden";
            import_gsap.default.set(node, { autoAlpha: 0 });
            (latest.current.onMotionExit ?? latest.current.popup?.onExited)?.();
          }
        };
        const play = () => context.add(() => {
          const open = isOpen();
          if (open === previousOpen) return;
          const first = previousOpen === void 0;
          previousOpen = open;
          timeline?.kill();
          resize?.kill();
          node.inert = !open;
          faceReady = false;
          pointerHeld = open && !!latest.current.openingPointer?.current;
          enablePointer();
          if (first && !open) {
            restoreTrigger();
            import_gsap.default.set(node, { autoAlpha: 0 });
            import_gsap.default.set(surface, { visibility: "hidden" });
            return;
          }
          if (motionTone === "hint") {
            if (prefersReducedMotion()) {
              import_gsap.default.set(node, { autoAlpha: open ? 1 : 0 });
              if (!open) finishExit();
              return;
            }
            if (open) import_gsap.default.set(node, { opacity: 0, scale: 0.98, y: 2 });
            timeline = import_gsap.default.timeline({ onComplete: open ? void 0 : finishExit });
            timeline.to(node, {
              autoAlpha: open ? 1 : 0,
              scale: open ? 1 : 0.98,
              y: open ? 0 : 2,
              duration: open ? 0.18 : 0.12,
              ease: "power2.out"
            });
            return;
          }
          const triggerRect = trigger?.getBoundingClientRect();
          const fromWidth = sideways ? 4 : triggerRect?.width ?? targetWidth * 0.7;
          const fromHeight = triggerRect?.height ?? 32;
          const expanded = dimensions();
          const motion = open ? SHARE_MOTION.open : SHARE_MOTION.close;
          if (trigger && !sideways) {
            trigger.style.opacity = "0";
            ownsTriggerOpacity = true;
          }
          import_gsap.default.set(node, { visibility: "visible", opacity: 1 });
          import_gsap.default.set(surface, { visibility: "visible", overflow: "hidden", pointerEvents: open ? "auto" : "none" });
          if (prefersReducedMotion()) {
            import_gsap.default.set(surface, {
              width: open ? expanded.width : fromWidth,
              height: open ? expanded.height : fromHeight,
              borderRadius: open ? radius : buttonRadius,
              "--spring-corner-curvature": open ? curvature : buttonCurvature,
              backgroundColor: open ? background : buttonBackground,
              boxShadow: open ? shadow : "none",
              borderColor: open ? borderColor : "transparent"
            });
            import_gsap.default.set(compact, { opacity: open ? 0 : 1 });
            import_gsap.default.set(body, { opacity: open ? 1 : 0, filter: "blur(0px)" });
            place();
            faceReady = open;
            enablePointer();
            if (!open) finishExit();
            else settleOverflow();
            return;
          }
          if (open && timeline === void 0) {
            import_gsap.default.set(surface, {
              width: fromWidth,
              height: fromHeight,
              borderRadius: buttonRadius,
              "--spring-corner-curvature": buttonCurvature,
              backgroundColor: buttonBackground,
              boxShadow: "none",
              borderColor: "transparent"
            });
            import_gsap.default.set(compact, { opacity: 1 });
            import_gsap.default.set(body, { opacity: 0, filter: "blur(3px)" });
          }
          timeline = import_gsap.default.timeline({ onComplete: () => {
            if (!open) {
              finishExit();
              return;
            }
            settleOverflow();
          } });
          timeline.to(surface, {
            width: open ? expanded.width : fromWidth,
            duration: motion.width.duration,
            ease: springEase(motion.width.stiffness, motion.width.damping, motion.width.duration)
          }, motion.width.delay);
          timeline.to(surface, {
            height: open ? expanded.height : fromHeight,
            duration: motion.height.duration,
            ease: springEase(motion.height.stiffness, motion.height.damping, motion.height.duration)
          }, motion.height.delay);
          timeline.to(surface, {
            borderRadius: open ? radius : buttonRadius,
            "--spring-corner-curvature": open ? curvature : buttonCurvature,
            backgroundColor: open ? background : buttonBackground,
            boxShadow: open ? shadow : "none",
            borderColor: open ? borderColor : "transparent",
            duration: 0.22,
            ease: "power2.out"
          }, 0);
          timeline.to(compact, { opacity: open ? 0 : 1, duration: 0.14, ease: "power2.out" }, open ? 0 : 0.2);
          timeline.to(body, {
            opacity: open ? 1 : 0,
            filter: open ? "blur(0px)" : "blur(3px)",
            duration: open ? 0.25 : 0.14,
            ease: "power2.out"
          }, open ? 0.12 : 0);
          if (open) timeline.call(() => {
            faceReady = true;
            enablePointer();
          }, [], 0.37);
          if (open) {
            const rows = Array.from(body.querySelectorAll("[role=menuitem], [role=menuitemradio], [data-menu-item]")).slice(0, 24);
            timeline.fromTo(rows, { opacity: 0, y: 4 }, {
              opacity: 1,
              y: 0,
              duration: 0.25,
              stagger: Math.min(0.018, 0.16 / Math.max(1, rows.length)),
              ease: "power2.out"
            }, 0.14);
          }
        });
        play();
        place();
        if (motionTone === "menu") import_gsap.default.ticker.add(place);
        const positionObserver = new MutationObserver(place);
        if (motionTone === "menu" && node.parentElement) positionObserver.observe(
          node.parentElement,
          { attributes: true, attributeFilter: ["style"] }
        );
        const observer = new MutationObserver(play);
        observer.observe(node, { attributes: true, attributeFilter: ["data-state", "data-open", "data-closed"] });
        let rendered = dimensions();
        const retarget = () => {
          if (!isOpen() || motionTone === "hint" || disposed) return;
          const width = dimensions().width;
          body.style.width = `${Math.max(0, width - paddingX - borderX)}px`;
          const contentHeight = body.offsetHeight + paddingY + borderY;
          const nextHeight = Number.isFinite(maxHeight) ? Math.min(contentHeight, maxHeight) : contentHeight;
          const contentChanged = Math.abs(nextHeight - targetHeight) >= 1;
          targetHeight = nextHeight;
          const next = dimensions();
          const widthChanged = Math.abs(next.width - rendered.width) >= 1;
          if (!contentChanged && !widthChanged && Math.abs(next.height - rendered.height) < 1) return;
          rendered = next;
          context.add(() => {
            resize?.kill();
            import_gsap.default.killTweensOf(surface, widthChanged ? "width,height" : "height");
            import_gsap.default.set(node, { width, height: targetHeight });
            const m = SHARE_MOTION.resize;
            resize = import_gsap.default.to(surface, {
              ...widthChanged ? { width } : {},
              height: next.height,
              duration: prefersReducedMotion() ? 0 : m.duration,
              ease: springEase(m.stiffness, m.damping, m.duration),
              onComplete: settleOverflow
            });
          });
        };
        const contentResize = new ResizeObserver(retarget);
        contentResize.observe(body);
        window.addEventListener("resize", retarget);
        return () => {
          disposed = true;
          observer.disconnect();
          contentResize.disconnect();
          positionObserver.disconnect();
          import_gsap.default.ticker.remove(place);
          window.removeEventListener("resize", retarget);
          document.removeEventListener("pointerup", releasePointer, true);
          document.removeEventListener("pointercancel", releasePointer, true);
          cancelAnimationFrame(releaseFrame);
          restoreTrigger();
          compact.replaceChildren();
          timeline?.kill();
          resize?.kill();
          context.revert();
          node.style.visibility = "hidden";
          surface.style.visibility = "hidden";
        };
      }, [motionTone]);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ...props, ref: setRef, "data-spring-tone": motionTone, className: `spring-surface ui-menu-surface ${className ?? ""}`, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: surfaceRef, "data-spring-shell": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: compactRef, "aria-hidden": "true", className: "pointer-events-none absolute" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: bodyRef, className: "spring-surface-content", children })
      ] }) });
    });
    var import_react22 = require2("react");
    var import_gsap2 = __toESM(require2("gsap"));
    function useHintPositionMotion(enabled) {
      const [positioner, positionerRef] = (0, import_react22.useState)(null);
      const [shift, shiftRef] = (0, import_react22.useState)(null);
      (0, import_react22.useLayoutEffect)(() => {
        if (!enabled || !positioner || !shift) return;
        let previous = null;
        let tween;
        let frame = 0;
        let disposed = false;
        const remember = () => {
          if (disposed) return;
          previous = positioner.getBoundingClientRect();
        };
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(remember);
        });
        const observer = new MutationObserver(() => {
          const next = positioner.getBoundingClientRect();
          if (previous && (Math.abs(next.left - previous.left) > 0.5 || Math.abs(next.top - previous.top) > 0.5)) {
            const x = previous.left - next.left + Number(import_gsap2.default.getProperty(shift, "x"));
            const y = previous.top - next.top + Number(import_gsap2.default.getProperty(shift, "y"));
            tween?.kill();
            import_gsap2.default.set(shift, { x, y });
            tween = import_gsap2.default.to(shift, { x: 0, y: 0, duration: prefersReducedMotion() ? 0 : 0.16, ease: "power2.out" });
          }
          if (previous) previous = next;
        });
        observer.observe(positioner, { attributes: true, attributeFilter: ["style"] });
        return () => {
          disposed = true;
          cancelAnimationFrame(frame);
          observer.disconnect();
          tween?.kill();
          import_gsap2.default.set(shift, { clearProps: "transform" });
        };
      }, [enabled, positioner, shift]);
      return { positionerRef, shiftRef };
    }
    var import_jsx_runtime2 = require2("react/jsx-runtime");
    function HoverCard({ actionsRef, onOpenChange, ...props }) {
      const motion = usePopupMotionRoot(actionsRef);
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SpringPopupContext.Provider, { value: motion.context, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_preview_card.PreviewCard.Root, { "data-slot": "hover-card", ...props, actionsRef: motion.actionsRef, onOpenChange: (open, details) => {
        onOpenChange?.(open, details);
        motion.onChange(open, details);
      } }) });
    }
    function HoverCardTrigger(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_preview_card.PreviewCard.Trigger, { "data-slot": "hover-card-trigger", ...props });
    }
    function HoverCardContent({
      className,
      side = "bottom",
      align = "center",
      sideOffset = 6,
      alignOffset = 0,
      motionTone = "hint",
      continuous = false,
      ...props
    }) {
      const { positionerRef, shiftRef } = useHintPositionMotion(continuous);
      const popup = /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        import_preview_card.PreviewCard.Popup,
        {
          render: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SpringSurface, { motionTone }),
          "data-slot": "hover-card-content",
          "data-hover-info-continuous": continuous || void 0,
          className: cn(
            "z-[70] max-w-sm origin-(--transform-origin) rounded-xl border border-border-theme bg-elevated-bg px-3 py-2 text-[12px] leading-snug text-text-base shadow-[0_6px_24px_rgba(0,0,0,0.12)] outline-none",
            className
          ),
          ...props
        }
      );
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_preview_card.PreviewCard.Portal, { container: __deepAgentBridge.portals, "data-slot": "hover-card-portal", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        import_preview_card.PreviewCard.Positioner,
        {
          ref: positionerRef,
          side,
          align,
          sideOffset,
          alignOffset,
          className: "isolate z-[70]",
          children: continuous ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { ref: shiftRef, children: popup }) : popup
        }
      ) });
    }
    var createHoverCardHandle = import_preview_card.PreviewCard.createHandle;
    var import_react3 = require2("react");
    var MorphPanelLayoutContext = (0, import_react3.createContext)(false);
    var MenuTriggerOpenContext = (0, import_react3.createContext)(false);
    var import_jsx_runtime3 = require2("react/jsx-runtime");
    var HoverInfoGroupContext = (0, import_react4.createContext)(null);
    function HoverInfo({ content, children, side }) {
      const menuOpen = (0, import_react4.useContext)(MenuTriggerOpenContext);
      const group = (0, import_react4.useContext)(HoverInfoGroupContext);
      const [open, setOpen] = (0, import_react4.useState)(false);
      (0, import_react4.useEffect)(() => {
        if (menuOpen) {
          setOpen(false);
          group?.dismiss();
        }
      }, [menuOpen, group]);
      if (content == null || content === "") return children;
      const disabled = (0, import_react4.isValidElement)(children) && children.props.disabled === true;
      const ariaLabel = typeof content === "string" && children.type === "button" && (0, import_react4.isValidElement)(children) && !children.props["aria-label"] ? content : void 0;
      const trigger = disabled ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "span",
        {
          className: children.props.className?.includes("w-full") ? "flex w-full" : "inline-flex max-w-full",
          tabIndex: 0,
          "aria-label": typeof content === "string" ? content : void 0,
          children
        }
      ) : children;
      if (group) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        HoverCardTrigger,
        {
          handle: group.handle,
          payload: { content, side },
          render: trigger,
          delay: group.delay,
          closeDelay: group.closeDelay,
          "aria-label": ariaLabel,
          "data-hover-info-disabled": menuOpen || void 0,
          className: "!no-underline hover:!no-underline"
        }
      );
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(HoverCard, { open: open && !menuOpen, onOpenChange: (next, details) => {
        if (details.reason === "trigger-press" || next && menuOpen) details.cancel();
        else setOpen(next);
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          HoverCardTrigger,
          {
            render: trigger,
            delay: 350,
            closeDelay: 150,
            "aria-label": ariaLabel,
            className: "!no-underline hover:!no-underline"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(HoverCardContent, { side, children: content })
      ] });
    }
    var import_react20 = require2("react");
    var import_react_fontawesome4 = require2("@fortawesome/react-fontawesome");
    var import_lucide_react4 = require2("deep-agent-lucide");
    var t = __deepAgentBridge.t;
    function useTranslation() {
      return { t };
    }
    var import_react6 = require2("react");
    var import_react_circular_progressbar = require2("react-circular-progressbar");
    var React = __toESM(require2("react"));
    var import_react5 = require2("react");
    var import_gsap3 = __toESM(require2("gsap"));
    function useSpringPress(forwardedRef) {
      const local = (0, import_react5.useRef)(null);
      const ref = (0, import_react5.useCallback)((node) => {
        local.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }, [forwardedRef]);
      (0, import_react5.useEffect)(() => {
        const node = local.current;
        if (!node) return;
        let pressed = false;
        let tween;
        const release = () => {
          if (!pressed) return;
          pressed = false;
          tween?.kill();
          tween = import_gsap3.default.to(node, {
            scale: 1,
            duration: prefersReducedMotion() ? 0 : 0.38,
            ease: springEase(420, 24, 0.38)
          });
        };
        const down = () => {
          if (node.matches(":disabled") || prefersReducedMotion()) return;
          pressed = true;
          tween?.kill();
          tween = import_gsap3.default.to(node, { scale: 0.97, duration: 0.075, ease: "power2.out" });
        };
        node.addEventListener("pointerdown", down);
        window.addEventListener("pointerup", release);
        window.addEventListener("pointercancel", release);
        window.addEventListener("blur", release);
        return () => {
          node.removeEventListener("pointerdown", down);
          window.removeEventListener("pointerup", release);
          window.removeEventListener("pointercancel", release);
          window.removeEventListener("blur", release);
          tween?.kill();
          import_gsap3.default.set(node, { clearProps: "scale" });
        };
      }, []);
      return ref;
    }
    var import_jsx_runtime4 = require2("react/jsx-runtime");
    var variantClasses = {
      default: "bg-text-base text-white shadow-sm hover:bg-black",
      secondary: "bg-gray-100 text-text-base hover:bg-gray-200",
      outline: "border border-border-theme bg-white text-text-base shadow-sm hover:bg-gray-50",
      ghost: "text-text-secondary hover:bg-gray-100 hover:text-text-base",
      destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700"
    };
    var sizeClasses = {
      default: "h-9 px-3.5 py-2 text-[13px]",
      sm: "h-8 px-3 text-[12px]",
      icon: "h-9 w-9 p-0"
    };
    var Button = React.forwardRef(
      ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => {
        const pressRef = useSpringPress(ref);
        return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            ref: pressRef,
            type,
            className: cn(
              "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-45",
              variantClasses[variant],
              sizeClasses[size],
              className
            ),
            ...props
          }
        );
      }
    );
    Button.displayName = "Button";
    function formatTokens(value) {
      const n = Math.max(0, Math.round(value));
      if (n < 1e3) return `${n}`;
      if (n < 999500) return `${formatUnit(n / 1e3)}k`;
      return `${formatUnit(n / 1e6)}M`;
    }
    function formatUnit(value) {
      const rounded = Math.round(value * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    }
    var MOTION = {
      fast: "transition-colors duration-150",
      standard: "transition-all duration-300 ease-out",
      smooth: "transition-all duration-[400ms] ease-out"
    };
    var FLOATING_MENU = {
      panel: "floating-menu-panel ui-menu-surface",
      item: "floating-menu-item",
      shell: "floating-menu-panel rounded-2xl bg-elevated-bg p-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.10)]",
      row: "floating-menu-item flex w-full cursor-pointer items-center rounded-lg px-2 py-1.5 text-[12px] transition-colors duration-150 hover:bg-ui-tint"
    };
    var MENU_LIST = {
      block: "p-2",
      gutter: "px-1.5 py-1",
      /** 滑动药丸内缩 —— 与 shell p-1.5 叠加，行 hover 不贴边 */
      pillInset: "left-1.5 right-1.5",
      row: "w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px]",
      rowCompact: "w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px]",
      section: "px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium text-text-secondary",
      icon: "mr-2 w-3.5 shrink-0 text-[13px] text-text-secondary",
      empty: "px-2.5 py-2 text-[12px] text-text-secondary",
      search: "flex items-center text-text-secondary",
      searchInput: "w-full bg-transparent outline-none placeholder:text-text-secondary",
      /** 搜索行 —— 与项目下拉对齐：13px、充足上下留白 */
      searchBar: "flex items-center text-[13px] text-text-secondary",
      searchBarPad: "px-3 pb-2.5 pt-3",
      searchBarPadInShell: "px-2 py-2",
      /** 方案 D：内缩短线，弱化全宽 border-t */
      divider: "mx-3.5 my-1.5 h-px shrink-0 bg-border-theme opacity-[0.55]"
    };
    var import_jsx_runtime5 = require2("react/jsx-runtime");
    function capacityTone(ratio, isEmptySession) {
      if (isEmptySession) return "var(--theme-text-secondary, #6b7280)";
      if (ratio >= 0.92) return "#dc4b41";
      if (ratio >= 0.8) return "#d99015";
      return "var(--theme-text-secondary, #6b7280)";
    }
    function contextOccupancyTokens(snapshot) {
      return snapshot.projected_request_tokens ?? snapshot.measured_prompt_tokens ?? snapshot.estimated_prompt_tokens;
    }
    function ContextCapacityIndicator({
      snapshot,
      contextWindow: capabilityContextWindow = 0,
      fallbackPromptTokens = 0,
      popoverSuppressed = false,
      overlayCloseSignal = 0,
      onPopoverOpenChange
    }) {
      const [open, setOpen] = (0, import_react6.useState)(false);
      const lastOverlayCloseSignal = (0, import_react6.useRef)(overlayCloseSignal);
      const lastReportedOpen = (0, import_react6.useRef)(false);
      const contextWindow = snapshot?.context_window ?? capabilityContextWindow;
      const hasWindow = contextWindow > 0;
      const usedTokens = snapshot ? contextOccupancyTokens(snapshot) : Math.max(0, Math.round(fallbackPromptTokens));
      const isEmptySession = !snapshot && usedTokens === 0;
      const ratio = !hasWindow ? 0 : Math.max(0, Math.min(1, usedTokens / contextWindow));
      const percent = Math.round(ratio * 100);
      const stroke = capacityTone(ratio, isEmptySession);
      const blocks = (0, import_react6.useMemo)(
        () => [...snapshot?.blocks ?? []].sort((a, b) => b.tokens - a.tokens),
        [snapshot?.blocks]
      );
      const unattributed = snapshot ? Math.max(
        0,
        contextOccupancyTokens(snapshot) - blocks.reduce((sum, block) => sum + block.tokens, 0)
      ) : 0;
      const cacheTotal = (snapshot?.cache_hit_tokens ?? 0) + (snapshot?.cache_miss_tokens ?? 0);
      const cacheRatio = snapshot?.cache_hit_ratio ?? (cacheTotal > 0 ? (snapshot?.cache_hit_tokens ?? 0) / cacheTotal : void 0);
      (0, import_react6.useEffect)(() => {
        if (popoverSuppressed && open) setOpen(false);
      }, [popoverSuppressed, open]);
      (0, import_react6.useEffect)(() => {
        if (overlayCloseSignal > lastOverlayCloseSignal.current) {
          lastOverlayCloseSignal.current = overlayCloseSignal;
          setOpen(false);
        }
      }, [overlayCloseSignal]);
      (0, import_react6.useEffect)(() => {
        if (open === lastReportedOpen.current) return;
        lastReportedOpen.current = open;
        onPopoverOpenChange?.(open);
      }, [open, onPopoverOpenChange]);
      const showPopover = open && !popoverSuppressed;
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "relative flex h-8 w-8 shrink-0 items-center justify-center", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(HoverCard, { open: showPopover, onOpenChange: (next, details) => {
        if (details.reason === "trigger-press") details.cancel();
        else if (!popoverSuppressed) setOpen(next);
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(HoverCardTrigger, { delay: 120, closeDelay: 150, render: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          Button,
          {
            variant: "ghost",
            size: "icon",
            className: `h-8 w-8 rounded-full hover:bg-ui-tint ${MOTION.fast}`,
            "aria-label": `Context ${percent}%`,
            onClick: () => {
              if (!popoverSuppressed) setOpen((value) => !value);
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "block h-4 w-4 shrink-0", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              import_react_circular_progressbar.CircularProgressbar,
              {
                value: ratio,
                maxValue: 1,
                strokeWidth: 12.5,
                className: "block h-full w-full [&_.CircularProgressbar-path]:transition-[stroke-dashoffset] [&_.CircularProgressbar-path]:duration-300 motion-reduce:[&_.CircularProgressbar-path]:transition-none",
                styles: (0, import_react_circular_progressbar.buildStyles)({
                  pathColor: stroke,
                  trailColor: "color-mix(in srgb, var(--theme-text-secondary, #6b7280) 30%, var(--theme-bg, #ffffff))",
                  strokeLinecap: "round"
                })
              }
            ) })
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(HoverCardContent, { motionTone: "menu", side: "top", align: "end", className: "w-[240px] px-3.5 py-3", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex items-baseline justify-between gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "font-semibold", children: "\u9884\u8BA1\u4E0B\u4E00\u6B21\u8BF7\u6C42" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "text-[18px] font-semibold leading-none", children: [
              percent,
              "%"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "mt-1.5 text-[13px] text-text-secondary", children: hasWindow ? `${formatTokens(usedTokens)} / ${formatTokens(contextWindow)}` : formatTokens(usedTokens) }),
          snapshot?.last_request_prompt_tokens != null && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "mt-1.5 flex justify-between gap-2 text-[12px] text-text-secondary", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "\u4E0A\u4E00\u6B21\u8BF7\u6C42" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: formatTokens(snapshot.last_request_prompt_tokens) })
          ] }),
          !!snapshot?.compaction_threshold && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "mt-1.5 flex justify-between gap-2 text-[12px] text-text-secondary", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "\u81EA\u52A8\u538B\u7F29\u9608\u503C" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: formatTokens(snapshot.compaction_threshold) })
          ] }),
          blocks.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "mt-2 space-y-1.5 border-t border-border-theme pt-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "text-[11px] text-text-tertiary", children: "\u4E0A\u4E0B\u6587\u7EC4\u6210\uFF08\u4F30\u7B97\uFF09" }),
            blocks.map((block) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex items-center justify-between gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "min-w-0 truncate text-text-secondary", children: block.name }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "shrink-0 font-medium", children: formatTokens(block.tokens) })
            ] }, `${block.kind}-${block.source}`)),
            unattributed > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "flex items-center justify-between gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "min-w-0 truncate text-text-secondary", children: "\u5176\u4ED6/\u672A\u5F52\u7C7B" }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "shrink-0 font-medium", children: formatTokens(unattributed) })
            ] })
          ] }),
          (cacheRatio != null || snapshot?.cache_hit_tokens) && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "mt-2 flex items-center justify-between border-t border-border-theme pt-2 text-text-secondary", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "\u4E0A\u6B21\u7F13\u5B58\u547D\u4E2D" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "font-medium text-text-base", children: cacheRatio == null ? formatTokens(snapshot?.cache_hit_tokens ?? 0) : `${Math.round(cacheRatio * 100)}%` })
          ] })
        ] })
      ] }) });
    }
    var import_react9 = require2("react");
    var import_react7 = require2("react");
    var import_jsx_runtime6 = require2("react/jsx-runtime");
    var Panel = (0, import_react7.forwardRef)(
      function Panel2({ className, menu = true, ...rest }, ref) {
        return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "div",
          {
            ref,
            className: cn(
              "rounded-2xl bg-elevated-bg shadow-[0_6px_24px_rgba(0,0,0,0.10)]",
              menu && FLOATING_MENU.panel,
              className
            ),
            ...rest
          }
        );
      }
    );
    var import_react8 = require2("react");
    var import_gsap4 = __toESM(require2("gsap"));
    var import_jsx_runtime7 = require2("react/jsx-runtime");
    function useSlidingIndicator({
      hoverSelector,
      activeSelector,
      followFocus = false
    }) {
      const containerRef = (0, import_react8.useRef)(null);
      const hoveredRef = (0, import_react8.useRef)(null);
      const focusedRef = (0, import_react8.useRef)(null);
      const [pill, setPill] = (0, import_react8.useState)(null);
      const [settled, setSettled] = (0, import_react8.useState)(false);
      (0, import_react8.useEffect)(() => {
        const t2 = window.setTimeout(() => setSettled(true), 0);
        return () => clearTimeout(t2);
      }, []);
      const positionPillOn = (0, import_react8.useCallback)((el) => {
        if (!(el instanceof HTMLElement)) return;
        const container = containerRef.current;
        if (!container) return;
        setPill({
          top: el.offsetTop + container.scrollTop,
          height: el.offsetHeight
        });
      }, []);
      const positionOnActive = (0, import_react8.useCallback)(() => {
        const c = containerRef.current;
        if (!c) return;
        const el = c.querySelector(activeSelector);
        if (!el) {
          setPill(null);
          return;
        }
        positionPillOn(el);
      }, [activeSelector, positionPillOn]);
      const repositionPill = (0, import_react8.useCallback)(() => {
        const target2 = hoveredRef.current ?? focusedRef.current;
        if (target2) {
          positionPillOn(target2);
        } else {
          positionOnActive();
        }
      }, [positionOnActive, positionPillOn]);
      (0, import_react8.useLayoutEffect)(() => {
        if (followFocus) repositionPill();
        else positionOnActive();
      }, [followFocus, positionOnActive, repositionPill]);
      (0, import_react8.useEffect)(() => {
        const container = containerRef.current;
        if (!container) return;
        const ro = new ResizeObserver(() => repositionPill());
        ro.observe(container);
        return () => ro.disconnect();
      }, [repositionPill]);
      const handleMouseOver = (0, import_react8.useCallback)(
        (e) => {
          const btn = e.target.closest(hoverSelector);
          if (btn) {
            hoveredRef.current = btn;
            positionPillOn(btn);
          }
        },
        [hoverSelector, positionPillOn]
      );
      const handleMouseLeave = (0, import_react8.useCallback)(() => {
        hoveredRef.current = null;
        repositionPill();
      }, [repositionPill]);
      const handleFocus = (0, import_react8.useCallback)((event) => {
        const target2 = event.target.closest(hoverSelector);
        focusedRef.current = target2?.matches(":focus-visible") ? target2 : null;
        if (focusedRef.current) hoveredRef.current = null;
        repositionPill();
      }, [hoverSelector, repositionPill]);
      const handleBlur = (0, import_react8.useCallback)((event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusedRef.current = null;
          repositionPill();
        }
      }, [repositionPill]);
      return {
        containerRef,
        containerProps: {
          onMouseOver: handleMouseOver,
          onMouseLeave: handleMouseLeave,
          onFocusCapture: followFocus ? handleFocus : void 0,
          onBlurCapture: followFocus ? handleBlur : void 0
        },
        indicatorStyle: {
          top: pill?.top ?? 0,
          height: pill?.height ?? 0,
          opacity: pill ? 1 : 0,
          /* 首帧无过渡（直接显示最终形态），settled 后走 class 的 transition-all */
          transition: settled ? void 0 : "none"
        }
      };
    }
    var PILL_BASE = `ui-hover-highlight absolute left-3 right-3 z-0 rounded-md pointer-events-none ${MOTION.standard}`;
    function createPillMotion(node, motion) {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const context = import_gsap4.default.context(() => {
      }, node);
      let target2 = { top: 0, height: 0, visible: false, immediate: true };
      const paint = () => context.add(() => {
        import_gsap4.default.killTweensOf(node);
        if (media.matches || target2.immediate) {
          import_gsap4.default.set(node, { y: target2.top, height: target2.height, opacity: target2.visible ? 1 : 0 });
        } else if (!target2.visible) {
          import_gsap4.default.to(node, { opacity: 0, duration: motion.exitDuration, overwrite: true });
        } else if (Number(import_gsap4.default.getProperty(node, "opacity")) <= 0.01) {
          import_gsap4.default.set(node, { y: target2.top, height: target2.height, opacity: 0 });
          import_gsap4.default.to(node, { opacity: 1, duration: motion.enterDuration, overwrite: true });
        } else {
          import_gsap4.default.to(node, {
            y: target2.top,
            height: target2.height,
            opacity: 1,
            duration: motion.duration,
            ease: motion.ease,
            overwrite: true
          });
        }
      });
      const reduce = () => {
        import_gsap4.default.killTweensOf(node);
        context.add(() => import_gsap4.default.set(node, { y: target2.top, height: target2.height, opacity: target2.visible ? 1 : 0 }));
      };
      media.addEventListener("change", reduce);
      return {
        moveTo(next) {
          target2 = next;
          paint();
        },
        dispose() {
          media.removeEventListener("change", reduce);
          context.revert();
        }
      };
    }
    function SlidingPill({ style, className, motion }) {
      const nodeRef = (0, import_react8.useRef)(null);
      const controller = (0, import_react8.useRef)(null);
      (0, import_react8.useLayoutEffect)(() => {
        if (!motion || !nodeRef.current) return;
        const instance = createPillMotion(nodeRef.current, motion);
        controller.current = instance;
        return () => {
          instance.dispose();
          controller.current = null;
        };
      }, [motion]);
      (0, import_react8.useLayoutEffect)(() => {
        controller.current?.moveTo({
          top: Number(style.top ?? 0),
          height: Number(style.height ?? 0),
          visible: Number(style.opacity ?? 0) > 0,
          immediate: style.transition === "none"
        });
      }, [motion, style.top, style.height, style.opacity, style.transition]);
      const hasBgClass = Boolean(className && /\bbg-/.test(className));
      const { top: _top, height: _height, opacity: _opacity, ...rest } = style;
      return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "div",
        {
          ref: nodeRef,
          "aria-hidden": true,
          className: cn(PILL_BASE, !hasBgClass && "bg-ui-tint", className, motion && "transition-none"),
          style: motion ? { ...rest, top: 0, transition: "none", willChange: "transform" } : style
        }
      );
    }
    var import_jsx_runtime8 = require2("react/jsx-runtime");
    var MENU_ITEM_ATTR = "data-menu-item";
    function SlidingMenuList({
      activeId,
      pillClassName,
      className,
      children,
      ...rest
    }) {
      const { containerRef, containerProps, indicatorStyle } = useSlidingIndicator({
        hoverSelector: `[${MENU_ITEM_ATTR}]`,
        activeSelector: `[${MENU_ITEM_ATTR}="${activeId}"]`
      });
      return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { ref: containerRef, ...containerProps, className: cn("relative w-full overflow-hidden", className), ...rest, children: [
        children,
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          SlidingPill,
          {
            className: cn("rounded-lg", MENU_LIST.pillInset, pillClassName),
            style: indicatorStyle
          }
        )
      ] });
    }
    var import_jsx_runtime9 = require2("react/jsx-runtime");
    function ComposerSuggestPanel({
      id,
      open,
      sections,
      selectedIndex,
      getKey,
      renderItem,
      renderTooltip,
      onSelect,
      onHover,
      className = ""
    }) {
      const panelRef = (0, import_react9.useRef)(null);
      const scrollRef = (0, import_react9.useRef)(null);
      const activeId = (0, import_react9.useMemo)(() => {
        let index = 0;
        for (const section of sections) {
          for (const item of section.items) {
            if (index === selectedIndex) return getKey(item);
            index += 1;
          }
        }
        return "";
      }, [sections, selectedIndex, getKey]);
      (0, import_react9.useLayoutEffect)(() => {
        const panel = panelRef.current;
        const anchor = panel?.parentElement;
        if (!open || !panel || !anchor) return;
        const resize = () => {
          const top = anchor.closest(".app-main-surface")?.getBoundingClientRect().top ?? 0;
          const available = Math.max(0, anchor.getBoundingClientRect().top - Math.max(0, top) - 28);
          panel.style.setProperty("--suggest-list-height", `${Math.min(320, available)}px`);
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(anchor);
        window.addEventListener("resize", resize);
        return () => {
          observer.disconnect();
          window.removeEventListener("resize", resize);
        };
      }, [open]);
      (0, import_react9.useLayoutEffect)(() => {
        const scroll = scrollRef.current;
        const selected = scroll?.querySelector('[aria-selected="true"]');
        if (!open || !scroll || !selected) return;
        const bounds = scroll.getBoundingClientRect(), row = selected.getBoundingClientRect();
        if (row.top < bounds.top) scroll.scrollTop -= bounds.top - row.top;
        else if (row.bottom > bounds.bottom) scroll.scrollTop += row.bottom - bounds.bottom;
      }, [open, activeId]);
      if (!open) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_jsx_runtime9.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        Panel,
        {
          ref: panelRef,
          "data-composer-suggest": true,
          className: `absolute inset-x-0 bottom-full z-50 mb-2 w-auto overflow-hidden p-1.5 ${className}`,
          children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { ref: scrollRef, className: "composer-suggest-scroll custom-scrollbar max-h-[var(--suggest-list-height,240px)] overflow-y-auto overscroll-contain", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(SlidingMenuList, { id, role: "listbox", "aria-label": sections.map((section) => section.label).join("\u3001"), activeId, pillClassName: "left-0 right-0", children: sections.map((section, sectionIndex) => {
            let baseIndex = 0;
            for (let i = 0; i < sectionIndex; i += 1) {
              baseIndex += sections[i].items.length;
            }
            return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: sectionIndex > 0 ? "mt-1" : "", children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "px-2 py-1.5 text-[12px] font-medium text-text-secondary", children: section.label }),
              section.items.map((item, index) => {
                const flatIndex = baseIndex + index;
                const selected = flatIndex === selectedIndex;
                const itemKey = getKey(item);
                const button = /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  "button",
                  {
                    type: "button",
                    role: "option",
                    id: `${id}-option-${flatIndex}`,
                    "aria-selected": selected,
                    tabIndex: -1,
                    ...{ [MENU_ITEM_ATTR]: itemKey },
                    onMouseDown: (event) => {
                      event.preventDefault();
                      onSelect(item);
                    },
                    onMouseEnter: () => onHover(flatIndex),
                    className: "relative z-[1] w-full text-left",
                    children: renderItem(item, selected)
                  },
                  itemKey
                );
                return renderTooltip ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(HoverInfo, { content: renderTooltip(item), children: button }, itemKey) : button;
              })
            ] }, section.key);
          }) }) })
        }
      ) });
    }
    var import_react13 = require2("react");
    var import_lucide_react = require2("deep-agent-lucide");
    var import_react10 = require2("react");
    var React2 = __toESM(require2("react"));
    var SliderPrimitive = __toESM(require2("@radix-ui/react-slider"));
    var import_jsx_runtime10 = require2("react/jsx-runtime");
    var Slider = React2.forwardRef(({ className, appearance = "default", children, thumbProps, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
      SliderPrimitive.Root,
      {
        ref,
        className: cn("relative flex w-full touch-none select-none items-center", appearance === "effort" && "reasoning-effort-input", className),
        ...props,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(SliderPrimitive.Track, { className: appearance === "effort" ? "reasoning-effort-track" : "relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/10", children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(SliderPrimitive.Range, { className: appearance === "effort" ? "sr-only" : "absolute h-full bg-white/80" }),
            children
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            SliderPrimitive.Thumb,
            {
              ...thumbProps,
              className: appearance === "effort" ? "reasoning-effort-input-thumb" : cn(
                "block h-3.5 w-3.5 rounded-full border border-white/40 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition-transform",
                "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                "disabled:pointer-events-none disabled:opacity-50"
              )
            }
          )
        ]
      }
    ));
    Slider.displayName = SliderPrimitive.Root.displayName;
    var import_gsap5 = require2("gsap");
    function createEffortField(canvas, getRatio) {
      const ctx = canvas.getContext("2d");
      let width = 0;
      let height = 0;
      let phase = 0;
      let lastTime = 0;
      const stars = Array.from({ length: 64 }, (_, i) => ({
        x: i * 0.61803398875 % 1,
        y: i * 0.754877666 % 1,
        size: 0.35 + i % 5 * 0.13,
        speed: 0.3 + i % 7 * 0.1
      }));
      const resize = () => {
        width = canvas.clientWidth;
        height = canvas.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      const draw = (time = 0, still = false, motionBoost = 1) => {
        if (!ctx || width <= 0 || height <= 0) return;
        const ratio = getRatio();
        if (!still) phase += Math.min(Math.max(time - lastTime, 0), 0.05) * (0.16 + ratio * 0.85) * Math.max(1, motionBoost);
        lastTime = time;
        const hue = 210 + ratio * ratio * 63;
        const fill = 32 + (width - 32) * ratio;
        ctx.clearRect(0, 0, width, height);
        const base = ctx.createLinearGradient(0, 0, Math.max(fill, 32), 0);
        base.addColorStop(0, "#30343a");
        base.addColorStop(0.28, `hsl(${hue - 12} 38% 47%)`);
        base.addColorStop(0.65, `hsl(${hue} 79% 70%)`);
        base.addColorStop(1, `hsl(${hue + 5} 88% 70%)`);
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, width, height);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        for (let band = 0; band < 7; band++) {
          ctx.beginPath();
          for (let x = 0; x <= width + 4; x += 4) {
            const y = height * (0.12 + band * 0.15) + Math.sin(x * 0.034 + phase + band * 1.8) * 5 + Math.sin(x * 0.079 - phase * 0.6 + band) * 2 - x * 0.035;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.lineWidth = 2 + band % 3 * 2;
          ctx.strokeStyle = `hsla(${hue + band * 2} 90% 87% / ${0.06 + ratio * 0.025})`;
          ctx.stroke();
        }
        const glowX = fill * (0.6 + Math.sin(phase * 0.7) * 0.12);
        const glow = ctx.createRadialGradient(glowX, height * 0.7, 0, glowX, height * 0.7, 46);
        glow.addColorStop(0, `hsla(${hue - 12} 100% 88% / .35)`);
        glow.addColorStop(1, `hsla(${hue} 100% 80% / 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
        for (const [i, star] of stars.entries()) {
          const x = (star.x + phase * star.speed * 0.08) % 1 * width;
          const y = ((star.y - phase * star.speed * 0.04) % 1 + 1) % 1 * height;
          const fade = Math.min(1, x / 55);
          const twinkle = 0.45 + Math.sin(phase * 2 + i * 1.9) * 0.25;
          ctx.fillStyle = `rgba(255,255,255,${fade * twinkle * (0.4 + ratio * 0.6)})`;
          ctx.beginPath();
          ctx.ellipse(x, y, star.size * (1 + ratio * 0.5), star.size * 0.65, -0.45, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        const shade = ctx.createLinearGradient(0, 0, Math.max(fill, 32), 0);
        shade.addColorStop(0, "rgba(36,39,44,.8)");
        shade.addColorStop(0.45, "rgba(36,39,44,0)");
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, width, height);
      };
      const observer = new ResizeObserver(() => {
        resize();
        draw(lastTime, true);
      });
      observer.observe(canvas);
      resize();
      return { draw, dispose: () => observer.disconnect() };
    }
    var SPRING = [
      [0, 0],
      [0.02, 0.015],
      [0.04, 0.0532],
      [0.06, 0.1065],
      [0.08, 0.1686],
      [0.1, 0.2351],
      [0.13, 0.3363],
      [0.16, 0.4332],
      [0.2, 0.5495],
      [0.24, 0.648],
      [0.28, 0.7287],
      [0.33, 0.807],
      [0.38, 0.8646],
      [0.44, 0.9128],
      [0.5, 0.9447],
      [0.57, 0.968],
      [0.65, 0.9834],
      [0.74, 0.9924],
      [0.85, 0.9975],
      [1, 1]
    ];
    function glideEase(progress) {
      const end = SPRING.findIndex(([x]) => x >= progress);
      if (end <= 0) return end === 0 ? 0 : 1;
      const [x0, y0] = SPRING[end - 1];
      const [x1, y1] = SPRING[end];
      return y0 + (y1 - y0) * (progress - x0) / (x1 - x0);
    }
    var returnEase = springEase(400, 23, 0.72);
    function createEffortMotion(root2, canvas, initialRatio, initialReducedMotion) {
      const state = { ratio: initialRatio, press: 1, body: 0, lean: 0, boost: 1 };
      let targetRatio = initialRatio;
      let reduced = initialReducedMotion;
      let attached = false;
      let disposed = false;
      let positionTween;
      let pressTween;
      let shapeTween;
      let boostTween;
      const field = createEffortField(canvas, () => state.ratio);
      const variables = () => ({
        "--effort-ratio": String(state.ratio),
        "--effort-press": String(state.press),
        "--effort-jelly-x": String(1 + state.body),
        "--effort-jelly-y": String(1 - state.body * 0.3),
        "--effort-jelly-offset": `${-state.lean * 9}px`,
        "--effort-jelly-skew": `${-state.lean * 12}deg`,
        "--effort-jelly-left": `${50 + state.lean * 32}%`,
        "--effort-jelly-right": `${50 - state.lean * 24}%`
      });
      const context = import_gsap5.gsap.context(() => {
        import_gsap5.gsap.set(root2, variables());
      }, root2);
      const paint = () => {
        if (disposed) return;
        for (const [name, value] of Object.entries(variables())) root2.style.setProperty(name, value);
        if (reduced) field.draw(import_gsap5.gsap.ticker.time, true);
      };
      const draw = (time) => {
        if (!document.hidden) field.draw(time, false, state.boost);
      };
      const syncTicker = () => {
        if (attached) import_gsap5.gsap.ticker.remove(draw);
        attached = !reduced;
        field.draw(import_gsap5.gsap.ticker.time, true);
        if (attached) import_gsap5.gsap.ticker.add(draw);
      };
      const stopTweens = () => {
        positionTween?.kill();
        pressTween?.kill();
        shapeTween?.kill();
        boostTween?.kill();
      };
      syncTicker();
      return {
        moveTo(ratio, immediate) {
          targetRatio = Math.max(0, Math.min(1, ratio));
          positionTween?.kill();
          positionTween = import_gsap5.gsap.to(state, {
            ratio: targetRatio,
            duration: immediate || reduced ? 0 : 0.5,
            ease: glideEase,
            onUpdate: paint
          });
        },
        press() {
          pressTween?.kill();
          pressTween = import_gsap5.gsap.to(state, { press: reduced ? 1 : 0.96, duration: reduced ? 0 : 0.08, onUpdate: paint });
        },
        drag(velocity) {
          if (reduced || disposed) return;
          const speed = Math.min(3.5, Math.abs(velocity));
          const deformation = Math.min(0.46, 0.045 + speed * 0.17);
          const lean = Math.sign(velocity) * deformation;
          shapeTween?.kill();
          shapeTween = import_gsap5.gsap.timeline({ onUpdate: paint }).to(state, { body: deformation, lean, duration: 0.09, ease: "power2.out" }).to(state, { body: 0, lean: 0, duration: 0.72, ease: returnEase }, ">0.07");
          boostTween?.kill();
          boostTween = import_gsap5.gsap.to(state, {
            boost: 1 + Math.min(2.2, 0.55 + speed * 0.6),
            duration: 0.12,
            ease: "power2.out"
          });
        },
        release() {
          pressTween?.kill();
          shapeTween?.kill();
          boostTween?.kill();
          pressTween = import_gsap5.gsap.to(state, { press: 1, duration: reduced ? 0 : 0.32, ease: "power2.out", onUpdate: paint });
          shapeTween = import_gsap5.gsap.to(state, {
            body: 0,
            lean: 0,
            duration: reduced ? 0 : 0.72,
            ease: returnEase,
            onUpdate: paint
          });
          boostTween = import_gsap5.gsap.to(state, { boost: 1, duration: reduced ? 0 : 0.7, ease: "power2.out" });
        },
        setReducedMotion(next) {
          if (next === reduced) return;
          reduced = next;
          stopTweens();
          Object.assign(state, { ratio: targetRatio, press: 1, body: 0, lean: 0, boost: 1 });
          paint();
          syncTicker();
        },
        dispose() {
          disposed = true;
          stopTweens();
          import_gsap5.gsap.ticker.remove(draw);
          field.dispose();
          context.revert();
        }
      };
    }
    var import_jsx_runtime11 = require2("react/jsx-runtime");
    function EffortSlider({ stops: stops2, value, onChange, ariaLabel, disabled }) {
      const [reducedMotion, setReducedMotion] = (0, import_react10.useState)(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      const active = Math.max(0, stops2.findIndex((stop) => stop.value === value));
      const max = Math.max(0, stops2.length - 1);
      const [preview, setPreview] = (0, import_react10.useState)(active);
      const [dragging, setDragging] = (0, import_react10.useState)(false);
      const previewRef = (0, import_react10.useRef)(active);
      const draggingRef = (0, import_react10.useRef)(false);
      const gesture = (0, import_react10.useRef)(null);
      const rootRef = (0, import_react10.useRef)(null);
      const canvasRef = (0, import_react10.useRef)(null);
      const motion = (0, import_react10.useRef)(null);
      const selected = Math.min(max, Math.max(0, Math.round(preview)));
      const ratio = max ? preview / max : 0;
      const updatePreview = (next) => {
        previewRef.current = Math.max(0, Math.min(max, next));
        setPreview(previewRef.current);
      };
      const commit = (next) => {
        const index = Math.max(0, Math.min(max, Math.round(next)));
        updatePreview(index);
        if (stops2[index] && stops2[index].value !== value) onChange(stops2[index].value);
      };
      const cancel = () => {
        draggingRef.current = false;
        gesture.current = null;
        setDragging(false);
        updatePreview(active);
        motion.current?.release();
      };
      (0, import_react10.useEffect)(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => setReducedMotion(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
      }, []);
      (0, import_react10.useEffect)(() => {
        if (!draggingRef.current) {
          previewRef.current = active;
          setPreview(active);
        }
      }, [active]);
      (0, import_react10.useLayoutEffect)(() => {
        const root2 = rootRef.current;
        const canvas = canvasRef.current;
        if (!root2 || !canvas) return;
        const controller = createEffortMotion(root2, canvas, ratio, reducedMotion);
        motion.current = controller;
        return () => {
          controller.dispose();
          motion.current = null;
        };
      }, []);
      (0, import_react10.useLayoutEffect)(() => {
        motion.current?.moveTo(ratio, dragging);
      }, [ratio, dragging]);
      (0, import_react10.useLayoutEffect)(() => {
        motion.current?.setReducedMotion(reducedMotion);
      }, [reducedMotion]);
      return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
        "div",
        {
          ref: rootRef,
          className: "reasoning-effort",
          "data-dragging": dragging || void 0,
          "data-maximum": selected === max || void 0,
          "data-disabled": disabled || void 0,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
              Slider,
              {
                appearance: "effort",
                min: 0,
                max: Math.max(1, max),
                step: 1e-3,
                value: [preview],
                disabled: disabled || max === 0,
                thumbProps: { "aria-label": ariaLabel, "aria-valuenow": selected, "aria-valuetext": stops2[selected]?.label },
                onValueChange: ([next]) => updatePreview(next),
                onValueCommit: ([next]) => commit(next),
                onPointerDown: (event) => {
                  if (!event.isPrimary || event.button !== 0) event.preventDefault();
                },
                onPointerDownCapture: (event) => {
                  if (disabled || max === 0 || !event.isPrimary || event.button !== 0) return;
                  gesture.current = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, time: event.timeStamp, moved: false };
                  motion.current?.press();
                },
                onPointerMoveCapture: (event) => {
                  const current = gesture.current;
                  if (!current || event.pointerId !== current.id) return;
                  if (!current.moved && Math.abs(event.clientX - current.startX) < 4) return;
                  current.moved = true;
                  draggingRef.current = true;
                  setDragging(true);
                  const velocity = (event.clientX - current.lastX) / Math.max(8, event.timeStamp - current.time);
                  motion.current?.drag(velocity);
                  current.lastX = event.clientX;
                  current.time = event.timeStamp;
                },
                onPointerUpCapture: (event) => {
                  if (event.pointerId !== gesture.current?.id) return;
                  gesture.current = null;
                  draggingRef.current = false;
                  setDragging(false);
                  updatePreview(Math.round(previewRef.current));
                  motion.current?.release();
                },
                onPointerCancel: cancel,
                onLostPointerCapture: () => {
                  if (gesture.current) cancel();
                },
                onKeyDownCapture: (event) => {
                  let next = selected;
                  if (["ArrowRight", "ArrowUp", "PageUp"].includes(event.key)) next++;
                  else if (["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key)) next--;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = max;
                  else return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (!disabled) commit(next);
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "reasoning-effort-fill", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("canvas", { ref: canvasRef }) }),
                  /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "reasoning-effort-dots", "aria-hidden": "true", children: stops2.map((stop) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", {}, stop.value)) }),
                  /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "reasoning-effort-thumb", "aria-hidden": "true" })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "reasoning-effort-stops", children: stops2.map((stop, index) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
              Button,
              {
                variant: "ghost",
                size: "sm",
                disabled,
                "aria-pressed": index === selected,
                className: "h-auto rounded px-0.5 py-[3px] text-[11px] font-normal hover:bg-transparent",
                onClick: () => commit(index),
                children: stop.label
              },
              stop.value
            )) })
          ]
        }
      );
    }
    var import_jsx_runtime12 = require2("react/jsx-runtime");
    function ListItem({
      selected = false,
      sliding = false,
      title,
      className,
      ...rest
    }) {
      return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(HoverInfo, { content: title, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
        "div",
        {
          className: cn(
            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[12px]",
            !sliding && FLOATING_MENU.item,
            MOTION.fast,
            sliding ? "relative z-[1]" : selected ? "bg-ui-tint font-medium" : "hover:bg-ui-tint",
            sliding && selected && "font-medium text-text-base",
            className
          ),
          ...rest
        }
      ) });
    }
    var import_react11 = require2("react");
    var import_jsx_runtime13 = require2("react/jsx-runtime");
    var TintButton = (0, import_react11.forwardRef)(function TintButton2({
      variant = "default",
      className,
      ...rest
    }, ref) {
      const pressRef = useSpringPress(ref);
      return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        "button",
        {
          ref: pressRef,
          className: cn(
            "rounded-full px-2 py-1.5 text-[12px] text-text-base",
            MOTION.fast,
            variant === "primary" ? "bg-primary text-white hover:bg-primary-hover" : "bg-ui-tint hover:bg-ui-tint-strong disabled:opacity-50 disabled:cursor-not-allowed",
            className
          ),
          ...rest
        }
      );
    });
    var import_react12 = require2("react");
    var import_gsap6 = __toESM(require2("gsap"));
    var import_jsx_runtime14 = require2("react/jsx-runtime");
    var OPEN_SHADOW = "0 6px 24px rgba(0,0,0,0.10)";
    var CLOSED_SHADOW = "0 0 0 rgba(0,0,0,0)";
    function MorphingMenuShell({
      open,
      onOpenChange,
      layoutId,
      trigger,
      className,
      panelClassName,
      panelShadow = OPEN_SHADOW,
      panelAlign = "left",
      panelPlacement = "above",
      zIndex = 50,
      staggerContent = false,
      unstyled = false,
      triggerLayout = "inline",
      children
    }) {
      const containerRef = (0, import_react12.useRef)(null);
      const anchorRef = (0, import_react12.useRef)(null);
      const shellRef = (0, import_react12.useRef)(null);
      const compactRef = (0, import_react12.useRef)(null);
      const panelRef = (0, import_react12.useRef)(null);
      const contentRef = (0, import_react12.useRef)(null);
      const previousOpen = (0, import_react12.useRef)();
      const latest = (0, import_react12.useRef)({ open, onOpenChange });
      latest.current = { open, onOpenChange };
      const [present, setPresent] = (0, import_react12.useState)(open);
      const [layoutAnimating, setLayoutAnimating] = (0, import_react12.useState)(false);
      const showPanel = open || present;
      (0, import_react12.useEffect)(() => {
        if (!open) return;
        const outside = (event) => {
          if (!containerRef.current?.contains(event.target)) latest.current.onOpenChange(false);
        };
        const escape = (event) => {
          if (event.key === "Escape") latest.current.onOpenChange(false);
        };
        document.addEventListener("mousedown", outside);
        document.addEventListener("keydown", escape);
        return () => {
          document.removeEventListener("mousedown", outside);
          document.removeEventListener("keydown", escape);
        };
      }, [open]);
      (0, import_react12.useLayoutEffect)(() => {
        const shell = shellRef.current, anchor = anchorRef.current, compact = compactRef.current;
        const panel = panelRef.current, content = contentRef.current;
        if (!shell || !anchor || !compact) return;
        const first = previousOpen.current === void 0;
        previousOpen.current = open;
        let disposed = false;
        let timeline;
        let resize;
        let restoreFocus = shell.contains(document.activeElement);
        const compactSize = () => {
          if (triggerLayout === "block") compact.style.width = `${anchor.clientWidth}px`;
          const button = compact.querySelector("button");
          const css = getComputedStyle(button ?? compact);
          const width = compact.offsetWidth, height = compact.offsetHeight;
          return {
            width,
            height,
            radius: Math.min(parseFloat(css.borderTopLeftRadius) || height / 2, height / 2),
            curvature: computedCornerCurvature(css),
            background: motionColor(css.backgroundColor)
          };
        };
        let closed = compactSize();
        const restClosed = () => {
          import_gsap6.default.set(compact, { opacity: 1, clearProps: "position,left,right,top,bottom,transform" });
          import_gsap6.default.set(shell, { clearProps: "position,left,right,top,bottom,width,height,maxWidth,overflow,borderRadius,backgroundColor,boxShadow,transform,--morph-corner-curvature" });
          anchor.style.width = "";
          anchor.style.height = "";
          if (triggerLayout === "block") compact.style.width = "100%";
        };
        compact.inert = open;
        if (panel) panel.inert = !open;
        if (!showPanel || !panel || !content) {
          restClosed();
          return;
        }
        if (open) setPresent(true);
        anchor.style.width = triggerLayout === "block" ? "100%" : `${closed.width}px`;
        anchor.style.height = `${closed.height}px`;
        if (shell.style.position !== "absolute") {
          import_gsap6.default.set(shell, {
            position: "absolute",
            width: closed.width,
            height: closed.height,
            maxWidth: "none",
            borderRadius: closed.radius,
            "--morph-corner-curvature": closed.curvature,
            backgroundColor: closed.background
          });
        }
        import_gsap6.default.set(shell, {
          left: panelAlign === "left" ? 0 : "auto",
          right: panelAlign === "right" ? 0 : "auto",
          bottom: panelPlacement === "above" ? 0 : "auto",
          top: panelPlacement === "below" ? 0 : "auto"
        });
        import_gsap6.default.set(compact, {
          position: "absolute",
          left: panelAlign === "left" ? 0 : "auto",
          right: panelAlign === "right" ? 0 : "auto",
          bottom: panelPlacement === "above" ? 0 : "auto",
          top: panelPlacement === "below" ? 0 : "auto"
        });
        const expandedSize = () => {
          panel.style.width = "";
          const scrollTop = content.scrollTop;
          content.style.maxHeight = "";
          content.style.overflowY = "";
          const width = Math.min(content.offsetWidth, window.innerWidth - 32);
          panel.style.width = `${width}px`;
          const rect = anchor.getBoundingClientRect();
          const availableHeight = panelPlacement === "above" ? rect.bottom - 16 : window.innerHeight - rect.top - 16;
          if (panel.offsetHeight > availableHeight) {
            content.style.maxHeight = `${Math.max(24, availableHeight)}px`;
            content.style.overflowY = "auto";
            content.scrollTop = scrollTop;
          }
          const left = panelAlign === "right" ? rect.right - width : rect.left;
          return {
            width,
            height: panel.offsetHeight,
            x: Math.max(16, Math.min(left, window.innerWidth - width - 16)) - left
          };
        };
        let expanded = expandedSize();
        const finish = () => {
          if (disposed || latest.current.open !== open) return;
          setLayoutAnimating(false);
          if (open) shell.style.overflow = "visible";
          else {
            restClosed();
            setPresent(false);
          }
        };
        const focus = () => {
          if (!disposed && restoreFocus && document.activeElement === document.body && latest.current.open === open) {
            (open ? panel : compact.querySelector("button"))?.focus({ preventScroll: true });
          }
        };
        const play = () => {
          timeline?.kill();
          resize?.kill();
          const reduced = prefersReducedMotion() || first && open;
          if (reduced) {
            import_gsap6.default.set(shell, {
              width: open ? expanded.width : closed.width,
              height: open ? expanded.height : closed.height,
              x: open ? expanded.x : 0,
              borderRadius: open ? continuousRadius(16) : closed.radius,
              "--morph-corner-curvature": open ? CORNER_CURVATURE : closed.curvature,
              backgroundColor: open ? motionColor(getComputedStyle(panel).backgroundColor) : closed.background,
              boxShadow: open ? panelShadow : CLOSED_SHADOW
            });
            import_gsap6.default.set(compact, { opacity: open ? 0 : 1, scale: 1 });
            import_gsap6.default.set(panel, { opacity: open ? 1 : 0, filter: "blur(0px)" });
            finish();
            focus();
            return;
          }
          setLayoutAnimating(true);
          shell.style.overflow = "hidden";
          const motion = open ? SHARE_MOTION.open : SHARE_MOTION.close;
          timeline = import_gsap6.default.timeline({ onComplete: finish });
          timeline.to(shell, {
            width: open ? expanded.width : closed.width,
            duration: motion.width.duration,
            ease: springEase(motion.width.stiffness, motion.width.damping, motion.width.duration)
          }, motion.width.delay);
          timeline.to(shell, {
            height: open ? expanded.height : closed.height,
            duration: motion.height.duration,
            ease: springEase(motion.height.stiffness, motion.height.damping, motion.height.duration)
          }, motion.height.delay);
          timeline.to(shell, {
            x: open ? expanded.x : 0,
            borderRadius: open ? continuousRadius(16) : closed.radius,
            "--morph-corner-curvature": open ? CORNER_CURVATURE : closed.curvature,
            backgroundColor: open ? motionColor(getComputedStyle(panel).backgroundColor) : closed.background,
            boxShadow: open ? panelShadow : CLOSED_SHADOW,
            duration: 0.22,
            ease: "power2.out"
          }, 0);
          timeline.to(compact, { opacity: open ? 0 : 1, duration: 0.14, ease: "power2.out" }, open ? 0 : 0.2);
          if (!open) timeline.fromTo(compact, { scale: 0.95 }, {
            scale: 1,
            duration: 0.48,
            ease: springEase(300, 21, 0.48)
          }, 0.2);
          timeline.to(panel, {
            opacity: open ? 1 : 0,
            filter: open ? "blur(0px)" : "blur(5px)",
            duration: open ? 0.24 : 0.18,
            ease: "power2.out"
          }, open ? 0.12 : 0);
          if (open && staggerContent) {
            const rows = Array.from(content.querySelectorAll("[role=menuitem], [data-menu-item]")).slice(0, 24);
            timeline.fromTo(rows, { opacity: 0, y: 6 }, {
              opacity: 1,
              y: 0,
              duration: 0.5,
              stagger: Math.min(0.025, 0.16 / Math.max(1, rows.length)),
              ease: springEase(280, 24, 0.5)
            }, 0.13);
          }
          timeline.call(focus, [], 0.36);
        };
        play();
        const retarget = () => {
          if (disposed) return;
          closed = compactSize();
          if (!latest.current.open) return;
          const next = expandedSize();
          if (Math.abs(next.width - expanded.width) < 0.5 && Math.abs(next.height - expanded.height) < 0.5 && Math.abs(next.x - expanded.x) < 0.5) return;
          const widthChanged = Math.abs(next.width - expanded.width) >= 0.5;
          expanded = next;
          resize?.kill();
          import_gsap6.default.killTweensOf(shell, widthChanged ? "width,height,x" : "height,x");
          const motion = SHARE_MOTION.resize;
          resize = import_gsap6.default.to(shell, {
            ...widthChanged ? { width: expanded.width } : {},
            x: expanded.x,
            height: expanded.height,
            duration: prefersReducedMotion() ? 0 : motion.duration,
            ease: springEase(motion.stiffness, motion.damping, motion.duration)
          });
        };
        const observer = new ResizeObserver(retarget);
        observer.observe(content);
        observer.observe(compact);
        const outsideFocus = (event) => {
          if (!shell.contains(event.target)) restoreFocus = false;
        };
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        document.addEventListener("focusin", outsideFocus);
        window.addEventListener("resize", retarget);
        media.addEventListener("change", play);
        return () => {
          disposed = true;
          timeline?.kill();
          resize?.kill();
          observer.disconnect();
          document.removeEventListener("focusin", outsideFocus);
          window.removeEventListener("resize", retarget);
          media.removeEventListener("change", play);
        };
      }, [open, showPanel, panelAlign, panelPlacement, panelShadow, triggerLayout]);
      return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { ref: containerRef, className: cn("relative", className), children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { ref: anchorRef, className: cn("relative max-w-full align-top", triggerLayout === "block" ? "flex w-full" : "inline-flex"), children: /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
        "div",
        {
          ref: shellRef,
          "data-motion-id": layoutId,
          "data-state": open ? "open" : "closed",
          "data-morph-placement": panelPlacement,
          className: cn("morph-menu-shell relative inline-flex max-w-full", triggerLayout === "block" && "w-full"),
          style: { zIndex: showPanel ? zIndex : void 0, pointerEvents: !open && present ? "none" : void 0 },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
              "div",
              {
                ref: compactRef,
                className: cn("morph-menu-compact pointer-events-auto inline-flex max-w-full", triggerLayout === "block" ? "w-full" : "w-max"),
                "aria-hidden": open,
                children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(MenuTriggerOpenContext.Provider, { value: open, children: trigger })
              }
            ),
            showPanel && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
              "div",
              {
                ref: panelRef,
                "data-morph-panel": true,
                "aria-hidden": !open,
                tabIndex: -1,
                className: "morph-menu-expanded ui-menu-surface absolute left-0 top-0 w-max max-w-[calc(100vw-32px)] rounded-2xl bg-elevated-bg",
                style: { opacity: 0, pointerEvents: open ? "auto" : "none" },
                children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(MorphPanelLayoutContext.Provider, { value: layoutAnimating, children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { ref: contentRef, className: cn("morph-menu-content max-w-[calc(100vw-32px)]", !unstyled && "bg-elevated-bg", panelClassName), children }) })
              }
            )
          ]
        }
      ) }) });
    }
    var import_jsx_runtime15 = require2("react/jsx-runtime");
    function modelLabel(id) {
      if (!id) return "";
      const raw = String(id).trim();
      const slash = raw.indexOf("/");
      // provider/model refs → show model id only (keeps pill single-line)
      if (slash > 0 && slash < raw.length - 1) return raw.slice(slash + 1);
      return raw;
    }
    var MODEL_MENU = {
      padX: "px-3",
      divider: "mx-3 my-2 h-px shrink-0 bg-border-theme opacity-[0.55]",
      section: "flex items-center py-1 text-[12px]",
      pill: "left-0 right-0 rounded-lg"
    };
    function ModelThinkingSelector({
      open,
      disabled = false,
      switching = false,
      models,
      selectedModel,
      selectedThinking,
      thinkingOptions,
      selectModelLabel,
      noModelsLabel,
      onOpenChange,
      onChooseModel,
      onChooseThinking,
      triggerClassName
    }) {
      const morphLayoutId = (0, import_react13.useId)().replace(/:/g, "");
      const selectedThinkingOption = thinkingOptions.find((option) => option.id === selectedThinking) ?? thinkingOptions[1];
      const pillModel = selectedModel ? modelLabel(selectedModel) : selectModelLabel;
      const trigger = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(HoverInfo, { content: modelLabel(selectedModel) || selectModelLabel, children: /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
        TintButton,
        {
          type: "button",
          disabled,
          onClick: () => onOpenChange(!open),
          className: cn("flex h-8 max-w-[210px] flex-shrink-0 items-center rounded-full px-3 text-xs", triggerClassName),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(selectedThinkingOption.icon, { size: 12, className: "mr-1.5 text-text-secondary" }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "min-w-0 truncate font-medium", children: pillModel }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "ml-1.5 shrink-0 text-text-secondary", children: selectedThinkingOption.label }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_lucide_react.ChevronDown, { size: 10, className: "ml-2 text-text-secondary" })
          ]
        }
      ) });
      return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
        MorphingMenuShell,
        {
          open,
          onOpenChange,
          layoutId: morphLayoutId,
          trigger,
          className: "flex h-8 min-w-0 max-w-full items-center",
          panelClassName: "w-[264px]",
          panelAlign: "right",
          zIndex: 80,
          children: /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "py-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: cn(MODEL_MENU.padX, "pb-1"), children: [
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: MODEL_MENU.section, children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "font-medium text-text-base", children: "\u6A21\u578B" }) }),
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "max-h-[96px] overflow-y-auto", children: models.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "rounded-lg px-2.5 py-2 text-[12px] text-text-secondary", children: noModelsLabel }) : /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(SlidingMenuList, { activeId: selectedModel, pillClassName: MODEL_MENU.pill, className: "w-full py-0.5", children: models.map((id) => {
                const selected = id === selectedModel;
                return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
                  ListItem,
                  {
                    ...{ [MENU_ITEM_ATTR]: id },
                    sliding: true,
                    selected,
                    onClick: switching ? void 0 : () => onChooseModel(id),
                    className: cn(
                      "cursor-pointer px-2.5 py-2 text-left",
                      selected ? "text-text-base" : "text-text-secondary"
                    ),
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "font-medium", children: modelLabel(id) }),
                      selected && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_lucide_react.Check, { size: 10, className: "ml-3 text-text-base" })
                    ]
                  },
                  id
                );
              }) }) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: MODEL_MENU.divider }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "px-3 pb-1 pt-0.5", children: [
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "mb-2.5 flex items-center text-[12px]", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: "font-medium text-text-base", children: "\u63A8\u7406\u5F3A\u5EA6" }) }),
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
                EffortSlider,
                {
                  stops: thinkingOptions.map((option) => ({
                    value: option.id,
                    label: option.label,
                    icon: option.icon
                  })),
                  value: selectedThinking,
                  onChange: (value) => onChooseThinking(value),
                  ariaLabel: "\u63A8\u7406\u5F3A\u5EA6",
                  disabled
                }
              )
            ] })
          ] })
        }
      );
    }
    var import_jsx_runtime16 = require2("react/jsx-runtime");
    function InputSurface({ className, ...rest }) {
      return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
        "div",
        {
          className: cn(
            "relative w-full rounded-[24px] bg-elevated-bg shadow-[0_6px_20px_rgba(31,38,48,0.08)]",
            MOTION.standard,
            "focus-within:shadow-[0_8px_26px_rgba(31,38,48,0.12)]",
            className
          ),
          ...rest
        }
      );
    }
    var import_react14 = require2("react");
    var import_gsap7 = __toESM(require2("gsap"));
    var MessageSendMotionContext = (0, import_react14.createContext)(null);
    var useMessageSendMotion = () => (0, import_react14.useContext)(MessageSendMotionContext);
    var import_react_fontawesome = require2("@fortawesome/react-fontawesome");
    var import_jsx_runtime17 = require2("react/jsx-runtime");
    function ComposerAttachButton({ disabled = false, disabledTitle, onClick }) {
      const { t: t2 } = useTranslation();
      return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(HoverInfo, { content: disabled ? disabledTitle : t2("composer.addMenu.hoverLabel"), children: /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(
        Button,
        {
          type: "button",
          disabled,
          "aria-label": t2("composer.addMenu.hoverLabel"),
          onClick,
          className: cn(
            "group/add flex h-8 w-8 shrink-0 items-center gap-0 overflow-hidden rounded-full bg-ui-tint p-0 text-text-secondary shadow-none",
            "hover:bg-ui-tint-strong hover:text-text-base",
            disabled && "cursor-not-allowed opacity-40"
          ),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
              "span",
              {
                className: cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center"
                ),
                children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_react_fontawesome.FontAwesomeIcon, { icon: ["fas", "plus"], className: "text-[11px]" })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
              "span",
              {
                className: cn(
                  "sr-only"
                ),
                children: t2("composer.addMenu.hoverLabel")
              }
            )
          ]
        }
      ) });
    }
    var import_react_fontawesome2 = require2("@fortawesome/react-fontawesome");
    var import_lucide_react3 = require2("deep-agent-lucide");
    var import_react18 = require2("react");
    var import_gsap10 = __toESM(require2("gsap"));
    var import_lucide_react2 = require2("deep-agent-lucide");
    var React3 = __toESM(require2("react"));
    var import_react15 = require2("react");
    var import_react_dom = require2("react-dom");
    var import_gsap8 = __toESM(require2("gsap"));
    var MODAL_ORIGIN_MOTION = {
      openBackdropDuration: 0.22,
      openPanelDuration: 0.32,
      openPanelDelay: 0.02,
      closePanelDuration: 0.2,
      closeBackdropDuration: 0.18,
      closeBackdropDelay: 0.02,
      scaleFrom: 0.96,
      openPanelEase: "power3.out",
      openBackdropEase: "power2.out",
      closePanelEase: "power2.inOut",
      closeBackdropEase: "power2.in"
    };
    function originTransformFromPanel(panel, origin) {
      const rect = panel.getBoundingClientRect();
      const originX = origin.centerX - rect.left;
      const originY = origin.centerY - rect.top;
      return `${originX}px ${originY}px`;
    }
    function modalOriginFromElement(element) {
      const rect = element.getBoundingClientRect();
      return {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      };
    }
    function playModalOriginOpen(backdrop, panel, origin) {
      const tl = import_gsap8.default.timeline();
      if (prefersReducedMotion()) {
        import_gsap8.default.set(backdrop, { autoAlpha: 1 });
        import_gsap8.default.set(panel, { autoAlpha: 1, scale: 1, clearProps: "transform,transformOrigin" });
        return tl;
      }
      const transformOrigin = origin ? originTransformFromPanel(panel, origin) : "center center";
      import_gsap8.default.set(backdrop, { autoAlpha: 0 });
      import_gsap8.default.set(panel, {
        opacity: 0,
        visibility: "visible",
        scale: MODAL_ORIGIN_MOTION.scaleFrom,
        transformOrigin
      });
      tl.to(backdrop, {
        autoAlpha: 1,
        duration: MODAL_ORIGIN_MOTION.openBackdropDuration,
        ease: MODAL_ORIGIN_MOTION.openBackdropEase
      }, 0).to(
        panel,
        {
          opacity: 1,
          scale: 1,
          duration: MODAL_ORIGIN_MOTION.openPanelDuration,
          ease: MODAL_ORIGIN_MOTION.openPanelEase
        },
        MODAL_ORIGIN_MOTION.openPanelDelay
      );
      return tl;
    }
    function playModalOriginClose(backdrop, panel, origin) {
      const tl = import_gsap8.default.timeline();
      if (prefersReducedMotion()) {
        import_gsap8.default.set([backdrop, panel], { autoAlpha: 0 });
        return tl;
      }
      const transformOrigin = origin ? originTransformFromPanel(panel, origin) : "center center";
      import_gsap8.default.set(panel, { transformOrigin });
      tl.to(
        panel,
        {
          autoAlpha: 0,
          scale: MODAL_ORIGIN_MOTION.scaleFrom,
          duration: MODAL_ORIGIN_MOTION.closePanelDuration,
          ease: MODAL_ORIGIN_MOTION.closePanelEase
        },
        0
      ).to(
        backdrop,
        {
          autoAlpha: 0,
          duration: MODAL_ORIGIN_MOTION.closeBackdropDuration,
          ease: MODAL_ORIGIN_MOTION.closeBackdropEase
        },
        MODAL_ORIGIN_MOTION.closeBackdropDelay
      );
      return tl;
    }
    var import_jsx_runtime18 = require2("react/jsx-runtime");
    function GlobalModal({
      open,
      onClose,
      children,
      origin = null,
      className,
      panelClassName,
      panelProps,
      panelRef,
      backdropClassName,
      closeOnBackdrop = true,
      closeOnEscape = true,
      zIndexClass = "z-[200]"
    }) {
      const [mounted, setMounted] = (0, import_react15.useState)(open);
      const backdropRef = (0, import_react15.useRef)(null);
      const panelElementRef = (0, import_react15.useRef)(null);
      const originRef = (0, import_react15.useRef)(origin);
      const tlRef = (0, import_react15.useRef)(null);
      const closingRef = (0, import_react15.useRef)(false);
      (0, import_react15.useEffect)(() => {
        if (open && origin) {
          originRef.current = origin;
        }
      }, [open, origin]);
      const finishClose = (0, import_react15.useCallback)(() => {
        closingRef.current = false;
        setMounted(false);
        originRef.current = null;
        onClose();
      }, [onClose]);
      const beginClose = (0, import_react15.useCallback)(() => {
        if (closingRef.current || !mounted) return;
        const backdrop = backdropRef.current;
        const panel = panelElementRef.current;
        if (!backdrop || !panel) {
          finishClose();
          return;
        }
        closingRef.current = true;
        tlRef.current?.kill();
        if (prefersReducedMotion()) {
          finishClose();
          return;
        }
        tlRef.current = playModalOriginClose(backdrop, panel, originRef.current);
        tlRef.current.eventCallback("onComplete", finishClose);
      }, [finishClose, mounted]);
      (0, import_react15.useEffect)(() => {
        if (open) {
          setMounted(true);
          closingRef.current = false;
          return;
        }
        if (mounted && !closingRef.current) {
          beginClose();
        }
      }, [beginClose, mounted, open]);
      (0, import_react15.useLayoutEffect)(() => {
        if (!mounted || !open || closingRef.current) return;
        const backdrop = backdropRef.current;
        const panel = panelElementRef.current;
        if (!backdrop || !panel) return;
        tlRef.current?.kill();
        tlRef.current = playModalOriginOpen(backdrop, panel, originRef.current);
        return () => {
          tlRef.current?.kill();
        };
      }, [mounted, open]);
      (0, import_react15.useEffect)(() => {
        if (!mounted || !closeOnEscape) return;
        const onKeyDown = (event) => {
          if (event.key === "Escape") beginClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [beginClose, closeOnEscape, mounted]);
      (0, import_react15.useEffect)(
        () => () => {
          tlRef.current?.kill();
        },
        []
      );
      if (!mounted || typeof document === "undefined") return null;
      const handleShellMouseDown = (event) => {
        if (!closeOnBackdrop || closingRef.current) return;
        if (event.target === event.currentTarget || event.target === backdropRef.current) {
          beginClose();
        }
      };
      const { onMouseDown: onPanelMouseDown, ...restPanelProps } = panelProps ?? {};
      const setPanelRef = (element) => {
        panelElementRef.current = element;
        if (typeof panelRef === "function") {
          panelRef(element);
        } else if (panelRef) {
          panelRef.current = element;
        }
      };
      return (0, import_react_dom.createPortal)(
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
          "div",
          {
            className: cn("fixed inset-0 flex items-center justify-center px-4", zIndexClass, className),
            onMouseDown: handleShellMouseDown,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
                "div",
                {
                  ref: backdropRef,
                  className: cn("absolute inset-0 bg-black/20", backdropClassName),
                  "aria-hidden": "true"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
                Panel,
                {
                  ref: setPanelRef,
                  menu: false,
                  ...restPanelProps,
                  className: cn(
                    "relative flex max-h-[88vh] w-full max-w-[620px] flex-col overflow-hidden",
                    panelClassName
                  ),
                  onMouseDown: (event) => {
                    event.stopPropagation();
                    onPanelMouseDown?.(event);
                  },
                  children
                }
              )
            ]
          }
        ),
        document.body
      );
    }
    function GlobalModalHeader({ className, ...props }) {
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: cn("flex items-start justify-between gap-4 px-6 py-5", className), ...props });
    }
    function GlobalModalFooter({ className, ...props }) {
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: cn("flex justify-end gap-2 px-6 py-4", className), ...props });
    }
    var GlobalModalTitle = (0, import_react15.forwardRef)(
      function GlobalModalTitle2({ className, ...props }, ref) {
        return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h2", { ref, className: cn("text-xl font-semibold text-text-base", className), ...props });
      }
    );
    var GlobalModalDescription = (0, import_react15.forwardRef)(function GlobalModalDescription2({ className, ...props }, ref) {
      return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { ref, className: cn("mt-1 text-[13px] leading-5 text-text-secondary", className), ...props });
    });
    var import_jsx_runtime19 = require2("react/jsx-runtime");
    var DialogContext = React3.createContext(null);
    function useDialogContext() {
      const context = React3.useContext(DialogContext);
      if (!context) {
        throw new Error("Dialog components must be used inside Dialog");
      }
      return context;
    }
    function Dialog({ open, defaultOpen = false, onOpenChange, children }) {
      const [internalOpen, setInternalOpen] = React3.useState(defaultOpen);
      const [origin, setOrigin] = React3.useState(null);
      const controlled = typeof open === "boolean";
      const actualOpen = controlled ? open : internalOpen;
      const setOpen = React3.useCallback(
        (next) => {
          if (!controlled) setInternalOpen(next);
          onOpenChange?.(next);
        },
        [controlled, onOpenChange]
      );
      return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(DialogContext.Provider, { value: { open: actualOpen, setOpen, origin, setOrigin }, children });
    }
    var DialogTrigger = React3.forwardRef(
      ({ asChild: _asChild, onClick, ...props }, ref) => {
        const { setOpen, setOrigin } = useDialogContext();
        return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
          "button",
          {
            ref,
            type: "button",
            onClick: (event) => {
              onClick?.(event);
              if (!event.defaultPrevented) {
                setOrigin(modalOriginFromElement(event.currentTarget));
                setOpen(true);
              }
            },
            ...props
          }
        );
      }
    );
    DialogTrigger.displayName = "DialogTrigger";
    var DialogOverlay = React3.forwardRef(
      ({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { ref, className: cn("hidden", className), ...props })
    );
    DialogOverlay.displayName = "DialogOverlay";
    var DialogContent = React3.forwardRef(
      ({ className, children, zIndexClass, backdropClassName, ...props }, ref) => {
        const { open, setOpen, origin } = useDialogContext();
        return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
          GlobalModal,
          {
            open,
            origin,
            onClose: () => setOpen(false),
            zIndexClass,
            backdropClassName,
            panelClassName: className,
            panelProps: { role: "dialog", "aria-modal": true, ...props },
            panelRef: ref,
            children
          }
        );
      }
    );
    DialogContent.displayName = "DialogContent";
    var DialogHeader = ({ className, ...props }) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(GlobalModalHeader, { className, ...props });
    DialogHeader.displayName = "DialogHeader";
    var DialogFooter = ({ className, ...props }) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(GlobalModalFooter, { className, ...props });
    DialogFooter.displayName = "DialogFooter";
    var DialogTitle = React3.forwardRef(
      ({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(GlobalModalTitle, { ref, className, ...props })
    );
    DialogTitle.displayName = "DialogTitle";
    var DialogDescription = React3.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(GlobalModalDescription, { ref, className, ...props }));
    DialogDescription.displayName = "DialogDescription";
    var DialogClose = React3.forwardRef(
      ({ asChild: _asChild, onClick, ...props }, ref) => {
        const { setOpen } = useDialogContext();
        return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
          "button",
          {
            ref,
            type: "button",
            onClick: (event) => {
              onClick?.(event);
              if (!event.defaultPrevented) setOpen(false);
            },
            ...props
          }
        );
      }
    );
    DialogClose.displayName = "DialogClose";
    var DialogCloseIcon = React3.forwardRef(
      ({ className, children, onClick, ...props }, ref) => {
        const { setOpen } = useDialogContext();
        return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
          "button",
          {
            ref,
            type: "button",
            className: cn(
              "flex h-8 w-8 flex-shrink-0 appearance-none items-center justify-center rounded-md border-0 bg-transparent text-text-secondary",
              MOTION.fast,
              "hover:bg-ui-tint-strong hover:text-text-base active:bg-ui-tint-strong",
              className
            ),
            onClick: (event) => {
              onClick?.(event);
              if (!event.defaultPrevented) setOpen(false);
            },
            ...props,
            children
          }
        );
      }
    );
    DialogCloseIcon.displayName = "DialogCloseIcon";
    var import_jsx_runtime20 = require2("react/jsx-runtime");
    function ImagePreviewTrigger({
      src,
      alt,
      triggerClassName,
      imageClassName
    }) {
      const { t: t2 } = useTranslation();
      const label = alt.trim() ? t2("composer.attachments.previewNamedImage", { name: alt }) : t2("composer.attachments.previewImage");
      return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(Dialog, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(
          DialogTrigger,
          {
            "aria-label": label,
            "aria-haspopup": "dialog",
            onClick: (event) => event.stopPropagation(),
            className: cn(
              "group/image-preview relative inline-flex shrink-0 cursor-zoom-in overflow-hidden border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              triggerClassName
            ),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("img", { src, alt, className: imageClassName }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
                "span",
                {
                  "aria-hidden": "true",
                  className: "pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover/image-preview:bg-black/10"
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
          DialogContent,
          {
            "aria-label": label,
            backdropClassName: "!bg-black/85",
            className: "!h-fit !max-h-none !w-fit !max-w-none !overflow-visible !rounded-none !bg-transparent !shadow-none",
            children: /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "relative flex items-center justify-center", children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
                "img",
                {
                  src,
                  alt,
                  className: "block max-h-[min(75dvh,760px)] max-w-[min(80vw,1120px)] rounded-lg object-contain shadow-2xl"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
                DialogCloseIcon,
                {
                  "aria-label": t2("composer.attachments.closePreview"),
                  className: "absolute right-3 top-3 z-10 h-9 w-9 rounded-full bg-black/55 text-white hover:bg-black/75 hover:text-white",
                  children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_lucide_react2.X, { "aria-hidden": "true", className: "h-5 w-5" })
                }
              )
            ] })
          }
        )
      ] });
    }
    var import_react16 = require2("react");
    var import_jsx_runtime21 = require2("react/jsx-runtime");
    var IconButton = (0, import_react16.forwardRef)(
      function IconButton2({ className, ...rest }, ref) {
        const pressRef = useSpringPress(ref);
        return /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
          "button",
          {
            ref: pressRef,
            className: cn(
              "ui-circle-icon-btn flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-text-secondary",
              MOTION.fast,
              "hover:bg-ui-tint hover:text-text-base",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
              className
            ),
            ...rest
          }
        );
      }
    );
    var import_react17 = require2("react");
    var import_gsap9 = __toESM(require2("gsap"));
    var import_jsx_runtime22 = require2("react/jsx-runtime");
    function SpringDisclosure({
      open,
      children,
      className,
      axis = "height",
      size,
      unmountOnExit = false,
      animateOnMount = false
    }) {
      const shellRef = (0, import_react17.useRef)(null);
      const bodyRef = (0, import_react17.useRef)(null);
      const lastSize = (0, import_react17.useRef)(0);
      const initialized = (0, import_react17.useRef)(false);
      const tweenRef = (0, import_react17.useRef)();
      const [present, setPresent] = (0, import_react17.useState)(open);
      (0, import_react17.useLayoutEffect)(() => {
        const first = !initialized.current;
        initialized.current = true;
        const shell = shellRef.current, body = bodyRef.current;
        if (!shell || !body) return;
        if (open) setPresent(true);
        body.inert = !open;
        let disposed = false;
        const animate = () => {
          const natural = axis === "width" ? size ?? body.offsetWidth : body.offsetHeight;
          const target2 = open ? natural : 0;
          if (shell.style[axis] === "auto" && !open) import_gsap9.default.set(shell, { [axis]: lastSize.current });
          lastSize.current = natural || lastSize.current;
          tweenRef.current?.kill();
          const reduced = prefersReducedMotion() || first && !animateOnMount;
          const m = SOFT_SPRING;
          tweenRef.current = import_gsap9.default.timeline({ onComplete: () => {
            if (disposed) return;
            if (open && axis === "height") shell.style.height = "auto";
            if (!open && unmountOnExit) setPresent(false);
          } });
          tweenRef.current.to(shell, {
            [axis]: target2,
            duration: reduced ? 0 : m.duration,
            ease: springEase(m.stiffness, m.damping, m.duration)
          }, 0);
          tweenRef.current.to(body, {
            opacity: open ? 1 : 0,
            y: open ? 0 : -3,
            filter: open ? "blur(0px)" : "blur(2px)",
            duration: reduced ? 0 : open ? 0.24 : 0.14,
            ease: "power2.out"
          }, 0);
        };
        animate();
        const observer = new ResizeObserver(() => {
          const next = axis === "width" ? size ?? body.offsetWidth : body.offsetHeight;
          if (open && Math.abs(next - lastSize.current) > 0.5) animate();
        });
        observer.observe(body);
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        media.addEventListener("change", animate);
        return () => {
          disposed = true;
          observer.disconnect();
          media.removeEventListener("change", animate);
          tweenRef.current?.kill();
        };
      }, [open, axis, size, unmountOnExit, animateOnMount]);
      if (unmountOnExit && !open && !present) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
        "div",
        {
          ref: shellRef,
          "data-spring-disclosure": axis,
          "aria-hidden": !open,
          className: cn("overflow-hidden", axis === "width" && "h-full shrink-0", className),
          style: { [axis]: 0 },
          children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
            "div",
            {
              ref: bodyRef,
              className: axis === "height" ? "flow-root" : "h-full",
              style: axis === "width" ? { width: size } : void 0,
              children
            }
          )
        }
      );
    }
    var import_jsx_runtime23 = require2("react/jsx-runtime");
    function AttachmentMotionItem({ exiting, onExited, children }) {
      const ref = (0, import_react18.useRef)(null);
      const latestExit = (0, import_react18.useRef)(onExited);
      latestExit.current = onExited;
      (0, import_react18.useLayoutEffect)(() => {
        const node = ref.current;
        if (!node) return;
        const reduced = prefersReducedMotion();
        node.inert = exiting;
        const tween = exiting ? import_gsap10.default.to(node, {
          opacity: 0,
          scale: 0.95,
          duration: reduced ? 0 : 0.16,
          onComplete: () => latestExit.current()
        }) : import_gsap10.default.fromTo(node, { opacity: 0, y: 6, scale: 0.96 }, {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: reduced ? 0 : 0.42,
          ease: springEase(360, 24, 0.42)
        });
        return () => {
          tween.kill();
        };
      }, [exiting]);
      return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { ref, className: "shrink-0", children });
    }
    function ComposerAttachmentList({ attachments, onRemove }) {
      const { t: t2 } = useTranslation();
      const [retained, setRetained] = (0, import_react18.useState)(attachments);
      const activeIds = new Set(attachments.map((item) => item.id));
      const shown = [...attachments, ...retained.filter((item) => !activeIds.has(item.id))];
      (0, import_react18.useEffect)(() => {
        setRetained((previous) => [...attachments, ...previous.filter((item) => !attachments.some((active) => active.id === item.id))]);
      }, [attachments]);
      const removeExited = (id) => setRetained((items) => items.filter((item) => item.id !== id));
      return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(SpringDisclosure, { open: shown.length > 0, unmountOnExit: true, animateOnMount: true, children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "-mx-1 mb-2 flex max-w-full items-start gap-2.5 overflow-x-auto px-1 pb-1 pt-1.5", children: shown.map((item) => {
        if (item.kind === "image") {
          const failed = item.status === "error";
          const status = failed ? t2("composer.attachments.failed") : item.status === "processing" ? t2("composer.attachments.recognizing") : null;
          const description = status ? t2("composer.attachments.statusLabel", {
            name: item.name,
            status: failed ? item.error ?? status : status
          }) : item.name;
          return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(AttachmentMotionItem, { exiting: !activeIds.has(item.id), onExited: () => removeExited(item.id), children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
            HoverInfo,
            {
              content: description,
              children: /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "group/attachment relative flex h-[68px] w-[68px] shrink-0", children: [
                item.dataUrl ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
                  ImagePreviewTrigger,
                  {
                    src: item.dataUrl,
                    alt: item.name,
                    triggerClassName: "h-full w-full rounded-[10px] border border-border-theme bg-ui-tint",
                    imageClassName: "h-full w-full object-cover"
                  }
                ) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "flex h-full w-full items-center justify-center rounded-[10px] border border-border-theme bg-ui-tint text-text-secondary", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(import_lucide_react3.Image, { "aria-hidden": "true", className: "h-5 w-5" }) }),
                status && /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(
                  "span",
                  {
                    role: failed ? "alert" : "status",
                    "aria-label": description,
                    className: cn(
                      "pointer-events-none absolute inset-x-1 bottom-1 flex items-center justify-center gap-0.5 whitespace-nowrap rounded-md bg-elevated-bg px-0.5 py-0.5 text-[10px] leading-4",
                      failed ? "text-red-500" : "text-text-secondary"
                    ),
                    children: [
                      failed ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(import_lucide_react3.CircleAlert, { "aria-hidden": "true", className: "h-3 w-3 shrink-0" }) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(import_lucide_react3.LoaderCircle, { "aria-hidden": "true", className: "h-3 w-3 shrink-0 motion-safe:animate-spin" }),
                      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "min-w-0 truncate", children: status })
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
                  Button,
                  {
                    variant: "ghost",
                    size: "icon",
                    "aria-label": t2("composer.attachments.removeImage", { name: item.name }),
                    onClick: () => onRemove(item.id),
                    className: "absolute -right-1 -top-1 z-10 h-5 w-5 rounded-full border-2 border-elevated-bg bg-neutral-600 p-0 text-white opacity-0 transition-opacity hover:bg-neutral-800 hover:text-white group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100",
                    children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(import_lucide_react3.X, { "aria-hidden": "true", className: "h-2.5 w-2.5" })
                  }
                )
              ] })
            },
            item.id
          ) }, item.id);
        }
        return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(AttachmentMotionItem, { exiting: !activeIds.has(item.id), onExited: () => removeExited(item.id), children: /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(
          "div",
          {
            className: "flex h-14 max-w-[220px] shrink-0 items-center gap-2 rounded-2xl bg-black/5 px-2 text-left",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "flex h-10 w-10 items-center justify-center rounded-xl bg-white text-text-secondary", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(import_react_fontawesome2.FontAwesomeIcon, { icon: ["fas", item.kind === "text" ? "file-lines" : "file"] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "min-w-0 flex-1", children: [
                /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "truncate text-[12px] font-medium text-text-base", children: item.name }),
                /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "truncate text-[11px] text-text-secondary", children: item.status === "processing" ? t2("composer.attachments.processing") : item.status === "error" ? item.error ?? t2("composer.attachments.failed") : item.kind === "text" ? t2("composer.attachments.text") : t2("composer.attachments.file") })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
                IconButton,
                {
                  type: "button",
                  "aria-label": t2("composer.attachments.removeAttachment", { name: item.name }),
                  onClick: () => onRemove(item.id),
                  className: "h-6 w-6 rounded-full",
                  children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(import_react_fontawesome2.FontAwesomeIcon, { icon: ["fas", "xmark"], className: "text-[11px]" })
                }
              )
            ]
          },
          item.id
        ) }, item.id);
      }) }) });
    }
    var SETTINGS_CHANGED_EVENT = __deepAgentBridge.event;
    var attachmentIngest = (...args) => __deepAgentBridge.api.attachmentIngest(...args);
    var attachmentRemove = (...args) => __deepAgentBridge.api.attachmentRemove(...args);
    var getActivePermissionPreset = (...args) => __deepAgentBridge.api.getActivePermissionPreset(...args);
    var getCommands = (...args) => __deepAgentBridge.api.getCommands(...args);
    var getPermissionPresetVisibility = (...args) => __deepAgentBridge.api.getPermissionPresetVisibility(...args);
    var getSettings = (...args) => __deepAgentBridge.api.getSettings(...args);
    var listSkills = (...args) => __deepAgentBridge.api.listSkills(...args);
    var searchProjectFiles = (...args) => __deepAgentBridge.api.searchProjectFiles(...args);
    var setActivePermissionPreset = (...args) => __deepAgentBridge.api.setActivePermissionPreset(...args);
    var setChatModel = (...args) => __deepAgentBridge.api.setChatModel(...args);
    var setThinkingDepth = (...args) => __deepAgentBridge.api.setThinkingDepth(...args);
    var import_client2 = require2("react-dom/client");
    var import_react19 = require2("react");
    var import_react_fontawesome3 = require2("@fortawesome/react-fontawesome");
    var import_jsx_runtime24 = require2("react/jsx-runtime");
    var TYPE_META = {
      success: { icon: ["fas", "circle-check"], color: "text-green-500" },
      error: { icon: ["fas", "circle-info"], color: "text-red-500" },
      info: { icon: ["fas", "circle-info"], color: "text-blue-500" },
      warning: { icon: ["fas", "circle-info"], color: "text-amber-500" }
    };
    var pushNotice = null;
    var seq = 0;
    var root = null;
    function ensureHost() {
      if (root) return;
      const el = document.createElement("div");
      el.id = "message-root";
      document.body.appendChild(el);
      root = (0, import_client2.createRoot)(el);
      root.render(/* @__PURE__ */ (0, import_jsx_runtime24.jsx)(MessageHost, {}));
    }
    function MessageHost() {
      const [notices, setNotices] = (0, import_react19.useState)([]);
      (0, import_react19.useEffect)(() => {
        pushNotice = (n) => {
          const id = ++seq;
          setNotices((prev) => [...prev, { ...n, id }]);
          window.setTimeout(() => {
            setNotices((prev) => prev.filter((x) => x.id !== id));
          }, n.duration);
        };
        return () => {
          pushNotice = null;
        };
      }, []);
      return /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("div", { className: "fixed top-4 inset-x-0 z-[9999] flex flex-col items-center gap-2 pointer-events-none", children: notices.map((n) => {
        const meta = TYPE_META[n.type];
        return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
          "div",
          {
            className: "message-notice pointer-events-auto flex items-center gap-2.5 rounded-xl bg-popover text-popover-foreground shadow-[0_12px_40px_rgba(0,0,0,0.28)] ring-1 ring-foreground/5 px-4 py-2.5 max-w-[480px] dark:shadow-[0_12px_40px_rgba(0,0,0,0.55)] dark:ring-foreground/10",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(import_react_fontawesome3.FontAwesomeIcon, { icon: meta.icon, className: `${meta.color} text-sm` }),
              /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: "text-[13px] text-foreground", children: n.text })
            ]
          },
          n.id
        );
      }) });
    }
    function show(type, text, duration = 3e3) {
      ensureHost();
      if (pushNotice) {
        pushNotice({ type, text, duration });
      } else {
        setTimeout(() => pushNotice?.({ type, text, duration }), 0);
      }
    }
    var message = {
      success: (text, duration) => show("success", text, duration),
      error: (text, duration) => show("error", text, duration),
      info: (text, duration) => show("info", text, duration),
      warning: (text, duration) => show("warning", text, duration)
    };
    function disposeMessages() {
      root?.unmount();
      root = null;
      pushNotice = null;
    }
    var import_jsx_runtime25 = require2("react/jsx-runtime");
    var LONG_TEXT_ATTACHMENT_THRESHOLD = 8 * 1024;
    var MAX_COMPOSER_ATTACHMENTS = 5;
    var COMPOSER_TEXTAREA_MIN_HEIGHT = 60;
    var COMPOSER_TEXTAREA_DEFAULT_MAX_HEIGHT = 300;
    var SKILL_MARKER = "\uE000";
    var MENTION_MARKER = "\uE001";
    var OPTION_TO_PRESET = {
      default: "default",
      auto: "auto_review",
      full: "full_access"
    };
    var PRESET_TO_OPTION = {
      default: "default",
      auto_review: "auto",
      full_access: "full"
    };
    function stripSkillMarkers(value) {
      return value.replace(/[\uE000\uE001]/g, "");
    }
    function countSkillMarkers(value) {
      return (value.match(/\uE000/g) ?? []).length;
    }
    function countMentionMarkers(value) {
      return (value.match(/\uE001/g) ?? []).length;
    }
    function normalizeSelectionRange(start, end) {
      if (start === end) return null;
      return {
        start: Math.min(start, end),
        end: Math.max(start, end)
      };
    }
    function rangesOverlap(range, start, end) {
      return Boolean(range && start < range.end && end > range.start);
    }
    function findActiveSlashToken(value, cursor) {
      const beforeCursor = value.slice(0, cursor);
      const match = beforeCursor.match(/(^|[\s\uE000\uE001])\/([a-zA-Z0-9_:-]*)$/);
      if (!match || match.index === void 0) return null;
      const start = match.index + match[1].length;
      const after = value.slice(start + 1);
      const fullCommand = after.match(/^[a-zA-Z0-9_:-]*/)?.[0] ?? "";
      if (cursor > start + 1 + fullCommand.length) return null;
      return {
        start,
        end: start + 1 + fullCommand.length,
        query: fullCommand
      };
    }
    function findActiveAtToken(value, cursor) {
      const beforeCursor = value.slice(0, cursor);
      const match = beforeCursor.match(/(^|[\s\uE000\uE001])@([^\s\uE000\uE001]*)$/);
      if (!match || match.index === void 0) return null;
      const start = match.index + match[1].length;
      const after = value.slice(start + 1);
      const fullMention = after.match(/^[^\s\uE000\uE001]*/)?.[0] ?? "";
      if (cursor > start + 1 + fullMention.length) return null;
      return {
        start,
        end: start + 1 + fullMention.length,
        query: fullMention
      };
    }
    function mentionLabel(mention) {
      if (mention.kind === "plan_mode") return "\u8BA1\u5212\u6A21\u5F0F";
      if (mention.kind === "goal") return "\u76EE\u6807";
      return mention.relPath || mention.name;
    }
    function Composer({
      value,
      onChange,
      onSubmit,
      placeholder,
      busy = false,
      onStop,
      stopping = false,
      planMode = false,
      activeProjectPath = null,
      footer,
      contextUsage = null,
      contextUsageFallbackTokens = 0,
      textareaMaxHeight = COMPOSER_TEXTAREA_DEFAULT_MAX_HEIGHT,
      overlayCloseSignal = 0,
      onOverlayOpenChange
    }) {
      const { t: t2 } = useTranslation();
      const attachmentLimitMessage = t2("composer.attachments.limit", {
        count: MAX_COMPOSER_ATTACHMENTS
      });
      const [isModelDropdownOpen, setIsModelDropdownOpen] = (0, import_react20.useState)(false);
      const [isApprovalDropdownOpen, setIsApprovalDropdownOpen] = (0, import_react20.useState)(false);
      const [isContextPopoverOpen, setIsContextPopoverOpen] = (0, import_react20.useState)(false);
      const dropdownRef = (0, import_react20.useRef)(null);
      const approvalDropdownRef = (0, import_react20.useRef)(null);
      const approvalMorphLayoutId = (0, import_react20.useId)().replace(/:/g, "");
      const suggestId = (0, import_react20.useId)();
      const lastOverlayCloseSignal = (0, import_react20.useRef)(overlayCloseSignal);
      const lastReportedOverlayOpen = (0, import_react20.useRef)(false);
      const fileInputRef = (0, import_react20.useRef)(null);
      const textareaRef = (0, import_react20.useRef)(null);
      const mirrorRef = (0, import_react20.useRef)(null);
      const composerRef = (0, import_react20.useRef)(null);
      const messageSendMotion = useMessageSendMotion();
      const [attachments, setAttachments] = (0, import_react20.useState)([]);
      const [models, setModels] = (0, import_react20.useState)([]);
      const [selectedModel, setSelectedModel] = (0, import_react20.useState)("");
      const [modelCapabilities, setModelCapabilities] = (0, import_react20.useState)([]);
      const [selectedThinking, setSelectedThinking] = (0, import_react20.useState)("medium");
      const [switching, setSwitching] = (0, import_react20.useState)(false);
      const [slashResults, setSlashResults] = (0, import_react20.useState)([]);
      const [slashSelected, setSlashSelected] = (0, import_react20.useState)(0);
      const [atSections, setAtSections] = (0, import_react20.useState)([]);
      const [atSelected, setAtSelected] = (0, import_react20.useState)(0);
      const [selectedSkills, setSelectedSkills] = (0, import_react20.useState)([]);
      const [selectedMentions, setSelectedMentions] = (0, import_react20.useState)([]);
      const [draftValue, setDraftValue] = (0, import_react20.useState)(value);
      const [cursorPos, setCursorPos] = (0, import_react20.useState)(value.length);
      const [selectionRange, setSelectionRange] = (0, import_react20.useState)(null);
      const [editorFocused, setEditorFocused] = (0, import_react20.useState)(false);
      const pendingDraftValueRef = (0, import_react20.useRef)(value);
      const [skills, setSkills] = (0, import_react20.useState)([]);
      const reloadSettings = (0, import_react20.useCallback)((cancelled) => {
        getSettings().then((s) => {
          if (cancelled?.() || !s) return;
          setModels(s.available_models);
          setModelCapabilities(s.model_capabilities ?? []);
          setSelectedModel(s.chat_model);
          setSelectedThinking(s.thinking_depth ?? "medium");
        }).catch(() => {
        });
      }, []);
      (0, import_react20.useEffect)(() => {
        let cancelled = false;
        reloadSettings(() => cancelled);
        const onSettingsChanged = () => reloadSettings();
        window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
        return () => {
          cancelled = true;
          window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
        };
      }, [reloadSettings]);
      (0, import_react20.useEffect)(() => {
        let cancelled = false;
        const load = () => {
          listSkills().then((list) => {
            if (!cancelled) setSkills(list);
          }).catch(() => {
          });
        };
        load();
        const onSettingsChanged = () => load();
        window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
        return () => {
          cancelled = true;
          window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
        };
      }, []);
      (0, import_react20.useEffect)(() => {
        if (value === pendingDraftValueRef.current) return;
        if (stripSkillMarkers(draftValue) === value) {
          pendingDraftValueRef.current = value;
          return;
        }
        setDraftValue(value);
        setCursorPos(value.length);
        setSelectionRange(null);
        setSlashResults([]);
        setSlashSelected(0);
        setSelectedSkills([]);
        setAtSections([]);
        setAtSelected(0);
        setSelectedMentions([]);
        pendingDraftValueRef.current = value;
      }, [draftValue, value]);
      const chooseModel = async (id) => {
        if (id === selectedModel || switching) return;
        const prev = selectedModel;
        setSelectedModel(id);
        setSwitching(true);
        try {
          const view = await setChatModel(id);
          setSelectedModel(view.chat_model);
          const switched = String(view.chat_model || "");
          const slash = switched.indexOf("/");
          const switchedLabel = slash > 0 && slash < switched.length - 1 ? switched.slice(slash + 1) : switched;
          message.success(t2("composer.modelSwitched", { model: switchedLabel || switched }));
        } catch (e) {
          setSelectedModel(prev);
          message.error(t2("composer.modelSwitchFailed"));
          console.error("set_chat_model failed:", e);
        } finally {
          setSwitching(false);
        }
      };
      const THINKING_OPTIONS = [
        { id: "simple", label: "composer.thinkingSimple", icon: import_lucide_react4.Feather },
        { id: "medium", label: "composer.thinkingMedium", icon: import_lucide_react4.Lightbulb },
        { id: "deep", label: "composer.thinkingDeep", icon: import_lucide_react4.Brain }
      ];
      const chooseThinking = async (id) => {
        if (id === selectedThinking) return;
        const prev = selectedThinking;
        setSelectedThinking(id);
        try {
          const view = await setThinkingDepth(id);
          setSelectedThinking(view.thinking_depth ?? id);
        } catch (e) {
          setSelectedThinking(prev);
          message.error(t2("composer.thinkingSwitchFailed"));
          console.error("set_thinking_depth failed:", e);
        }
      };
      const ALL_APPROVAL_OPTIONS = [
        { id: "default", label: "composer.defaultPermission", desc: "composer.defaultPermissionDesc", icon: import_lucide_react4.Hand },
        { id: "auto", label: "composer.autoReview", desc: "composer.autoReviewDesc", icon: import_lucide_react4.ShieldHalf },
        { id: "full", label: "composer.fullAccess", desc: "composer.fullAccessDesc", icon: import_lucide_react4.CircleAlert }
      ];
      const [visibleOptions, setVisibleOptions] = (0, import_react20.useState)(ALL_APPROVAL_OPTIONS);
      const [selectedApproval, setSelectedApproval] = (0, import_react20.useState)(ALL_APPROVAL_OPTIONS[0]);
      (0, import_react20.useEffect)(() => {
        let cancelled = false;
        const syncApproval = () => {
          getActivePermissionPreset().then((preset) => {
            if (cancelled) return;
            const optId = PRESET_TO_OPTION[preset] ?? "default";
            const opt = ALL_APPROVAL_OPTIONS.find((o) => o.id === optId);
            if (opt) setSelectedApproval(opt);
          }).catch(() => {
          });
        };
        syncApproval();
        window.addEventListener(SETTINGS_CHANGED_EVENT, syncApproval);
        return () => {
          cancelled = true;
          window.removeEventListener(SETTINGS_CHANGED_EVENT, syncApproval);
        };
      }, []);
      const applyApproval = async (opt) => {
        const prev = selectedApproval;
        setSelectedApproval(opt);
        try {
          await setActivePermissionPreset(OPTION_TO_PRESET[opt.id] ?? "default");
        } catch (e) {
          setSelectedApproval(prev);
          message.error(t2("composer.approvalSwitchFailed"));
          console.error("set_active_permission_preset failed:", e);
        }
      };
      const chooseApproval = async (opt) => {
        setIsApprovalDropdownOpen(false);
        if (opt.id === "full") {
          const confirm = __deepAgentBridge.options?.requestFullAccessConfirm;
          const ok = typeof confirm === "function" ? await confirm() : true;
          if (!ok) return;
          await applyApproval(opt);
          return;
        }
        await applyApproval(opt);
      };
      (0, import_react20.useEffect)(() => {
        const updateVisibleOptions = async () => {
          try {
            const vis = await getPermissionPresetVisibility();
            const newOptions = [];
            if (vis.default_enabled) newOptions.push(ALL_APPROVAL_OPTIONS[0]);
            if (vis.auto_review_enabled) newOptions.push(ALL_APPROVAL_OPTIONS[1]);
            if (vis.full_access_enabled) newOptions.push(ALL_APPROVAL_OPTIONS[2]);
            setVisibleOptions(newOptions);
            setSelectedApproval((prev) => {
              if (newOptions.find((o) => o.id === prev.id)) return prev;
              return newOptions.length > 0 ? newOptions[0] : prev;
            });
          } catch {
          }
        };
        updateVisibleOptions();
        window.addEventListener("approvalMenuChanged", updateVisibleOptions);
        return () => window.removeEventListener("approvalMenuChanged", updateVisibleOptions);
      }, []);
      const slashSections = (0, import_react20.useMemo)(() => {
        const systemCommands = slashResults.filter((cmd) => cmd.skillName === void 0);
        const skillsGroup = slashResults.filter((cmd) => cmd.skillName !== void 0);
        const sections = [];
        if (systemCommands.length > 0) {
          sections.push({
            key: "system",
            label: t2("composer.systemCommands", { defaultValue: "System Commands" }),
            items: systemCommands
          });
        }
        if (skillsGroup.length > 0) {
          sections.push({
            key: "skills",
            label: t2("composer.skillsGroup", { defaultValue: "Skills" }),
            items: skillsGroup
          });
        }
        return sections;
      }, [slashResults, t2]);
      const slashEntries = (0, import_react20.useMemo)(
        () => slashSections.flatMap((section) => section.items),
        [slashSections]
      );
      const atEntries = (0, import_react20.useMemo)(
        () => atSections.flatMap((section) => section.items),
        [atSections]
      );
      const activeSlashToken = (0, import_react20.useMemo)(
        () => findActiveSlashToken(draftValue, cursorPos),
        [cursorPos, draftValue]
      );
      const activeAtToken = (0, import_react20.useMemo)(
        () => findActiveAtToken(draftValue, cursorPos),
        [cursorPos, draftValue]
      );
      const slashOpen = Boolean((draftValue.startsWith("/") || activeSlashToken) && slashEntries.length > 0);
      const atOpen = Boolean(!slashOpen && activeAtToken && atEntries.length > 0);
      const resizeTextarea = (0, import_react20.useCallback)(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = "auto";
        const nextHeight = Math.min(
          Math.max(textarea.scrollHeight, COMPOSER_TEXTAREA_MIN_HEIGHT),
          textareaMaxHeight
        );
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > textareaMaxHeight ? "auto" : "hidden";
      }, [textareaMaxHeight]);
      (0, import_react20.useLayoutEffect)(() => {
        resizeTextarea();
      }, [draftValue, resizeTextarea]);
      (0, import_react20.useEffect)(() => {
        if (draftValue.startsWith("/")) {
          const body = draftValue.slice(1);
          const firstSpace = body.search(/\s/);
          const commandName = firstSpace >= 0 ? body.slice(0, firstSpace) : body;
          const argQuery = firstSpace >= 0 ? body.slice(firstSpace + 1).trim().toLowerCase() : "";
          const exactArgCommand = firstSpace < 0 && (commandName === "model" || commandName === "thinking");
          if (commandName === "model" && (firstSpace >= 0 || exactArgCommand)) {
            const choices = models.filter((id) => id.toLowerCase().includes(argQuery)).map((id) => ({
              id: `slash-arg.model.${id}`,
              title: id,
              description: id === selectedModel ? "\u5F53\u524D\u6A21\u578B" : "\u5207\u6362\u5230\u8FD9\u4E2A DeepSeek \u6A21\u578B",
              category: "\u6A21\u578B",
              shortcut: null,
              insertText: `/model ${id} `
            }));
            setSlashResults(choices);
            setSlashSelected(0);
            return;
          }
          if (commandName === "thinking" && (firstSpace >= 0 || exactArgCommand)) {
            const choices = [
              { id: "simple", title: "simple", description: "\u7B80\u5355\u601D\u8003\uFF0C\u54CD\u5E94\u66F4\u5FEB", category: "\u601D\u8003" },
              { id: "medium", title: "medium", description: "\u4E2D\u5EA6\u601D\u8003\uFF0C\u9ED8\u8BA4\u5E73\u8861\u6A21\u5F0F", category: "\u601D\u8003" },
              { id: "deep", title: "deep", description: "\u6DF1\u5EA6\u601D\u8003\uFF0C\u7ED9\u590D\u6742\u4EFB\u52A1\u66F4\u591A\u63A8\u7406\u9884\u7559", category: "\u601D\u8003" }
            ].filter((opt) => opt.title.includes(argQuery) || opt.description.includes(argQuery)).map((opt) => ({
              ...opt,
              id: `slash-arg.thinking.${opt.id}`,
              shortcut: null,
              insertText: `/thinking ${opt.id} `
            }));
            setSlashResults(choices);
            setSlashSelected(0);
            return;
          }
        }
        if (!activeSlashToken) {
          setSlashResults([]);
          setSlashSelected(0);
          return;
        }
        let cancelled = false;
        const q = activeSlashToken.query.trim().toLowerCase();
        const selectedSkillIds = new Set(selectedSkills.map((skill) => skill.id));
        const skillChoices = skills.filter(
          (sk) => !selectedSkillIds.has(sk.id) && (!q || sk.id.toLowerCase().includes(q) || sk.name.toLowerCase().includes(q))
        ).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 8).map((sk) => ({
          id: `slash-skill.${sk.id}`,
          title: `/${sk.id}`,
          description: sk.description,
          category: "Skill",
          shortcut: null,
          skillId: sk.id,
          skillName: sk.name
        }));
        getCommands("").then((commands) => {
          if (cancelled) return;
          const slash = commands.filter((c) => {
            if (!c.id.startsWith("slash.")) return false;
            const name = c.title.replace(/^\//, "").toLowerCase();
            return !q || name.includes(q);
          });
          setSlashResults([...slash, ...skillChoices]);
          setSlashSelected(0);
        }).catch(() => {
          if (!cancelled) {
            setSlashResults(skillChoices);
            setSlashSelected(0);
          }
        });
        return () => {
          cancelled = true;
        };
      }, [activeSlashToken, draftValue, models, selectedModel, selectedSkills, skills]);
      (0, import_react20.useEffect)(() => {
        if (!activeAtToken || slashOpen) {
          setAtSections([]);
          setAtSelected(0);
          return;
        }
        let cancelled = false;
        const q = activeAtToken.query.trim().toLowerCase();
        const matches = (value2) => !q || value2.toLowerCase().includes(q);
        const sections = [];
        const addChoices = [
          {
            id: "add-files",
            type: "add-files",
            title: "\u6587\u4EF6\u548C\u6587\u4EF6\u5939",
            description: q ? "\u7EE7\u7EED\u8F93\u5165\u4EE5\u641C\u7D22\u9879\u76EE\u6587\u4EF6\u548C\u6587\u4EF6\u5939" : "",
            icon: "paperclip"
          },
          {
            id: "goal",
            type: "goal",
            title: "\u76EE\u6807",
            description: "\u8BBE\u7F6E\u8981\u6301\u7EED\u8FFD\u6C42\u7684\u76EE\u6807",
            icon: "bullseye"
          },
          {
            id: "plan-mode",
            type: "plan-mode",
            title: "\u8BA1\u5212\u6A21\u5F0F",
            description: "\u5F00\u542F\u8BA1\u5212\u6A21\u5F0F",
            icon: "list-check"
          }
        ];
        const addItems = addChoices.filter((item) => matches(item.title) || matches(item.description));
        if (addItems.length > 0) {
          sections.push({ key: "add", label: "\u6DFB\u52A0", items: addItems });
        }
        const selectedSkillIds = new Set(selectedSkills.map((skill) => skill.id));
        const skillItems = skills.filter(
          (skill) => !selectedSkillIds.has(skill.id) && (matches(skill.id) || matches(skill.name) || matches(skill.description ?? ""))
        ).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 6).map((skill) => ({
          id: `at-skill.${skill.id}`,
          type: "skill",
          title: skill.name || skill.id,
          description: skill.description,
          icon: "cube",
          skill
        }));
        if (skillItems.length > 0) {
          sections.push({ key: "plugins", label: "\u63D2\u4EF6", items: skillItems });
        } else if (!q) {
          sections.push({
            key: "plugins",
            label: "\u63D2\u4EF6",
            items: [
              {
                id: "add-files",
                type: "add-files",
                title: "\u6B63\u5728\u52A0\u8F7D\u63D2\u4EF6\u2026",
                description: "",
                icon: "paperclip"
              }
            ]
          });
        }
        if (!q) {
          sections.push({
            key: "files",
            label: "\u6587\u4EF6\u548C\u4EFB\u52A1",
            items: [
              {
                id: "add-files",
                type: "add-files",
                title: "\u8F93\u5165\u4EE5\u641C\u7D22\u6587\u4EF6\u6216\u4EFB\u52A1",
                description: "",
                icon: "paperclip"
              }
            ]
          });
          setAtSections(sections);
          setAtSelected(0);
          return;
        }
        const timer = window.setTimeout(() => {
          searchProjectFiles(activeProjectPath, q, 24).then((result) => {
            if (cancelled) return;
            const mentionedPaths = new Set(
              selectedMentions.flatMap(
                (mention) => mention.kind === "file" || mention.kind === "folder" ? [mention.path] : []
              )
            );
            const fileItems = result.entries.filter((entry) => !mentionedPaths.has(entry.path)).slice(0, 12).map((entry) => ({
              id: `at-file.${entry.path}`,
              type: "file",
              title: entry.name,
              description: entry.rel_path,
              icon: entry.is_dir ? "folder" : "file",
              entry
            }));
            if (fileItems.length > 0) {
              sections.push({ key: "files", label: "\u6587\u4EF6\u548C\u4EFB\u52A1", items: fileItems });
            }
            setAtSections(sections);
            setAtSelected(0);
          }).catch(() => {
            if (!cancelled) {
              setAtSections(sections);
              setAtSelected(0);
            }
          });
        }, 80);
        return () => {
          cancelled = true;
          window.clearTimeout(timer);
        };
      }, [activeAtToken, activeProjectPath, selectedMentions, selectedSkills, skills, slashOpen]);
      const chooseSlash = (cmd) => {
        const replaceWholeRootSlash = !activeSlashToken && draftValue.startsWith("/");
        const rawStart = activeSlashToken ? activeSlashToken.start : replaceWholeRootSlash ? 0 : cursorPos;
        const rawEnd = activeSlashToken ? activeSlashToken.end : replaceWholeRootSlash ? draftValue.length : cursorPos;
        const prefix = draftValue.slice(0, rawStart);
        const suffix = draftValue.slice(rawEnd);
        if (cmd.skillName !== void 0) {
          if (selectedSkills.some((skill) => skill.id === (cmd.skillId ?? cmd.id))) {
            setSlashResults([]);
            setSlashSelected(0);
            requestAnimationFrame(() => textareaRef.current?.focus());
            return;
          }
          const nextValue = `${prefix}${SKILL_MARKER}${suffix}`;
          const insertedSkill = {
            id: cmd.skillId ?? cmd.id,
            name: cmd.skillName
          };
          const insertAt = countSkillMarkers(prefix);
          setSelectedSkills((prev) => {
            const next = [...prev];
            next.splice(insertAt, 0, insertedSkill);
            return next;
          });
          setDraftValue(nextValue);
          pendingDraftValueRef.current = stripSkillMarkers(nextValue);
          onChange(stripSkillMarkers(nextValue));
          setCursorPos(rawStart + 1);
          setSelectionRange(null);
          requestAnimationFrame(() => {
            textareaRef.current?.setSelectionRange(rawStart + 1, rawStart + 1);
            textareaRef.current?.focus();
          });
        } else {
          const insertText = cmd.insertText ?? `${cmd.title} `;
          const nextValue = `${prefix}${insertText}${suffix}`;
          setDraftValue(nextValue);
          pendingDraftValueRef.current = stripSkillMarkers(nextValue);
          onChange(stripSkillMarkers(nextValue));
          setCursorPos(rawStart + insertText.length);
          setSelectionRange(null);
          requestAnimationFrame(() => {
            const caret = rawStart + insertText.length;
            textareaRef.current?.setSelectionRange(caret, caret);
            textareaRef.current?.focus();
          });
        }
        setSlashResults([]);
        setSlashSelected(0);
      };
      const insertSkillMarker = (rawStart, rawEnd, skill) => {
        if (selectedSkills.some((item) => item.id === skill.id)) {
          requestAnimationFrame(() => textareaRef.current?.focus());
          return;
        }
        const prefix = draftValue.slice(0, rawStart);
        const suffix = draftValue.slice(rawEnd);
        const spacer = suffix && !/^\s/.test(suffix) ? " " : "";
        const nextValue = `${prefix}${SKILL_MARKER}${spacer}${suffix}`;
        const insertAt = countSkillMarkers(prefix);
        setSelectedSkills((prev) => {
          const next = [...prev];
          next.splice(insertAt, 0, skill);
          return next;
        });
        setDraftValue(nextValue);
        pendingDraftValueRef.current = stripSkillMarkers(nextValue);
        onChange(stripSkillMarkers(nextValue));
        const caret = rawStart + 1 + spacer.length;
        setCursorPos(caret);
        setSelectionRange(null);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(caret, caret);
          textareaRef.current?.focus();
        });
      };
      const insertMentionMarker = (rawStart, rawEnd, mention) => {
        const prefix = draftValue.slice(0, rawStart);
        const suffix = draftValue.slice(rawEnd);
        const spacer = suffix && !/^\s/.test(suffix) ? " " : " ";
        const nextValue = `${prefix}${MENTION_MARKER}${spacer}${suffix}`;
        const insertAt = countMentionMarkers(prefix);
        setSelectedMentions((prev) => {
          const next = [...prev];
          next.splice(insertAt, 0, mention);
          return next;
        });
        setDraftValue(nextValue);
        pendingDraftValueRef.current = stripSkillMarkers(nextValue);
        onChange(stripSkillMarkers(nextValue));
        const caret = rawStart + 1 + spacer.length;
        setCursorPos(caret);
        setSelectionRange(null);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(caret, caret);
          textareaRef.current?.focus();
        });
      };
      const chooseAt = (choice) => {
        if (!activeAtToken) return;
        const rawStart = activeAtToken.start;
        const rawEnd = activeAtToken.end;
        if (choice.type === "add-files") {
          message.info("\u7EE7\u7EED\u5728 @ \u540E\u8F93\u5165\u6587\u4EF6\u540D\u6216\u6587\u4EF6\u5939\u540D\u5373\u53EF\u641C\u7D22");
          setAtSelected(0);
          requestAnimationFrame(() => textareaRef.current?.focus());
          return;
        }
        if (choice.type === "goal") {
          const goal = window.prompt("\u8BF7\u8F93\u5165\u8981\u6301\u7EED\u8FFD\u8E2A\u7684\u76EE\u6807");
          if (!goal?.trim()) {
            requestAnimationFrame(() => textareaRef.current?.focus());
            return;
          }
          insertMentionMarker(rawStart, rawEnd, {
            kind: "goal",
            text: goal.trim()
          });
        } else if (choice.type === "plan-mode") {
          if (!selectedMentions.some((mention) => mention.kind === "plan_mode")) {
            insertMentionMarker(rawStart, rawEnd, { kind: "plan_mode" });
          }
        } else if (choice.type === "file") {
          insertMentionMarker(rawStart, rawEnd, {
            kind: choice.entry.is_dir ? "folder" : "file",
            path: choice.entry.path,
            relPath: choice.entry.rel_path,
            name: choice.entry.name,
            isDir: choice.entry.is_dir
          });
        } else if (choice.type === "skill") {
          insertSkillMarker(rawStart, rawEnd, {
            id: choice.skill.id,
            name: choice.skill.name
          });
        }
        setAtSections([]);
        setAtSelected(0);
      };
      (0, import_react20.useEffect)(() => {
        const handleClickOutside = (e) => {
          if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
            setIsModelDropdownOpen(false);
          }
          if (approvalDropdownRef.current && !approvalDropdownRef.current.contains(e.target)) {
            setIsApprovalDropdownOpen(false);
          }
        };
        if (isModelDropdownOpen || isApprovalDropdownOpen) {
          document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
      }, [isModelDropdownOpen, isApprovalDropdownOpen]);
      (0, import_react20.useEffect)(() => {
        const open = isModelDropdownOpen || isApprovalDropdownOpen || isContextPopoverOpen;
        if (open === lastReportedOverlayOpen.current) return;
        lastReportedOverlayOpen.current = open;
        onOverlayOpenChange?.(open);
      }, [isModelDropdownOpen, isApprovalDropdownOpen, isContextPopoverOpen, onOverlayOpenChange]);
      (0, import_react20.useEffect)(() => {
        if (overlayCloseSignal > lastOverlayCloseSignal.current) {
          lastOverlayCloseSignal.current = overlayCloseSignal;
          setIsModelDropdownOpen(false);
          setIsApprovalDropdownOpen(false);
          setIsContextPopoverOpen(false);
        }
      }, [overlayCloseSignal]);
      const submitWithAttachments = () => {
        const readyAttachments = attachments.filter((item) => item.status === "ready");
        const surface = composerRef.current?.querySelector("[data-message-composer-surface]");
        if (textareaRef.current && mirrorRef.current && surface) {
          messageSendMotion?.prepare(textareaRef.current, mirrorRef.current, surface, draftValue);
        }
        onSubmit(readyAttachments, selectedSkills, selectedMentions, draftValue);
        if (readyAttachments.length > 0) setAttachments([]);
        if (selectedSkills.length > 0) setSelectedSkills([]);
        if (selectedMentions.length > 0) setSelectedMentions([]);
        setDraftValue("");
        setCursorPos(0);
        setSelectionRange(null);
        pendingDraftValueRef.current = "";
      };
      const hasComposerContent = Boolean(
        stripSkillMarkers(draftValue).trim() || attachments.length > 0 || selectedSkills.length > 0 || selectedMentions.length > 0
      );
      const addAttachment = (attachment) => {
        setAttachments((prev) => [...prev, attachment]);
      };
      const showAttachmentLimitWarning = () => {
        message.warning(attachmentLimitMessage);
      };
      const removeAttachment = (id) => {
        setAttachments((prev) => prev.filter((item) => item.id !== id));
        void attachmentRemove(id).catch(() => {
        });
      };
      const attachmentId = () => globalThis.crypto?.randomUUID?.() ?? `att_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error(t2("composer.attachments.readFailed")));
        reader.readAsDataURL(file);
      });
      const readFileAsText = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error(t2("composer.attachments.readFailed")));
        reader.readAsText(file);
      });
      const addTextAttachment = async (text, source, name) => {
        if (attachments.length >= MAX_COMPOSER_ATTACHMENTS) {
          showAttachmentLimitWarning();
          return;
        }
        const id = attachmentId();
        const attachmentName = name ?? `pasted-text-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.txt`;
        const size = new Blob([text]).size;
        addAttachment({
          id,
          kind: "text",
          name: attachmentName,
          mime: "text/plain",
          size,
          source,
          status: "processing"
        });
        try {
          const persisted = await attachmentIngest({
            id,
            session_id: null,
            kind: "text",
            name: attachmentName,
            mime: "text/plain",
            source,
            text
          });
          markAttachmentReady(id, {
            size: persisted.size_bytes || size,
            extractedText: persisted.extracted_text ?? text,
            storageDir: persisted.storage_dir,
            originalPath: persisted.original_path ?? void 0,
            sha256: persisted.sha256 ?? void 0,
            backendMessage: persisted.message ?? void 0
          });
        } catch (error) {
          markAttachmentError(id, error);
        }
      };
      const isTextLikeFile = (file) => file.type.startsWith("text/") || /\.(txt|md|markdown|json|log|yaml|yml|xml|ts|tsx|js|jsx|mjs|cjs|rs|go|py|java|kt|css|scss|html|htm|env|gitignore|npmrc|toml|ini|conf|cfg|sh|bash|zsh|fish|ps1|bat|cmd)$/i.test(
        file.name
      );
      const markAttachmentReady = (id, patch) => {
        setAttachments(
          (prev) => prev.map((item) => item.id === id ? { ...item, ...patch, status: "ready" } : item)
        );
      };
      const markAttachmentError = (id, error) => {
        setAttachments(
          (prev) => prev.map(
            (item) => item.id === id ? { ...item, status: "error", error: error instanceof Error ? error.message : String(error) } : item
          )
        );
      };
      const addFiles = async (files, source) => {
        const incoming = Array.from(files);
        const remaining = MAX_COMPOSER_ATTACHMENTS - attachments.length;
        if (remaining <= 0) {
          showAttachmentLimitWarning();
          return;
        }
        const accepted = incoming.slice(0, remaining);
        if (incoming.length > accepted.length) {
          showAttachmentLimitWarning();
        }
        for (const file of accepted) {
          const id = attachmentId();
          const isImage = file.type.startsWith("image/");
          const isText = isTextLikeFile(file);
          const base = {
            id,
            kind: isImage ? "image" : isText ? "text" : "file",
            name: file.name || (isImage ? "pasted-image.png" : "attachment"),
            mime: file.type || "application/octet-stream",
            size: file.size,
            source,
            status: "processing"
          };
          addAttachment(base);
          try {
            if (isImage) {
              const dataUrl = await readFileAsDataUrl(file);
              const persisted = await attachmentIngest({
                id,
                session_id: null,
                kind: "image",
                name: base.name,
                mime: base.mime,
                source,
                data_url: dataUrl
              });
              const imagePath = persisted.original_path ?? void 0;
              markAttachmentReady(id, {
                dataUrl,
                size: persisted.size_bytes || file.size,
                storageDir: persisted.storage_dir,
                originalPath: imagePath,
                extractedText: persisted.extracted_text ?? void 0,
                sha256: persisted.sha256 ?? void 0,
                backendMessage: persisted.message ?? void 0
              });
            } else if (isText) {
              const extractedText = await readFileAsText(file);
              const persisted = await attachmentIngest({
                id,
                session_id: null,
                kind: "text",
                name: base.name,
                mime: base.mime,
                source,
                text: extractedText
              });
              markAttachmentReady(id, {
                kind: "text",
                size: persisted.size_bytes || file.size,
                extractedText: persisted.extracted_text ?? extractedText,
                storageDir: persisted.storage_dir,
                originalPath: persisted.original_path ?? void 0,
                sha256: persisted.sha256 ?? void 0,
                backendMessage: persisted.message ?? void 0
              });
            } else {
              const dataUrl = await readFileAsDataUrl(file);
              const persisted = await attachmentIngest({
                id,
                session_id: null,
                kind: "file",
                name: base.name,
                mime: base.mime,
                source,
                data_url: dataUrl
              });
              markAttachmentReady(id, {
                size: persisted.size_bytes || file.size,
                extractedText: persisted.extracted_text ?? void 0,
                storageDir: persisted.storage_dir,
                originalPath: persisted.original_path ?? void 0,
                sha256: persisted.sha256 ?? void 0,
                backendMessage: persisted.message ?? void 0
              });
            }
          } catch (error) {
            markAttachmentError(id, error);
          }
        }
      };
      const onPaste = (event) => {
        const text = event.clipboardData.getData("text/plain");
        const files = Array.from(event.clipboardData.files);
        if (files.length > 0) {
          event.preventDefault();
          void addFiles(files, "paste");
          return;
        }
        if (text.length > LONG_TEXT_ATTACHMENT_THRESHOLD) {
          event.preventDefault();
          void addTextAttachment(text, "paste");
        }
      };
      const onDrop = (event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        void addFiles(event.dataTransfer.files, "drop");
      };
      const syncCursorFromTextarea = () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        setCursorPos(start);
        setSelectionRange(normalizeSelectionRange(start, end));
      };
      const handleEditorChange = (event) => {
        const next = event.currentTarget.value;
        const stripped = stripSkillMarkers(next);
        const caret = event.currentTarget.selectionStart ?? next.length;
        const previousDraft = draftValue;
        setDraftValue(next);
        setCursorPos(caret);
        setSelectionRange(
          normalizeSelectionRange(
            caret,
            event.currentTarget.selectionEnd ?? caret
          )
        );
        const previousMarkerCount = countSkillMarkers(previousDraft);
        const nextMarkerCount = countSkillMarkers(next);
        if (nextMarkerCount !== previousMarkerCount) {
          setSelectedSkills((prev) => {
            if (nextMarkerCount <= 0) return [];
            if (nextMarkerCount >= previousMarkerCount) return prev.slice(0, nextMarkerCount);
            const removed = previousMarkerCount - nextMarkerCount;
            const removeAt = Math.min(countSkillMarkers(next.slice(0, caret)), Math.max(prev.length - removed, 0));
            const reconciled = [...prev];
            reconciled.splice(removeAt, removed);
            return reconciled.slice(0, nextMarkerCount);
          });
        }
        const previousMentionCount = countMentionMarkers(previousDraft);
        const nextMentionCount = countMentionMarkers(next);
        if (nextMentionCount !== previousMentionCount) {
          setSelectedMentions((prev) => {
            if (nextMentionCount <= 0) return [];
            if (nextMentionCount >= previousMentionCount) return prev.slice(0, nextMentionCount);
            const removed = previousMentionCount - nextMentionCount;
            const removeAt = Math.min(
              countMentionMarkers(next.slice(0, caret)),
              Math.max(prev.length - removed, 0)
            );
            const reconciled = [...prev];
            reconciled.splice(removeAt, removed);
            return reconciled.slice(0, nextMentionCount);
          });
        }
        pendingDraftValueRef.current = stripped;
        onChange(stripped);
      };
      const editorPlaceholder = placeholder ?? t2("composer.placeholder");
      const mirrorContent = (() => {
        const showMirrorCaret = editorFocused && !selectionRange;
        let caretRendered = false;
        const renderCaretAt = (position, key) => {
          if (!showMirrorCaret || caretRendered || cursorPos !== position) return null;
          caretRendered = true;
          return /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "composer-mirror-caret", "aria-hidden": "true" }, key);
        };
        const renderMirrorText = (text, startOffset, keyPrefix) => {
          if (!text) return [];
          if (!selectionRange || !rangesOverlap(selectionRange, startOffset, startOffset + text.length)) {
            const caret = cursorPos >= startOffset && cursorPos <= startOffset + text.length ? renderCaretAt(cursorPos, `${keyPrefix}-caret`) : null;
            if (!caret) return [/* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { children: text }, `${keyPrefix}-plain`)];
            const caretIndex = cursorPos - startOffset;
            return [
              caretIndex > 0 ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { children: text.slice(0, caretIndex) }, `${keyPrefix}-before-caret`) : null,
              caret,
              caretIndex < text.length ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { children: text.slice(caretIndex) }, `${keyPrefix}-after-caret`) : null
            ].filter(Boolean);
          }
          const nodes2 = [];
          const selectedStart = Math.max(selectionRange.start, startOffset) - startOffset;
          const selectedEnd = Math.min(selectionRange.end, startOffset + text.length) - startOffset;
          if (selectedStart > 0) {
            nodes2.push(/* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { children: text.slice(0, selectedStart) }, `${keyPrefix}-before`));
          }
          nodes2.push(
            /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "rounded-[2px] bg-primary text-white", children: text.slice(selectedStart, selectedEnd) }, `${keyPrefix}-selected`)
          );
          if (selectedEnd < text.length) {
            nodes2.push(/* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { children: text.slice(selectedEnd) }, `${keyPrefix}-after`));
          }
          return nodes2;
        };
        if (!draftValue) {
          return /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "text-gray-400", children: editorPlaceholder });
        }
        const markerRegex = /[\uE000\uE001]/g;
        let offset = 0;
        let skillIndex = 0;
        let mentionIndex = 0;
        const nodes = [];
        let match;
        let segmentIndex = 0;
        while ((match = markerRegex.exec(draftValue)) !== null) {
          const markerStart = match.index;
          const text = draftValue.slice(offset, markerStart);
          if (text) nodes.push(...renderMirrorText(text, offset, `text-${segmentIndex}`));
          offset = markerStart;
          const marker = match[0];
          const markerSelected = rangesOverlap(selectionRange, offset, offset + 1);
          const caretBefore = renderCaretAt(offset, `marker-${segmentIndex}-before-caret`);
          if (caretBefore) nodes.push(caretBefore);
          if (marker === SKILL_MARKER) {
            const skill = selectedSkills[skillIndex];
            if (skill) {
              const skillLabel = skill.name || skill.id;
              nodes.push(
                /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(HoverInfo, { content: `${skill.name} (${skill.id})`, children: /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
                  "span",
                  {
                    className: `mx-0.5 inline-flex h-[20px] max-w-[180px] items-center rounded-[3px] px-1 text-[13px] font-medium leading-none align-baseline ${markerSelected ? "bg-primary text-white" : "border border-primary/20 bg-primary/10 text-primary"}`,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(import_react_fontawesome4.FontAwesomeIcon, { icon: ["fas", "cube"], className: "mr-1 text-[11px]" }),
                      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "truncate", children: skillLabel })
                    ]
                  }
                ) }, `skill-${segmentIndex}`)
              );
            }
            skillIndex += 1;
          } else {
            const mention = selectedMentions[mentionIndex];
            if (mention) {
              const icon = mention.kind === "folder" ? "folder" : mention.kind === "file" ? "file" : mention.kind === "goal" ? "bullseye" : "list-check";
              const label = mentionLabel(mention);
              const title = mention.kind === "goal" ? mention.text : mention.kind === "plan_mode" ? "\u5F00\u542F\u8BA1\u5212\u6A21\u5F0F" : mention.path;
              nodes.push(
                /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(HoverInfo, { content: title, children: /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
                  "span",
                  {
                    className: `mx-0.5 inline-flex h-[20px] max-w-[220px] items-center rounded-[3px] px-1 text-[13px] font-medium leading-none align-baseline ${markerSelected ? "bg-primary text-white" : "bg-black/5 text-text-base"}`,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(import_react_fontawesome4.FontAwesomeIcon, { icon: ["fas", icon], className: "mr-1 text-[11px] text-text-secondary" }),
                      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "truncate", children: label })
                    ]
                  }
                ) }, `mention-${segmentIndex}`)
              );
            }
            mentionIndex += 1;
          }
          offset += 1;
          const caretAfter = renderCaretAt(offset, `marker-${segmentIndex}-after-caret`);
          if (caretAfter) nodes.push(caretAfter);
          segmentIndex += 1;
        }
        const tail = draftValue.slice(offset);
        if (tail) nodes.push(...renderMirrorText(tail, offset, `text-${segmentIndex}`));
        return nodes;
      })();
      const handleCopy = (event) => {
        const textarea = event.currentTarget;
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? start;
        if (start === end) return;
        const selectedText = stripSkillMarkers(textarea.value.slice(start, end));
        event.preventDefault();
        event.clipboardData.setData("text/plain", selectedText);
      };
      const handleCut = (event) => {
        const textarea = event.currentTarget;
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? start;
        if (start === end) return;
        const selectedText = stripSkillMarkers(textarea.value.slice(start, end));
        const nextValue = `${textarea.value.slice(0, start)}${textarea.value.slice(end)}`;
        const stripped = stripSkillMarkers(nextValue);
        event.preventDefault();
        event.clipboardData.setData("text/plain", selectedText);
        setDraftValue(nextValue);
        setCursorPos(start);
        setSelectionRange(null);
        const removedMarkers = countSkillMarkers(textarea.value.slice(start, end));
        if (removedMarkers > 0) {
          const removeAt = countSkillMarkers(textarea.value.slice(0, start));
          setSelectedSkills((prev) => {
            const next = [...prev];
            next.splice(removeAt, removedMarkers);
            return next;
          });
        }
        const removedMentionMarkers = countMentionMarkers(textarea.value.slice(start, end));
        if (removedMentionMarkers > 0) {
          const removeAt = countMentionMarkers(textarea.value.slice(0, start));
          setSelectedMentions((prev) => {
            const next = [...prev];
            next.splice(removeAt, removedMentionMarkers);
            return next;
          });
        }
        pendingDraftValueRef.current = stripped;
        onChange(stripped);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(start, start);
          textareaRef.current?.focus();
        });
      };
      const onKeyDown = (e) => {
        if (e.nativeEvent.isComposing) return;
        if (atOpen && e.key === "ArrowDown") {
          e.preventDefault();
          setAtSelected((s) => Math.min(s + 1, atEntries.length - 1));
          return;
        }
        if (atOpen && e.key === "ArrowUp") {
          e.preventDefault();
          setAtSelected((s) => Math.max(s - 1, 0));
          return;
        }
        if (atOpen && (e.key === "Tab" || e.key === "Enter" && !e.shiftKey)) {
          const selected = atEntries[atSelected];
          if (selected) {
            e.preventDefault();
            chooseAt(selected);
            return;
          }
        }
        if (atOpen && e.key === "Escape") {
          e.preventDefault();
          setAtSections([]);
          return;
        }
        if (slashOpen && e.key === "ArrowDown") {
          e.preventDefault();
          setSlashSelected((s) => Math.min(s + 1, slashEntries.length - 1));
          return;
        }
        if (slashOpen && e.key === "ArrowUp") {
          e.preventDefault();
          setSlashSelected((s) => Math.max(s - 1, 0));
          return;
        }
        if (slashOpen && (e.key === "Tab" || e.key === "Enter" && !e.shiftKey)) {
          const selected = slashEntries[slashSelected];
          const exact = selected?.skillName ? false : selected?.title === stripSkillMarkers(draftValue).trim();
          if (selected && !exact) {
            e.preventDefault();
            chooseSlash(selected);
            return;
          }
        }
        if (slashOpen && e.key === "Escape") {
          e.preventDefault();
          setSlashResults([]);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (!busy) submitWithAttachments();
        }
      };
      return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { ref: composerRef, className: "group/composer relative w-full", children: [
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
          InputSurface,
          {
            "data-message-composer-surface": true,
            className: "flex flex-col overflow-visible rounded-[24px] shadow-[0_8px_24px_rgba(31,38,48,0.09)] focus-within:shadow-[0_10px_30px_rgba(31,38,48,0.13)]",
            onDragOver: (event) => event.preventDefault(),
            onDrop,
            children: /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "relative flex w-full flex-col p-3.5 pb-2.5", children: [
              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                ComposerSuggestPanel,
                {
                  id: `${suggestId}-at`,
                  open: atOpen,
                  sections: atSections,
                  selectedIndex: atSelected,
                  getKey: (item) => item.id,
                  onSelect: chooseAt,
                  onHover: setAtSelected,
                  renderItem: (item, selected) => /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
                    "div",
                    {
                      className: `grid w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 px-2 py-2 text-left text-[13px] transition-colors duration-150 ${selected ? "font-medium text-text-base" : "text-text-secondary"}`,
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "flex h-4 w-4 items-center justify-center text-text-base", children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(import_react_fontawesome4.FontAwesomeIcon, { icon: ["fas", item.icon], className: "text-[12px]" }) }),
                        /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("span", { className: "min-w-0", children: [
                          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "block truncate font-medium text-text-base", children: item.title }),
                          item.description && /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "block truncate text-[12px] text-text-secondary", children: item.description })
                        ] })
                      ]
                    }
                  )
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                ComposerSuggestPanel,
                {
                  id: `${suggestId}-slash`,
                  open: slashOpen,
                  sections: slashSections,
                  selectedIndex: slashSelected,
                  getKey: (cmd) => cmd.id,
                  onSelect: chooseSlash,
                  onHover: setSlashSelected,
                  renderTooltip: (cmd) => /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(import_jsx_runtime25.Fragment, { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "font-medium", children: cmd.title }),
                    cmd.description && /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "mt-1 max-w-sm text-bg-base/80", children: cmd.description })
                  ] }),
                  renderItem: (cmd, selected) => /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
                    "div",
                    {
                      className: `composer-slash-row grid w-full grid-cols-[130px_minmax(0,1fr)_64px] items-center gap-2.5 px-2 py-2 text-left text-[13px] transition-colors duration-150 ${selected ? "font-medium text-text-base" : "text-text-secondary"}`,
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "truncate font-medium text-text-base", children: cmd.title }),
                        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "truncate text-[12px] leading-snug text-text-secondary", children: cmd.description }),
                        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "composer-slash-category truncate text-right text-[11px] text-text-secondary", children: cmd.category })
                      ]
                    }
                  )
                }
              ),
              planMode && /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "mb-2 inline-flex w-fit items-center rounded-full bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-700", children: [
                /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(import_react_fontawesome4.FontAwesomeIcon, { icon: ["fas", "list-check"], className: "mr-1.5 text-[10px]" }),
                "Plan Mode"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(ComposerAttachmentList, { attachments, onRemove: removeAttachment }),
              /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "relative w-full", children: [
                /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                  "div",
                  {
                    ref: mirrorRef,
                    "data-message-composer-content": true,
                    "aria-hidden": "true",
                    className: "pointer-events-none absolute inset-0 overflow-hidden custom-scrollbar whitespace-pre-wrap break-words bg-transparent text-sm leading-6 text-text-base",
                    style: {
                      minHeight: `${COMPOSER_TEXTAREA_MIN_HEIGHT}px`,
                      maxHeight: `${textareaMaxHeight}px`
                    },
                    children: mirrorContent
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                  "textarea",
                  {
                    ref: textareaRef,
                    "aria-label": editorPlaceholder,
                    "aria-autocomplete": "list",
                    "aria-controls": atOpen ? `${suggestId}-at` : slashOpen ? `${suggestId}-slash` : void 0,
                    "aria-activedescendant": atOpen ? `${suggestId}-at-option-${atSelected}` : slashOpen ? `${suggestId}-slash-option-${slashSelected}` : void 0,
                    className: `composer-textarea custom-scrollbar relative z-10 w-full resize-none bg-transparent text-sm leading-6 text-transparent outline-none placeholder-transparent ${draftValue ? "" : "composer-textarea--empty"}`,
                    style: {
                      minHeight: `${COMPOSER_TEXTAREA_MIN_HEIGHT}px`,
                      maxHeight: `${textareaMaxHeight}px`
                    },
                    placeholder: editorPlaceholder,
                    value: draftValue,
                    onChange: handleEditorChange,
                    onPaste,
                    onCopy: handleCopy,
                    onCut: handleCut,
                    onKeyDown,
                    onSelect: syncCursorFromTextarea,
                    onClick: syncCursorFromTextarea,
                    onKeyUp: syncCursorFromTextarea,
                    onFocus: () => {
                      setEditorFocused(true);
                      syncCursorFromTextarea();
                    },
                    onBlur: () => {
                      setEditorFocused(false);
                      setSelectionRange(null);
                    },
                    onScroll: (event) => {
                      if (!mirrorRef.current) return;
                      mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
                      mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
                    }
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "composer-toolbar mt-2.5 flex h-8 items-center gap-3", children: [
                /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "composer-primary-tools flex min-w-0 flex-1 items-center gap-1.5 overflow-visible", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                    "input",
                    {
                      ref: fileInputRef,
                      type: "file",
                      multiple: true,
                      className: "hidden",
                      onChange: (event) => {
                        if (event.target.files) void addFiles(event.target.files, "picker");
                        event.currentTarget.value = "";
                      }
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                    ComposerAttachButton,
                    {
                      disabled: attachments.length >= MAX_COMPOSER_ATTACHMENTS,
                      disabledTitle: attachmentLimitMessage,
                      onClick: () => fileInputRef.current?.click()
                    }
                  ),
                  visibleOptions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { ref: approvalDropdownRef, className: "min-w-0 max-w-full", children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                    MorphingMenuShell,
                    {
                      open: isApprovalDropdownOpen,
                      onOpenChange: (next) => {
                        if (next) {
                          setIsModelDropdownOpen(false);
                          setIsContextPopoverOpen(false);
                        }
                        setIsApprovalDropdownOpen(next);
                      },
                      layoutId: approvalMorphLayoutId,
                      trigger: /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
                        "button",
                        {
                          type: "button",
                          className: cn(
                            "flex h-8 max-w-full min-w-0 flex-shrink items-center whitespace-nowrap rounded-full px-3 text-[11px] font-medium",
                            MOTION.fast,
                            selectedApproval?.id === "full" ? cn(
                              "text-[#e25507] bg-[#e25507]/10 hover:bg-[#e25507]/18 active:bg-[#e25507]/22",
                              isApprovalDropdownOpen && "bg-[#e25507]/18"
                            ) : cn(
                              "text-text-secondary bg-black/5 hover:bg-black/10 hover:text-text-base active:bg-black/[0.12]",
                              isApprovalDropdownOpen && "bg-black/10 text-text-base"
                            )
                          ),
                          onClick: () => {
                            const next = !isApprovalDropdownOpen;
                            if (next) {
                              setIsModelDropdownOpen(false);
                              setIsContextPopoverOpen(false);
                            }
                            setIsApprovalDropdownOpen(next);
                          },
                          children: [
                            selectedApproval && /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(import_jsx_runtime25.Fragment, { children: [
                              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                                selectedApproval.icon,
                                {
                                  size: 12,
                                  className: cn(
                                    "mr-1.5 shrink-0",
                                    selectedApproval.id === "full" ? "text-[#e25507]" : "text-text-secondary"
                                  )
                                }
                              ),
                              /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: "truncate", children: t2(selectedApproval.label) })
                            ] }),
                            /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(import_lucide_react4.ChevronDown, { size: 10, className: "ml-1 shrink-0" })
                          ]
                        }
                      ),
                      className: "min-w-0 max-w-full",
                      panelClassName: "w-[min(288px,calc(100vw-48px))]",
                      panelShadow: "0 4px 12px rgba(0,0,0,0.08)",
                      panelAlign: "left",
                      children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "p-1.5", children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                        SlidingMenuList,
                        {
                          activeId: selectedApproval?.id ?? "",
                          pillClassName: cn(
                            "left-0 right-0 rounded-xl bg-ui-tint-strong",
                            selectedApproval?.id === "full" && "bg-[#e25507]/10"
                          ),
                          className: "flex w-full flex-col gap-0.5",
                          children: visibleOptions.map((opt) => {
                            const selected = selectedApproval?.id === opt.id;
                            const isFull = opt.id === "full";
                            return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
                              "div",
                              {
                                ...{ [MENU_ITEM_ATTR]: opt.id },
                                className: cn(
                                  "relative z-[1] flex w-full cursor-pointer items-start gap-[7px] rounded-xl px-2 py-2 text-left",
                                  MOTION.fast,
                                  selected ? isFull ? "font-medium text-[#e25507]" : "font-medium text-text-base" : "text-text-base"
                                ),
                                onClick: () => chooseApproval(opt),
                                children: [
                                  /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "mt-0.5 flex w-3 shrink-0 justify-center", children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                                    opt.icon,
                                    {
                                      size: 12,
                                      className: cn(
                                        selected && isFull ? "text-[#e25507]" : "text-text-secondary"
                                      )
                                    }
                                  ) }),
                                  /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "min-w-0 flex-1", children: [
                                    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: cn("pr-3.5 text-[12px] font-medium leading-[17px]", selected && !isFull && "text-text-base"), children: t2(opt.label) }),
                                    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                                      "div",
                                      {
                                        className: cn(
                                          "mt-0.5 text-[11px] leading-[15px]",
                                          selected && isFull ? "text-[#e25507]/80" : "text-[#8c8c8c]"
                                        ),
                                        children: t2(opt.desc)
                                      }
                                    )
                                  ] }),
                                  selected && /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                                    import_lucide_react4.Check,
                                    {
                                      size: 10,
                                      className: cn("absolute right-2 top-[11px] shrink-0", isFull ? "text-[#e25507]" : "text-text-secondary")
                                    }
                                  )
                                ]
                              },
                              opt.id
                            );
                          })
                        }
                      ) })
                    }
                  ) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: "composer-model-tools flex h-8 shrink-0 items-center gap-2", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                    ContextCapacityIndicator,
                    {
                      snapshot: contextUsage,
                      contextWindow: modelCapabilities.find((c) => c.model_id === selectedModel)?.context_window,
                      fallbackPromptTokens: contextUsageFallbackTokens,
                      popoverSuppressed: isModelDropdownOpen || isApprovalDropdownOpen,
                      overlayCloseSignal,
                      onPopoverOpenChange: (next) => {
                        if (next) {
                          setIsModelDropdownOpen(false);
                          setIsApprovalDropdownOpen(false);
                        }
                        setIsContextPopoverOpen(next);
                      }
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "relative flex h-8 items-center", ref: dropdownRef, children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                    ModelThinkingSelector,
                    {
                      open: isModelDropdownOpen,
                      disabled: busy && !onStop,
                      switching,
                      models,
                      selectedModel,
                      selectedThinking,
                      thinkingOptions: THINKING_OPTIONS.map((opt) => ({
                        ...opt,
                        label: t2(opt.label)
                      })),
                      selectModelLabel: t2("composer.selectModel"),
                      noModelsLabel: t2("composer.noModels"),
                      onOpenChange: (next) => {
                        if (next) {
                          setIsApprovalDropdownOpen(false);
                          setIsContextPopoverOpen(false);
                        }
                        setIsModelDropdownOpen(next);
                      },
                      onChooseModel: chooseModel,
                      onChooseThinking: chooseThinking
                    }
                  ) }),
                  /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(HoverInfo, { content: busy ? t2(stopping ? "composer.stopping" : "composer.stop") : void 0, children: /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
                    "button",
                    {
                      onClick: () => {
                        if (busy) {
                          onStop?.();
                        } else {
                          submitWithAttachments();
                        }
                      },
                      disabled: busy ? !onStop || stopping : !hasComposerContent,
                      "aria-label": busy ? t2(stopping ? "composer.stopping" : "composer.stop") : t2("composer.send"),
                      className: cn(
                        "composer-send-btn",
                        busy ? onStop ? "composer-send-btn--stop" : "composer-send-btn--idle" : hasComposerContent ? planMode ? "composer-send-btn--plan" : "composer-send-btn--ready" : "composer-send-btn--idle"
                      ),
                      children: stopping ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(import_lucide_react4.Loader2, { className: "h-3.5 w-3.5 animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(import_react_fontawesome4.FontAwesomeIcon, { icon: busy ? ["fas", "stop"] : ["fas", "arrow-up"], className: "text-[11px]" })
                    }
                  ) })
                ] })
              ] })
            ] })
          }
        ),
        footer && /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
          "div",
          {
            className: cn(
              "relative mt-2 flex min-h-[48px] w-full items-center overflow-visible rounded-[20px] bg-gradient-to-r from-hover-bg via-selection-bg/70 to-primary/10 px-3.5 py-2 shadow-[0_6px_20px_rgba(0,0,0,0.06)] group-focus-within/composer:shadow-[0_8px_24px_rgba(0,0,0,0.10)]",
              MOTION.standard
            ),
            children: footer
          }
        )
      ] });
    }
    var import_jsx_runtime26 = require2("react/jsx-runtime");
    var stops = [
      { value: "simple", label: "\u7B80\u5355", icon: import_lucide_react5.Feather },
      { value: "medium", label: "\u4E2D\u5EA6", icon: import_lucide_react5.Lightbulb },
      { value: "deep", label: "\u6DF1\u5EA6", icon: import_lucide_react5.Brain }
    ];
    function OriginalDemo({ bridge, variant }) {
      const [text, setText] = (0, import_react21.useState)("");
      const [value, setValue] = (0, import_react21.useState)(bridge.settings.thinking_depth);
      const draftKeyRef = (0, import_react21.useRef)(null);
      (0, import_react21.useEffect)(() => bridge.subscribe(() => {
        setValue(bridge.settings.thinking_depth);
        const key = bridge.options.draftTextKey;
        if (key != null && key !== draftKeyRef.current && typeof bridge.options.draftText === "string") {
          draftKeyRef.current = key;
          setText(bridge.options.draftText);
        }
      }), [bridge]);
      return /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("main", { className: "original-deep-agent-stage font-sans text-text-base", "data-original-ready": "true", children: variant === "slider" ? /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: "original-effort-section px-3 pb-1 pt-0.5", children: [
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("div", { className: "mb-2.5 flex items-center text-[12px]", children: /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("span", { className: "font-medium text-text-base", children: "\u63A8\u7406\u5F3A\u5EA6" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(EffortSlider, { stops, value, onChange: (next) => {
          setValue(next);
          void bridge.api.setThinkingDepth(next);
        }, ariaLabel: "\u63A8\u7406\u5F3A\u5EA6", disabled: bridge.options.disabled })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("div", { className: "original-composer-container", children: /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
        Composer,
        {
          value: text,
          onChange: setText,
          busy: bridge.options.busy ?? false,
          stopping: bridge.options.stopping ?? false,
          onStop: bridge.options.onStop,
          placeholder: bridge.options.placeholder,
          contextUsage: bridge.options.contextUsage ?? null,
          contextUsageFallbackTokens: bridge.options.contextUsageFallbackTokens ?? 0,
          onSubmit: (attachments = [], skills = [], mentions = [], displayText) => {
            bridge.submit(displayText ?? text, attachments, skills, mentions);
            setText("");
          }
        }
      ) }) });
    }
    import_fontawesome_svg_core.library.add(import_free_solid_svg_icons.faPlus, import_free_solid_svg_icons.faArrowUp, import_free_solid_svg_icons.faStop, import_free_solid_svg_icons.faFile, import_free_solid_svg_icons.faFileLines, import_free_solid_svg_icons.faListCheck, import_free_solid_svg_icons.faBullseye, import_free_solid_svg_icons.faPaperclip, import_free_solid_svg_icons.faCube, import_free_solid_svg_icons.faFolder, import_free_solid_svg_icons.faCircleCheck, import_free_solid_svg_icons.faCircleInfo, import_free_solid_svg_icons.faXmark);
    return module.exports;
  });
}
export {
  mountDeepAgentComposer
};
