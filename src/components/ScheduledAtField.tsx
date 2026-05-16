import type { SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';

export const MIN_SCHEDULED_AT = 6 * 60 * 1000; // 6 mins
const MAX_SCHEDULED_AT = 90 * 24 * 60 * 60 * 1000; // 90 days

// Runtime intentionally duck-types and validates anything; cross-realm Date
// loses identity, so we don't use `instanceof Date`.
interface DateLike {
  getTime(): number;
  getTimezoneOffset(): number;
}

interface ScheduledAtFieldProps {
  scheduledAt: unknown;
  setScheduledAt: (date: Date) => void;
}

export default function ScheduledAtField({
  scheduledAt,
  setScheduledAt,
}: ScheduledAtFieldProps) {
  const isValid = !!(
    scheduledAt && (scheduledAt as Partial<DateLike>)?.getTime
  );
  const validScheduledAt = isValid ? (scheduledAt as DateLike) : null;
  const [minStr, setMinStr] = useState<string | undefined>();
  const [maxStr, setMaxStr] = useState<string | undefined>();
  const timezoneOffset = validScheduledAt?.getTimezoneOffset() ?? 0;

  useEffect(() => {
    if (!isValid) return undefined;
    function updateMinStr() {
      const min = new Date(Date.now() + MIN_SCHEDULED_AT);
      const str = new Date(min.getTime() - timezoneOffset * 60000)
        .toISOString()
        .slice(0, 16);
      setMinStr(str);
    }
    updateMinStr();

    function updateMaxStr() {
      const max = new Date(Date.now() + MAX_SCHEDULED_AT);
      const str = new Date(max.getTime() - timezoneOffset * 60000)
        .toISOString()
        .slice(0, 16);
      setMaxStr(str);
    }
    updateMaxStr();

    // Update every 10s
    const intervalId = setInterval(() => {
      updateMinStr();
      updateMaxStr();
    }, 1000 * 10);
    return () => clearInterval(intervalId);
  }, [isValid, timezoneOffset]);

  if (!validScheduledAt) {
    // Not using "instanceof Date" check due to "cross-realm" issues
    console.warn('scheduledAt is invalid', scheduledAt);
    return null;
  }

  const defaultValue = new Date(
    validScheduledAt.getTime() - validScheduledAt.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);

  return (
    <input
      type="datetime-local"
      name="scheduledAt"
      defaultValue={defaultValue}
      min={minStr}
      max={maxStr}
      required
      onChange={(e: SyntheticEvent<HTMLInputElement>) => {
        setScheduledAt(new Date(e.currentTarget.value));
      }}
    />
  );
}

export function getLocalTimezoneName() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZoneName: 'long',
  });
  const parts = formatter.formatToParts(date);
  const timezoneName = parts.find(
    (part) => part.type === 'timeZoneName',
  )?.value;
  return timezoneName;
}
