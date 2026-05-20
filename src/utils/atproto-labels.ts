import {
  LABELS,
  type ComAtprotoLabelDefs,
  type InterpretedLabelValueDefinition,
} from '@atproto/api';

export type AtprotoLabel = ComAtprotoLabelDefs.Label;
export type AtprotoLabelDefinitionMap = Record<
  string,
  InterpretedLabelValueDefinition[]
>;

export interface AtprotoLabelInfo {
  label: AtprotoLabel;
  name: string;
  description: string;
  severity: AtprotoLabelSeverity;
}

export interface AtprotoLabelerInfo {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

export type AtprotoGlobalLabelStrings = Record<
  string,
  { name: string; description: string }
>;
export type AtprotoLabelerInfoMap = Record<string, AtprotoLabelerInfo>;
export type AtprotoLabelSeverity = 'none' | 'inform' | 'alert';

const LABELS_BY_VALUE: Record<
  string,
  InterpretedLabelValueDefinition | undefined
> = LABELS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getOwn<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

export function normalizeAtprotoLabels(value: unknown): AtprotoLabel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label) => {
    if (
      !isRecord(label) ||
      typeof label.src !== 'string' ||
      typeof label.uri !== 'string' ||
      typeof label.val !== 'string'
    ) {
      return [];
    }
    if (label.neg) return [];
    const normalized: AtprotoLabel = {
      src: label.src,
      uri: label.uri,
      val: label.val,
      cts: typeof label.cts === 'string' ? label.cts : '',
    };
    if (typeof label.ver === 'number') normalized.ver = label.ver;
    if (typeof label.cid === 'string') normalized.cid = label.cid;
    if (typeof label.exp === 'string') normalized.exp = label.exp;
    if (typeof label.neg === 'boolean') normalized.neg = label.neg;
    if (label.sig instanceof Uint8Array) normalized.sig = label.sig;
    return [normalized];
  });
}

export function dedupeAtprotoLabels(
  labels: readonly AtprotoLabel[],
): AtprotoLabel[] {
  return Array.from(
    new Map(
      labels.map((label) => [`${label.src}:${label.val}`, label]),
    ).values(),
  );
}

export function getDisplayAtprotoLabels(value: unknown): AtprotoLabel[] {
  return dedupeAtprotoLabels(
    normalizeAtprotoLabels(value).filter((label) => !label.val.startsWith('!')),
  );
}

export function normalizeAtprotoLabelerDids(
  value: unknown,
  appLabelers: readonly string[] = [],
): string[] {
  if (!Array.isArray(value)) return [];
  const appLabelerSet = new Set(appLabelers);
  const seen = new Set<string>();
  return value.flatMap((labeler) => {
    const did =
      typeof labeler === 'string'
        ? labeler
        : isRecord(labeler) && typeof labeler.did === 'string'
          ? labeler.did
          : undefined;
    if (!did || appLabelerSet.has(did) || seen.has(did)) return [];
    seen.add(did);
    return [did];
  });
}

function isLabelDefinition(
  value: unknown,
): value is InterpretedLabelValueDefinition {
  return (
    isRecord(value) &&
    typeof value.identifier === 'string' &&
    typeof value.severity === 'string' &&
    typeof value.blurs === 'string' &&
    typeof value.defaultSetting === 'string' &&
    Array.isArray(value.locales)
  );
}

function isLabelerInfo(value: unknown): value is AtprotoLabelerInfo {
  return (
    isRecord(value) &&
    typeof value.did === 'string' &&
    (value.handle === undefined || typeof value.handle === 'string') &&
    (value.displayName === undefined ||
      typeof value.displayName === 'string') &&
    (value.avatar === undefined || typeof value.avatar === 'string')
  );
}

export function getAtprotoLabelDefinitions(
  value: unknown,
): AtprotoLabelDefinitionMap {
  if (!isRecord(value)) return {};
  const defs = value.atprotoLabelDefs;
  if (!isRecord(defs)) return {};
  return Object.fromEntries(
    Object.entries(defs).flatMap(([did, didDefs]) => {
      if (!Array.isArray(didDefs)) return [];
      return [[did, didDefs.filter(isLabelDefinition)]];
    }),
  );
}

export function getAtprotoLabelerInfoMap(
  value: unknown,
): AtprotoLabelerInfoMap {
  if (!isRecord(value)) return {};
  const labelers = value.atprotoLabelers;
  if (!isRecord(labelers)) return {};
  return Object.fromEntries(
    Object.entries(labelers).flatMap(([did, labeler]) => {
      if (!isLabelerInfo(labeler) || labeler.did !== did) return [];
      return [[did, labeler]];
    }),
  );
}

function getDefinitions(
  label: AtprotoLabel,
  labelDefs: AtprotoLabelDefinitionMap,
): {
  customDef?: InterpretedLabelValueDefinition;
  globalDef?: InterpretedLabelValueDefinition;
} {
  const customDef = getOwn(labelDefs, label.src)?.find(
    (def) => def.identifier === label.val && def.definedBy === label.src,
  );
  return {
    customDef,
    globalDef: getOwn(LABELS_BY_VALUE, label.val),
  };
}

function getLocaleStrings(
  def: InterpretedLabelValueDefinition,
  locale: string,
): { name: string; description: string } | undefined {
  if (!Array.isArray(def.locales)) return undefined;
  const exact = def.locales.find((strings) => strings.lang === locale);
  if (exact) return exact;
  const language = locale.split('-')[0];
  const languageMatch = def.locales.find(
    (strings) => strings.lang.split('-')[0] === language,
  );
  return languageMatch ?? def.locales[0];
}

function normalizeSeverity(value: unknown): AtprotoLabelSeverity {
  return value === 'inform' || value === 'alert' ? value : 'none';
}

export function describeAtprotoLabel(
  label: AtprotoLabel,
  labelDefs: AtprotoLabelDefinitionMap = {},
  locale = 'en',
  globalLabelStrings: AtprotoGlobalLabelStrings = {},
): AtprotoLabelInfo {
  const { customDef, globalDef } = getDefinitions(label, labelDefs);
  const def = customDef ?? globalDef;
  const globalStrings = getOwn(globalLabelStrings, label.val);
  const strings = customDef
    ? getLocaleStrings(customDef, locale)
    : (globalStrings ?? (globalDef && getLocaleStrings(globalDef, locale)));
  const fallbackName = label.val
    .replace(/^!/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return {
    label,
    name: strings?.name ?? fallbackName,
    description: strings?.description ?? label.val,
    severity: normalizeSeverity(def?.severity),
  };
}
