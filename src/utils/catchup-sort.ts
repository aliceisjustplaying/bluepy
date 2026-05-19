export interface CatchupSortablePost {
  id: string;
  createdAt: string;
}

export function getCreatedAtTime(
  post: Pick<CatchupSortablePost, 'createdAt'>,
): number {
  const time = Date.parse(post.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

export function compareCreatedAt(
  a: CatchupSortablePost,
  b: CatchupSortablePost,
): number {
  const order = getCreatedAtTime(a) - getCreatedAtTime(b);
  if (order !== 0) return order;
  return a.id.localeCompare(b.id);
}
