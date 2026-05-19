export interface CatchupFetchRangeItem {
  createdAt: string;
}

export function catchupPageHasItemsInRange(
  items: CatchupFetchRangeItem[],
  maxCreatedAt: number | null,
): boolean {
  if (!maxCreatedAt) return true;
  return items.some((item) => Date.parse(item.createdAt) >= maxCreatedAt);
}
