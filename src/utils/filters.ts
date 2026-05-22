import type { AtprotoCompat } from '../types/atproto-compat';

import mem from './mem';
import { getCurrentAccountID } from './store-utils';

type FilterResult = AtprotoCompat.v1.FilterResult;

interface FilterableItem {
  readonly filtered?: readonly FilterResult[] | null;
  readonly account?: { readonly id?: string } | null;
}

interface FilterStateHide {
  readonly action: 'hide';
}

interface FilterStateBlur {
  readonly action: 'blur';
  readonly titles: string[];
  readonly titlesStr: string;
}

interface FilterStateWarn {
  readonly action: 'warn';
  readonly titles: string[];
  readonly titlesStr: string;
}

type FilterState = FilterStateHide | FilterStateBlur | FilterStateWarn | false;

function computeFilterState(
  filtered: readonly FilterResult[] | null | undefined,
  filterContext: string,
): FilterState {
  if (!filtered?.length) return false;
  const appliedFilters = filtered.filter((f) => {
    const { filter } = f;
    const hasContext = (filter.context as readonly string[]).includes(
      filterContext,
    );
    if (!hasContext) return false;
    if (!filter.expiresAt) return hasContext;
    return Date.parse(filter.expiresAt) > Date.now();
  });
  if (!appliedFilters.length) return false;
  const isHidden = appliedFilters.some((f) => f.filter.filterAction === 'hide');
  if (isHidden)
    return {
      action: 'hide',
    };
  const isBlur = appliedFilters.every((f) => f.filter.filterAction === 'blur');
  if (isBlur) {
    const filterTitles = appliedFilters.map((f) => f.filter.title);
    return {
      action: 'blur',
      titles: filterTitles,
      titlesStr: filterTitles.join(' • '),
    };
  }
  // const isWarn = appliedFilters.some((f) => f.filter.filterAction === 'warn');
  const isWarn = appliedFilters.some((f) => !!f.filter.filterAction);
  // Re: spec; unknown values for filter_action should be treated as warn.
  if (isWarn) {
    const filterTitles = appliedFilters.map((f) => f.filter.title);
    return {
      action: 'warn',
      titles: filterTitles,
      titlesStr: filterTitles.join(' • '),
    };
  }
  return false;
}
export const isFiltered = mem(computeFilterState);

function filteredItem(
  item: FilterableItem,
  filterContext: string | undefined,
  currentAccountID: string | null | undefined,
): boolean {
  const { filtered } = item;
  if (!filtered?.length) return true;
  const isSelf = currentAccountID && item.account?.id === currentAccountID;
  if (isSelf) return true;
  const filterState = isFiltered(filtered, filterContext as string);
  if (!filterState) return true;
  if (filterState.action === 'hide') return false;
  // item._filtered = filterState;
  return true;
}
export function filteredItems<T extends FilterableItem>(
  items: readonly T[] | null | undefined,
  filterContext: string | undefined,
): readonly T[] {
  if (!items?.length) return [];
  if (!filterContext) return items;
  const currentAccountID = getCurrentAccountID();
  return items.filter((item) =>
    filteredItem(item, filterContext, currentAccountID),
  );
}
