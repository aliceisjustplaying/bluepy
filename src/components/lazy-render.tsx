import type { ComponentChildren, ComponentType, JSX } from 'preact';
import { Children } from 'preact/compat';
import { useMemo, useRef } from 'preact/hooks';
import { useOnInView } from 'react-intersection-observer';

// The sticky header, usually at the top
const TOP = 48;

type LazyRenderAs = keyof JSX.IntrinsicElements | ComponentType;

interface LazyRenderProps {
  as?: LazyRenderAs;
  id?: string;
  class?: string;
  children?: ComponentChildren;
  renderIfHasChildren?: boolean;
  [key: string]: unknown;
}

export default function LazyRender({
  as: Root = 'div',
  id,
  class: className,
  children,
  renderIfHasChildren = true,
  ...props
}: LazyRenderProps) {
  const rootRef = useRef<HTMLElement | null>(null);

  const hasChildren = useMemo(
    () => Children.toArray(children).filter((child) => !!child).length > 0,
    [children],
  );

  const observerRef = useOnInView<HTMLElement>(
    (inView, entry) => {
      if (!rootRef.current) return;
      const node = rootRef.current;
      if (inView) {
        console.log('💥', { id, root: node });
        node.classList.remove('hidden');
      } else if (entry.boundingClientRect.bottom <= TOP) {
        // Element is above the fold (already scrolled past)
        if (hasChildren && renderIfHasChildren) {
          // Don't need to observe if has children
          observerRef(null);
          // Debugging
          if (import.meta.env.DEV) {
            node.dataset.rectBottom = String(entry.boundingClientRect.bottom);
          }
        } else {
          node.classList.add('hidden');
        }
      }
    },
    {
      rootMargin: `-${TOP}px 0px 0px 0px`,
      triggerOnce: true,
      skip: !hasChildren,
    },
  );

  const RootEl = Root as unknown as 'div';
  return (
    <RootEl
      {...props}
      ref={(node: HTMLElement | null) => {
        rootRef.current = node;
        observerRef(node);
      }}
      class={`lazy-render ${className || ''}`}
    >
      {children}
    </RootEl>
  );
}
