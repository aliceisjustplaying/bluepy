import type { ReactNode } from 'react';
import { InView as InViewUntyped } from 'react-intersection-observer';

export interface InViewProps {
  as?: 'div' | 'li';
  root?: Element | null;
  rootMargin?: string;
  threshold?: number;
  class?: string;
  className?: string;
  tabIndex?: number;
  onChange?: (inView: boolean) => void;
  children?: ReactNode;
}

function InView({
  class: legacyClassName,
  className,
  onChange,
  ...props
}: InViewProps) {
  const notifyInViewChange = onChange
    ? (inView: boolean) => {
        onChange(inView);
      }
    : undefined;
  return (
    <InViewUntyped
      {...props}
      className={className ?? legacyClassName}
      onChange={notifyInViewChange}
    />
  );
}

export default InView;
