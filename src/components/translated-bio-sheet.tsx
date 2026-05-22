import { Trans, useLingui } from '@lingui/react/macro';

import type { AtprotoCompat } from '../types/atproto-compat';
import getHTMLText from '../utils/get-html-text';

import Icon from './icon';
import TranslationBlock from './translation-block';

interface TranslatedBioSheetProps {
  note?: string;
  fields?: AtprotoCompat.v1.AccountField[];
  onClose?: () => void;
}

function TranslatedBioSheet({
  note,
  fields,
  onClose,
}: TranslatedBioSheetProps) {
  const { t } = useLingui();
  const fieldsText =
    fields
      ?.map(({ name, value }) => `${name}\n${getHTMLText(value)}`)
      .join('\n\n') || '';

  const text =
    getHTMLText(note ?? '') + (fieldsText ? `\n\n${fieldsText}` : '');

  return (
    <div className="sheet">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Translated Bio</Trans>
        </h2>
      </header>
      <main>
        <p
          style={{
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </p>
        <TranslationBlock forceTranslate text={text} />
      </main>
    </div>
  );
}

export default TranslatedBioSheet;
