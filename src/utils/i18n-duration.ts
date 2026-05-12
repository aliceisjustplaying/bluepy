import { i18n } from '@lingui/core';

type DurationUnit = 'day' | 'hour' | 'minute' | 'month' | 'second' | 'week' | 'year';

export default function i18nDuration(
  duration: number,
  unit: DurationUnit,
): () => string {
  return () =>
    i18n.number(duration, {
      style: 'unit',
      unit,
      unitDisplay: 'long',
    });
}
