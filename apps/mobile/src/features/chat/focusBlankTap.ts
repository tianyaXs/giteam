import { getDisplayedCellItemType, type DisplayedTurnCell } from './displayedCells';

/** 点这些时间线单元格时不切换专注 chrome（展开事件详情优先）。 */
export function isFocusBlockingEventCell(cell: DisplayedTurnCell | null | undefined): boolean {
  if (!cell || cell.userMessage) return false;
  const kind = getDisplayedCellItemType(cell);
  return kind === 'event' || kind === 'toolBatch';
}
