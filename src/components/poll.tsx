import { i18n } from '@lingui/core';
import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useReducer, useRef, useState } from 'react';

import haptics from '../utils/haptics';
import shortenNumber from '../utils/shorten-number';
import showToast from '../utils/show-toast';
import useTruncated from '../utils/useTruncated';

import EmojiText from './emoji-text';
import Icon from './icon';
import RelativeTime from './relative-time';

const POLL_OPTIONS_BATCH_SIZE = 40;

interface PollProps {
  // The `mastodon.v1.Poll` type asserts `votesCount` is a `number`, but at
  // runtime older servers (and some federated payloads) can omit it. Override
  // to keep the defensive `votesCount = 0` default below valid.
  poll: Omit<mastodon.v1.Poll, 'votesCount'> & {
    emojis?: mastodon.v1.CustomEmoji[];
    votesCount?: number;
  };
  lang?: string;
  readOnly?: boolean;
  refresh?: () => void | Promise<void>;
  votePoll?: (choices: number[]) => void | Promise<void>;
}

interface PollState {
  uiState: 'default' | 'loading';
  visibleOptionsCount: number;
}

type PollAction =
  | { type: 'uiState'; uiState: PollState['uiState'] }
  | { type: 'showMore'; total: number }
  | { type: 'resetVisibleOptions' };

type PollOption = PollProps['poll']['options'][number];
type SelectedOptions = number[] | number | null;
type KeyedPollOption = ReturnType<typeof keyedPollOptions>[number];

interface PollResultOptionsProps {
  emojis?: mastodon.v1.CustomEmoji[];
  loadMoreRef: RefObject<HTMLDivElement | null>;
  optionsRef?: RefObject<HTMLDivElement | null>;
  options: PollOption[];
  ownVotes?: number[] | null;
  pollVotesCount: number;
  roundPrecision: number;
  visibleOptions: KeyedPollOption[];
  visibleOptionsCount: number;
  voted?: boolean;
}

interface PollResultsViewProps extends PollResultOptionsProps {
  expired?: boolean;
  setShowResults: Dispatch<SetStateAction<boolean>>;
  showPollInfo: boolean;
  uiState: PollState['uiState'];
}

interface PollVotingFormProps {
  emojis?: mastodon.v1.CustomEmoji[];
  loadMoreRef: RefObject<HTMLDivElement | null>;
  multiple?: boolean;
  options: PollOption[];
  optionsRef?: RefObject<HTMLDivElement | null>;
  readOnly?: boolean;
  selectedOptions: SelectedOptions;
  setSelectedOptions: Dispatch<SetStateAction<SelectedOptions>>;
  setUIState: (nextUIState: PollState['uiState']) => void;
  showPollInfo: boolean;
  uiState: PollState['uiState'];
  visibleOptions: KeyedPollOption[];
  visibleOptionsCount: number;
  voteOptionsSelectionCount: number;
  votePoll: NonNullable<PollProps['votePoll']>;
}

interface PollMetaProps {
  expired?: boolean;
  expiresAtDate: false | Date;
  options: PollOption[];
  optionsHaveVoteCounts: boolean;
  readOnly?: boolean;
  refresh: NonNullable<PollProps['refresh']>;
  setShowResults: Dispatch<SetStateAction<boolean>>;
  setUIState: (nextUIState: PollState['uiState']) => void;
  showPollInfo: boolean;
  showResults: boolean;
  uiState: PollState['uiState'];
  voted?: boolean;
  votersCount?: number | null;
  votesCount: number;
}

interface PollPercentageStyle extends CSSProperties {
  '--percentage'?: string;
}

function keyedPollOptions(options: readonly PollOption[]) {
  const titleCounts = new Map<string, number>();
  const usedKeys = new Set<string>();
  const keyedOptions: Array<{
    option: PollOption;
    optionKey: string;
    optionIndex: number;
  }> = [];
  for (const option of options) {
    const { title } = option;
    const titleCount = titleCounts.get(title) ?? 0;
    titleCounts.set(title, titleCount + 1);
    let optionKey = titleCount ? `${title}-${titleCount}` : title;
    while (usedKeys.has(optionKey)) {
      const nextTitleCount = titleCounts.get(title) ?? 0;
      titleCounts.set(title, nextTitleCount + 1);
      optionKey = `${title}-${nextTitleCount}`;
    }
    usedKeys.add(optionKey);
    keyedOptions.push({
      option,
      optionKey,
      optionIndex: keyedOptions.length,
    });
  }
  return keyedOptions;
}

