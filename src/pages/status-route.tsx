import { useParams } from 'react-router-dom';

import { encodeAtprotoID } from '../utils/atproto-route';

import Status from './status';

export default function StatusRoute() {
  const params = useParams<{ id?: string; instance?: string }>();
  let { id, instance } = params;
  if (id?.startsWith('at://')) id = encodeAtprotoID(id);
  if (!id) return null;
  return <Status id={id} instance={instance} />;
}
