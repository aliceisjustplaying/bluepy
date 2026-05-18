import { useParams } from 'react-router-dom';

import {
  encodeAtprotoID,
  getAtprotoRepo,
  isAtprotoFeedGeneratorURI,
  isAtprotoListURI,
  isAtprotoPostURI,
  isAtprotoProfileURI,
  maybeDecodeAtprotoURI,
} from '../utils/atproto-route';

import AccountStatuses from './account-statuses';
import List from './list';
import Status from './status';

export default function AtprotoRoute() {
  const params = useParams<{
    '*': string;
    atUri?: string;
    scheme?: string;
  }>();
  const uri =
    params.scheme === 'at'
      ? `at://${(params['*'] || '').replace(/^\/+/, '')}`
      : maybeDecodeAtprotoURI(params.atUri);

  if (isAtprotoPostURI(uri)) {
    return <Status id={encodeAtprotoID(uri)} instance="bsky.social" />;
  }
  if (isAtprotoProfileURI(uri)) {
    const repo = getAtprotoRepo(uri);
    return repo ? <AccountStatuses id={repo} instance="bsky.social" /> : null;
  }
  if (isAtprotoListURI(uri) || isAtprotoFeedGeneratorURI(uri)) {
    return <List id={encodeAtprotoID(uri)} instance="bsky.social" />;
  }
  return null;
}
