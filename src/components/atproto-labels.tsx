import './atproto-labels.css';

import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';

import {
  type AtprotoGlobalLabelStrings,
  describeAtprotoLabel,
  getDisplayAtprotoLabels,
  getAtprotoLabelDefinitions,
} from '../utils/atproto-labels';
import { getPreferences } from '../utils/api';

interface AtprotoLabelsProps {
  labels?: unknown;
}

export default function AtprotoLabels({ labels }: AtprotoLabelsProps) {
  const { i18n, t } = useLingui();
  const globalLabelStrings = useMemo<AtprotoGlobalLabelStrings>(
    () => ({
      porn: {
        name: t`Adult Content`,
        description: t`Explicit sexual images.`,
      },
      sexual: {
        name: t`Sexually Suggestive`,
        description: t`Does not include nudity.`,
      },
      nudity: {
        name: t`Non-sexual Nudity`,
        description: t`E.g. artistic nudes.`,
      },
      'graphic-media': {
        name: t`Graphic Media`,
        description: t`Explicit or potentially disturbing media.`,
      },
      gore: {
        name: t`Graphic Media`,
        description: t`Explicit or potentially disturbing media.`,
      },
      bot: {
        name: t`Automated`,
        description: t`This account has marked itself as automated.`,
      },
    }),
    [t],
  );
  const visibleLabels = getDisplayAtprotoLabels(labels);
  if (!visibleLabels.length) return null;

  const labelDefs = getAtprotoLabelDefinitions(getPreferences());

  return (
    <div className="atproto-labels">
      {visibleLabels.map((label) => {
        const info = describeAtprotoLabel(
          label,
          labelDefs,
          i18n.locale,
          globalLabelStrings,
        );
        return (
          <span
            className={`atproto-label atproto-label-${info.severity}`}
            key={`${label.src}:${label.val}:${label.uri}`}
            title={info.description}
          >
            {info.name}
          </span>
        );
      })}
    </div>
  );
}
