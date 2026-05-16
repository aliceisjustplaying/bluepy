import './modal.css';

import type {
  ReactNode,
  FocusEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import store from '../utils/store';
import useCloseWatcher from '../utils/useCloseWatcher';

const $modalContainer = document.getElementById('modal-container');

function getBackdropThemeColor() {
  return getComputedStyle(document.documentElement).getPropertyValue(
    '--backdrop-theme-color',
  );
}

interface ModalProps {
  children?: ReactNode;
  onClose?: ((event?: React.SyntheticEvent) => void) | null;
  onClick?: ((event: React.MouseEvent<HTMLDivElement>) => void) | null;
  class?: string;
  minimized?: boolean;
  [key: string]: unknown;
}

function Modal({
  children,
  onClose,
  onClick,
  class: className,
  minimized,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const hasChildren = !!children;
  useEffect(() => {
    if (!hasChildren) return undefined;
    let timer = setTimeout(() => {
      const focusElement = modalRef.current?.querySelector(
        '[tabIndex="-1"]',
      ) as HTMLElement | null;
      if (focusElement) {
        focusElement.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [hasChildren]);

  const supportsCloseWatcher = (window as Window & { CloseWatcher?: unknown })
    .CloseWatcher;
  const escRef = useHotkeys<HTMLElement>(
    'esc',
    () => {
      setTimeout(() => {
        onClose?.();
      }, 0);
    },
    {
      enabled: !supportsCloseWatcher && !!onClose,
      // Using keyup and setTimeout above
      // This will run "later" to prevent clash with esc handlers from other components
      keydown: false,
      keyup: true,
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
    },
    [onClose],
  );
  useCloseWatcher(onClose ? () => onClose() : undefined, [onClose]);

  useEffect(() => {
    if (!children) return undefined;
    const $deckContainers = document.querySelectorAll('.deck-container');
    if (minimized) {
      // Similar to focusDeck in focus-deck.jsx
      // Focus last deck
      const page = $deckContainers[$deckContainers.length - 1] as
        | HTMLElement
        | undefined; // last one
      if (page && page.tabIndex === -1) {
        page.focus();
      }
    } else {
      if (children) {
        $deckContainers.forEach(($deckContainer) => {
          $deckContainer.setAttribute('inert', '');
        });
      } else {
        $deckContainers.forEach(($deckContainer) => {
          $deckContainer.removeAttribute('inert');
        });
      }
    }
    return () => {
      $deckContainers.forEach(($deckContainer) => {
        $deckContainer.removeAttribute('inert');
      });
    };
  }, [children, minimized]);

  const $meta = useRef<HTMLMetaElement | null>(null);
  const metaColor = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (children && !minimized) {
      const theme = store.local.get('theme');
      if (theme) {
        const backdropColor = getBackdropThemeColor();
        console.log({ backdropColor });
        $meta.current = document.querySelector(
          `meta[name="theme-color"][data-theme-setting="manual"]`,
        );
        if ($meta.current) {
          metaColor.current = $meta.current.content;
          $meta.current.content = backdropColor;
        }
        document.documentElement.style.setProperty(
          '--meta-theme-color',
          backdropColor,
        );
      } else {
        const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
          .matches
          ? 'dark'
          : 'light';
        const backdropColor = getBackdropThemeColor();
        console.log({ backdropColor });
        $meta.current = document.querySelector(
          `meta[name="theme-color"][media*="${colorScheme}"]`,
        );
        if ($meta.current) {
          metaColor.current = $meta.current.content;
          $meta.current.content = backdropColor;
        }
        document.documentElement.style.setProperty(
          '--meta-theme-color',
          backdropColor,
        );
      }
    } else {
      // Reset meta color
      if ($meta.current && metaColor.current) {
        $meta.current.content = metaColor.current;
      }
      document.documentElement.style.removeProperty('--meta-theme-color');
    }
    return () => {
      // Reset meta color
      if ($meta.current && metaColor.current) {
        $meta.current.content = metaColor.current;
      }
      document.documentElement.style.removeProperty('--meta-theme-color');
    };
  }, [children, minimized]);

  if (!children) return null;

  const modalContent = (
    // TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
    // modal backdrop element; clicking outside content closes the modal. Escape
    // is wired separately via the focused inner element and CloseWatcher. Real
    // interactive content lives in the children.
    <div
      ref={(node: HTMLDivElement | null) => {
        modalRef.current = node;
        const inner = node?.querySelector?.(
          '[tabIndex="-1"]',
        ) as HTMLElement | null;
        (escRef as { current: HTMLElement | null }).current = inner || node;
      }}
      className={className}
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
        onClick?.(e);
        if (e.target === e.currentTarget) {
          onClose?.(e);
        }
      }}
      tabIndex={minimized ? 0 : -1}
      inert={minimized}
      onFocus={(e: FocusEvent<HTMLDivElement>) => {
        try {
          if (e.target === e.currentTarget) {
            const focusElement = modalRef.current?.querySelector(
              '[tabIndex="-1"]',
            ) as HTMLElement | null;
            const isFocusable =
              !!focusElement &&
              getComputedStyle(focusElement)?.pointerEvents !== 'none';
            if (focusElement && isFocusable) {
              focusElement.focus();
            }
          }
        } catch (err) {
          console.error(err);
        }
      }}
    >
      {children}
    </div>
  );

  return createPortal(modalContent, $modalContainer!);

  // return createPortal(children, $modalContainer);
}

export default Modal;
