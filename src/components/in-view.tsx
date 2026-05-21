import type { ComponentType, ReactNode } from 'react';
import { InView as InViewUntyped } from 'react-intersection-observer';

export interface InViewProps {
  as?: string;
  root?: Element | null;
  rootMargin?: string;
  threshold?: number;
  class?: string;
  className?: string;
  tabIndex?: number;
  onChange?: (inView: boolean) => void;
  children?: ReactNode;
}

const InView: ComponentType<InViewProps> =
  InViewUntyped as typeof InViewUntyped & ComponentType<InViewProps>;

export default InView;
