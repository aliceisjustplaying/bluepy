import NameTextComponent, {
  type NameTextAccount,
  type NameTextProps,
} from './name-text';

export interface NameTextProxyProps extends Omit<NameTextProps, 'account'> {
  account?:
    | NameTextAccount
    | ({ id?: string; acct?: string; username?: string; url?: string } & Record<
        string,
        unknown
      >)
    | null;
}

function nameTextAccount(value: NameTextProxyProps['account']) {
  if (!value) return value;
  if (typeof value.id !== 'string') return null;
  const acct =
    typeof value.acct === 'string'
      ? value.acct
      : typeof value.username === 'string'
        ? value.username
        : '';
  const username = typeof value.username === 'string' ? value.username : acct;
  if (typeof value.url !== 'string') return null;
  return {
    ...value,
    acct,
    id: value.id,
    url: value.url,
    username,
  };
}

export default function NameTextProxy(props: NameTextProxyProps) {
  const { account, ...componentProps } = props;
  return (
    <NameTextComponent {...componentProps} account={nameTextAccount(account)} />
  );
}
