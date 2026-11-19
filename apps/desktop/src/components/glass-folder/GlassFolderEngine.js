// Native DOM port of the preserved reference HTML. No iframe or runtime eval.
import { createSurface } from "./motion-runtime";
export function mountGlassFolder(target, options = {}) {
const scope = createSurface(target, {"markup":"<main class=\"glass-folder-demo\" aria-label=\"Glass folder card\"><div class=\"gf-demo-slot\"></div></main>","css":"html,body{margin:0;min-height:100%;background:transparent}body{font-family:Arial,sans-serif}.glass-folder-demo{box-sizing:border-box;min-height:0;width:100%;padding:8px 0 4px;background:transparent;display:grid;grid-template-columns:minmax(0,1fr);gap:0;align-items:start;justify-items:stretch;overflow:visible}.gf-demo-slot{position:relative;width:100%;min-width:0;max-width:100%;padding-top:18px}.gf-feedback{position:absolute;top:100%;left:0;right:0;margin-top:16px;font-size:12px;line-height:1.6;text-align:center;color:#53535c;min-height:20px}.gf-root .gf-sheet:disabled{cursor:default}@media(max-width:800px){.glass-folder-demo{padding:40px 12px 56px}.gf-demo-slot{padding-top:20px}}\n\n.gf-root {\n  --gf-px: 0;\n  --gf-py: 0;\n  --gf-ease: cubic-bezier(.2, .8, .2, 1);\n  --gf-spring: cubic-bezier(.34, 1.36, .5, 1);\n  --gf-hinge: 0deg;\n  --gf-lift: 42px;\n  --gf-spread: 0px;\n  --gf-fan: 0deg;\n  --gf-stack: 15px;\n  --gf-ink: #141416;\n  --gf-ink-soft: rgba(20, 20, 22, .55);\n  position: relative;\n  display: inline-block;\n  flex: none;\n  vertical-align: top;\n  font-family: ui-sans-serif, system-ui, -apple-system, \"SF Pro Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;\n  -webkit-font-smoothing: antialiased;\n  -webkit-tap-highlight-color: transparent;\n  isolation: isolate;\n}\n.gf-root[data-tone=\"dark\"] { --gf-ink: #f5f5f7; --gf-ink-soft: rgba(245, 245, 247, .58); }\n.gf-root:hover, .gf-root:focus-within { --gf-hinge: -11deg; --gf-lift: -34px; --gf-spread: 8px; --gf-fan: 1.4deg; --gf-stack: 10px; }\n.gf-root[data-open] { --gf-hinge: -24deg; --gf-lift: -96px; --gf-spread: 40px; --gf-fan: 5deg; --gf-stack: 30px; }\n\n.gf-stage {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: 340px;\n  height: 272px;\n  transform-origin: 0 0;\n}\n.gf-tilt {\n  position: absolute;\n  inset: 0;\n  transform: perspective(1400px) rotateX(calc(var(--gf-py) * -3deg)) rotateY(calc(var(--gf-px) * 4deg));\n  transition: transform .9s var(--gf-ease);\n}\n\n.gf-shadow {\n  position: absolute;\n  left: 18px;\n  right: 18px;\n  bottom: -6px;\n  height: 60px;\n  border-radius: 40px;\n  background: rgba(16, 18, 24, .34);\n  filter: blur(22px);\n  transform: translateX(calc(var(--gf-px) * -8px));\n  transition: transform .9s var(--gf-ease), opacity .9s var(--gf-ease);\n}\n.gf-root[data-tone=\"dark\"] .gf-shadow { background: rgba(0, 0, 0, .62); }\n\n.gf-back {\n  position: absolute;\n  inset: 0;\n  overflow: hidden;\n  background: linear-gradient(180deg, #f3f3f4 0%, #e3e3e6 100%);\n}\n.gf-root[data-tone=\"dark\"] .gf-back { background: linear-gradient(180deg, #2a2a2e 0%, #121214 100%); }\n.gf-art {\n  position: absolute;\n  left: -12px;\n  top: -12px;\n  max-width: none;\n  object-fit: cover;\n  transform: translate(calc(var(--gf-px) * -7px), calc(var(--gf-py) * -6px)) scale(1.02);\n  transition: transform 1.1s var(--gf-ease), opacity 1.2s var(--gf-ease), filter 1.2s var(--gf-ease);\n}\ncanvas.gf-art { opacity: 0; filter: blur(14px) saturate(.6); }\ncanvas.gf-art[data-ready] { opacity: 1; filter: none; }\n.gf-back-sheen {\n  position: absolute;\n  inset: 0;\n  background:\n    linear-gradient(180deg, rgba(255, 255, 255, .22) 0%, rgba(255, 255, 255, 0) 22%),\n    radial-gradient(120% 80% at 80% 0%, rgba(255, 255, 255, .16), rgba(255, 255, 255, 0) 60%);\n  pointer-events: none;\n}\n\n.gf-rim {\n  position: absolute;\n  left: 0;\n  top: 0;\n  max-width: none;\n  overflow: visible;\n  pointer-events: none;\n  fill: none;\n}\n.gf-back-rim { width: 340px; height: 272px; }\n.gf-back-rim path { stroke: rgba(255, 255, 255, .45); stroke-width: 1; }\n.gf-root[data-tone=\"dark\"] .gf-back-rim path { stroke: rgba(255, 255, 255, .16); }\n\n.gf-files {\n  position: absolute;\n  inset: 0;\n  z-index: 5;\n  pointer-events: none;\n  clip-path: inset(-400px -400px 10px -400px);\n}\n.gf-sheet-slot { display: contents; }\n.gf-sheet {\n  all: unset;\n  box-sizing: border-box;\n  position: absolute;\n  left: 34px;\n  top: 96px;\n  width: 272px;\n  height: 184px;\n  border-radius: 16px;\n  overflow: hidden;\n  cursor: pointer;\n  pointer-events: auto;\n  background: linear-gradient(180deg, #ffffff 0%, #f2f2f0 100%);\n  box-shadow:\n    inset 0 1px 0 rgba(255, 255, 255, .9),\n    0 0 0 .5px rgba(0, 0, 0, .1),\n    0 10px 26px -8px rgba(10, 12, 20, .28);\n  transform-origin: 50% 100%;\n  transform:\n    translate(calc(var(--gf-jx) + var(--gf-slot) * var(--gf-spread)), calc(var(--gf-lift) + var(--gf-depth) * var(--gf-stack) * -1))\n    rotate(calc(var(--gf-jr) + var(--gf-slot) * var(--gf-fan)));\n  transition:\n    transform .75s var(--gf-spring) calc(var(--gf-depth) * 40ms),\n    box-shadow .4s var(--gf-ease),\n    translate .9s var(--gf-ease),\n    opacity .9s var(--gf-ease);\n}\n.gf-root[data-tone=\"dark\"] .gf-sheet { background: linear-gradient(180deg, #2c2c30 0%, #1c1c1f 100%); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .14), 0 0 0 .5px rgba(255, 255, 255, .08), 0 12px 28px -8px rgba(0, 0, 0, .7); }\n.gf-sheet--art { background: #1a1a1d; }\n.gf-root[data-open] .gf-sheet:hover,\n.gf-root[data-open] .gf-sheet:focus-visible {\n  transform:\n    translate(calc(var(--gf-jx) + var(--gf-slot) * var(--gf-spread)), calc(var(--gf-lift) + var(--gf-depth) * var(--gf-stack) * -1 - 18px))\n    rotate(calc(var(--gf-slot) * var(--gf-fan) * .6));\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9), 0 0 0 .5px rgba(0, 0, 0, .1), 0 22px 40px -12px rgba(10, 12, 20, .42);\n  transition-delay: 0s;\n}\n.gf-sheet:focus-visible { outline: 2px solid #4c8dff; outline-offset: 2px; }\n.gf-sheet-art {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: 272px;\n  height: 184px;\n  max-width: none;\n  object-fit: cover;\n  transition: opacity .9s var(--gf-ease), filter .9s var(--gf-ease);\n}\ncanvas.gf-sheet-art { opacity: 0; filter: blur(10px); }\ncanvas.gf-sheet-art[data-ready] { opacity: 1; filter: none; }\n.gf-sheet--art::after {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  border-radius: inherit;\n  background: linear-gradient(180deg, rgba(0, 0, 0, .42) 0%, rgba(0, 0, 0, 0) 34%);\n  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .2);\n  pointer-events: none;\n}\n.gf-sheet-head {\n  position: absolute;\n  left: 14px;\n  right: 14px;\n  top: 11px;\n  z-index: 1;\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: 10px;\n  white-space: nowrap;\n}\n.gf-sheet-name {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  font-size: 12.5px;\n  font-weight: 560;\n  letter-spacing: -.005em;\n  color: #18181b;\n}\n.gf-sheet-meta {\n  flex: none;\n  font-family: ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 10px;\n  letter-spacing: .02em;\n  color: rgba(24, 24, 27, .5);\n}\n.gf-root[data-tone=\"dark\"] .gf-sheet-name, .gf-sheet--art .gf-sheet-name { color: #fafafa; }\n.gf-root[data-tone=\"dark\"] .gf-sheet-meta, .gf-sheet--art .gf-sheet-meta { color: rgba(250, 250, 250, .66); }\n.gf-lines {\n  position: absolute;\n  left: 14px;\n  right: 14px;\n  top: 40px;\n  display: flex;\n  flex-direction: column;\n  gap: 9px;\n}\n.gf-lines i {\n  display: block;\n  height: 5px;\n  border-radius: 3px;\n  background: rgba(24, 24, 27, .08);\n}\n.gf-lines i:first-child { height: 9px; margin-bottom: 4px; background: rgba(24, 24, 27, .14); }\n.gf-root[data-tone=\"dark\"] .gf-lines i { background: rgba(255, 255, 255, .08); }\n.gf-root[data-tone=\"dark\"] .gf-lines i:first-child { background: rgba(255, 255, 255, .16); }\n\n.gf-sheet--drop { animation: gf-drop .85s var(--gf-ease) both; }\n@keyframes gf-drop {\n  0% { translate: 0 -190px; rotate: -9deg; opacity: 0; }\n  35% { opacity: 1; }\n  72% { translate: 0 10px; rotate: 1deg; }\n  100% { translate: 0 0; rotate: 0deg; opacity: 1; }\n}\n\n.gf-front {\n  position: absolute;\n  left: 0;\n  top: 74px;\n  width: 340px;\n  height: 198px;\n  z-index: 10;\n  -webkit-backdrop-filter: blur(22px) saturate(1.5);\n  backdrop-filter: blur(22px) saturate(1.5);\n  transform-origin: 50% 100%;\n  transform: perspective(760px) rotateX(var(--gf-hinge));\n  transition: transform .8s var(--gf-spring), translate 1s var(--gf-ease), opacity 1s var(--gf-ease);\n}\n.gf-front--bump { animation: gf-bump .7s var(--gf-ease) .38s both; }\n@keyframes gf-bump {\n  0% { scale: 1; }\n  35% { scale: 1.018 .975; }\n  70% { scale: .996 1.006; }\n  100% { scale: 1; }\n}\n.gf-tint {\n  position: absolute;\n  inset: 0;\n  background:\n    linear-gradient(180deg, rgba(255, 255, 255, .16) 0%, rgba(255, 255, 255, .5) 42%, rgba(252, 252, 252, .93) 100%);\n}\n.gf-root[data-tone=\"dark\"] .gf-tint {\n  background: linear-gradient(180deg, rgba(18, 18, 20, .18) 0%, rgba(14, 14, 16, .62) 46%, rgba(8, 8, 10, .94) 100%);\n}\n.gf-spec {\n  position: absolute;\n  inset: 0;\n  background: radial-gradient(260px 200px at calc(50% + var(--gf-px) * 46%) calc(30% + var(--gf-py) * 40%), rgba(255, 255, 255, .5), rgba(255, 255, 255, 0) 70%);\n  mix-blend-mode: soft-light;\n  opacity: .9;\n  transition: background-position .6s var(--gf-ease);\n  pointer-events: none;\n}\n.gf-root[data-tone=\"dark\"] .gf-spec { mix-blend-mode: screen; opacity: .16; }\n.gf-front-rim { width: 340px; height: 198px; }\n.gf-front-rim path { stroke-width: 2.4; transition: stroke-width .3s var(--gf-ease); }\n.gf-root[data-tone=\"dark\"] .gf-front-rim { opacity: .55; }\n\n.gf-hit {\n  all: unset;\n  position: absolute;\n  inset: 0;\n  z-index: 1;\n  cursor: pointer;\n}\n.gf-hit:focus-visible ~ .gf-label .gf-title { text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 4px; }\n.gf-front:has(.gf-hit:focus-visible) .gf-front-rim path { stroke-width: 5; }\n\n.gf-label {\n  position: absolute;\n  z-index: 2;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  max-width: 200px;\n  pointer-events: none;\n  color: var(--gf-ink);\n}\n.gf-root[data-place=\"bottom-left\"] .gf-label { left: 28px; bottom: 32px; }\n.gf-root[data-place=\"top-left\"] .gf-label { left: 28px; top: 34px; }\n.gf-root[data-place=\"top-right\"] .gf-label { right: 32px; top: 52px; align-items: flex-start; }\n.gf-title {\n  font-size: 18px;\n  font-weight: 500;\n  line-height: 1.15;\n  letter-spacing: -.012em;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.gf-meta {\n  font-family: ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 12px;\n  letter-spacing: .03em;\n  color: var(--gf-ink-soft);\n  white-space: nowrap;\n  animation: gf-roll .5s var(--gf-ease) both;\n}\n@keyframes gf-roll {\n  from { opacity: 0; translate: 0 7px; filter: blur(3px); }\n  to { opacity: 1; translate: 0 0; filter: blur(0); }\n}\n\n.gf-key {\n  all: unset;\n  box-sizing: border-box;\n  position: absolute;\n  right: 22px;\n  bottom: 22px;\n  z-index: 12;\n  width: 58px;\n  height: 58px;\n  border-radius: 18px;\n  display: grid;\n  place-items: center;\n  cursor: pointer;\n  transition: transform .35s var(--gf-spring), box-shadow .35s var(--gf-ease), background .35s var(--gf-ease);\n}\n.gf-key:hover { transform: translateY(-2px); }\n.gf-key:active { transform: translateY(0) scale(.93); transition-duration: .12s; }\n.gf-key:focus-visible { outline: 2px solid #4c8dff; outline-offset: 3px; }\n.gf-key--add {\n  color: #fff;\n  background: radial-gradient(120% 90% at 50% 0%, #3a3a3f 0%, #121214 55%, #050506 100%);\n  box-shadow:\n    inset 0 1px 0 rgba(255, 255, 255, .22),\n    inset 0 -3px 8px rgba(0, 0, 0, .7),\n    0 0 0 1px rgba(0, 0, 0, .75),\n    0 14px 22px -8px rgba(0, 0, 0, .55),\n    0 3px 6px -2px rgba(0, 0, 0, .35);\n}\n.gf-root[data-tone=\"dark\"] .gf-key--add {\n  color: #111113;\n  background: radial-gradient(120% 90% at 50% 0%, #ffffff 0%, #ececee 55%, #d2d2d6 100%);\n  box-shadow: inset 0 1px 0 #fff, inset 0 -3px 8px rgba(0, 0, 0, .14), 0 0 0 1px rgba(0, 0, 0, .4), 0 14px 22px -8px rgba(0, 0, 0, .7);\n}\n.gf-key--more {\n  color: #111113;\n  background: linear-gradient(180deg, rgba(255, 255, 255, .92) 0%, rgba(226, 226, 230, .82) 100%);\n  -webkit-backdrop-filter: blur(10px);\n  backdrop-filter: blur(10px);\n  box-shadow:\n    inset 0 1px 0 #fff,\n    inset 0 -2px 4px rgba(0, 0, 0, .06),\n    0 0 0 1px rgba(0, 0, 0, .16),\n    0 10px 18px -8px rgba(0, 0, 0, .3);\n}\n.gf-root[data-tone=\"dark\"] .gf-key--more {\n  color: #f5f5f7;\n  background: linear-gradient(180deg, rgba(255, 255, 255, .16) 0%, rgba(255, 255, 255, .06) 100%);\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .22), 0 0 0 1px rgba(255, 255, 255, .1), 0 10px 18px -8px rgba(0, 0, 0, .6);\n}\n.gf-key--more[aria-expanded=\"true\"] { transform: scale(.96); }\n.gf-glyph { display: block; max-width: none; fill: none; stroke: currentColor; stroke-linecap: round; }\n.gf-glyph--plus { width: 26px; height: 26px; stroke-width: 1.6; animation: gf-turn .6s var(--gf-spring); }\n.gf-glyph--more { width: 30px; height: 12px; stroke-width: 1.7; }\n@keyframes gf-turn { from { rotate: -90deg; } to { rotate: 0deg; } }\n\n.gf-menu {\n  position: absolute;\n  right: 22px;\n  bottom: 90px;\n  z-index: 20;\n  min-width: 176px;\n  padding: 6px;\n  border-radius: 16px;\n  display: flex;\n  flex-direction: column;\n  background: rgba(252, 252, 253, .72);\n  -webkit-backdrop-filter: blur(24px) saturate(1.6);\n  backdrop-filter: blur(24px) saturate(1.6);\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9), 0 0 0 .5px rgba(0, 0, 0, .14), 0 24px 48px -16px rgba(10, 12, 20, .4);\n  transform-origin: 100% 100%;\n  opacity: 0;\n  visibility: hidden;\n  transform: translateY(6px) scale(.94);\n  transition: opacity .2s var(--gf-ease), transform .32s var(--gf-spring), visibility 0s .32s;\n}\n.gf-menu[data-open] { opacity: 1; visibility: visible; transform: none; transition-delay: 0s; }\n.gf-root[data-tone=\"dark\"] .gf-menu { background: rgba(30, 30, 34, .72); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .1), 0 0 0 .5px rgba(255, 255, 255, .1), 0 24px 48px -16px rgba(0, 0, 0, .8); }\n.gf-menu-item {\n  all: unset;\n  box-sizing: border-box;\n  padding: 9px 12px;\n  border-radius: 10px;\n  font-size: 13.5px;\n  font-weight: 450;\n  color: #18181b;\n  cursor: pointer;\n}\n.gf-root[data-tone=\"dark\"] .gf-menu-item { color: #f4f4f5; }\n.gf-menu-item:hover, .gf-menu-item:focus-visible { background: rgba(24, 24, 27, .07); }\n.gf-root[data-tone=\"dark\"] .gf-menu-item:hover, .gf-root[data-tone=\"dark\"] .gf-menu-item:focus-visible { background: rgba(255, 255, 255, .09); }\n.gf-menu-item--danger { color: #d92d20; }\n.gf-root[data-tone=\"dark\"] .gf-menu-item--danger { color: #ff6b5e; }\n\n.gf-root:not([data-entered]) .gf-back,\n.gf-root:not([data-entered]) .gf-back-rim { translate: 0 22px; opacity: 0; }\n.gf-root:not([data-entered]) .gf-sheet { translate: 0 -120px; opacity: 0; }\n.gf-root:not([data-entered]) .gf-front { translate: 0 46px; opacity: 0; }\n.gf-root:not([data-entered]) .gf-key { opacity: 0; scale: .6; }\n.gf-root:not([data-entered]) .gf-shadow { opacity: 0; }\n.gf-back, .gf-back-rim { transition: translate 1s var(--gf-ease), opacity .9s var(--gf-ease); }\n.gf-root[data-entered] .gf-sheet { transition-delay: calc(var(--gf-depth) * 40ms), 0s, calc(.18s + var(--gf-depth) * 90ms), calc(.18s + var(--gf-depth) * 90ms); }\n.gf-root[data-entered] .gf-front { transition-delay: 0s, .42s, .42s; }\n.gf-key { transition: transform .35s var(--gf-spring), box-shadow .35s var(--gf-ease), opacity .6s var(--gf-ease) .7s, scale .7s var(--gf-spring) .7s; }\n\n@media (prefers-reduced-motion: reduce) {\n  .gf-root *, .gf-root *::before, .gf-root *::after {\n    transition-duration: 0s !important;\n    transition-delay: 0s !important;\n    animation: none !important;\n  }\n  .gf-tilt { transform: none; }\n}\n","width":340,"height":280,"responsive":true}, options);
const { document, window, requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout, setInterval, clearInterval, ResizeObserver, IntersectionObserver, matchMedia } = scope;

let liveOptions = { ...options };

const ART_PRESETS = {
    aurora: {
        style: "streak",
        colors: ["#f4efe9", "#e9c2b8", "#c2433f", "#2a1e2a", "#22395e", "#6f97c2", "#e5edf4"],
        scale: 0.7,
        warp: 1.4,
        angle: -0.62,
        gloss: 0.18,
        veins: 0,
    },
    ember: {
        style: "marble",
        colors: ["#07090c", "#16252c", "#3d5f68", "#1a1416", "#a3201a", "#ef4a2b", "#ff8a5c"],
        scale: 0.62,
        warp: 3.2,
        angle: -0.5,
        gloss: 0.55,
        veins: 0.6,
    },
    dusk: {
        style: "marble",
        colors: ["#120c18", "#3e2850", "#8f6c9c", "#2b1a24", "#b3502f", "#eab08a", "#fbe7d2"],
        scale: 0.75,
        warp: 3.6,
        angle: 0.8,
        gloss: 0.5,
        veins: 0.5,
    },
    glacier: {
        style: "streak",
        colors: ["#f7f8fa", "#d9e2ea", "#9fb4c7", "#e8edf2", "#bccbd8", "#ffffff"],
        scale: 0.7,
        warp: 1.6,
        angle: 0.35,
        gloss: 0.25,
        veins: 0,
    },
    verdant: {
        style: "marble",
        colors: ["#070b08", "#173024", "#4f7a5a", "#141812", "#a7843a", "#e9cf87", "#fbf3d6"],
        scale: 0.7,
        warp: 3.4,
        angle: 2.1,
        gloss: 0.5,
        veins: 0.5,
    },
};
function hexToRgb(hex) {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3)
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = /^[0-9a-f]{6}$/i.test(h) ? parseInt(h, 16) : 0x808080;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++)
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}
function makeFbm(seed) {
    const r = rng(seed);
    const perm = new Uint8Array(512);
    const grad = new Float32Array(512);
    const p = [];
    for (let i = 0; i < 256; i++)
        p.push(i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = p[i];
        p[i] = p[j];
        p[j] = t;
    }
    for (let i = 0; i < 512; i++)
        perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
        const a = r() * Math.PI * 2;
        grad[i * 2] = Math.cos(a);
        grad[i * 2 + 1] = Math.sin(a);
    }
    const noise = (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const xf = x - xi;
        const yf = y - yi;
        const X = xi & 255;
        const Y = yi & 255;
        const h00 = perm[X + perm[Y]] * 2;
        const h10 = perm[X + 1 + perm[Y]] * 2;
        const h01 = perm[X + perm[Y + 1]] * 2;
        const h11 = perm[X + 1 + perm[Y + 1]] * 2;
        const d00 = grad[h00] * xf + grad[h00 + 1] * yf;
        const d10 = grad[h10] * (xf - 1) + grad[h10 + 1] * yf;
        const d01 = grad[h01] * xf + grad[h01 + 1] * (yf - 1);
        const d11 = grad[h11] * (xf - 1) + grad[h11 + 1] * (yf - 1);
        const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
        const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
        return d00 + u * (d10 - d00) + v * (d01 - d00 + u * (d11 - d01 - d10 + d00));
    };
    return (x, y, octaves) => {
        let sum = 0;
        let amp = 0.5;
        for (let i = 0; i < octaves; i++) {
            sum += amp * noise(x, y);
            const nx = 1.6 * x + 1.2 * y + 7.1;
            y = -1.2 * x + 1.6 * y + 3.3;
            x = nx;
            amp *= 0.5;
        }
        return sum;
    };
}
function createArtJob(width, height, recipe, seed) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const colors = recipe.colors.length >= 2 ? recipe.colors : ["#111111", "#eeeeee"];
    const stops = colors.map((c, i) => ({ t: i / (colors.length - 1), c: hexToRgb(c) }));
    const scale = recipe.scale ?? 0.7;
    const warp = recipe.warp ?? 3;
    const gloss = recipe.gloss ?? 0.4;
    const veins = recipe.veins ?? 0;
    const streak = recipe.style === "streak";
    const fbm = makeFbm(seed * 977 + 13);
    const r = rng(seed + 1);
    const ox = r() * 50;
    const oy = r() * 50;
    const angle = (recipe.angle ?? 0) + (r() - 0.5) * 0.5;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const m = Math.min(w, h);
    const gw = Math.ceil(w / 2) + 3;
    const gh = Math.ceil(h / 2) + 3;
    const G = new Float32Array(gw * gh);
    const GQ = new Float32Array(gw * gh);
    const F = new Float32Array(w * h);
    const Q = new Float32Array(w * h);
    const pixels = new Uint8ClampedArray(w * h * 4);
    let row = 0;
    const field = (gy) => {
        for (let gx = 0; gx < gw; gx++) {
            const u = ((gx - 1) * 2 - w / 2) / m;
            const v = ((gy - 1) * 2 - h / 2) / m;
            let px = (u * ca - v * sa) * scale;
            let py = (u * sa + v * ca) * scale;
            if (streak) {
                px *= 0.14;
                py *= 2.2;
            }
            px += ox;
            py += oy;
            const qx = fbm(px, py, 3);
            const qy = fbm(px + 5.2, py + 1.3, 3);
            const rx = fbm(px + warp * qx + 1.7, py + warp * qy + 9.2, 3);
            const ry = fbm(px + warp * qx + 8.3, py + warp * qy + 2.8, 3);
            G[gy * gw + gx] = fbm(px + warp * rx, py + warp * ry, 4);
            GQ[gy * gw + gx] = Math.sqrt(qx * qx + qy * qy);
        }
    };
    const upsample = () => {
        const cr = (a, b, c, d) => (-a + 9 * b + 9 * c - d) / 16;
        const T = new Float32Array(w * gh);
        for (let gy = 0; gy < gh; gy++) {
            const r = gy * gw;
            for (let x = 0; x < w; x++) {
                const c = (x >> 1) + 1;
                T[gy * w + x] = x & 1 ? cr(G[r + c - 1], G[r + c], G[r + c + 1], G[r + c + 2]) : G[r + c];
            }
        }
        for (let y = 0; y < h; y++) {
            const c = (y >> 1) + 1;
            for (let x = 0; x < w; x++) {
                F[y * w + x] =
                    y & 1 ? cr(T[(c - 1) * w + x], T[c * w + x], T[(c + 1) * w + x], T[(c + 2) * w + x]) : T[c * w + x];
                const gx = (x >> 1) + 1;
                const q0 = GQ[c * gw + gx];
                const qx = x & 1 ? (q0 + GQ[c * gw + gx + 1]) / 2 : q0;
                const q1 = y & 1 ? (x & 1 ? (GQ[(c + 1) * gw + gx] + GQ[(c + 1) * gw + gx + 1]) / 2 : GQ[(c + 1) * gw + gx]) : qx;
                Q[y * w + x] = (qx + q1) / 2;
            }
        }
    };
    const colorize = () => {
        const sample = [];
        const stride = Math.max(1, Math.floor(F.length / 4096));
        for (let i = 0; i < F.length; i += stride)
            sample.push(F[i]);
        sample.sort((a, b) => a - b);
        const lo = sample[Math.floor(sample.length * 0.02)];
        const hi = sample[Math.floor(sample.length * 0.98)];
        const k = 1 / (hi - lo || 1);
        const lx = -0.55;
        const ly = -0.65;
        const lz = 0.52;
        const slope = k * m * 0.012;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                let t = (F[i] - lo) * k;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                let j = 1;
                while (j < stops.length - 1 && stops[j].t < t)
                    j++;
                const a = stops[j - 1];
                const b = stops[j];
                let f = (t - a.t) / (b.t - a.t || 1);
                f = f < 0 ? 0 : f > 1 ? 1 : f;
                f = f * f * (3 - 2 * f);
                const gx = (F[x < w - 1 ? i + 1 : i] - F[x > 0 ? i - 1 : i]) * slope;
                const gy = (F[y < h - 1 ? i + w : i] - F[y > 0 ? i - w : i]) * slope;
                const nd = (-gx * lx - gy * ly + lz) / Math.sqrt(gx * gx + gy * gy + 1);
                const spec = Math.pow(nd > 0 ? nd : 0, 24) * gloss * 255;
                const silk = 1 + 0.035 * Math.sin(t * 150 + Q[i] * 24);
                const vein = veins * Math.max(0, 1 - Math.abs(Q[i] - 0.42) * 14) * 0.6;
                const lit = (0.82 + 0.28 * nd) * silk * (1 - vein);
                pixels[i * 4] = (a.c[0] + (b.c[0] - a.c[0]) * f) * lit + spec;
                pixels[i * 4 + 1] = (a.c[1] + (b.c[1] - a.c[1]) * f) * lit + spec;
                pixels[i * 4 + 2] = (a.c[2] + (b.c[2] - a.c[2]) * f) * lit + spec;
                pixels[i * 4 + 3] = 255;
            }
        }
    };
    const step = (rows) => {
        if (row >= gh)
            return true;
        const end = Math.min(gh, row + Math.max(1, rows));
        while (row < end)
            field(row++);
        if (row < gh)
            return false;
        upsample();
        colorize();
        return true;
    };
    return { width: w, height: h, pixels, step };
}
function fanSlot(index, count) {
    return count <= 1 ? 0 : (index / (count - 1)) * 2 - 1;
}

