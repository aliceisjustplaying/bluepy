import { api } from './api';
import pmem from './pmem';

async function isSearchEnabledImpl(instance: string): Promise<boolean> {
  const { compat } = api({ instance });
  const results = await compat.v2.search.list({
    q: 'from:me',
    type: 'statuses',
    limit: 1,
  });
  return !!results?.statuses?.length;
}

export default pmem(isSearchEnabledImpl);
