import { useSnapshot } from 'valtio';

import states from '../utils/states';

interface CharCountMeterProps {
  maxCharacters?: number;
  hidden?: boolean;
}

function CharCountMeter({ maxCharacters = 500, hidden }: CharCountMeterProps) {
  const snapStates = useSnapshot(states);
  const snapCharCount: unknown = snapStates.composerCharacterCount;
  const charCount =
    typeof snapCharCount === 'number' && Number.isFinite(snapCharCount)
      ? snapCharCount
      : 0;
  const leftChars = maxCharacters - charCount;
  if (hidden) {
    return <span className="char-counter" hidden />;
  }
  return (
    <span
      className="char-counter"
      title={`${leftChars}/${maxCharacters}`}
      style={{
        '--percentage': (charCount / maxCharacters) * 100,
      }}
    >
      <meter
        className={
          leftChars <= -10
            ? 'explode'
            : leftChars <= 0
              ? 'danger'
              : leftChars <= 20
                ? 'warning'
                : ''
        }
        value={charCount}
        max={maxCharacters}
      />
      <span className="counter">{leftChars}</span>
    </span>
  );
}

export default CharCountMeter;
