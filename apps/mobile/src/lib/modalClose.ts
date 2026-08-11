/**
 * 在 Reanimated 关闭动画结束后真正卸载浮层 Modal，并加 setTimeout 兜底，
 * 防止 runOnJS 回调丢失时全屏透明 Modal 残留、吞掉所有点击（移植自 Moirai）。
 *
 * startCloseAnimation 的结束回调通过 runOnJS 从动画线程触发；快速连点关闭时
 * 该回调可能丢失，故用 setTimeout(animationDurationMs + padding) 强制 settle。
 * `settled` 守卫保证只卸载一次。
 */
export function closeModalAfterAnimation(
  startCloseAnimation: (onFinished: () => void) => void,
  setVisible: (visible: false) => void,
  animationDurationMs: number,
  afterClose?: () => void,
  fallbackPaddingMs = 80
): void {
  let settled = false;

  const settle = (): void => {
    if (settled) return;
    settled = true;
    setVisible(false);
    afterClose?.();
  };

  startCloseAnimation(settle);
  setTimeout(settle, animationDurationMs + fallbackPaddingMs);
}
