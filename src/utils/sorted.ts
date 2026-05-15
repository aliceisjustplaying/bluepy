export function sorted<T>(
  items: Iterable<T> | ArrayLike<T>,
  compareFn?: (a: T, b: T) => number,
): T[] {
  const copy = Array.from(items);
  Array.prototype.sort.call(copy, compareFn);
  return copy;
}