function pollReducer(state: PollState, action: PollAction): PollState {
  switch (action.type) {
    case 'uiState':
      return { ...state, uiState: action.uiState };
    case 'showMore':
      return {
        ...state,
        visibleOptionsCount: Math.min(
          state.visibleOptionsCount + POLL_OPTIONS_BATCH_SIZE,
          action.total,
        ),
      };
    case 'resetVisibleOptions':
      return { ...state, visibleOptionsCount: POLL_OPTIONS_BATCH_SIZE };
  }
  return state;
}

function PollResultOptions({
  emojis,
  loadMoreRef,
  options,
  optionsRef,
  ownVotes,
  pollVotesCount,
  roundPrecision,
  visibleOptions,
  visibleOptionsCount,
  voted,
}: PollResultOptionsProps) {
  const { t } = useLingui();

  return (
    <div className="poll-options" ref={optionsRef}>
      {visibleOptions.map(({ option, optionKey, optionIndex }) => {
        const { title, votesCount: optionVotesCountRaw } = option;
        const optionVotesCount = optionVotesCountRaw ?? 0;
        const ratio = pollVotesCount ? optionVotesCount / pollVotesCount : 0;
        const percentage = ratio
          ? ratio.toLocaleString(i18n.locale || undefined, {
              style: 'percent',
              maximumFractionDigits: roundPrecision,
            })
          : '0%';

        const isLeading =
          optionVotesCount > 0 &&
          optionVotesCount ===
            Math.max(...options.map((o) => o.votesCount ?? 0));
        return (
          <div
            key={optionKey}
            className={`poll-option poll-result ${
              isLeading ? 'poll-option-leading' : ''
            }`}
            style={
              {
                '--percentage': `${ratio * 100}%`,
              } as PollPercentageStyle
            }
          >
            <div className="poll-option-title">
              <span>
                <EmojiText text={title} emojis={emojis} />
              </span>
            </div>
            <div
              className="poll-option-votes"
              title={plural(optionVotesCount, {
                one: `# vote`,
                other: `# votes`,
              })}
            >
              {voted && ownVotes?.includes(optionIndex) && (
                <>
                  <Icon icon="check-circle" alt={t`Voted`} />{' '}
                </>
              )}
              <span className="poll-option-votes-percentage">{percentage}</span>
            </div>
          </div>
        );
      })}
      {visibleOptionsCount < options.length && (
        <div ref={loadMoreRef} style={{ minHeight: '1em' }} />
      )}
    </div>
  );
}

