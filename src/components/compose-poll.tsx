import { Trans, useLingui } from '@lingui/react/macro';

import i18nDuration from '../utils/i18n-duration';

import TextExpander from './text-expander';

export interface PollState {
  options: string[];
  expiresIn: number | string;
  multiple: boolean;
}

export const expiryOptions: Record<number, () => string> = {
  300: i18nDuration(5, 'minute'),
  1_800: i18nDuration(30, 'minute'),
  3_600: i18nDuration(1, 'hour'),
  21_600: i18nDuration(6, 'hour'),
  86_400: i18nDuration(1, 'day'),
  259_200: i18nDuration(3, 'day'),
  604_800: i18nDuration(1, 'week'),
};

interface ComposePollProps {
  lang?: string;
  poll: PollState;
  disabled?: boolean;
  onInput?: (poll: PollState | null) => void;
  maxOptions: number;
  maxExpiration: number;
  minExpiration: number;
  maxCharactersPerOption?: number;
}

function ComposePoll({
  lang,
  poll,
  disabled,
  onInput = () => {},
  maxOptions,
  maxExpiration,
  minExpiration,
  maxCharactersPerOption,
}: ComposePollProps) {
  const { t } = useLingui();
  const { options, expiresIn, multiple } = poll;

  return (
    <div className={`poll ${multiple ? 'multiple' : ''}`}>
      <div className="poll-choices">
        {options.map((option, i) => (
          <div className="poll-choice" key={i}>
            <TextExpander keys=":" className="poll-field-container">
              <input
                required
                type="text"
                value={option}
                disabled={disabled}
                maxLength={maxCharactersPerOption}
                placeholder={t`Choice ${i + 1}`}
                lang={lang}
                spellCheck={true}
                autoComplete="off"
                dir="auto"
                data-allow-custom-emoji="true"
                onInput={(e) => {
                  const { value } = e.target as HTMLInputElement;
                  options[i] = value;
                  onInput(poll);
                }}
              />
            </TextExpander>
            <button
              type="button"
              className="plain4 poll-button"
              disabled={disabled || options.length <= 1}
              onClick={() => {
                options.splice(i, 1);
                onInput(poll);
              }}
              title={t`Remove`}
            >
              −
            </button>
          </div>
        ))}
      </div>
      <div className="poll-toolbar">
        <button
          type="button"
          className="plain2 poll-button"
          disabled={disabled || options.length >= maxOptions}
          onClick={() => {
            options.push('');
            onInput(poll);
          }}
          title={t`Add`}
        >
          +
        </button>{' '}
        <div className="poll-config">
          <label className="multiple-choices">
            <input
              type="checkbox"
              checked={multiple}
              disabled={disabled}
              onChange={(e) => {
                const { checked } = e.target as HTMLInputElement;
                poll.multiple = checked;
                onInput(poll);
              }}
            />{' '}
            <Trans>Multiple choice</Trans>
          </label>
          <label className="expires-in">
            <Trans>Duration</Trans>{' '}
            <select
              value={expiresIn}
              disabled={disabled}
              onChange={(e) => {
                const { value } = e.target as HTMLSelectElement;
                poll.expiresIn = value;
                onInput(poll);
              }}
            >
              {Object.entries(expiryOptions)
                .filter(([value]) => {
                  const v = Number(value);
                  return v >= minExpiration && v <= maxExpiration;
                })
                .map(([value, label]) => (
                  <option value={value} key={value}>
                    {label()}
                  </option>
                ))}
            </select>
          </label>
          <div className="spacer" />
          <button
            type="button"
            className="light danger small"
            disabled={disabled}
            onClick={() => {
              onInput(null);
            }}
          >
            <Trans>Remove poll</Trans>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ComposePoll;
