export interface VisibleRange {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
}

export function visibleRange(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): VisibleRange {
  if (count <= 0 || rowHeight <= 0 || viewportHeight < 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (count - end) * rowHeight),
  };
}
