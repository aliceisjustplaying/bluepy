import { useParams } from 'react-router-dom';

import {
  encodeAtprotoID,
  isAtprotoPostURI,
  maybeDecodeAtprotoURI,
} from '../utils/atproto-route';

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

  if (!isAtprotoPostURI(uri)) return null;
  return <Status id={encodeAtprotoID(uri)} instance="bsky.social" />;
}
