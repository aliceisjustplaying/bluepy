import './keyboard-shortcuts-help.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { memo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSnapshot } from 'valtio';

import { currentAppPath } from '../utils/router';
import states from '../utils/states';

import Icon from './icon';
import Modal from './modal';

// Helper component for sequential key shortcuts
function SequentialKeys({ key1, key2 }: { key1: string; key2: string }) {
  return (
    <Trans>
      <kbd>{key1}</kbd> then <kbd>{key2}</kbd>
    </Trans>
  );
}

export default memo(function KeyboardShortcutsHelp() {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);

  function onClose() {
    states.showKeyboardShortcutsHelp = false;
  }

  useHotkeys(
    '?',
    () => {
      console.log('help');
      states.showKeyboardShortcutsHelp = true;
    },
    {
      useKey: true,
      ignoreModifiers: true,
      ignoreEventWhen: (e) => {
        const isCatchUpPage = /\/catchup/i.test(currentAppPath());
        return isCatchUpPage || e.metaKey || e.ctrlKey || e.altKey;
        // const hasModal = !!document.querySelector('#modal-container > *');
        // return hasModal;
      },
    },
  );

  return (
    !!snapStates.showKeyboardShortcutsHelp && (
      <Modal onClose={onClose}>
        <div
          id="keyboard-shortcuts-help-container"
          className="sheet"
          tabIndex={-1}
        >
          <button type="button" className="sheet-close" onClick={onClose}>
            <Icon icon="x" alt={t`Close`} />
          </button>
          <header>
            <h2>
              <Trans>Keyboard shortcuts</Trans>
            </h2>
          </header>
          <main>
            <table>
              <tbody>
                {(
                  [
                    {
                      id: 'keyboard-shortcuts-help',
                      action: t`Keyboard shortcuts help`,
                      keys: <kbd>?</kbd>,
                    },
                    {
                      id: 'next-post',
                      action: t`Next post`,
                      keys: <kbd>j</kbd>,
                    },
                    {
                      id: 'previous-post',
                      action: t`Previous post`,
                      keys: <kbd>k</kbd>,
                    },
                    {
                      id: 'skip-carousel-next',
                      action: t`Skip carousel to next post`,
                      keys: (
                        <Trans>
                          <kbd>Shift</kbd> + <kbd>j</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'skip-carousel-previous',
                      action: t`Skip carousel to previous post`,
                      keys: (
                        <Trans>
                          <kbd>Shift</kbd> + <kbd>k</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'load-new-posts',
                      action: t`Load new posts`,
                      keys: <kbd>.</kbd>,
                    },
                    {
                      id: 'open-post-details',
                      action: t`Open post details`,
                      keys: <kbd>Enter</kbd>,
                    },
                    {
                      id: 'open-media-or-post',
                      action: t`Open media or post details`,
                      keys: <kbd>o</kbd>,
                    },
                    {
                      id: 'expand-content-warning',
                      action: (
                        <Trans>
                          Expand content warning or
                          <br />
                          toggle expanded/collapsed thread
                        </Trans>
                      ),
                      keys: <kbd>x</kbd>,
                    },
                    {
                      id: 'close-post-dialogs',
                      action: t`Close post or dialogs`,
                      keys: (
                        <Trans>
                          <kbd>Esc</kbd> or <kbd>Backspace</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'compose-new-post',
                      action: t`Compose new post`,
                      keys: <kbd>c</kbd>,
                    },
                    {
                      id: 'compose-new-post-window',
                      action: t`Compose new post (new window)`,
                      className: 'insignificant',
                      keys: (
                        <Trans>
                          <kbd>Shift</kbd> + <kbd>c</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'send-post',
                      action: t`Send post`,
                      keys: (
                        <Trans>
                          <kbd>Ctrl</kbd> + <kbd>Enter</kbd> or <kbd>⌘</kbd> +{' '}
                          <kbd>Enter</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'search',
                      action: t`Search`,
                      keys: <kbd>/</kbd>,
                    },
                    {
                      id: 'reply',
                      action: t`Reply`,
                      keys: <kbd>r</kbd>,
                    },
                    {
                      id: 'reply-window',
                      action: t`Reply (new window)`,
                      className: 'insignificant',
                      keys: (
                        <Trans>
                          <kbd>Shift</kbd> + <kbd>r</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'like',
                      action: t`Like (favourite)`,
                      keys: (
                        <Trans>
                          <kbd>l</kbd> or <kbd>f</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'repost',
                      action: t`Repost`,
                      keys: (
                        <Trans>
                          <kbd>Shift</kbd> + <kbd>b</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'quote',
                      action: t`Quote`,
                      keys: <kbd>q</kbd>,
                    },
                    {
                      id: 'bookmark',
                      action: t`Bookmark`,
                      keys: <kbd>d</kbd>,
                    },
                    {
                      id: 'cloak-mode',
                      action: t`Toggle Cloak mode`,
                      keys: (
                        <Trans>
                          <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>k</kbd>
                        </Trans>
                      ),
                    },
                    {
                      id: 'go-home',
                      action: t`Go to Home`,
                      keys: <SequentialKeys key1="g" key2="h" />,
                    },
                    {
                      id: 'go-notifications',
                      action: t`Go to Notifications`,
                      keys: <SequentialKeys key1="g" key2="n" />,
                    },
                    {
                      id: 'go-settings',
                      action: t`Go to Settings`,
                      keys: <SequentialKeys key1="g" key2="s" />,
                    },
                    {
                      id: 'go-profile',
                      action: t`Go to Profile`,
                      keys: <SequentialKeys key1="g" key2="p" />,
                    },
                    {
                      id: 'go-bookmarks',
                      action: t`Go to Bookmarks`,
                      keys: <SequentialKeys key1="g" key2="b" />,
                    },
                  ] as ReadonlyArray<{
                    id: string;
                    action: import('react').ReactNode;
                    className?: string;
                    keys: import('react').ReactNode;
                  }>
                ).map(({ id, action, className, keys }) => (
                  <tr key={id}>
                    <th className={className}>{action}</th>
                    <td>{keys}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </main>
        </div>
      </Modal>
    )
  );
});
