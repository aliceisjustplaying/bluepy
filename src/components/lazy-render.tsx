import type { ReactNode, ComponentType, JSX } from 'react';
import { Children } from 'react';
import { useMemo, useRef } from 'react';
import { useOnInView } from 'react-intersection-observer';

// The sticky header, usually at the top
const TOP = 48;

type LazyRenderAs = keyof JSX.IntrinsicElements | ComponentType;

interface LazyRenderProps {
  as?: LazyRenderAs;
  id?: string;
  class?: string;
  className?: string;
  children?: ReactNode;
  renderIfHasChildren?: boolean;
  [key: string]: unknown;
}

interface LazyRenderRootProps {
  id?: string;
  class?: string;
  className?: string;
  children?: ReactNode;
  ref?: (node: HTMLElement | null) => void;
  [key: string]: unknown;
}

function lazyRenderRoot(root: unknown): ComponentType<LazyRenderRootProps> {
  return root as ComponentType<LazyRenderRootProps>;
}

export default function LazyRender({
  as: Root = 'div',
  id,
  class: classProp,
  className = classProp,
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

  const RootEl = lazyRenderRoot(Root);
  return (
    <RootEl
      {...props}
      ref={(node: HTMLElement | null) => {
        rootRef.current = node;
        observerRef(node);
      }}
      className={`lazy-render ${className || ''}`}
    >
      {children}
    </RootEl>
  );
}
