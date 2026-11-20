export type PetActivity = {
  busy: boolean;
  lastActivityAt: number;
};

let busy = false;
let lastActivityAt = Date.now();
let snapshot: PetActivity = { busy, lastActivityAt };
const listeners = new Set<() => void>();
let flushTimer = 0;

function emit() {
  snapshot = { busy, lastActivityAt };
  for (const listener of listeners) listener();
}

export function getPetActivitySnapshot(): PetActivity {
  return snapshot;
}

export function readPetRuntime(): PetActivity {
  return { busy, lastActivityAt };
}

export function subscribePetActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 用户操作。连续事件合并到约 1 秒一次，休眠判断仍用最后一次的时间。 */
export function notePetActivity(at = Date.now()): void {
  lastActivityAt = at;
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = 0;
    emit();
  }, 1000);
}

export function setPetBusy(next: boolean): void {
  if (busy === next) return;
  busy = next;
  lastActivityAt = Date.now();
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = 0;
  }
  emit();
}
