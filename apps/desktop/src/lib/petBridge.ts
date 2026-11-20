import { invoke } from "./platform";
import { readPetRuntime } from "./petActivity";
import { loadPetSettings, type PetSettings } from "./petSettings";

export type PetSync = PetSettings & {
  busy: boolean;
  lastActivityAt: number;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function buildPetSync(settings: PetSettings = loadPetSettings()): PetSync {
  const activity = readPetRuntime();
  return {
    ...settings,
    busy: activity.busy,
    lastActivityAt: activity.lastActivityAt,
  };
}

let chain: Promise<void> = Promise.resolve();

export function publishDesktopPet(settings?: PetSettings): void {
  if (!isTauriRuntime()) return;
  const snapshot = buildPetSync(settings);
  chain = chain.then(async () => {
    try {
      await invoke("pet_sync", { snapshot });
    } catch {
      // 浏览器预览或命令尚未就绪时忽略。
    }
  });
}
