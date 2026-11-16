import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface GuideMarker {
  id: string;
  /** 显示器内逻辑坐标（Rust 侧已减去显示器逻辑原点）。 */
  x: number;
  y: number;
  /** 保留字段：坐标兜底动作的执行标记（agent-desktop ref 点击无坐标，不弹）。 */
  label?: string;
  kind?: "guide" | "action";
}

declare global {
  interface Window {
    __osOverlay?: {
      marker: (payload: GuideMarker) => void;
      clear: () => void;
      progress: (payload: { text: string }) => void;
      progressClear: () => void;
    };
  }
}

const OVERLAY_CSS = `
html, body, #root { background: transparent; overflow: hidden; }
.os-guide-marker {
  position: fixed;
  /* 中心锚定在目标点；子元素动画只走 transform/opacity（合成器驱动，主线程繁忙也流畅）。 */
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 2147483647;
}
.os-guide-ring {
  position: absolute;
  left: 0; top: 0;
  width: 72px; height: 72px;
  margin: -36px 0 0 -36px;
  border-radius: 50%;
  border: 3px solid #2f6feb;
  box-shadow: 0 0 18px rgba(47, 111, 235, 0.55);
  animation: os-ring-pulse 1.6s ease-out infinite;
}
.os-guide-dot {
  position: absolute;
  left: 0; top: 0;
  width: 14px; height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: #2f6feb;
  box-shadow: 0 0 10px rgba(47, 111, 235, 0.8);
}
.os-action-ring {
  border-color: #22b573;
  box-shadow: 0 0 16px rgba(34, 181, 115, 0.6);
  /* 执行标记快节奏单跳：看到即完成，不循环。 */
  animation: os-action-pulse 0.9s ease-out both;
}
.os-action-dot {
  background: #22b573;
  box-shadow: 0 0 10px rgba(34, 181, 115, 0.85);
}
@keyframes os-ring-pulse {
  0%   { transform: scale(0.4);  opacity: 0.95; }
  100% { transform: scale(1.25); opacity: 0; }
}
@keyframes os-action-pulse {
  0%   { transform: scale(0.35); opacity: 0.95; }
  100% { transform: scale(1.1);  opacity: 0; }
}
.os-progress-panel {
  position: fixed;
  left: 50%;
  top: 14px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 60vw;
  padding: 9px 16px;
  border-radius: 999px;
  background: rgba(18, 22, 30, 0.92);
  color: #f5f7fa;
  font: 500 13px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif;
  white-space: nowrap;
  overflow: hidden;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  z-index: 2147483647;
  /* 出现：从下方升起收进顶部，轻微过冲带弹性（合成器驱动）。 */
  animation: os-progress-in 0.5s cubic-bezier(0.3, 1.3, 0.5, 1) both;
}
.os-progress-panel.os-progress-out {
  /* 退场：从顶部释放垂落淡出，ease-in 加速离场。 */
  animation: os-progress-out 0.38s cubic-bezier(0.5, 0, 0.8, 0.4) both;
}
@keyframes os-progress-in {
  from { transform: translateX(-50%) translateY(140%); opacity: 0; }
  to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
}
@keyframes os-progress-out {
  from { transform: translateX(-50%) translateY(0);    opacity: 1; }
  to   { transform: translateX(-50%) translateY(160%); opacity: 0; }
}
.os-progress-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.os-progress-dot {
  flex: none;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #22b573;
  box-shadow: 0 0 8px rgba(34, 181, 115, 0.8);
  animation: os-progress-breath 1.4s ease-in-out infinite;
}
@keyframes os-progress-breath {
  0%, 100% { opacity: 0.35; transform: scale(0.8); }
  50%      { opacity: 1;    transform: scale(1); }
}
`;

/** 执行标记：看到即可（与 os-action-pulse 单跳时长匹配）。 */
const ACTION_TTL_MS = 1100;
/** 进展浮窗退场动画时长（closing→closed 的等待窗口）。 */
const PROGRESS_OUT_MS = 380;
/** 进展浮窗无更新自动隐藏（动作卡死时浮窗不至于永久挂着）。每次 progress 重置。 */
const PROGRESS_TTL_MS = 60000;

