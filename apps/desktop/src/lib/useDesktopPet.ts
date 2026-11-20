import { useEffect } from "react";
import { notePetActivity, setPetBusy, subscribePetActivity } from "./petActivity";
import { PET_SETTINGS_EVENT } from "./petSettings";
import { publishDesktopPet } from "./petBridge";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

/** 把会话忙碌和用户操作同步到独立悬浮窗。 */
export function useDesktopPet(busyBySession: Record<string, boolean>): void {
  const busy = Object.values(busyBySession).some(Boolean);

  useEffect(() => {
    setPetBusy(busy);
  }, [busy]);

  useEffect(() => {
    const onActivity = () => notePetActivity();
    const options: AddEventListenerOptions = { capture: true, passive: true };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, options);
    window.addEventListener("focus", onActivity);
    const onSettings = () => publishDesktopPet();
    window.addEventListener(PET_SETTINGS_EVENT, onSettings);
    const unsubscribe = subscribePetActivity(() => publishDesktopPet());
    notePetActivity();
    publishDesktopPet();
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, options);
      window.removeEventListener("focus", onActivity);
      window.removeEventListener(PET_SETTINGS_EVENT, onSettings);
      unsubscribe();
    };
  }, []);
}
