import type { ComponentType } from 'preact';
import { useParams } from 'react-router-dom';

import { encodeAtprotoID } from '../utils/atproto-route';

import StatusRaw from './status';

interface StatusProps {
  id?: string;
  instance?: string;
}
const Status = StatusRaw as unknown as ComponentType<StatusProps>;

export default function StatusRoute() {
  const params = useParams<{ id?: string; instance?: string }>();
  let { id, instance } = params;
  if (id?.startsWith('at://')) id = encodeAtprotoID(id);
  return <Status id={id} instance={instance} />;
}
