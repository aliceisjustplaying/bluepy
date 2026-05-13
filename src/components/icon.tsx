import type { CSSProperties } from 'preact';
import { memo } from 'preact/compat';
import { useEffect } from 'preact/hooks';

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
type IconBlockEntry =
  | IconModule
  | [IconModule, string?, string?]
  | {
      module: IconModule;
      rotate?: string;
      flip?: string;
      rtl?: boolean;
    };

const INVALID_ID_CHARS_REGEX = /[^a-zA-Z0-9]/g;

interface IconProps {
  icon?: string;
  size?: string;
  alt?: string;
  title?: string;
  class?: string;
  style?: CSSProperties;
}

function Icon({
  icon,
  size = 'm',
  alt,
  title,
  class: className = '',
  style = {},
}: IconProps) {
  title = title || alt;
  const { loadIcon, isIconLoaded } = useIconSprite();

  useEffect(() => {
    if (icon && !isIconLoaded(icon)) {
      void loadIcon(icon);
    }
  }, [icon]);

  if (!icon) return null;

  const iconSize = SIZES[size];
  let iconBlock = (ICONS as unknown as Partial<Record<string, IconBlockEntry>>)[
    icon
  ];
  if (!iconBlock) {
    console.warn(`Icon ${icon} not found`);
    return null;
  }

  let rotate: string | undefined,
    flip: string | undefined,
    rtl: boolean | undefined = false;
  if (Array.isArray(iconBlock)) {
    [iconBlock, rotate, flip] = iconBlock;
  } else if (typeof iconBlock === 'object') {
    ({ rotate, flip, rtl } = iconBlock);
    iconBlock = iconBlock.module;
  }

  const sanitizedTitle = title?.replace(INVALID_ID_CHARS_REGEX, '-');
  const titleID = `${ICON_NAMESPACE}-title-${icon}-${sanitizedTitle}`;

  const loaded = isIconLoaded(icon);

  return (
    <span
      class={`icon ${className} ${rtl ? 'rtl-flip' : ''}`}
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