const W = 340;
const H = 272;
const HEADROOM = 54;
const FRONT_TOP = 74;
const FRONT_H = H - FRONT_TOP;
const SHEET_W = 272;
const SHEET_H = 184;
const BACK_PATH = "M0 56A22 22 0 0 1 22 34L146 34C170 34 172 0 198 0L318 0A22 22 0 0 1 340 22L340 250A22 22 0 0 1 318 272L22 272A22 22 0 0 1 0 250Z";
const FRONT_PATH = "M0 22A22 22 0 0 1 22 0L118 0C144 0 146 32 172 32L318 32A22 22 0 0 1 340 54L340 " +
    (FRONT_H - 22) +
    "A22 22 0 0 1 318 " +
    FRONT_H +
    "L22 " +
    FRONT_H +
    "A22 22 0 0 1 0 " +
    (FRONT_H - 22) +
    "Z";
const MAX_VISIBLE = 4;
const SAMPLE_FILES = [
    { name: "Cover — final", meta: "PNG · 4.8 MB", art: "ember" },
    { name: "Moodboard", meta: "24 images", art: "dusk" },
    { name: "Brief.pdf", meta: "PDF · 1.2 MB" },
];

const recipeOf=art=>typeof art==='string'?ART_PRESETS[art]:art;
const artCache=new Map();
const paintQueue=[];
let painting=false,backsReady=0;
const reduceMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function paint(recipe,seed,w,h,priority=0){
  const key=JSON.stringify([recipe,seed,w,h]);
  if(artCache.has(key))return artCache.get(key);
  const promise=new Promise(done=>{
    let at=paintQueue.length;while(at>1&&paintQueue[at-1].priority>priority)at--;
    paintQueue.splice(at,0,{job:createArtJob(w,h,recipe,seed),priority,done});
    if(painting)return;painting=true;
    function tick(){
      const until=performance.now()+7;
      while(paintQueue.length&&performance.now()<until){
        const head=paintQueue[0];if(!head.job.step(4))continue;
        paintQueue.shift();const c=document.createElement('canvas');c.width=head.job.width;c.height=head.job.height;
        c.getContext('2d').putImageData(new ImageData(head.job.pixels,c.width,c.height),0,0);head.done(c);
      }
      if(paintQueue.length){if(reduceMotion())setTimeout(tick,0);else requestAnimationFrame(tick);}else painting=false;
    }
    if(reduceMotion())setTimeout(tick,0);else requestAnimationFrame(tick);
  });
  artCache.set(key,promise);return promise;
}
function artCanvas(className,art,seed,w,h,priority){
  const canvas=document.createElement('canvas');canvas.className=className;canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText=`width:${w}px;height:${h}px;max-width:none`;
  const density=Math.min(1.5,window.devicePixelRatio||1);
  paint(recipeOf(art),seed,Math.round(w*density),Math.round(h*density),priority).then(src=>{
    if(!canvas.isConnected)return;canvas.width=src.width;canvas.height=src.height;
    canvas.getContext('2d').drawImage(src,0,0);canvas.dataset.ready='';
    if(className==='gf-art'&&++backsReady===1)document.body.dataset.motionReady='true';
  });
  return canvas;
}
function normalizeFiles(list){
  const source = Array.isArray(list) && list.length ? list : SAMPLE_FILES;
  return source.map((file,index)=>{
    const rawId = file.id != null && String(file.id).trim() ? String(file.id).trim() : '';
    const id = rawId || index;
    return {
      id,
      key: rawId || `idx:${index}`,
      name: file.name || `Item ${index + 1}`,
      meta: file.meta || '',
      art: file.art,
    };
  });
}
function resolveSettings(opts){
  return {
    label: opts.label || 'Repository',
    tone: opts.tone === 'dark' ? 'dark' : 'light',
    art: opts.art && ART_PRESETS[opts.art] ? opts.art : 'aurora',
    seed: typeof opts.seed === 'number' ? opts.seed : hashString(opts.label || 'repo') % 997,
    action: opts.action === 'add' ? 'add' : 'more',
    files: normalizeFiles(opts.files),
    hideFeedback: Boolean(opts.hideFeedback),
  };
}
function makeFolder(host,index,settings){
  const uid='gf-port-'+index+'-'+Math.random().toString(36).slice(2,7);
  const root=document.createElement('div');root.className='gf-root';root.dataset.tone=settings.tone;root.dataset.place='bottom-left';root.dataset.folder=String(index);
  root.innerHTML=`<div class="gf-stage"><div class="gf-tilt"><div class="gf-shadow" aria-hidden="true"></div><div class="gf-back" aria-hidden="true"><div class="gf-back-sheen"></div></div><svg class="gf-rim gf-back-rim" viewBox="0 0 340 272" aria-hidden="true"><path d="${BACK_PATH}"/></svg><div class="gf-front"><div class="gf-tint" aria-hidden="true"></div><div class="gf-spec" aria-hidden="true"></div><svg class="gf-rim gf-front-rim" viewBox="0 0 340 198" aria-hidden="true"><defs><linearGradient id="${uid}-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient></defs><path d="${FRONT_PATH}" stroke="url(#${uid}-rim)"/></svg><button class="gf-hit" type="button" aria-expanded="false"></button><div class="gf-label"><span class="gf-title"></span><span class="gf-meta"></span></div></div><div class="gf-files" role="list" inert></div><button class="gf-key gf-key--${settings.action}" type="button">${settings.action==='add'?'<svg class="gf-glyph gf-glyph--plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15"/></svg>':'<svg class="gf-glyph gf-glyph--more" viewBox="0 0 30 12" aria-hidden="true"><rect x="1" y="1.5" width="8" height="9" rx="3.4"/><rect x="11" y="1.5" width="8" height="9" rx="3.4"/><rect x="21" y="1.5" width="8" height="9" rx="3.4"/></svg>'}</button><div class="gf-menu" role="menu" aria-label="Folder options" inert></div></div></div>`;
  const q=s=>root.querySelector(s),front=q('.gf-front'),back=q('.gf-back'),filesNode=q('.gf-files'),hit=q('.gf-hit'),key=q('.gf-key'),menu=q('.gf-menu');
  front.style.clipPath=`path('${FRONT_PATH}')`;back.style.clipPath=`path('${BACK_PATH}')`;
  back.prepend(artCanvas('gf-art',settings.art,settings.seed,W+24,H+24,0));
  q('.gf-title').textContent=settings.label;filesNode.setAttribute('aria-label',settings.label+' contents');
  let files=settings.files.map(f=>({...f})),nextNumeric=0,open=false,menuOpen=false;for(const f of files){const n=Number(f.id);if(Number.isFinite(n))nextNumeric=Math.max(nextNumeric,n+1);} 
  const sheetNodes=new Map();
  const feedback=document.createElement('output');feedback.className='gf-feedback';feedback.setAttribute('aria-live','polite');
  if(settings.hideFeedback) feedback.hidden=true;
  host.append(root,feedback);
  function setOpen(value){
    open=value;root.toggleAttribute('data-open',open);hit.setAttribute('aria-expanded',String(open));filesNode.inert=!open;setMenu(false);renderLabel();
    // Light-DOM host flag so the grid cell can raise z-index above neighbors.
    target.toggleAttribute('data-gf-open',open);
    // 收起时清掉纸片焦点，避免 outline 留在文件夹上方的留白区。
    if(!open){
      const active=root.querySelector('.gf-sheet:focus,.gf-sheet:focus-visible');
      if(active&&typeof active.blur==='function') active.blur();
    }
  }
  function setMenu(value){
    menuOpen=value;menu.toggleAttribute('data-open',value);menu.inert=!value;key.setAttribute('aria-expanded',String(value));
    if(value){menu.firstElementChild.textContent=open?'收起文件夹':'展开文件夹';menu.firstElementChild.focus();}
  }
  function renderLabel(){
    hit.setAttribute('aria-label',`${open?'Close':'Open'} ${settings.label}, ${files.length} ${files.length===1?'item':'items'}`);
    const text=document.createElement('span');text.className='gf-meta';text.textContent=files.length+(files.length===1?' item':' items');q('.gf-meta').replaceWith(text);
  }
  function renderFiles(dropped){
    const start=Math.max(0,files.length-MAX_VISIBLE),visible=files.slice(start);
    const visibleIds=new Set(visible.map(file=>file.id));
    for(const [id,node]of sheetNodes)if(!visibleIds.has(id)){node.remove();sheetNodes.delete(id);}
    visible.forEach((file,v)=>{
      let node=sheetNodes.get(file.id);
      if(!node){
        node=document.createElement('div');node.className='gf-sheet-slot';node.setAttribute('role','listitem');
        const sheet=document.createElement('button');sheet.type='button';sheet.className='gf-sheet'+(file.art?' gf-sheet--art':'');
        if(file.art)sheet.append(artCanvas('gf-sheet-art',file.art,hashString(file.name)%997,SHEET_W,SHEET_H,1));
        else{const lines=document.createElement('span');lines.className='gf-lines';lines.setAttribute('aria-hidden','true');lines.innerHTML=[86,92,64,88,42].map(w=>`<i style="width:${w}%"></i>`).join('');sheet.append(lines);}
        const header=document.createElement('span');header.className='gf-sheet-head';const name=document.createElement('span');name.className='gf-sheet-name';name.textContent=file.name;const meta=document.createElement('span');meta.className='gf-sheet-meta';meta.textContent=file.meta||'';header.append(name,meta);sheet.append(header);
        sheet.addEventListener('click',()=>{
          feedback.textContent='Selected: '+file.name;
          if(typeof liveOptions.onSelectFile==='function') liveOptions.onSelectFile({id:file.key||String(file.id),name:file.name,meta:file.meta,art:file.art});
          else if(typeof liveOptions.onActivate==='function') liveOptions.onActivate();
        });
        sheet.addEventListener('animationend',event=>{if(event.target===sheet&&event.animationName==='gf-drop')sheet.classList.remove('gf-sheet--drop');});
        node.append(sheet);sheetNodes.set(file.id,node);
      }
      const sheet=node.firstElementChild,jitter=rng(hashString(file.name)+file.id);
      sheet.style.setProperty('--gf-slot',fanSlot(v,visible.length));sheet.style.setProperty('--gf-depth',visible.length-1-v);
      sheet.style.setProperty('--gf-jx',((jitter()-.5)*10).toFixed(2)+'px');sheet.style.setProperty('--gf-jr',((jitter()-.5)*3.2).toFixed(2)+'deg');sheet.style.zIndex=v+1;
      sheet.classList.toggle('gf-sheet--drop',file.id===dropped&&!reduceMotion());
      if(node.parentNode!==filesNode)filesNode.append(node);
    });
    renderLabel();
  }
  function add(){
    if(typeof liveOptions.onAddFile==='function'){
      liveOptions.onAddFile();
      feedback.textContent='Add action';
      return;
    }
    const id=nextNumeric++;files.push({id,key:String(id),name:'Untitled '+(files.length+1),meta:'Just now'});renderFiles(id);
    front.classList.remove('gf-front--bump');
    if(!reduceMotion()){void front.offsetWidth;front.classList.add('gf-front--bump');}
    const glyph=key.querySelector('.gf-glyph--plus');if(glyph)glyph.replaceWith(glyph.cloneNode(true));
    feedback.textContent='Added a file · '+files.length+' items';
  }
  function activateRepo(){
    if(typeof liveOptions.onActivate==='function') liveOptions.onActivate();
    feedback.textContent='Open: '+settings.label;
  }
  front.addEventListener('animationend',event=>{if(event.target===front&&event.animationName==='gf-bump')front.classList.remove('gf-front--bump');});
  hit.addEventListener('click',()=>setOpen(!open));
  hit.addEventListener('dblclick',(event)=>{event.preventDefault();activateRepo();});
  if(settings.action==='add'){key.setAttribute('aria-label','Add a file to '+settings.label);key.addEventListener('click',add);}
  else{
    key.setAttribute('aria-label','More options for '+settings.label);key.setAttribute('aria-haspopup','menu');key.setAttribute('aria-expanded','false');
    key.addEventListener('click',()=>setMenu(!menuOpen));
    for(const [label,action,danger]of [
      [open?'收起文件夹':'展开文件夹',()=>setOpen(!open),false],
      ['打开对话',activateRepo,false],
      ['关闭项目',()=>{ if(typeof liveOptions.onRemove==='function') liveOptions.onRemove(); },true],
    ]){
      const item=document.createElement('button');item.type='button';item.className='gf-menu-item'+(danger?' gf-menu-item--danger':'');item.setAttribute('role','menuitem');item.tabIndex=-1;item.textContent=label;
      item.addEventListener('click',()=>{setMenu(false);action();key.focus();});menu.append(item);
    }
  }
  menu.addEventListener('keydown',event=>{
    const items=[...menu.children],at=items.indexOf(document.activeElement);let next;
    if(event.key==='ArrowDown')next=(at+1)%items.length;else if(event.key==='ArrowUp')next=(at+items.length-1)%items.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;
    if(next!==undefined){event.preventDefault();items[next].focus();}else if(event.key==='Tab')setMenu(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(menuOpen){setMenu(false);key.focus();}else if(open&&root.contains(event.composedPath()[0])){setOpen(false);hit.focus();}
  });
  document.addEventListener('pointerdown',event=>{
    const target=event.composedPath()[0];if(!root.contains(target)){if(menuOpen)setMenu(false);else if(open)setOpen(false);}
  });
  let frame=0,px=0,py=0;
  function write(){frame=0;root.style.setProperty('--gf-px',px.toFixed(3));root.style.setProperty('--gf-py',py.toFixed(3));}
  root.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'||reduceMotion())return;const bounds=scope.rect(root);px=(scope.point(event).x-bounds.left)/bounds.width*2-1;py=(scope.point(event).y-bounds.top)/bounds.height*2-1;if(!frame)frame=requestAnimationFrame(write);
  });
  root.addEventListener('pointerleave',()=>{px=py=0;if(!frame)frame=requestAnimationFrame(write);});
  const resize=new ResizeObserver(()=>{const width=Math.min(340,host.clientWidth),k=width/W;root.style.width=width+'px';root.style.height=(H+HEADROOM)*k+'px';q('.gf-stage').style.transform=`translateY(${HEADROOM*k}px) scale(${k})`;});resize.observe(host);
  const enter=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){enter.disconnect();setTimeout(()=>{root.dataset.entered='';},index*100);}},{threshold:.25});enter.observe(root);
  renderFiles();
  return {
    applyLabel(label){
      settings.label=label||settings.label;
      q('.gf-title').textContent=settings.label;
      filesNode.setAttribute('aria-label',settings.label+' contents');
      renderLabel();
    },
    applyFiles(nextFiles){
      files=normalizeFiles(nextFiles);
      nextNumeric=0;for(const f of files){const n=Number(f.id);if(Number.isFinite(n))nextNumeric=Math.max(nextNumeric,n+1);}
      renderFiles();
    },
  };
}

const folderApi = makeFolder(document.querySelector('.gf-demo-slot'), 0, resolveSettings(liveOptions));

const baseUpdate = scope.controller.update.bind(scope.controller);
scope.controller.update = (next = {}) => {
  liveOptions = { ...liveOptions, ...next };
  baseUpdate(next);
  if (typeof next.label === 'string') folderApi.applyLabel(next.label);
  if (Array.isArray(next.files)) folderApi.applyFiles(next.files);
};

scope.ready();
return scope.controller;
}
