import NameTextComponent, { type NameTextProps } from './name-text';

export interface NameTextProxyProps {
  [key: string]: unknown;
}

export default function NameTextProxy(props: NameTextProxyProps) {
  return <NameTextComponent {...(props as unknown as NameTextProps)} />;
}
