import { useCallback, useLayoutEffect } from 'react';
import { matchPath } from 'react-router-dom';
import { subscribeKey } from 'valtio/utils';

import states from './states';

const { PHANPY_CLIENT_NAME: CLIENT_NAME } = import.meta.env as {
  PHANPY_CLIENT_NAME: string;
};

export default function useTitle(
  title: string | null | undefined,
  path: string | string[],
): void {
  const setTitle = useCallback(() => {
    const { currentLocation } = states;
    const hasPaths = Array.isArray(path);
    let paths: string[] = hasPaths ? path : [];
    // Workaround for matchPath not working for optional path segments
    // https://github.com/remix-run/react-router/discussions/9862
    if (!hasPaths && /:?\w+\?/.test(path)) {
      paths.push(path.replace(/(:\w+)\?/g, '$1'));
      paths.push(path.replace(/\/?:\w+\?/g, ''));
    }
    let matched: unknown = false;
    if (paths.length) {
      matched = paths.some((p) => matchPath(p, currentLocation as string));
    } else if (path) {
      matched = matchPath(path as string, currentLocation as string);
    }
    console.debug('setTitle', { title, path, currentLocation, paths, matched });
    if (matched) {
      document.title = title ? `${title} / ${CLIENT_NAME}` : CLIENT_NAME;
    }
  }, [title, path]);

  useLayoutEffect(() => {
    const unsub = subscribeKey(states, 'currentLocation', setTitle);
    setTitle();
    return unsub;
  }, [setTitle]);
}
