import StatusComponent, { type StatusComponentProps } from './status';

type StatusProxyStatus = NonNullable<StatusComponentProps['status']>;

export interface StatusProxyProps extends Omit<StatusComponentProps, 'status'> {
  status?: unknown;
}

function isStatusProxyStatus(value: unknown): value is StatusProxyStatus {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'account' in value &&
    !!value.account &&
    typeof value.account === 'object'
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
