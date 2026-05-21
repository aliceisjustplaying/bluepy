import StatusComponent, { type StatusComponentProps } from './status';

export interface StatusProxyProps {
  [key: string]: unknown;
}

export default function StatusProxy(props: StatusProxyProps) {
  return <StatusComponent {...(props as StatusComponentProps)} />;
}
