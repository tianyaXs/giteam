import type { MotionOptions, MotionController } from "./motion-runtime";
import type { CalendarBoardEvent } from "../../lib/automationCalendar";

export type VelocityFocusDragOptions = MotionOptions & {
  events?: CalendarBoardEvent[];
  /** 当前周起始（周日 00:00）时间戳 */
  weekStartMs?: number;
  /**
   * originDay：拖拽起始星期。
   * originDate：例外卡的源绝对日；源格为 null（用于不覆盖同日另一张）。
   */
  onEventMove?: (
    taskId: string,
    day: number,
    hour: number,
    originDay: number,
    originDate?: string | null
  ) => void;
  onEventClick?: (taskId: string) => void;
  /** 点击空白日/时格，用于预填时间创建任务 */
  onSlotClick?: (day: number, hour: number) => void;
  /** 周翻页：-1 上一周，1 下一周，0 回到本周 */
  onWeekChange?: (delta: -1 | 0 | 1) => void;
};

export function mountVelocityFocusDrag(
  target: HTMLElement,
  options?: VelocityFocusDragOptions
): MotionController;
