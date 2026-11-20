import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BotAvatar } from "bot-avatars";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { invoke, listen } from "../lib/platform";
import { isTauriRuntime, type PetSync } from "../lib/petBridge";
import { loadPetSettings, normalizePetSettings } from "../lib/petSettings";
import { gazeClientPoint, resolvePetState, type PetMotionState } from "../lib/petState";

const STATE_LABEL: Record<PetMotionState, string> = {
  default: "待机",
  working: "忙碌",
  sleeping: "休眠",
};

function initialSync(): PetSync {
  return { ...loadPetSettings(), busy: false, lastActivityAt: Date.now() };
}

function applyPayload(payload: Partial<PetSync> | null | undefined, fallback: PetSync): PetSync {
  if (!payload) return fallback;
  const settings = normalizePetSettings(payload);
  const lastActivityAt = typeof payload.lastActivityAt === "number" && payload.lastActivityAt > 0
    ? payload.lastActivityAt
    : fallback.lastActivityAt;
  return { ...settings, busy: payload.busy === true, lastActivityAt };
}

export function PetWindowApp() {
  const [sync, setSync] = useState<PetSync>(initialSync);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let dead = false;
    let pending = false;
    let last = 0;
    let frame = 0;
    const follow = (time: number) => {
      if (dead) return;
      if (!pending && time - last >= 40) {
        pending = true;
        last = time;
        void invoke<{ x: number; y: number }>("pet_pointer").then((point) => {
          pending = false;
          if (dead || !point) return;
          const gaze = gazeClientPoint({
            cursorX: point.x,
            cursorY: point.y,
            width: window.innerWidth,
            height: window.innerHeight,
          });
          document.dispatchEvent(new PointerEvent("pointermove", {
            clientX: gaze.x,
            clientY: gaze.y,
            bubbles: true,
          }));
        }).catch(() => {
          pending = false;
        });
      }
      if (!dead) frame = window.requestAnimationFrame(follow);
    };
    frame = window.requestAnimationFrame(follow);
    return () => {
      dead = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let dead = false;
    let unlisten = () => {};
    void (async () => {
      const stop = await listen<PetSync>("giteam://pet-sync", (event) => {
        setSync((current) => applyPayload(event.payload, current));
      });
      if (dead) {
        stop();
        return;
      }
      unlisten = stop;
      try {
        const snapshot = await invoke<PetSync | null>("pet_ready");
        if (!dead) setSync((current) => applyPayload(snapshot, current));
      } catch {
        // 窗口命令不可用时仍显示本地外观。
      }
    })();
    return () => {
      dead = true;
      unlisten();
    };
  }, []);

  const state = resolvePetState({
    busy: sync.busy,
    lastActivityAt: sync.lastActivityAt,
    now,
    sleepMinutes: sync.sleepMinutes,
  });

  async function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !isTauriRuntime()) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = { x: event.screenX, y: event.screenY };
    let moved = false;
    let originX = 0;
    let originY = 0;
    let scale = 1;
    try {
      const win = getCurrentWindow();
      const origin = await win.outerPosition();
      originX = origin.x;
      originY = origin.y;
      scale = await win.scaleFactor();
      const onMove = (ev: globalThis.PointerEvent) => {
        const dx = ev.screenX - start.x;
        const dy = ev.screenY - start.y;
        if (dx * dx + dy * dy > 16) moved = true;
        if (!moved) return;
        void win.setPosition(new PhysicalPosition(
          Math.round(originX + dx * scale),
          Math.round(originY + dy * scale),
        ));
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        if (!moved) {
          void invoke("pet_open_client").catch(() => {});
          return;
        }
        void win.outerPosition()
          .then((pos) => invoke("pet_save_position", { x: pos.x, y: pos.y }))
          .catch(() => {});
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    } catch {
      void invoke("pet_open_client").catch(() => {});
    }
  }

  return (
    <button
      type="button"
      aria-label={`打开 Giteam，宠物当前${STATE_LABEL[state]}`}
      onPointerDown={(event) => { void onPointerDown(event); }}
      style={{
        display: "grid",
        placeItems: "center",
        width: "100%",
        height: "100%",
        margin: 0,
        padding: 0,
        border: 0,
        background: "transparent",
        cursor: "pointer",
      }}
    >
      <BotAvatar
        type={sync.type}
        state={state}
        shading={sync.shading}
        face={sync.face}
        hat={sync.hat}
        glasses={sync.glasses}
        headphones={sync.headphones}
        bowTie={sync.bowTie}
        color={sync.color || undefined}
        accessoryColor={sync.accessoryColor || undefined}
        size={sync.size}
        interactive
        aria-hidden="true"
      />
    </button>
  );
}
