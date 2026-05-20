import { Trans } from '@lingui/react/macro';
import { toASCII } from 'punycode/';

interface AccountHandleInfoProps {
  acct: string;
  instance?: string;
}

function AccountHandleInfo({ acct, instance }: AccountHandleInfoProps) {
  // acct = username or username@server
  let [username, server]: (string | undefined)[] = acct.split('@');
  if (!server) server = instance;
  const encodedAcct = toASCII(acct);
  return (
    <div className="handle-info">
      <span className="handle-handle" title={encodedAcct}>
        <b className="handle-username">{username}</b>
        <span className="handle-at">@</span>
        <b className="handle-server">{server}</b>
      </span>
      <div className="handle-legend">
        <span className="ib">
          <span className="handle-legend-icon username" /> <Trans>username</Trans>
        </span>{' '}
        <span className="ib">
          <span className="handle-legend-icon server" />{' '}
          <Trans>handle domain name</Trans>
        </span>
      </div>
    </div>
  );
}

export default AccountHandleInfo;
