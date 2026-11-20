/*!
bot-avatars@0.2.2 · Jakub Antalik · https://libraries.dev/bots

MIT License

Copyright (c) 2026 Jakub Antalik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// src/lib/motion-core/libraries-dev/select-choice.jsx
import { useId, useRef } from "react";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { jsx, jsxs } from "react/jsx-runtime";
function SelectChoice({ label, value, items, onChange, disabled = false }) {
  const id = useId();
  const container = useRef(null);
  const current = items.find(([key]) => key === value)?.[1];
  return /* @__PURE__ */ jsxs("div", { className: "library-field", ref: container, children: [
    /* @__PURE__ */ jsx("span", { id, children: label }),
    /* @__PURE__ */ jsxs(Select.Root, { value, onValueChange: (next) => {
      if (next != null) onChange(next);
    }, disabled, children: [
      /* @__PURE__ */ jsxs(Select.Trigger, { className: "library-select-trigger", "aria-labelledby": id, children: [
        /* @__PURE__ */ jsx("span", { children: current }),
        /* @__PURE__ */ jsx(Select.Icon, { children: /* @__PURE__ */ jsx(ChevronDown, { "aria-hidden": "true", size: 14 }) })
      ] }),
      /* @__PURE__ */ jsx(Select.Portal, { container, children: /* @__PURE__ */ jsx(Select.Positioner, { className: "library-select-positioner", align: "start", side: "top", sideOffset: 6, alignItemWithTrigger: false, children: /* @__PURE__ */ jsx(Select.Popup, { className: "library-select-popup", children: /* @__PURE__ */ jsx(Select.List, { children: items.map(([key, text]) => /* @__PURE__ */ jsxs(Select.Item, { value: key, className: "library-select-item", children: [
        /* @__PURE__ */ jsx(Select.ItemText, { children: text }),
        /* @__PURE__ */ jsx(Select.ItemIndicator, { children: /* @__PURE__ */ jsx(Check, { "aria-hidden": "true", size: 14 }) })
      ] }, key)) }) }) }) })
    ] })
  ] });
}

// src/lib/motion-core/libraries-dev/demo-controls.jsx
import { useId as useId2 } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function SegmentedChoice({ label, value, items, onChange, disabled = false }) {
  const name = useId2();
  return /* @__PURE__ */ jsxs2("fieldset", { className: "library-field", disabled, children: [
    /* @__PURE__ */ jsx2("legend", { children: label }),
    /* @__PURE__ */ jsx2("div", { className: "library-segments", children: items.map(([key, text]) => /* @__PURE__ */ jsxs2("label", { children: [
      /* @__PURE__ */ jsx2("input", { type: "radio", name, value: key, checked: key === value, onChange: () => onChange(key) }),
      /* @__PURE__ */ jsx2("span", { children: text })
    ] }, key)) })
  ] });
}

