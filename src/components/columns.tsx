import { useLingui } from '@lingui/react/macro';
import type { ComponentType } from 'preact';
import { useHotkeys } from 'react-hotkeys-hook';
import { useSnapshot } from 'valtio';

import AccountStatuses from '../pages/account-statuses';
import Bookmarks from '../pages/bookmarks';
import Favourites from '../pages/favourites';
import Following from '../pages/following';
import Hashtag from '../pages/hashtag';
import List from '../pages/list';
import Mentions from '../pages/mentions';
import Notifications from '../pages/notifications';
import Public from '../pages/public';
import Search from '../pages/search';
import Trending from '../pages/trending';
import isRTL from '../utils/is-rtl';
import states from '../utils/states';
import { getCurrentAccountID } from '../utils/store-utils';
import useTitle from '../utils/useTitle';

type ShortcutParams = Record<string, unknown> & {
  id?: string | null;
  query?: string;
};

interface Shortcut extends ShortcutParams {
  type: string;
}

type ColumnComponent = ComponentType<
  ShortcutParams & { columnMode?: boolean }
>;

const scrollIntoViewOptions: ScrollIntoViewOptions = {
  block: 'nearest',
  inline: 'nearest',
  behavior: 'instant' as ScrollBehavior,
};

function Columns() {
  const { t } = useLingui();
  useTitle(t`Home`, '/');
  const snapStates = useSnapshot(states);
  const { shortcuts } = snapStates;

  console.debug('RENDER Columns', shortcuts);

  const components = (shortcuts as readonly (Shortcut | null | undefined)[]).map((shortcut) => {
    if (!shortcut) return null;
    const { type, ...params } = shortcut;
    const Component = ({
      following: Following,
      notifications: Notifications,
      list: List,
      public: Public,
      bookmarks: Bookmarks,
      favourites: Favourites,
      hashtag: Hashtag,
      mentions: Mentions,
      trending: Trending,
      search: Search,
      profile: AccountStatuses,
    } as unknown as Record<string, ColumnComponent | undefined>)[type];
    if (!Component) return null;
    // Don't show Search column with no query, for now
    if (type === 'search' && !params.query) return null;
    // Don't show List column with no list, for now
    if (type === 'list' && !params.id) return null;
    // If profile, provide the account ID
    if (type === 'profile') {
      params.id = getCurrentAccountID();
    }
    return (
      <Component key={type + JSON.stringify(params)} {...params} columnMode />
    );
  });

  useHotkeys(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    (e) => {
      try {
        const index = parseInt(e.key, 10) - 1;
        const $column = document.querySelectorAll<HTMLElement>(
          '#columns > *',
        )[index];
        if ($column) {
          $column.focus();
          $column.scrollIntoView(scrollIntoViewOptions);
        }
      } catch (err) {
        console.error(err);
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e: KeyboardEvent) => {
        // Allow number even with Shift (e.g. French AZERTY requires Shift for numbers)
        if (/^[1-9]$/.test(e.key)) return false;
        return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
    },
  );

  useHotkeys(
    ['[', ']'],
    (_e, handler) => {
      const key = handler.keys?.[0];
      const currentFocusedColumn = (
        document.activeElement as HTMLElement | null
      )?.closest('#columns > *') as HTMLElement | null;

      const rtl = isRTL();
      const prevColKey = rtl ? ']' : '[';
      const nextColKey = rtl ? '[' : ']';
      let $column: HTMLElement | null = null;

      if (key === prevColKey) {
        // If [, focus on left of focused column, else first column
        $column = currentFocusedColumn
          ? (currentFocusedColumn.previousElementSibling as HTMLElement | null)
          : (document.querySelectorAll<HTMLElement>('#columns > *')[0] ?? null);
      } else if (key === nextColKey) {
        // If ], focus on right of focused column, else 2nd column
        $column = currentFocusedColumn
          ? (currentFocusedColumn.nextElementSibling as HTMLElement | null)
          : (document.querySelectorAll<HTMLElement>('#columns > *')[1] ?? null);
      }
      if ($column) {
        $column.focus();
        $column.scrollIntoView(scrollIntoViewOptions);
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e: KeyboardEvent) => {
        // Allow '[' or ']' even with Alt (e.g. German keyboards require Alt for these)
        if (['[', ']'].includes(e.key)) return false;
        return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
    },
  );

  return (
    <div
      id="columns"
      onContextMenu={(e) => {
        const target = e.target as Element | null;
        // If right-click on header, but not links or buttons
        if (
          target?.closest('.deck > header') &&
          !target.closest('a') &&
          !target.closest('button')
        ) {
          e.preventDefault();
          states.showShortcutsSettings = true;
        }
      }}
      onFocus={() => {
        // Get current focused column
        const currentFocusedColumn = (
          document.activeElement as HTMLElement | null
        )?.closest('#columns > *');
        if (currentFocusedColumn) {
          // Remove focus classes from all columns
          // Add focus class to current focused column
          document
            .querySelectorAll<HTMLElement>('#columns > *')
            .forEach((column) => {
              column.classList.toggle(
                'focus',
                column === currentFocusedColumn,
              );
            });
        }
      }}
    >
      {components}
    </div>
  );
}

export default Columns;
