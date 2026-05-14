import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import { useEffect, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import getTranslateTargetLanguage from '../utils/get-translate-target-language';
import localeMatchDefault from '../utils/locale-match';
import { speak, supportsTTS } from '../utils/speech';
import states from '../utils/states';

import Icon from './icon';
import Menu2 from './menu2';
import TranslationBlock from './translation-block';

// `localeMatch` is called throughout the codebase with 2 args (omitting the
// required `defaultLocale`). The wrapper catches the resulting throw and
// returns `false`. The `availableLocales` argument can in practice contain
// `false` (when `getTranslateTargetLanguage` returns `false`) — the wrapper's
// try/catch handles that. Cast to a permissive signature reflecting both
// realities so we can keep matching the existing call shape without churning
// the rest of the codebase in this batch.
type OptionalDefaultLocaleMatch = (
  requestedLocales: readonly string[],
  availableLocales: readonly (string | false)[],
  defaultLocale?: string,
) => string | false;

const localeMatch = localeMatchDefault as OptionalDefaultLocaleMatch;

const FORCE_TRANSLATE_LIMIT = 140;

interface MediaAltModalProps {
  alt: string;
  lang?: string;
  onClose?: () => void;
}

export default function MediaAltModal({
  alt,
  lang,
  onClose,
}: MediaAltModalProps) {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const [forceTranslate, setForceTranslate] = useState(false);
  const targetLanguage = getTranslateTargetLanguage(true);
  const contentTranslationHideLanguages =
    snapStates.settings.contentTranslationHideLanguages || [];
  // Preserve original JS behavior: even when `targetLanguage` is `false`, the
  // wrapper's try/catch hides the runtime throw from `Intl.match` and returns
  // `false`, so the `!localeMatch(...)` test passes through.
  const differentLanguage =
    !!lang &&
    lang !== targetLanguage &&
    !localeMatch([lang], [targetLanguage]) &&
    !contentTranslationHideLanguages.find(
      (l) => lang === l || localeMatch([lang], [l]),
    );

  useEffect(() => {
    const isShortAlt = alt.length > 0 && alt.length <= FORCE_TRANSLATE_LIMIT;
    if (differentLanguage && isShortAlt) {
      setForceTranslate(true);
    }
  }, [differentLanguage, alt]);

  return (
    <div class="sheet" tabIndex={-1}>
      {!!onClose && (
        <button type="button" class="sheet-close outer" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header class="header-grid">
        <h2>
          <Trans>Media description</Trans>
        </h2>
        <div class="header-side">
          <Menu2
            align="end"
            menuButton={
              <button type="button" class="plain4">
                <Icon icon="more" alt={t`More`} size="xl" />
              </button>
            }
          >
            <MenuItem
              disabled={forceTranslate}
              onClick={() => {
                setForceTranslate(true);
              }}
            >
              <Icon icon="translate" />
              <span>
                <Trans>Translate</Trans>
              </span>
            </MenuItem>
            {supportsTTS && (
              <MenuItem
                onClick={() => {
                  speak(alt, lang);
                }}
              >
                <Icon icon="speak" />
                <span>
                  <Trans>Speak</Trans>
                </span>
              </MenuItem>
            )}
          </Menu2>
        </div>
      </header>
      <main lang={lang} dir="auto">
        <p
          style={{
            whiteSpace: 'pre-wrap',
            textWrap: 'pretty',
          }}
        >
          {alt}
        </p>
        {(differentLanguage || forceTranslate) && (
          <TranslationBlock
            forceTranslate={forceTranslate}
            sourceLanguage={lang}
            text={alt}
          />
        )}
      </main>
    </div>
  );
}