/**
 * agent 覆盖层窗口渲染层（独立入口 overlay.html + src/os/overlay-main.tsx）。
 *
 * 宿主窗口由 src-tauri/os_overlay.rs 创建：全屏透明、NSPanel（盖住全屏空间）、
 * `set_ignore_cursor_events(true)` 永久穿透（本窗口收不到任何鼠标事件）、
 * `content_protected` 防标记进截屏污染模型输入。
 *
 * 通道：Rust 经 `Webview::eval` 直接调用 `window.__osOverlay.marker/clear`——
 * 不走 Tauri 事件系统（无 capability 依赖、无监听器注册时序问题）。挂载完成
 * 后 invoke `os_overlay_ready` 上报就绪，Rust 以此决定何时下发标记（自定义命令
 * 不经 ACL 门控）。交互控件一律不进本窗口。
 */
export function OsOverlayApp() {
  const [markers, setMarkers] = useState<GuideMarker[]>([]);
  /** 浮窗生命周期：closed(不渲染) → open(展示) → closing(退场动画中) → closed。 */
  const [progressPhase, setProgressPhase] = useState<"closed" | "open" | "closing">("closed");
  const [progress, setProgress] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const progressOutTimerRef = useRef<number | null>(null);
  /** FLIP 宽度动画的起点：progress 桥在改文本前测旧布局宽。 */
  const progressPrevWidthRef = useRef<number | null>(null);

  useEffect(() => {
    const hideProgress = () => {
      if (progressOutTimerRef.current !== null) return;
      setProgressPhase("closing");
      progressOutTimerRef.current = window.setTimeout(() => {
        progressOutTimerRef.current = null;
        setProgressPhase("closed");
        setProgress(null);
        progressPrevWidthRef.current = null;
      }, PROGRESS_OUT_MS);
    };
    window.__osOverlay = {
      marker: (payload: GuideMarker) => {
        setMarkers((prev) => [...prev, payload]);
        window.setTimeout(() => {
          setMarkers((prev) => prev.filter((m) => m.id !== payload.id));
        }, ACTION_TTL_MS);
      },
      clear: () => setMarkers([]),
      progress: (payload: { text: string }) => {
        // 退场中途来新进展：取消 closing 直接回场（动画随 className 切换重播）。
        if (progressOutTimerRef.current !== null) {
          window.clearTimeout(progressOutTimerRef.current);
          progressOutTimerRef.current = null;
        }
        // 先测旧布局宽再改文本——宽度 FLIP 的起点。
        progressPrevWidthRef.current =
          panelRef.current?.getBoundingClientRect().width ?? null;
        setProgressPhase("open");
        setProgress(payload.text);
        if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
        progressTimerRef.current = window.setTimeout(hideProgress, PROGRESS_TTL_MS);
      },
      progressClear: () => {
        if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
        hideProgress();
      },
    };
    void invoke("os_overlay_ready").catch(() => {
      /* 桥上报失败时 Rust 侧会走就绪超时诊断，这里无需处理 */
    });
    return () => {
      delete window.__osOverlay;
      if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
      if (progressOutTimerRef.current !== null) window.clearTimeout(progressOutTimerRef.current);
    };
  }, []);

  // 宽度动态变化：新文本布局完成后，WAAPI 从旧宽过渡到新宽（结束回落 auto 布局），
  // 中间帧靠 nowrap+overflow hidden 自然截断/展开——像抽屉拉开收回。
  useEffect(() => {
    if (progressPhase !== "open" || progress === null) return;
    const panel = panelRef.current;
    if (!panel) return;
    const raf = window.requestAnimationFrame(() => {
      const newWidth = panel.getBoundingClientRect().width;
      const prev = progressPrevWidthRef.current;
      progressPrevWidthRef.current = newWidth;
      if (prev === null || Math.abs(newWidth - prev) < 2) return;
      panel.animate(
        [{ width: `${prev}px` }, { width: `${newWidth}px` }],
        { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    });
    return () => window.cancelAnimationFrame(raf);
  }, [progress, progressPhase]);

  return (
    <>
      <style>{OVERLAY_CSS}</style>
      {progressPhase !== "closed" && progress !== null && (
        <div
          ref={panelRef}
          className={`os-progress-panel${progressPhase === "closing" ? " os-progress-out" : ""}`}
        >
          <span className="os-progress-dot" />
          <span className="os-progress-text">{progress}</span>
        </div>
      )}
      {markers.map((marker) => (
        <div key={marker.id} className="os-guide-marker" style={{ left: marker.x, top: marker.y }}>
          <span className="os-guide-ring os-action-ring" />
          <span className="os-guide-dot os-action-dot" />
        </div>
      ))}
    </>
  );
}
