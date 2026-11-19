import { createSurface } from "./motion-runtime";
import {
  CALENDAR_PEEK,
  layoutPeekStacks,
  peekCellKey,
  peekPositionCalc,
  placeholderPeekLayout,
  sortPeekEvents,
} from "../../lib/calendarPeekLayout.ts";
export function mountVelocityFocusDrag(target, options = {}) {
const scope = createSurface(target, {"markup":"\n<div class=\"calendar-shell\">\n  <div class=\"calendar-header\">\n    <button type=\"button\" class=\"btn\" id=\"btn-prev\" aria-label=\"上一周\">‹</button>\n    <button type=\"button\" class=\"btn\" id=\"btn-today\">今天</button>\n    <button type=\"button\" class=\"btn\" id=\"btn-next\" aria-label=\"下一周\">›</button>\n    <div class=\"month-title\" id=\"month-title\">任务时间表</div>\n    <div class=\"month-empty\" id=\"empty-hint\" hidden>点击空白时段创建任务</div>\n  </div>\n  <div class=\"calendar-body\" id=\"calendar-body\">\n    <div class=\"grid-container\" id=\"grid\"></div>\n    <div class=\"events-layer\" id=\"events-layer\"></div>\n    <div class=\"drag-placeholder\" id=\"placeholder\"></div>\n  </div>\n</div>\n<div class=\"drag-ghost\" id=\"ghost\">\n  <div class=\"ghost-layer-original\" id=\"ghost-original\"></div>\n  <div class=\"ghost-layer-new\" id=\"ghost-new\"></div>\n</div>\n","css":"\n  *, *::before, *::after { box-sizing: border-box; }\n  :root {\n    --bg-window: #ffffff;\n    --bg-header: #ffffff;\n    --border-subtle: rgba(0,0,0,0.08);\n    --text-primary: #1e1e1e;\n    --text-secondary: #6b6b73;\n    --btn-bg: rgba(0,0,0,0.04);\n    --btn-hover: rgba(0,0,0,0.07);\n    --placeholder-border: #94a3b8;\n    --placeholder-bg: rgba(241, 245, 249, 0.55);\n    --col-time-width: 56px;\n    --row-header-height: 52px;\n    --row-hour-height: 64px;\n    --hour-start: 8;\n    font-family: inherit, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n  }\n  .motion-body[data-theme=\"dark\"] {\n    --bg-window: #2b2b2d;\n    --bg-header: #2b2b2d;\n    --border-subtle: rgba(255,255,255,0.07);\n    --text-primary: #e4e4e7;\n    --text-secondary: #9a9aa3;\n    --btn-bg: rgba(255,255,255,0.06);\n    --btn-hover: rgba(255,255,255,0.1);\n    --placeholder-border: rgba(148,163,184,0.55);\n    --placeholder-bg: rgba(148,163,184,0.12);\n  }\n  body {\n    margin: 0; height: 100%; min-height: var(--motion-height); overflow: hidden;\n    background: var(--bg-window); color: var(--text-primary);\n    display: flex; align-items: stretch; justify-content: stretch;\n    user-select: none; -webkit-user-select: none;\n  }\n  body.is-dragging * { cursor: grabbing !important; }\n  .calendar-shell {\n    width: 100%; height: 100%; min-height: var(--motion-height);\n    background: var(--bg-window); display: flex; flex-direction: column; overflow: hidden; position: relative;\n  }\n  .calendar-header {\n    height: 48px; display: flex; align-items: center; gap: 10px;\n    padding: 0 16px; border-bottom: 1px solid var(--border-subtle);\n    background: var(--bg-header); flex-shrink: 0;\n  }\n  .btn {\n    padding: 5px 11px; border-radius: 8px; border: 0; background: var(--btn-bg);\n    font-size: 12.5px; font-weight: 500; cursor: pointer; color: var(--text-primary);\n  }\n  .btn:hover { background: var(--btn-hover); }\n  .month-title { font-size: 13.5px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }\n  .month-empty { margin-left: auto; font-size: 12px; color: var(--text-secondary); }\n  .calendar-body { flex: 1; position: relative; overflow: auto; min-height: 0; }\n  .grid-container {\n    display: grid; grid-template-columns: var(--col-time-width) repeat(7, 1fr); min-width: 720px;\n  }\n  .header-cell {\n    height: var(--row-header-height); display: flex; flex-direction: column; align-items: center; justify-content: center;\n    border-bottom: 1px solid var(--border-subtle); border-right: 1px solid var(--border-subtle);\n    font-size: 11px; color: var(--text-secondary);\n  }\n  .header-cell .day-num {\n    font-size: 15px; font-weight: 600; color: var(--text-primary); margin-top: 2px;\n    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 50%;\n  }\n  .header-cell.today .day-num { background: #ef4444; color: white; }\n  .time-cell {\n    height: var(--row-hour-height); border-right: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle);\n    display: flex; align-items: flex-start; justify-content: center; font-size: 10.5px; color: var(--text-secondary);\n  }\n  .time-label { transform: translateY(-50%); background: var(--bg-window); padding: 0 3px; }\n  .grid-cell { height: var(--row-hour-height); border-right: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); }\n  .grid-cell { cursor: pointer; transition: background-color 0.12s ease; }\n  .grid-cell:hover { background: rgba(0,0,0,0.035); }\n  .motion-body[data-theme=\"dark\"] .grid-cell:hover { background: rgba(255,255,255,0.045); }\n  .events-layer { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }\n  .event-card {\n    position: absolute; border-radius: 8px; cursor: grab; pointer-events: auto;\n    outline: 1px solid transparent; overflow: hidden;\n    transition: left 0.38s cubic-bezier(0.22, 1.15, 0.36, 1), width 0.38s cubic-bezier(0.22, 1.15, 0.36, 1),\n      top 0.38s cubic-bezier(0.22, 1.15, 0.36, 1), box-shadow 0.28s ease, outline-color 0.15s, opacity 0.2s;\n  }\n  .event-card.is-disabled { opacity: 0.55; }\n  .event-card:hover { outline-color: rgba(255,255,255,0.12); }\n  .motion-body[data-theme=\"light\"] .event-card:hover { outline-color: rgba(0,0,0,0.08); }\n  .event-card.is-deck-back { cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }\n  .event-card.is-expanded {\n    box-shadow: 0 10px 28px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.06);\n  }\n  .motion-body[data-theme=\"light\"] .event-card.is-expanded {\n    box-shadow: 0 10px 24px rgba(0,0,0,0.12), 0 1px 0 rgba(255,255,255,0.8);\n  }\n  .event-content { padding: 7px 9px; display: flex; flex-direction: column; width: 100%; height: 100%; gap: 2px; min-width: 0; }\n  .event-card.is-stacked .event-content { padding: 5px 7px; }\n  .event-time { font-size: 10.5px; font-weight: 600; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n  .event-title { font-size: 12px; font-weight: 500; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n  .event-count-badge {\n    position: absolute; right: 6px; bottom: 5px; z-index: 2;\n    height: 16px; min-width: 16px; padding: 0 5px; border-radius: 999px;\n    display: flex; align-items: center; justify-content: center;\n    font-size: 9px; font-weight: 700; letter-spacing: 0.02em;\n    color: inherit; background: rgba(0,0,0,0.18); pointer-events: none;\n  }\n  .motion-body[data-theme=\"light\"] .event-count-badge { background: rgba(255,255,255,0.55); }\n  .event-overflow-chip {\n    position: absolute; z-index: 30; pointer-events: auto; cursor: pointer;\n    height: 20px; min-width: 20px; padding: 0 6px; border-radius: 6px;\n    display: flex; align-items: center; justify-content: center;\n    font-size: 10px; font-weight: 600; letter-spacing: 0.01em;\n    color: var(--text-secondary); background: color-mix(in srgb, var(--bg-window) 72%, var(--border-subtle));\n    border: 1px solid var(--border-subtle); box-shadow: 0 1px 2px rgba(0,0,0,0.06);\n  }\n  .drag-placeholder {\n    position: absolute; border-radius: 8px; border: 1.5px dashed var(--placeholder-border);\n    background: var(--placeholder-bg); pointer-events: none; z-index: 5; display: none;\n  }\n  .drag-ghost {\n    position: fixed; top: 0; left: 0; pointer-events: none; z-index: 9999; border-radius: 8px; overflow: hidden;\n    transform-origin: center center; will-change: transform, background, backdrop-filter;\n    transition: background 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), backdrop-filter 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);\n    opacity: 0;\n  }\n  .drag-ghost.is-morphing {\n    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);\n    box-shadow: 0 18px 40px rgba(0,0,0,0.22);\n  }\n  .ghost-layer-original, .ghost-layer-new {\n    position: absolute; top: 0; left: 0; right: 0; bottom: 0; will-change: opacity, filter, transform;\n  }\n  .ghost-layer-original {\n    opacity: 1; filter: blur(0px); transform: scale(1);\n    transition: opacity 0.45s ease, filter 0.5s ease, transform 0.5s ease;\n  }\n  .drag-ghost.is-morphing .ghost-layer-original { opacity: 0; filter: blur(10px); transform: scale(0.92); }\n  .ghost-layer-new {\n    display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600;\n    opacity: 0; filter: blur(8px); transform: scale(1.04);\n    transition: opacity 0.45s ease 0.08s, filter 0.45s ease 0.08s, transform 0.45s ease 0.08s;\n  }\n  .drag-ghost.is-morphing .ghost-layer-new { opacity: 1; filter: blur(0px); transform: scale(1); }\n","width":1040,"height":720,"responsive":true}, options);
const { document, window, requestAnimationFrame } = scope;

  let liveOptions = { ...(options || {}) };
  const HOUR_START = 8;
  const HOUR_END = 20;
  const ROW_H = 64;
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  const themesLight = {
    pink: { bg: '#fce7f3', ghostBg: 'rgba(252, 231, 243, 0.75)', text: '#9f1239' },
    green: { bg: '#dcfce7', ghostBg: 'rgba(220, 252, 231, 0.75)', text: '#166534' },
    yellow: { bg: '#fef3c7', ghostBg: 'rgba(254, 243, 199, 0.8)', text: '#92400e' },
    purple: { bg: '#ede9fe', ghostBg: 'rgba(237, 233, 254, 0.8)', text: '#5b21b6' },
    blue: { bg: '#dbeafe', ghostBg: 'rgba(219, 234, 254, 0.8)', text: '#1e3a8a' },
    gray: { bg: '#f3f4f6', ghostBg: 'rgba(243, 244, 246, 0.8)', text: '#374151' }
  };
  // 不透明实色：叠放时不再透出下层文字（叠字）。
  const themesDark = {
    pink: { bg: '#5a2436', ghostBg: 'rgba(244, 63, 94, 0.42)', text: '#fda4af' },
    green: { bg: '#1f3d2c', ghostBg: 'rgba(34, 197, 94, 0.4)', text: '#86efac' },
    yellow: { bg: '#4a3b16', ghostBg: 'rgba(234, 179, 8, 0.4)', text: '#fde68a' },
    purple: { bg: '#3a2758', ghostBg: 'rgba(168, 85, 247, 0.42)', text: '#d8b4fe' },
    blue: { bg: '#1e3358', ghostBg: 'rgba(59, 130, 246, 0.42)', text: '#93c5fd' },
    gray: { bg: '#3a3a40', ghostBg: 'rgba(255, 255, 255, 0.18)', text: '#d4d4d8' }
  };

  function currentTheme() {
    const raw = target.ownerDocument.documentElement.getAttribute('data-theme');
    return raw === 'light' ? 'light' : 'dark';
  }
  function themes() { return currentTheme() === 'light' ? themesLight : themesDark; }
  function syncThemeAttr() {
    const theme = currentTheme();
    scope.body.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }
  syncThemeAttr();
  const themeObserver = new MutationObserver(() => { syncThemeAttr(); renderEvents(); });
  themeObserver.observe(target.ownerDocument.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  scope.addCleanup(() => themeObserver.disconnect());

  let events = normalizeEvents(liveOptions.events);

  function normalizeEvents(list) {
    if (!Array.isArray(list)) return [];
    return list.map((ev, index) => ({
      id: String(ev.id || ('ev-' + index)),
      taskId: String(ev.taskId || ev.id || ('ev-' + index)),
      day: Math.max(0, Math.min(6, Number(ev.day) || 0)),
      hour: Math.max(HOUR_START, Math.min(HOUR_END, Number(ev.hour) || HOUR_START)),
      duration: Math.max(0.5, Number(ev.duration) || 1),
      title: String(ev.title || '任务'),
      subtitle: String(ev.subtitle || ''),
      theme: String(ev.theme || 'gray'),
      enabled: ev.enabled !== false,
      originDate: ev.originDate ? String(ev.originDate) : undefined,
    }));
  }

  const gridEl = document.getElementById('grid');
  const monthTitle = document.getElementById('month-title');
  const emptyHint = document.getElementById('empty-hint');
  let weekStartMs = Number(liveOptions.weekStartMs);
  if (!Number.isFinite(weekStartMs)) {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - d.getDay());
    weekStartMs = d.getTime();
  }

  function startOfWeekMs(ms) {
    const d = new Date(ms);
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - d.getDay());
    return d.getTime();
  }

  function formatWeekTitle(ms) {
    const start = new Date(startOfWeekMs(ms));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    if (start.getMonth() === end.getMonth()) {
      return start.getFullYear() + '年' + (start.getMonth() + 1) + '月 ' + start.getDate() + '–' + end.getDate() + '日';
    }
    return (start.getMonth() + 1) + '/' + start.getDate() + ' – ' + (end.getMonth() + 1) + '/' + end.getDate();
  }

  function rebuildGrid() {
    weekStartMs = startOfWeekMs(Number.isFinite(Number(liveOptions.weekStartMs)) ? Number(liveOptions.weekStartMs) : weekStartMs);
    const weekStart = new Date(weekStartMs);
    const today = new Date();
    today.setHours(0,0,0,0);
    if (monthTitle) monthTitle.textContent = formatWeekTitle(weekStartMs) + ' · 任务编排';
    gridEl.innerHTML = '';
    gridEl.innerHTML += '<div class="header-cell" style="border:none;"></div>';
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      date.setHours(0,0,0,0);
      const isToday = date.getTime() === today.getTime();
      gridEl.innerHTML += '<div class="header-cell' + (isToday ? ' today' : '') + '"><div>周' + days[i] + '</div><div class="day-num">' + date.getDate() + '</div></div>';
    }
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      const label = h > 12 ? (h - 12) + ' PM' : (h === 12 ? '12 PM' : h + ' AM');
      gridEl.innerHTML += '<div class="time-cell"><span class="time-label">' + label + '</span></div>';
      for (let d = 0; d < 7; d++) {
        gridEl.innerHTML += '<div class="grid-cell" data-day="' + d + '" data-hour="' + h + '" role="button" tabindex="-1" title="点击创建任务"></div>';
      }
    }
    gridEl.querySelectorAll('.grid-cell[data-day]').forEach((cell) => {
      cell.addEventListener('click', () => {
        if (expandedCellKey) {
          collapseExpanded();
          return;
        }
        if (typeof liveOptions.onSlotClick !== 'function') return;
        const day = Number(cell.getAttribute('data-day'));
        const hour = Number(cell.getAttribute('data-hour'));
        if (!Number.isFinite(day) || !Number.isFinite(hour)) return;
        try { liveOptions.onSlotClick(day, hour); } catch (_) {}
      });
    });
  }
  rebuildGrid();

  const eventsLayer = document.getElementById('events-layer');
  function formatHourLabel(hour) {
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour > 12 ? hour - 12 : hour;
    return h12 + ':00 ' + suffix;
  }

  let expandedCellKey = null;

  function applyPeekBox(el, day, hour, duration, offsetPx, shrinkPx, topOffsetPx, zIndex) {
    const pos = peekPositionCalc(day, offsetPx, shrinkPx);
    const topExtra = topOffsetPx > 0 ? ' + ' + topOffsetPx + 'px' : '';
    el.style.left = pos.left;
    el.style.width = pos.width;
    el.style.top = 'calc(var(--row-header-height) + ' + (hour - HOUR_START) + ' * var(--row-hour-height) + ' + CALENDAR_PEEK.insetPx + 'px' + topExtra + ')';
    el.style.height = 'calc(' + duration + ' * var(--row-hour-height) - ' + (CALENDAR_PEEK.insetPx * 2) + 'px)';
    el.style.zIndex = String(zIndex);
  }

  function setPlaceholderPeek(day, hour) {
    if (!draggedEv) return;
    const layout = placeholderPeekLayout(events, draggedEv, day, hour, { expandedKey: expandedCellKey });
    const pos = peekPositionCalc(day, layout.offsetPx, layout.shrinkPx);
    const topExtra = layout.topOffsetPx > 0 ? ' + ' + layout.topOffsetPx + 'px' : '';
    placeholder.style.left = pos.left;
    placeholder.style.width = pos.width;
    placeholder.style.top = 'calc(var(--row-header-height) + ' + (hour - HOUR_START) + ' * var(--row-hour-height) + ' + CALENDAR_PEEK.insetPx + 'px' + topExtra + ')';
    placeholder.style.height = 'calc(' + (draggedEv.duration || 1) + ' * var(--row-hour-height) - ' + (CALENDAR_PEEK.insetPx * 2) + 'px)';
    placeholder.style.zIndex = '6';
    placeholder.style.display = 'block';
  }

  function collapseExpanded() {
    if (!expandedCellKey) return;
    expandedCellKey = null;
    renderEvents();
  }

  function expandCell(day, hour) {
    const key = peekCellKey(day, hour);
    const count = events.filter((ev) => ev.day === day && ev.hour === hour).length;
    if (count <= 1) return false;
    expandedCellKey = expandedCellKey === key ? null : key;
    renderEvents();
    return true;
  }

  function renderEvents() {
    const prevRects = new Map();
    eventsLayer.querySelectorAll('.event-card[data-event-id]').forEach((el) => {
      prevRects.set(el.dataset.eventId, el.getBoundingClientRect());
    });
    eventsLayer.innerHTML = '';
    if (emptyHint) emptyHint.hidden = events.length > 0;
    const palette = themes();
    const byId = new Map(events.map((ev) => [ev.id, ev]));
    // 拖起时从布局里排除源卡，同格其余立刻重排；落点动画阶段保留完整布局。
    const excludeId = isDragging && draggedEv ? draggedEv.id : null;
    const stack = layoutPeekStacks(events, { excludeId, expandedKey: expandedCellKey });
    stack.cards.forEach((card) => {
      const ev = byId.get(card.id);
      if (!ev) return;
      const el = document.createElement('div');
      el.className = 'event-card'
        + (ev.enabled ? '' : ' is-disabled')
        + (card.visibleCount > 1 ? ' is-stacked' : '')
        + (card.expanded ? ' is-expanded' : '')
        + (!card.showContent && card.visibleCount > 1 ? ' is-deck-back' : '');
      el.dataset.eventId = ev.id;
      el.dataset.cellKey = peekCellKey(card.day, card.hour);
      el.id = eventDomId(ev.id);
      applyPeekBox(el, card.day, card.hour, ev.duration, card.offsetPx, card.shrinkPx, card.topOffsetPx, card.zIndex);
      const themeConfig = palette[ev.theme] || palette.gray;
      el.style.background = themeConfig.bg;
      el.style.color = themeConfig.text;
      if ((isDragging || isDropping) && draggedEv && ev.id === draggedEv.id) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
      const sub = ev.subtitle || formatHourLabel(ev.hour);
      const slotLabel = '同格第 ' + (card.lane + 1) + '/' + card.cellTotal + ' 个';
      el.setAttribute('aria-label', ev.title + ', ' + sub + (card.cellTotal > 1 ? ', ' + slotLabel : ''));
      el.setAttribute('aria-expanded', card.expanded ? 'true' : 'false');
      if (card.showContent) {
        let html = '<div class="event-content"><div class="event-time">' + escapeHtml(sub) + '</div><div class="event-title">' + escapeHtml(ev.title) + '</div></div>';
        if (!card.expanded && card.cellTotal > 1 && card.showContent) {
          html += '<span class="event-count-badge" aria-hidden="true">' + card.cellTotal + '</span>';
        }
        el.innerHTML = html;
      } else {
        // 收起牌背：只露实色边，不渲染文字，避免叠字。
        el.innerHTML = '';
      }
      el.addEventListener('mousedown', (e) => startDrag(e, ev, el, themeConfig));
      eventsLayer.appendChild(el);
    });
    // FLIP：收起/展开时做轻弹跳位移动效（参考 LeiBox stacked-metadata 的展开感）
    if (prevRects.size && !isDragging && !isDropping) {
      const nodes = [...eventsLayer.querySelectorAll('.event-card[data-event-id]')];
      nodes.forEach((el) => {
        const prev = prevRects.get(el.dataset.eventId);
        if (!prev) return;
        const next = el.getBoundingClientRect();
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        const sw = prev.width / Math.max(1, next.width);
        if (Math.abs(dx) + Math.abs(dy) < 0.5 && Math.abs(sw - 1) < 0.01) return;
        el.style.transition = 'none';
        el.style.transformOrigin = 'top left';
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scaleX(' + sw + ')';
      });
      requestAnimationFrame(() => {
        nodes.forEach((el) => {
          if (!el.style.transform) return;
          el.style.transition = 'transform 0.38s cubic-bezier(0.22, 1.15, 0.36, 1)';
          el.style.transform = '';
        });
      });
    }
    stack.overflows.forEach((chip) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'event-overflow-chip';
      el.textContent = '+' + chip.count;
      el.title = chip.titles.join('、');
      el.setAttribute('aria-label', '展开查看还有 ' + chip.count + ' 个任务');
      el.style.left = 'calc(var(--col-time-width) + ' + (chip.day + 1) + ' * ((100% - var(--col-time-width)) / 7) - ' + CALENDAR_PEEK.insetPx + 'px - 28px)';
      el.style.top = 'calc(var(--row-header-height) + ' + (chip.hour - HOUR_START + 1) + ' * var(--row-hour-height) - ' + CALENDAR_PEEK.insetPx + 'px - 22px)';
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        expandCell(chip.day, chip.hour);
      });
      eventsLayer.appendChild(el);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function eventDomId(id) {
    return 'event-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  let isDragging = false;
  let isDropping = false;
  let draggedEv = null, originalEl = null, currentThemeConfig = null;
  const ghost = document.getElementById('ghost');
  const ghostOrig = document.getElementById('ghost-original');
  const ghostNew = document.getElementById('ghost-new');
  const placeholder = document.getElementById('placeholder');
  let targetX = 0, targetY = 0, posX = 0, posY = 0;
  let dropTargetX = 0, dropTargetY = 0;
  let velX = 0, velY = 0;
  let rotX = 0, rotY = 0, rotZ = 0;
  let currentScale = 1.0, targetScale = 1.0;
  let grabOffsetX = 0, grabOffsetY = 0;
  let currentHoverDay = -1, currentHoverHour = -1;
  let pointerStartX = 0, pointerStartY = 0;
  let originDay = 0, originHour = 0;

  function startDrag(e, evData, el, themeConfig) {
    if (e.button !== 0 || isDragging) return;
    if (isDropping) {
      isDropping = false;
      ghost.style.opacity = '0';
      placeholder.style.display = 'none';
      renderEvents();
    }
    isDragging = true;
    draggedEv = evData;
    originalEl = el;
    currentThemeConfig = themeConfig;
    originDay = evData.day;
    originHour = evData.hour;
    document.body.classList.add('is-dragging');
    const pt = scope.point(e);
    targetX = posX = pt.x;
    targetY = posY = pt.y;
    pointerStartX = pt.x;
    pointerStartY = pt.y;
    velX = velY = rotX = rotY = rotZ = 0;
    currentScale = targetScale = 1.0;
    const rect = scope.rect(originalEl);
    grabOffsetX = pt.x - rect.left;
    grabOffsetY = pt.y - rect.top;
    // Ghost 保持完整卡尺寸可读；placeholder / 同格重排走 peek 几何。
    ghost.style.width = Math.max(rect.width, 96) + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.transition = 'none';
    ghostOrig.style.transition = 'none';
    ghostNew.style.transition = 'none';
    ghost.classList.remove('is-morphing');
    ghost.style.background = themeConfig.bg;
    ghostOrig.innerHTML = originalEl.innerHTML;
    ghostNew.style.color = themeConfig.text;
    ghost.style.opacity = '1';
    void ghost.offsetWidth;
    ghost.style.transition = '';
    ghostOrig.style.transition = '';
    ghostNew.style.transition = '';
    requestAnimationFrame(() => {
      ghost.classList.add('is-morphing');
      ghost.style.background = themeConfig.ghostBg;
    });
    currentHoverDay = evData.day;
    currentHoverHour = evData.hour;
    // 真正拖动前先不收起；位移超过阈值后再收起，保证点击仍能展开。
    renderEvents();
    setPlaceholderPeek(evData.day, evData.hour);
    updateGridFeedback(targetX, targetY);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', endDrag);
  }

  function onDragMove(e) {
    const pt = scope.point(e);
    targetX = pt.x; targetY = pt.y;
    const travel = Math.abs(pt.x - pointerStartX) + Math.abs(pt.y - pointerStartY);
    if (travel > 8 && expandedCellKey) {
      expandedCellKey = null;
      renderEvents();
      setPlaceholderPeek(currentHoverDay, currentHoverHour);
    }
    updateGridFeedback(targetX, targetY);
  }

  function updateGridFeedback(clientX, clientY) {
    const calendar = document.getElementById('calendar-body');
    const rect = scope.rect(calendar);
    const colW = Math.max(1, (rect.width - 56) / 7);
    let relativeX = clientX - rect.left + calendar.scrollLeft - 56;
    let relativeY = clientY - rect.top + calendar.scrollTop - 52;
    let dayIdx = Math.max(0, Math.min(6, Math.floor(relativeX / colW)));
    let hourIdx = Math.max(HOUR_START, Math.min(HOUR_END, Math.floor(relativeY / ROW_H) + HOUR_START));
    if (dayIdx !== currentHoverDay || hourIdx !== currentHoverHour) {
      currentHoverDay = dayIdx;
      currentHoverHour = hourIdx;
      ghostNew.innerText = '周' + days[dayIdx] + ' ' + formatHourLabel(hourIdx);
      setPlaceholderPeek(dayIdx, hourIdx);
    }
  }

  function endDrag() {
    isDragging = false;
    document.body.classList.remove('is-dragging');
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', endDrag);
    const travel = Math.abs(posX - pointerStartX) + Math.abs(posY - pointerStartY);
    const moved = travel > 8 || currentHoverDay !== originDay || currentHoverHour !== originHour;

    if (!moved) {
      ghost.style.opacity = '0';
      placeholder.style.display = 'none';
      const clickEv = draggedEv;
      const clickId = clickEv && (clickEv.taskId || clickEv.id);
      const cellKey = clickEv ? peekCellKey(originDay, originHour) : null;
      const cellCount = clickEv
        ? events.filter((ev) => ev.day === originDay && ev.hour === originHour).length
        : 0;
      draggedEv = null;
      // 多任务格：首次点击展开（LeiBox stacked-metadata 式）；已展开再点则打开任务。
      if (cellCount > 1 && cellKey && expandedCellKey !== cellKey) {
        expandedCellKey = cellKey;
        renderEvents();
        return;
      }
      renderEvents();
      if (clickId && typeof liveOptions.onEventClick === 'function') {
        try { liveOptions.onEventClick(clickId); } catch (_) {}
      }
      return;
    }

    isDropping = true;
    expandedCellKey = null;
    const movedFromDay = originDay;
    if (draggedEv) {
      // 只动被拖的那一张；同任务其他天保持不动（多日重复靠补充例外持久化）
      events = events.map((x) =>
        x.id === draggedEv.id ? { ...x, day: currentHoverDay, hour: currentHoverHour } : x
      );
      draggedEv.day = currentHoverDay;
      draggedEv.hour = currentHoverHour;
    }
    renderEvents();
    ghost.classList.remove('is-morphing');
    ghost.style.background = currentThemeConfig.bg;

    const moveId = draggedEv && (draggedEv.taskId || draggedEv.id);
    if (moveId && typeof liveOptions.onEventMove === 'function') {
      try {
        liveOptions.onEventMove(
          moveId,
          currentHoverDay,
          currentHoverHour,
          movedFromDay,
          draggedEv.originDate || null
        );
      } catch (_) {}
    }
  }

  function physicsLoop() {
    if (isDragging || isDropping) {
      let targetRotY = 0, targetRotX = 0, targetRotZ = 0;
      if (isDragging) {
        const oldPosX = posX, oldPosY = posY;
        posX += (targetX - posX) * 0.45;
        posY += (targetY - posY) * 0.45;
        velX = posX - oldPosX;
        velY = posY - oldPosY;
        targetRotY = Math.max(-25, Math.min(25, velX * 0.8));
        targetRotX = Math.max(-25, Math.min(25, -velY * 0.8));
        targetRotZ = Math.max(-8, Math.min(8, velX * 0.08));
        targetScale = 1.02;
      } else if (isDropping) {
        const dropTargetEl = document.getElementById(eventDomId(draggedEv.id));
        if (dropTargetEl) {
          const dropRect = scope.rect(dropTargetEl);
          dropTargetX = dropRect.left + grabOffsetX;
          dropTargetY = dropRect.top + grabOffsetY;
        }
        velX = (velX + (dropTargetX - posX) * 0.35) * 0.58;
        velY = (velY + (dropTargetY - posY) * 0.35) * 0.58;
        posX += velX;
        posY += velY;
        targetScale = 1.0;
        const dist = Math.abs(dropTargetX - posX) + Math.abs(dropTargetY - posY);
        const speed = Math.abs(velX) + Math.abs(velY);
        if (dist < 0.5 && speed < 0.5) {
          isDropping = false;
          ghost.style.opacity = '0';
          placeholder.style.display = 'none';
          draggedEv = null;
          renderEvents();
          return requestAnimationFrame(physicsLoop);
        }
      }
      rotX += (targetRotX - rotX) * 0.2;
      rotY += (targetRotY - rotY) * 0.2;
      rotZ += (targetRotZ - rotZ) * 0.2;
      currentScale += (targetScale - currentScale) * 0.2;
      ghost.style.transform =
        'translate(' + posX + 'px, ' + posY + 'px) translate(-' + grabOffsetX + 'px, -' + grabOffsetY + 'px) perspective(1200px) rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg) rotateZ(' + rotZ + 'deg) scale(' + currentScale + ')';
    }
    requestAnimationFrame(physicsLoop);
  }

  function shiftWeek(delta) {
    if (typeof liveOptions.onWeekChange === 'function') {
      try { liveOptions.onWeekChange(delta); } catch (_) {}
      return;
    }
    weekStartMs = startOfWeekMs(weekStartMs + delta * 7 * 86400000);
    liveOptions.weekStartMs = weekStartMs;
    rebuildGrid();
    renderEvents();
  }
  function onDocPointerDown(e) {
    if (!expandedCellKey || isDragging || isDropping) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const hit = path.find((n) => n && n.dataset && (n.dataset.cellKey === expandedCellKey || n.classList?.contains('event-overflow-chip')));
    if (hit) return;
    collapseExpanded();
  }
  function onDocKeyDown(e) {
    if (e.key === 'Escape') collapseExpanded();
  }
  window.addEventListener('pointerdown', onDocPointerDown, true);
  window.addEventListener('keydown', onDocKeyDown);
  scope.addCleanup(() => {
    window.removeEventListener('pointerdown', onDocPointerDown, true);
    window.removeEventListener('keydown', onDocKeyDown);
  });

  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnToday = document.getElementById('btn-today');
  if (btnPrev) btnPrev.addEventListener('click', () => { collapseExpanded(); shiftWeek(-1); });
  if (btnNext) btnNext.addEventListener('click', () => { collapseExpanded(); shiftWeek(1); });
  if (btnToday) {
    btnToday.addEventListener('click', () => {
      collapseExpanded();
      if (typeof liveOptions.onWeekChange === 'function') {
        try { liveOptions.onWeekChange(0); } catch (_) {}
      } else {
        const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay());
        weekStartMs = d.getTime(); liveOptions.weekStartMs = weekStartMs; rebuildGrid(); renderEvents();
      }
      const calendar = document.getElementById('calendar-body');
      const nowH = new Date().getHours();
      if (calendar) calendar.scrollTop = Math.max(0, (Math.max(HOUR_START, nowH) - HOUR_START) * ROW_H - 40);
    });
  }

  const baseUpdate = scope.controller.update.bind(scope.controller);
  scope.controller.update = (next = {}) => {
    const prevWeek = liveOptions.weekStartMs;
    liveOptions = { ...liveOptions, ...next };
    baseUpdate(next);
    if (Object.prototype.hasOwnProperty.call(next, 'weekStartMs') && next.weekStartMs !== prevWeek) {
      rebuildGrid();
    }
    if (Object.prototype.hasOwnProperty.call(next, 'events')) {
      events = normalizeEvents(next.events);
    }
    if (!isDragging && !isDropping) renderEvents();
  };

  renderEvents();
  physicsLoop();
scope.ready();
return scope.controller;
}
