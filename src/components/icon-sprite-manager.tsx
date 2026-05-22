import type { ReactNode } from 'react';
import { createContext } from 'react';
import { memo } from 'react';
import { use, useCallback, useMemo, useState } from 'react';

interface IconData {
  width: number;
  height: number;
  body: string;
}

type IconModule = () => Promise<{ default: unknown }>;
type IconTupleEntry = (IconModule | string | undefined)[];
type IconBlock = IconModule | IconTupleEntry | { module: IconModule };

interface IconSpriteContextValue {
  loadIcon: (iconName: string) => Promise<void>;
  isIconLoaded: (iconName: string) => boolean;
  loadedIcons: Set<string>;
  iconData: Partial<Record<string, IconData>>;
}

const IconSpriteContext = createContext<IconSpriteContextValue | null>(null);

export const ICON_NAMESPACE = 'sprite-icon';
const hiddenSvgStyle = { display: 'none' };

function isIconData(value: unknown): value is IconData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { width?: unknown }).width === 'number' &&
    typeof (value as { height?: unknown }).height === 'number' &&
    typeof (value as { body?: unknown }).body === 'string'
  );
}

interface IconSpriteProviderProps {
  children?: ReactNode;
}

export function IconSpriteProvider({ children }: IconSpriteProviderProps) {
  const [loadedIcons, setLoadedIcons] = useState<Set<string>>(new Set());
  const [iconData, setIconData] = useState<Partial<Record<string, IconData>>>(
    {},
  );

  const loadIcon = useCallback(
    async (iconName: string) => {
      if (loadedIcons.has(iconName)) {
        return;
      }

      try {
        const { ICONS } = await import('./ICONS');
        const iconsByName: Partial<Record<string, IconBlock>> = ICONS;
        const iconBlock = iconsByName[iconName];

        if (!iconBlock) {
          console.warn(`Icon ${iconName} not found`);
          return;
        }

        let iconModule: IconModule;
        if (Array.isArray(iconBlock)) {
          [iconModule] = iconBlock as [IconModule, string?, string?];
        } else if (typeof iconBlock === 'object') {
          iconModule = iconBlock.module;
        } else {
          iconModule = iconBlock;
        }

        const iconResult = await iconModule();
        const iconDataResult = iconResult.default;
        if (!isIconData(iconDataResult)) {
          console.warn(`Icon ${iconName} has invalid data`);
          return;
        }

        setIconData((prev) => ({ ...prev, [iconName]: iconDataResult }));
        setLoadedIcons((prev) => new Set([...prev, iconName]));
      } catch (error) {
        console.warn(`Failed to load icon ${iconName}:`, error);
      }
    },
    [loadedIcons],
  );

  const isIconLoaded = useCallback(
    (iconName: string) => loadedIcons.has(iconName),
    [loadedIcons],
  );

  const contextValue: IconSpriteContextValue = useMemo(
    () => ({
      loadIcon,
      isIconLoaded,
      loadedIcons,
      iconData,
    }),
    [iconData, isIconLoaded, loadIcon, loadedIcons],
  );

  return (
    <IconSpriteContext.Provider value={contextValue}>
      {children}
      <IconSprite />
    </IconSpriteContext.Provider>
  );
}

function IconSprite() {
  const { loadedIcons, iconData } = useIconSprite();

  if (loadedIcons.size === 0) {
    return null;
  }

  return (
    <svg style={hiddenSvgStyle} aria-hidden="true">
      <defs>
        {Array.from(loadedIcons).map((iconName) => {
          const data = iconData[iconName];
          if (!data) return null;
          return <Symbol key={iconName} iconName={iconName} data={data} />;
        })}
      </defs>
    </svg>
  );
}

interface SymbolProps {
  iconName: string;
  data: IconData;
}

const Symbol = memo(
  function ({ iconName, data }: SymbolProps) {
    return (
      <symbol
        id={`${ICON_NAMESPACE}-${iconName}`}
        viewBox={`0 0 ${data.width} ${data.height}`}
        // TRUSTED-INTERNAL: app-generated, not user HTML — intentionally not sanitized
        dangerouslySetInnerHTML={{ __html: data.body }}
      />
    );
  },
  (prevProps, nextProps) => {
    return prevProps.iconName === nextProps.iconName;
  },
);

export function useIconSprite(): IconSpriteContextValue {
  const context = use(IconSpriteContext);
  if (!context) {
    throw new Error('useIconSprite must be used within IconSpriteProvider');
  }
  return context;
}
