import { describe, expect, it } from "vitest";
import { computeChatLayout } from "./AgentChatFrame";

// 与 AgentChatFrame.tsx 中常量保持一致：
// 内容 860、轨偏移 820、expanded 300、collapsed 46、外侧余量 20、左缘下限 24。
const EXPANDED_NEED = 820 + 300 + 20; // 1140
const COLLAPSED_NEED = 820 + 46 + 20; // 886
const EXPANDED_THRESHOLD = 24 + EXPANDED_NEED; // 1164
const COLLAPSED_THRESHOLD = 24 + COLLAPSED_NEED; // 910

describe("computeChatLayout", () => {
  it("centers the content with an expanded rail when space is ample", () => {
    expect(computeChatLayout(3000)).toEqual({ contentLeft: 1070, railMode: "expanded" });
  });

  it("hands over from centered to left-drift continuously at the crossover", () => {
    // 居中位与「给展开轨留位的右贴值」相交于 w=1420，两侧取值相等 → 无跳变
    expect(computeChatLayout(1420)).toEqual({ contentLeft: 280, railMode: "expanded" });
    expect(computeChatLayout(1419).contentLeft).toBe(279);
  });

  it("drifts the content left gradually as the window shrinks", () => {
    // 每缩 1px 窗口，内容列只漂 1px（而非一次性跳到左缘）
    expect(computeChatLayout(1400)).toEqual({ contentLeft: 260, railMode: "expanded" });
    expect(computeChatLayout(1300)).toEqual({ contentLeft: 160, railMode: "expanded" });
  });

  it("settles at the minimum left gap before the rail starts degrading", () => {
    expect(computeChatLayout(EXPANDED_THRESHOLD)).toEqual({
      contentLeft: 24,
      railMode: "expanded"
    });
  });

  it("collapses the rail in place without moving the content column", () => {
    // 跨过展开→折叠阈值时内容列保持 24px，只有轨道在右缘原地折叠
    expect(computeChatLayout(EXPANDED_THRESHOLD - 1)).toEqual({
      contentLeft: 24,
      railMode: "collapsed"
    });
    expect(computeChatLayout(1000)).toEqual({ contentLeft: 24, railMode: "collapsed" });
  });

  it("hides the rail below the collapsed threshold and eases back toward center", () => {
    // min(居中, 24) 衔接：折叠档末尾仍贴左缘下限，隐藏后随居中位回落
    expect(computeChatLayout(COLLAPSED_THRESHOLD)).toEqual({
      contentLeft: 24,
      railMode: "collapsed"
    });
    expect(computeChatLayout(COLLAPSED_THRESHOLD - 1)).toEqual({
      contentLeft: 24.5,
      railMode: "hidden"
    });
  });

  it("clamps the offset to zero when the viewport is narrower than the content", () => {
    expect(computeChatLayout(600)).toEqual({ contentLeft: 0, railMode: "hidden" });
  });

  it("moves the content column continuously across the whole width range", () => {
    // 核心体验约束：任意相邻 1px 宽度变化，内容列位移不超过 1px（无阈值瞬移）
    let previous = computeChatLayout(0).contentLeft;
    for (let width = 1; width <= 3000; width += 1) {
      const current = computeChatLayout(width).contentLeft;
      expect(Math.abs(current - previous)).toBeLessThanOrEqual(1);
      previous = current;
    }
  });
});
