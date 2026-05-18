import { memo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { navigatePath } from '../utils/router';
import states from '../utils/states';
import { getCurrentAccount } from '../utils/store-utils';

// ignoreEventWhen doesn't work with sequence shortcuts, so we wrap callbacks instead
const useGoHotkeys = (
  key: string,
  callback: (e: globalThis.KeyboardEvent) => void,
) => {
  useHotkeys(
    `g>${key}`,
    (e) => {
      const hasModal = !!document.querySelector('#modal-container > *');
      const shouldIgnore = hasModal || e.metaKey || e.ctrlKey || e.altKey;
      if (!shouldIgnore) {
        callback(e);
      }
    },
    { useKey: true },
  );
};

export default memo(function NavigationCommand() {
  useGoHotkeys('h', () => {
    navigatePath('/');
  });
  useGoHotkeys('n', () => {
    navigatePath('/notifications');
  });
  useGoHotkeys('s', () => {
    states.showSettings = true;
  });
  useGoHotkeys('p', () => {
    const account = getCurrentAccount();
    if (account) {
      const { instanceURL } = account;
      const { id } = account.info;
      navigatePath(`/${instanceURL}/a/${id}`);
    }
  });
  useGoHotkeys('b', () => {
    navigatePath('/b');
  });

  return null;
});