// src/lib/motion-core/libraries-dev/bot-avatars.jsx
import { useState } from "react";
import { BotAvatar, botAvatarTypes } from "bot-avatars";
import { Fragment, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var shapesZh = ["\u56DB\u53F6\u8349", "\u82B1\u6735", "\u4E09\u89D2", "\u65B9\u5757", "\u56E2\u5B50", "\u5E7D\u7075", "\u5706\u7403", "\u6C34\u6EF4", "\u661F\u661F", "\u673A\u5668\u4EBA", "\u673A\u7532", "\u5916\u661F\u4EBA", "\u516D\u8FB9\u5F62", "\u732B\u54AA", "\u4E91\u6735", "\u80F6\u56CA", "\u5375\u77F3", "\u6C34\u6D3C"];
var materials = {
  fabric: ["Fabric", "\u7ED2\u5E03"],
  plastic: ["Plastic", "\u4EAE\u9762\u5851\u6599"],
  crisp: ["Crisp", "\u9510\u5229\u8FB9\u7F18"],
  smooth: ["Smooth", "\u67D4\u548C\u8868\u9762"],
  flat: ["Flat", "\u54D1\u5149"]
};
var states = {
  default: ["Idle", "\u5F85\u547D"],
  working: ["Working", "\u5DE5\u4F5C\u4E2D"],
  sleeping: ["Sleeping", "\u4F11\u7720"]
};
var faces = { eyes: ["Eyes", "\u773C\u775B"], mouth: ["Eyes and mouth", "\u773C\u775B\u548C\u5634\u5DF4"] };
var css = `
.bot-demo-panel {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  justify-items: center;
  width: min(100%, 500px);
  min-height: 244px;
}
.bot-demo-avatar { width: min(42vw, 192px); }
.bot-demo-avatar canvas { display: block; }
.bot-demo-companion { opacity: .78; }
@media (max-width: 350px) {
  .bot-demo-panel { min-height: 205px; }
}
`;
function BotAvatarsScene({ reducedMotion, locale, options }) {
  const zh = locale === "zh";
  const [selectedType, setType] = useState("clover");
  const [selectedState, setState] = useState("default");
  const [selectedShading, setShading] = useState("fabric");
  const [selectedFace, setFace] = useState("eyes");
  const type = options.type ?? selectedType;
  const state = options.state ?? selectedState;
  const shading = options.shading ?? selectedShading;
  const face = options.face ?? selectedFace;
  return /* @__PURE__ */ jsxs3(Fragment, { children: [
    /* @__PURE__ */ jsx3("style", { children: css }),
    /* @__PURE__ */ jsx3("div", { className: "library-visual", children: /* @__PURE__ */ jsxs3("div", { className: "bot-demo-panel", children: [
      /* @__PURE__ */ jsx3(BotAvatar, { className: "bot-demo-companion", "aria-hidden": "true", type: "cat", shading: "plastic", state: "sleeping", size: "clamp(45px, 14vw, 92px)", paused: true }),
      /* @__PURE__ */ jsx3("div", { className: "bot-demo-avatar", children: /* @__PURE__ */ jsx3(BotAvatar, { type, state, shading, face, size: "100%", paused: reducedMotion }) }),
      /* @__PURE__ */ jsx3(BotAvatar, { className: "bot-demo-companion", "aria-hidden": "true", type: "star", state: "default", size: "clamp(45px, 14vw, 92px)", paused: true })
    ] }) }),
    /* @__PURE__ */ jsxs3("div", { className: "library-controls", children: [
      /* @__PURE__ */ jsx3(SelectChoice, { label: zh ? "\u9020\u578B" : "Shape", value: type, onChange: setType, disabled: options.type != null, items: botAvatarTypes.map((key, index) => [key, zh ? shapesZh[index] : key.charAt(0).toUpperCase() + key.slice(1)]) }),
      /* @__PURE__ */ jsx3(SegmentedChoice, { label: zh ? "\u72B6\u6001" : "State", value: state, onChange: setState, disabled: options.state != null, items: Object.entries(states).map(([key, labels]) => [key, labels[zh ? 1 : 0]]) }),
      /* @__PURE__ */ jsx3(SelectChoice, { label: zh ? "\u6750\u8D28" : "Material", value: shading, onChange: setShading, disabled: options.shading != null, items: Object.entries(materials).map(([key, labels]) => [key, labels[zh ? 1 : 0]]) }),
      /* @__PURE__ */ jsx3(SegmentedChoice, { label: zh ? "\u4E94\u5B98" : "Face", value: face, onChange: setFace, disabled: options.face != null, items: Object.entries(faces).map(([key, labels]) => [key, labels[zh ? 1 : 0]]) })
    ] })
  ] });
}

// src/lib/motion-core/libraries-dev/mount.jsx
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createSurface } from "./motion-runtime";
import { jsx as jsx4 } from "react/jsx-runtime";
var stylesBySlug = {
  "liquid-metal": ["metal-fx-styles", "mfx-bare-style", "mfx-bend-style"]
};
function Demo({ Scene, options, reducedMotion, preview, onReady }) {
  const locale = options.locale ?? "en";
  useEffect(() => {
    onReady?.();
  }, [onReady]);
  return /* @__PURE__ */ jsx4(
    "div",
    {
      className: "library-demo",
      lang: locale,
      "data-preview": preview,
      "data-controls": options.showControls !== false,
      "data-reduced": reducedMotion,
      children: /* @__PURE__ */ jsx4(Scene, { options, reducedMotion, preview, locale })
    }
  );
}
function mountLibraryDemo(target, initialOptions, scene2, settings = {}) {
  const { Scene, slug, width, height, css: css2 } = scene2;
  const { preview = false, onReady } = settings;
  let options = { ...initialOptions };
  let destroyed = false;
  const scope = createSurface(target, { markup: "", css: css2, width, height, responsive: true }, options);
  const reactRoot = createRoot(scope.body);
  const document = target.ownerDocument;
  const media = document.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
  const draw = () => reactRoot.render(
    /* @__PURE__ */ jsx4(Demo, { Scene, options, reducedMotion: scope.reduced() || document.hidden, preview, onReady })
  );
  const styleIds = stylesBySlug[slug];
  if (styleIds) {
    const mirror = () => {
      for (const id of styleIds) {
        const source = document.getElementById(id);
        if (source && !scope.root.getElementById(id)) scope.root.append(source.cloneNode(true));
      }
    };
    const observer = new document.defaultView.MutationObserver(mirror);
    observer.observe(document.head, { childList: true });
    scope.addCleanup(() => observer.disconnect());
    mirror();
  }
  scope.on(media, "change", draw);
  scope.on(document, "visibilitychange", draw);
  draw();
  return {
    ...scope.controller,
    update(next) {
      if (destroyed) return;
      options = { ...options, ...next };
      scope.controller.update(next);
      draw();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scope.controller.destroy();
      queueMicrotask(() => reactRoot.unmount());
    }
  };
}

