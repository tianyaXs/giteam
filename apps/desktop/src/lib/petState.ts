export type PetMotionState = "default" | "working" | "sleeping";

/** 会话运行中优先忙碌；否则超过休眠阈值进入休眠，其余时间为待机。 */
export function resolvePetState(input: {
  busy: boolean;
  lastActivityAt: number;
  now: number;
  sleepMinutes: number;
}): PetMotionState {
  if (input.busy) return "working";
  const minutes = Number.isFinite(input.sleepMinutes) ? Math.max(1, Math.floor(input.sleepMinutes)) : 5;
  const idleMs = input.now - input.lastActivityAt;
  if (Number.isFinite(idleMs) && idleMs >= minutes * 60_000) return "sleeping";
  return "default";
}

/**
 * 把屏幕上的鼠标收成头像会跟随的视口坐标。
 * bot-avatars 只在大约一个身体宽度内全力看向指针，更远就松开。
 * 这里保留方向，把落点收到这个范围内，宠物就会一直看向鼠标。
 */
export function gazeClientPoint(input: {
  cursorX: number;
  cursorY: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  const width = Number.isFinite(input.width) && input.width > 0 ? input.width : 1;
  const height = Number.isFinite(input.height) && input.height > 0 ? input.height : width;
  const body = width / 1.5;
  const faceX = width / 2;
  const faceY = height / 2 + body * 0.1;
  let dx = (Number.isFinite(input.cursorX) ? input.cursorX : faceX) - faceX;
  let dy = (Number.isFinite(input.cursorY) ? input.cursorY : faceY) - faceY;
  const dist = Math.hypot(dx, dy);
  const reach = body * 0.85;
  if (dist > reach && dist > 0) {
    const scale = reach / dist;
    dx *= scale;
    dy *= scale;
  }
  return { x: faceX + dx, y: faceY + dy };
}
