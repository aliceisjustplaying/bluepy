import StatusComponent, { type StatusComponentProps } from './status';

type StatusProxyStatus = NonNullable<StatusComponentProps['status']>;

export interface StatusProxyProps extends Omit<StatusComponentProps, 'status'> {
  status?: unknown;
}

function isStatusProxyStatus(value: unknown): value is StatusProxyStatus {
  if (!value || typeof value !== 'object') return false;
  if (!('id' in value) || typeof value.id !== 'string') return false;
  if (!('account' in value) || !value.account) return false;
  const { account } = value;
  return (
    typeof account === 'object' &&
    'id' in account &&
    typeof account.id === 'string'
  );
}

export default function StatusProxy(props: StatusProxyProps) {
  const { status, ...componentProps } = props;
  return (
    <StatusComponent
      {...componentProps}
      status={isStatusProxyStatus(status) ? status : null}
    />
  );
}
