import type { CSSProperties } from 'react';
import { memo } from 'react';
import { useEffect, useRef } from 'react';

import { ICON_NAMESPACE, useIconSprite } from './icon-sprite-manager';
import { ICONS } from './ICONS';

const SIZES: Record<string, number> = {
  xs: 8,
  s: 12,
  m: 16,
  l: 20,
  xl: 24,
  xxl: 32,
};

type IconModule = () => Promise<unknown>;
type IconTupleEntry = (IconModule | string | undefined)[];
type IconBlockEntry =
  | IconModule
  | IconTupleEntry
  | {
      module: IconModule;
      rotate?: string;
      flip?: string;
      rtl?: boolean;
    };

const INVALID_ID_CHARS_REGEX = /[^a-zA-Z0-9]/g;
const ICONS_BY_NAME: Partial<Record<string, IconBlockEntry>> = ICONS;

interface IconProps {
  icon?: string;
  size?: string;
  alt?: string;
  title?: string;
  class?: string;
  className?: string;
  style?: CSSProperties;
}

const EMPTY_ICON_STYLE: CSSProperties = {};

function Icon({
  icon,
  size = 'm',
  alt,
  title,
  class: classProp = '',
  className = classProp,
  style = EMPTY_ICON_STYLE,
}: IconProps) {
  title = title || alt;
  const { loadIcon, isIconLoaded } = useIconSprite();

  // Both `loadIcon` and `isIconLoaded` are re-created whenever any icon in
  // the app finishes loading (they close over the provider's `loadedIcons`
  // set). Subscribing the effect to them would re-fire for every <Icon /> on
  // every icon load — O(icons^2) no-op work. Forward through refs so the
  // effect reads the latest closures without subscribing. The provider's
  // functional setState prevents duplicate loads even from stale closures.
  const loadIconRef = useRef(loadIcon);
  const isIconLoadedRef = useRef(isIconLoaded);
  useEffect(() => {
    loadIconRef.current = loadIcon;
    isIconLoadedRef.current = isIconLoaded;
  }, [loadIcon, isIconLoaded]);

  useEffect(() => {
    if (icon && !isIconLoadedRef.current(icon)) {
      void loadIconRef.current(icon);
    }
  }, [icon]);

  if (!icon) return null;

  const iconSize = SIZES[size];
  const iconBlock = ICONS_BY_NAME[icon];
  if (!iconBlock) {
    console.warn(`Icon ${icon} not found`);
    return null;
  }

  let rotate: string | undefined,
    flip: string | undefined,
    rtl: boolean | undefined = false;
  if (Array.isArray(iconBlock)) {
    [, rotate, flip] = iconBlock as [IconModule, string?, string?];
  } else if (typeof iconBlock === 'object') {
    ({ rotate, flip, rtl } = iconBlock);
  }

  const sanitizedTitle = title?.replace(INVALID_ID_CHARS_REGEX, '-');
  const titleID = `${ICON_NAMESPACE}-title-${icon}-${sanitizedTitle}`;

  const loaded = isIconLoaded(icon);

  return (
    <span
      className={`icon ${className} ${rtl ? 'rtl-flip' : ''}`}
      style={Object.assign(
        {
          width: `${iconSize}px`,
          height: `${iconSize}px`,
        },
        style,
      )}
      data-icon={icon}
      title={loaded ? undefined : title || undefined}
    >
      {loaded && (
        <svg
          width={iconSize}
          height={iconSize}
          role={title ? 'img' : 'presentation'}
          aria-labelledby={titleID}
          style={{
            transform: `${rotate ? `rotate(${rotate})` : ''} ${
              flip ? `scaleX(-1)` : ''
            }`,
          }}
        >
          {title ? <title id={titleID}>{title}</title> : null}
          <use href={`#${ICON_NAMESPACE}-${icon}`} />
        </svg>
      )}
    </span>
  );
}

export default memo(Icon, (prevProps, nextProps) => {
  return (
    prevProps.icon === nextProps.icon &&
    prevProps.title === nextProps.title &&
    prevProps.alt === nextProps.alt &&
    prevProps.size === nextProps.size
  );
});
