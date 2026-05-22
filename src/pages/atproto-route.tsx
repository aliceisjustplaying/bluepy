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
  return <AtprotoRouteByKind />;
}

function AtprotoRouteByKind({
  statusOnly = false,
  nonStatusOnly = false,
}: {
  statusOnly?: boolean;
  nonStatusOnly?: boolean;
}) {
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
    if (nonStatusOnly) return null;
    return <Status id={encodeAtprotoID(uri)} instance="bsky.social" />;
  }
  if (statusOnly) return null;
  if (isAtprotoProfileURI(uri)) {
    const repo = getAtprotoRepo(uri);
    return repo ? <AccountStatuses id={repo} instance="bsky.social" /> : null;
  }
  if (isAtprotoListURI(uri) || isAtprotoFeedGeneratorURI(uri)) {
    return <List id={encodeAtprotoID(uri)} instance="bsky.social" />;
  }
  return null;
}

export function AtprotoNonStatusRoute() {
  return <AtprotoRouteByKind nonStatusOnly />;
}

export function AtprotoStatusRoute() {
  return <AtprotoRouteByKind statusOnly />;
}