// src/lib/motion-core/libraries-dev/bot-avatars-entry.js
var scene = { slug: "bot-avatars", width: 820, height: 440, css: ".library-demo {\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  gap: 18px;\n  padding: 20px 16px;\n  min-height: var(--motion-height);\n  background: #fff;\n  color: #111;\n  color-scheme: light;\n  font: 14px/1.4 system-ui, sans-serif;\n}\n\n.library-visual {\n  display: grid;\n  place-items: center;\n  width: 100%;\n  min-width: 0;\n  flex: 1;\n}\n\n.library-demo[data-preview=true] .library-controls,\n.library-demo[data-controls=false] .library-controls {\n  display: none;\n}\n\n.library-controls {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-start;\n  align-items: end;\n  gap: 12px 18px;\n  width: min(100%, 560px);\n  margin: 0;\n  padding-top: 12px;\n  border-top: 1px solid #ededed;\n}\n\n.library-field {\n  display: grid;\n  min-width: 0;\n  max-width: 100%;\n  gap: 5px;\n  padding: 0;\n  margin: 0;\n  border: 0;\n  color: #646464;\n  font: 500 12px/1.35 system-ui, sans-serif;\n}\n\n.library-field legend { margin-bottom: 5px; padding: 0; }\n.library-segments {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 3px;\n}\n.library-segments label { position: relative; display: grid; cursor: pointer; }\n.library-segments input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; margin: 0; cursor: inherit; }\n.library-segments span,\n.library-controls > button,\n.library-select-trigger {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 32px;\n  max-width: 100%;\n  padding: 4px 8px;\n  border: 0;\n  border-radius: 6px;\n  background: #f4f4f4;\n  color: #111;\n  font: 500 13px/1.35 system-ui, sans-serif;\n}\n.library-segments input:checked + span,\n.library-controls > button[aria-pressed=true] { background: #111; color: #fff; }\n.library-segments input:disabled + span { opacity: .55; }\n.library-segments label:has(:disabled) { cursor: default; }\n.library-controls > button, .library-select-trigger { cursor: pointer; }\n.library-controls :is(button, input):disabled { cursor: default; }\n.library-controls > button:disabled, .library-select-trigger:disabled { opacity: .55; }\n.library-select-trigger {\n  justify-content: space-between;\n  gap: 10px;\n  min-width: 88px;\n  background: #fff;\n  box-shadow: inset 0 0 0 1px #e5e5e5;\n}\n.library-select-trigger svg, .library-select-item svg { display: block; }\n.library-select-positioner { z-index: 8; }\n.library-select-popup {\n  min-width: var(--anchor-width);\n  max-height: min(248px, var(--available-height));\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  outline: none;\n  padding: 4px;\n  border-radius: 9px;\n  background: #fff;\n  box-shadow: 0 4px 16px #0002;\n  color: #111;\n  font: 500 13px/1.35 system-ui, sans-serif;\n}\n.library-select-item {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 12px;\n  min-height: 32px;\n  padding: 4px 8px;\n  border-radius: 5px;\n  cursor: pointer;\n  outline: none;\n}\n.library-select-item[data-highlighted], .library-select-trigger[data-popup-open] { background: #f4f4f4; }\n.library-range-row { display: flex; align-items: center; gap: 6px; }\n.library-range-value { min-width: 3ch; color: #111; font-variant-numeric: tabular-nums; }\n.library-controls input[type=range] { width: 86px; min-height: 32px; margin: 0; accent-color: #111; }\n.library-demo :is(button, input):focus-visible,\n.library-segments input:focus-visible + span {\n  outline: 2px solid #2563eb;\n  outline-offset: 2px;\n}\n.library-demo[data-reduced=true] :is(.library-visual, .library-visual *) {\n  animation-play-state: paused !important;\n  transition-duration: 0s !important;\n}\n\n@media (max-width: 360px) {\n  .library-demo { padding: 12px; gap: 12px; }\n  .library-controls { gap: 8px 12px; }\n}\n", Scene: BotAvatarsScene };
function mountBotAvatars(target, options = {}) {
  return mountLibraryDemo(target, options, scene);
}
export {
  mountBotAvatars
};
