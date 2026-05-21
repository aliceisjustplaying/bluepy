import type { Ref } from 'react';

export function assignFocusableAnchorRef(
  ref: Ref<unknown>,
  node: HTMLAnchorElement | null,
): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}
