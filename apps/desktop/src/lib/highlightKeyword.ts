import { useEffect } from "react";
import type { RefObject } from "react";

const HIT_ATTR = "data-search-hit";
// 跳过这些元素及其内部文本：已高亮 mark/行内键盘键/输入控件等不应被拆词包裹。
// 不跳过 CODE/PRE——代码块内的关键词同样要高亮（<mark> 仅加背景，保留 shiki 语法色）。
const SKIP_TAG = /^(SCRIPT|STYLE|SVG|MARK|KBD|RUBY|TEXTAREA|INPUT|SELECT)$/;

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectHighlightableTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement;
      while (parent && parent !== root) {
        if (SKIP_TAG.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
        parent = parent.parentElement;
      }
      const value = node.nodeValue || "";
      return value.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  let current: Node | null;
  while ((current = walker.nextNode())) out.push(current as Text);
  return out;
}

/**
 * 在容器内的可见文本中把关键词包裹成 <mark>（大小写不敏感、转义元字符）。
 * 不跳过 code/pre：代码块内的关键词也要高亮。<mark> 只加背景、不设前景色，
 * 正文里继承正文色、代码块里保留 shiki 的语法着色，不破坏 token 颜色。
 */
export function applyKeywordHighlight(root: HTMLElement, keyword: string): void {
  const query = keyword.trim();
  if (!query) return;
  const regex = new RegExp(escapeRegExp(query), "gi");
  for (const node of collectHighlightableTextNodes(root)) {
    const text = node.nodeValue || "";
    regex.lastIndex = 0;
    if (!regex.test(text)) continue;
    regex.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
      const mark = document.createElement("mark");
      mark.setAttribute(HIT_ATTR, "");
      // 仅背景高亮、不覆盖前景色：正文继承正文色，代码块保留 shiki 的语法着色。
      mark.className = "rounded bg-primary/30 px-0.5";
      mark.textContent = match[0];
      fragment.appendChild(mark);
      last = match.index + match[0].length;
      if (match[0].length === 0) regex.lastIndex++; // 零宽保护，避免死循环
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(fragment, node);
  }
}

/** 还原容器内由 applyKeywordHighlight 注入的 <mark>，并合并相邻文本节点。 */
export function clearKeywordHighlight(root: HTMLElement): void {
  const marks = root.querySelectorAll(`mark[${HIT_ATTR}]`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
    parent.normalize();
  });
}

/**
 * 在容器内高亮关键词：post-render DOM 包裹，不侵入 MarkdownLite/streamdown 渲染管道。
 * 仅用于稳定（非流式）消息——流式消息文本持续变化，React 重渲染会冲掉 <mark>，
 * 故调用方应仅在「定位命中」态启用（active 与消息选中态绑定）。
 * 不负责滚动：原生 mark.scrollIntoView 会绕过 Virtuoso 的位置追踪，与 scrollToIndex 互抢导致抖动。
 */
export function useHighlightKeyword(
  containerRef: RefObject<HTMLElement | null>,
  keyword: string,
  active: boolean
): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !active || !keyword.trim()) return;
    // streamdown 正文同步渲染、shiki 代码高亮异步（会替换 code 的 innerHTML）。
    // 少次重试即可：滚动由定位 effect 通过 Virtuoso scrollBy 单次完成。
    const apply = () => {
      clearKeywordHighlight(root);
      applyKeywordHighlight(root, keyword);
    };
    const raf1 = requestAnimationFrame(apply);
    const retryTimer = window.setTimeout(apply, 280);
    const retryTimer2 = window.setTimeout(apply, 700);
    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(retryTimer);
      window.clearTimeout(retryTimer2);
      clearKeywordHighlight(root);
    };
  }, [containerRef, keyword, active]);
}
