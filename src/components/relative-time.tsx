import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { useEffect, useMemo, useState } from 'preact/hooks';

import DateTimeFormat from '../utils/date-time-format';
import RTF from '../utils/relative-time-format';

function isValidDate(value: Date | string | number): boolean {
  if (value instanceof Date) {
    return !isNaN(value.getTime());
  } else {
    const date = new Date(value);
    return !isNaN(date.getTime());
  }
}

const minute = 60;
const hour = 60 * minute;
const day = 24 * hour;

const rtfFromNow = (date: Date): string => {
  // date = Date object
  const rtf = RTF(i18n.locale);
  const seconds = (date.getTime() - Date.now()) / 1000;
  const absSeconds = Math.abs(seconds);
  if (absSeconds < minute) {
    return rtf.format(Math.floor(seconds), 'second');
  } else if (absSeconds < hour) {
    return rtf.format(Math.floor(seconds / minute), 'minute');
  } else if (absSeconds < day) {
    return rtf.format(Math.floor(seconds / hour), 'hour');
  } else if (absSeconds < 30 * day) {
    return rtf.format(Math.floor(seconds / day), 'day');
  } else if (absSeconds < 365 * day) {
    return rtf.format(Math.floor(seconds / day / 30), 'month');
  } else {
    return rtf.format(Math.floor(seconds / day / 365), 'year');
  }
};

const twitterFromNow = (date: Date): string => {
  // date = Date object
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (seconds < minute) {
    return t({
      comment: 'Relative time in seconds, as short as possible',
      message: `${seconds < 1 ? 1 : Math.floor(seconds)}s`,
    });
  } else if (seconds < hour) {
    return t({
      comment: 'Relative time in minutes, as short as possible',
      message: `${Math.floor(seconds / minute)}m`,
    });
  } else {
    return t({
      comment: 'Relative time in hours, as short as possible',
      message: `${Math.floor(seconds / hour)}h`,
    });
  }
};

interface RelativeTimeProps {
  datetime?: Date | string | number | null;
  format?: string;
}

export default function RelativeTime({ datetime, format }: RelativeTimeProps) {
  // `tick` increments from a self-scheduled timer to force the rendered
  // relative string to refresh on its own cadence. It's intentionally part of
  // the memo dep arrays so the formatted output recomputes when the tick
  // changes, even though `tick` is not read inside the callback bodies.
  const [tick, setTick] = useState(0);
  const date = useMemo(
    () => (datetime ? new Date(datetime) : null),
    [datetime],
  );
  const [dateStr, dt, title] = useMemo(() => {
    if (!date || !isValidDate(date)) {
      // tick is intentionally in the deps array to force recomputation; it is
      // also referenced here so oxlint sees it as used.
      void tick;
      return [typeof datetime === 'string' ? datetime : '', '', ''];
    }
    void tick;
    let str;
    if (format === 'micro') {
      // If date <= 1 day ago or day is within this year
      const now = new Date();
      const dayDiff = (now.getTime() - date.getTime()) / 1000 / day;
      if (dayDiff <= 1) {
        str = twitterFromNow(date);
      } else {
        const sameYear = now.getFullYear() === date.getFullYear();
        if (sameYear) {
          str = DateTimeFormat(i18n.locale, {
            year: undefined,
            month: 'short',
            day: 'numeric',
          }).format(date);
        } else {
          str = DateTimeFormat(i18n.locale, {
            dateStyle: 'short',
          }).format(date);
        }
      }
    }
    if (!str) str = rtfFromNow(date);
    return [str, date.toISOString(), date.toLocaleString()];
  }, [date, datetime, format, tick]);

  useEffect(() => {
    if (!date || !isValidDate(date)) return undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let raf: number | undefined;
    function rafRerender() {
      raf = requestAnimationFrame(() => {
        setTick((c) => c + 1);
        scheduleRerender();
      });
    }
    function scheduleRerender() {
      if (!date) return;
      // If less than 1 minute, rerender every 10s
      // If less than 1 hour rerender every 1m
      // Else, don't need to rerender
      const seconds = (Date.now() - date.getTime()) / 1000;
      if (seconds < minute) {
        timeout = setTimeout(rafRerender, 10_000);
      } else if (seconds < hour) {
        timeout = setTimeout(rafRerender, 60_000);
      }
    }
    scheduleRerender();
    return () => {
      clearTimeout(timeout);
      if (raf !== undefined) cancelAnimationFrame(raf);
    };
  }, [date]);

  if (!datetime) return null;

  return (
    <time datetime={dt} title={title}>
      {dateStr}
    </time>
  );
}
