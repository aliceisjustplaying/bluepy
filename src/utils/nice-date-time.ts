import { i18n } from '@lingui/core';

import DateTimeFormat from './date-time-format';

interface NiceDateTimeOpts {
  hideTime?: boolean;
  formatOpts?: Intl.DateTimeFormatOptions;
  forceOpts?: Intl.DateTimeFormatOptions;
}

function niceDateTime(
  date: Date | string | number,
  dtfOpts?: NiceDateTimeOpts,
): string {
  let d: Date;
  if (date instanceof Date) {
    d = date;
  } else {
    d = new Date(date);
  }

  const { hideTime, formatOpts, forceOpts } = dtfOpts || {};
  const currentYear = new Date().getFullYear();
  const options: Intl.DateTimeFormatOptions = forceOpts || {
    // Show year if not current year
    year: d.getFullYear() === currentYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    // Hide time if requested
    hour: hideTime ? undefined : 'numeric',
    minute: hideTime ? undefined : 'numeric',
    ...formatOpts,
  };

  const DTF = DateTimeFormat(i18n.locale, options);
  const dateText = DTF.format(d);
  return dateText;
}

export default niceDateTime;