function PollResultsView({
  expired,
  setShowResults,
  showPollInfo,
  uiState,
  ...optionsProps
}: PollResultsViewProps) {
  return (
    <>
      <PollResultOptions {...optionsProps} />
      {!expired && !optionsProps.voted && (
        <div className="poll-actions">
          <button
            className="poll-hide-results-button plain2"
            disabled={uiState === 'loading'}
            onClick={(e) => {
              e.preventDefault();
              setShowResults(false);
            }}
          >
            <Icon icon="arrow-left" size="s" /> <Trans>Hide results</Trans>
          </button>{' '}
          <div className="poll-info">
            {showPollInfo && (
              <small className="insignificant">
                <Plural
                  value={optionsProps.options.length}
                  one={`# choice`}
                  other={`# choices`}
                />
              </small>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PollVotingForm({
  emojis,
  loadMoreRef,
  multiple,
  options,
  optionsRef,
  readOnly,
  selectedOptions,
  setSelectedOptions,
  setUIState,
  showPollInfo,
  uiState,
  visibleOptions,
  visibleOptionsCount,
  voteOptionsSelectionCount,
  votePoll,
}: PollVotingFormProps) {
  const { t } = useLingui();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const choices: number[] = Array.isArray(selectedOptions)
          ? selectedOptions
          : selectedOptions !== null
            ? [selectedOptions]
            : [];
        if (!choices.length) return;
        setUIState('loading');
        void (async () => {
          try {
            await votePoll(choices);
          } catch (err) {
            console.error(err);
            showToast(t`Unable to vote in poll`);
          } finally {
            setUIState('default');
          }
        })();
      }}
    >
      <div className="poll-options" ref={optionsRef}>
        {visibleOptions.map(({ option, optionKey, optionIndex }) => {
          const { title } = option;
          const isSelected = Array.isArray(selectedOptions)
            ? selectedOptions.includes(optionIndex)
            : selectedOptions === optionIndex;
          return (
            <div className="poll-option" key={optionKey}>
              <label className="poll-label">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name="poll"
                  value={optionIndex}
                  disabled={uiState === 'loading'}
                  readOnly={readOnly}
                  checked={isSelected}
                  onChange={(e) => {
                    const value = optionIndex;
                    const target = e.currentTarget;
                    if (multiple) {
                      setSelectedOptions((prev) => {
                        const prevArr = Array.isArray(prev) ? prev : [];
                        return target.checked
                          ? [...prevArr, value]
                          : prevArr.filter((v) => v !== value);
                      });
                    } else {
                      setSelectedOptions(value);
                    }
                  }}
                />
                <span className="poll-option-title">
                  <EmojiText text={title} emojis={emojis} />
                </span>
              </label>
            </div>
          );
        })}
        {visibleOptionsCount < options.length && (
          <div ref={loadMoreRef} style={{ minHeight: '1em' }} />
        )}
      </div>
      <div className="poll-actions">
        <button
          className="poll-vote-button"
          type="submit"
          disabled={
            readOnly || uiState === 'loading' || voteOptionsSelectionCount === 0
          }
          onClick={() => {
            void haptics.trigger('medium');
          }}
        >
          <Trans>Vote</Trans>
        </button>{' '}
        <div className="poll-info">
          {showPollInfo &&
            (multiple && voteOptionsSelectionCount > 0 ? (
              <small>
                {voteOptionsSelectionCount}{' '}
                <span className="insignificant">/ {options.length}</span>
              </small>
            ) : (
              <small className="insignificant">
                <Plural
                  value={options.length}
                  one={`# choice`}
                  other={`# choices`}
                />
              </small>
            ))}
        </div>
      </div>
    </form>
  );
}

function PollMeta({
  expired,
  expiresAtDate,
  options,
  optionsHaveVoteCounts,
  readOnly,
  refresh,
  setShowResults,
  setUIState,
  showPollInfo,
  showResults,
  uiState,
  voted,
  votersCount,
  votesCount,
}: PollMetaProps) {
  const { t } = useLingui();

  return (
    <p className="poll-meta">
      <span className="spacer">
        {(expired || voted) && showPollInfo && (
          <>
            <span className="ib">
              <Plural
                value={options.length}
                one={`# choice`}
                other={`# choices`}
              />
            </span>{' '}
            &bull;{' '}
          </>
        )}
        <span className="ib">
          <Plural
            value={votesCount}
            one={
              <Trans>
                <span title={String(votesCount)}>
                  {shortenNumber(votesCount)}
                </span>{' '}
                vote
              </Trans>
            }
            other={
              <Trans>
                <span title={String(votesCount)}>
                  {shortenNumber(votesCount)}
                </span>{' '}
                votes
              </Trans>
            }
          />
        </span>
        {!!votersCount && votersCount !== votesCount && (
          <>
            {' '}
            &bull;{' '}
            <span className="ib">
              <Plural
                value={votersCount}
                one={
                  <Trans>
                    <span title={String(votersCount)}>
                      {shortenNumber(votersCount)}
                    </span>{' '}
                    voter
                  </Trans>
                }
                other={
                  <Trans>
                    <span title={String(votersCount)}>
                      {shortenNumber(votersCount)}
                    </span>{' '}
                    voters
                  </Trans>
                }
              />
            </span>
          </>
        )}{' '}
        &bull;{' '}
        {expired ? (
          expiresAtDate ? (
            <span className="ib">
              <Trans>
                Ended <RelativeTime datetime={expiresAtDate} />
              </Trans>
            </span>
          ) : (
            t`Ended`
          )
        ) : expiresAtDate ? (
          <span className="ib">
            <Trans>
              Ending <RelativeTime datetime={expiresAtDate} />
            </Trans>
          </span>
        ) : (
          t`Ending`
        )}
      </span>
      {!voted && !expired && !readOnly && optionsHaveVoteCounts && (
        <button
          type="button"
          className="plain small poll-results-button"
          disabled={uiState === 'loading'}
          onClick={(e) => {
            e.preventDefault();
            setShowResults(!showResults);
          }}
          title={showResults ? t`Hide results` : t`Show results`}
        >
          <Icon
            icon={showResults ? 'eye-open' : 'eye-close'}
            alt={showResults ? t`Hide results` : t`Show results`}
          />{' '}
        </button>
      )}
      {!expired && !readOnly && (
        <button
          type="button"
          className="plain small"
          disabled={uiState === 'loading'}
          onClick={(e) => {
            e.preventDefault();
            setUIState('loading');

            void (async () => {
              try {
                await refresh();
              } finally {
                setUIState('default');
              }
            })();
          }}
          title={t`Refresh`}
        >
          <Icon icon="refresh" alt={t`Refresh`} />
        </button>
      )}
    </p>
  );
}

export default function Poll({
  poll,
  lang,
  readOnly,
  refresh = () => {},
  votePoll = () => {},
}: PollProps) {
  const [{ uiState, visibleOptionsCount }, dispatchPoll] = useReducer(
    pollReducer,
    {
      uiState: 'default',
      visibleOptionsCount: POLL_OPTIONS_BATCH_SIZE,
    },
  );
  const setUIState = (nextUIState: PollState['uiState']) => {
    dispatchPoll({ type: 'uiState', uiState: nextUIState });
  };
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const {
    expired,
    expiresAt,
    multiple,
    options,
    ownVotes,
    voted,
    votersCount,
    votesCount = 0,
    emojis,
  } = poll;
  const expiresAtDate = !!expiresAt && new Date(expiresAt); // Update poll at point of expiry
  // NOTE: Disable this because setTimeout runs immediately if delay is too large
  // https://stackoverflow.com/a/56718027/20838
  // useEffect(() => {
  //   let timeout;
  //   if (!expired && expiresAtDate) {
  //     const ms = expiresAtDate.getTime() - Date.now() + 1; // +1 to give it a little buffer
  //     if (ms > 0) {
  //       timeout = setTimeout(() => {
  //         setUIState('loading');
  //         (async () => {
  //           // await refresh();
  //           setUIState('default');
  //         })();
  //       }, ms);
  //     }
  //   }
  //   return () => {
  //     clearTimeout(timeout);
  //   };
  // }, [expired, expiresAtDate]);

  const pollVotesCount = multiple ? votersCount || votesCount : votesCount;
  let roundPrecision = 0;

  if (pollVotesCount <= 1000) {
    roundPrecision = 0;
  } else if (pollVotesCount <= 10000) {
    roundPrecision = 1;
  } else if (pollVotesCount <= 100000) {
    roundPrecision = 2;
  }

  const [showResults, setShowResults] = useState(false);
  const optionsHaveVoteCounts = options.every((o) => o.votesCount !== null);

  const resultsView =
    (showResults && optionsHaveVoteCounts) || voted || expired;
  const [selectedOptions, setSelectedOptions] = useState<
    number[] | number | null
  >(multiple ? [] : null);

  useEffect(() => {
    if (!loadMoreRef.current) return undefined;
    if (visibleOptionsCount >= options.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          dispatchPoll({ type: 'showMore', total: options.length });
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [visibleOptionsCount, options.length]);

  useEffect(() => {
    dispatchPoll({ type: 'resetVisibleOptions' });
  }, [resultsView, options.length]);

  const voteOptionsSelectionCount = Array.isArray(selectedOptions)
    ? selectedOptions.length
    : selectedOptions !== null
      ? 1
      : 0;
  const [showPollInfo, setShowPollInfo] = useState(false);
  const ref = useTruncated<HTMLDivElement>({
    onTruncated: setShowPollInfo,
  });
  const visibleOptions = keyedPollOptions(
    options.slice(0, visibleOptionsCount),
  );

  return (
    <div
      lang={lang}
      dir="auto"
      className={`poll ${readOnly ? 'read-only' : ''} ${
        uiState === 'loading' ? 'loading' : ''
      }`}
    >
      {resultsView ? (
        <PollResultsView
          emojis={emojis}
          expired={expired}
          loadMoreRef={loadMoreRef}
          options={options}
          optionsRef={ref}
          ownVotes={ownVotes}
          pollVotesCount={pollVotesCount}
          roundPrecision={roundPrecision}
          setShowResults={setShowResults}
          showPollInfo={showPollInfo}
          uiState={uiState}
          visibleOptions={visibleOptions}
          visibleOptionsCount={visibleOptionsCount}
          voted={voted}
        />
      ) : (
        <PollVotingForm
          emojis={emojis}
          loadMoreRef={loadMoreRef}
          multiple={multiple}
          options={options}
          optionsRef={ref}
          readOnly={readOnly}
          selectedOptions={selectedOptions}
          setSelectedOptions={setSelectedOptions}
          setUIState={setUIState}
          showPollInfo={showPollInfo}
          uiState={uiState}
          visibleOptions={visibleOptions}
          visibleOptionsCount={visibleOptionsCount}
          voteOptionsSelectionCount={voteOptionsSelectionCount}
          votePoll={votePoll}
        />
      )}
      <PollMeta
        expired={expired}
        expiresAtDate={expiresAtDate}
        options={options}
        optionsHaveVoteCounts={optionsHaveVoteCounts}
        readOnly={readOnly}
        refresh={refresh}
        setShowResults={setShowResults}
        setUIState={setUIState}
        showPollInfo={showPollInfo}
        showResults={showResults}
        uiState={uiState}
        voted={voted}
        votersCount={votersCount}
        votesCount={votesCount}
      />
    </div>
  );
}
