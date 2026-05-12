import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { memo } from 'preact/compat';
import { useCallback, useContext, useState } from 'preact/hooks';

interface IconData {
  width: number;
  height: number;
  body: string;
}

type IconModule = () => Promise<{ default: IconData }>;
type IconBlock = IconModule | IconModule[] | { module: IconModule };

interface IconSpriteContextValue {
  loadIcon: (iconName: string) => Promise<void>;
  isIconLoaded: (iconName: string) => boolean;
  loadedIcons: Set<string>;
  iconData: Partial<Record<string, IconData>>;
}

const IconSpriteContext = createContext<IconSpriteContextValue | null>(null);

export const ICON_NAMESPACE = 'sprite-icon';

interface IconSpriteProviderProps {
  children?: ComponentChildren;
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
        const { ICONS } = (await import('./ICONS')) as unknown as {
          ICONS: Partial<Record<string, IconBlock>>;
        };
        const iconBlock = ICONS[iconName];

        if (!iconBlock) {
          console.warn(`Icon ${iconName} not found`);
          return;
        }

        let iconModule: IconModule;
        if (Array.isArray(iconBlock)) {
          iconModule = iconBlock[0];
        } else if (typeof iconBlock === 'object') {
          iconModule = iconBlock.module;
        } else {
          iconModule = iconBlock;
        }

        const iconResult = await iconModule();
        const iconDataResult = iconResult.default;

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

  const contextValue: IconSpriteContextValue = {
    loadIcon,
    isIconLoaded,
    loadedIcons,
    iconData,
  };

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
    <svg style={{ display: 'none' }} aria-hidden="true">
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
        dangerouslySetInnerHTML={{ __html: data.body }}
      />
    );
  },
  (prevProps, nextProps) => {
    return prevProps.iconName === nextProps.iconName;
  },
);

export function useIconSprite(): IconSpriteContextValue {
  const context = useContext(IconSpriteContext);
  if (!context) {
    throw new Error('useIconSprite must be used within IconSpriteProvider');
  }
  return context;
}
