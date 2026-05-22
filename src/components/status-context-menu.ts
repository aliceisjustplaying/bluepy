import type { RefObject } from 'react';
import { useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { LongPressEventType, useLongPress } from 'use-long-press';

import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';

import { isIOS } from './status-helpers';
import type { AnyStatus } from './status-types';

export type ContextMenuHandle = { closeMenu?: () => void };
export type ContextMenuPropsShape = {
  anchorRef?: { current: Element | null };
  anchorPoint?: { x: number; y: number };
  align?: 'start' | 'center' | 'end';
  direction?: 'left' | 'right' | 'top' | 'bottom';
  gap?: number;
  shift?: number;
};

interface StatusContextMenuArgs {
  allowContextMenu?: boolean;
  isSizeLarge: boolean;
  previewMode?: boolean;
  readOnly?: boolean;
  deleted?: boolean;
  quoted?: boolean | number;
  statusRef: RefObject<HTMLElement | null>;
  replyStatus: (e?: React.KeyboardEvent | globalThis.KeyboardEvent) => void;
  favouriteStatusNotify: () => Promise<void>;
  bookmarkStatusNotify: () => Promise<void>;
  confirmBoostStatus: () => Promise<boolean>;
  canBoost?: boolean;
  reblogged?: boolean | null;
  username?: string;
  acct?: string;
  sameInstance: boolean;
  authenticated?: boolean;
  unauthInteractionErrorMessage: string;
  quoteDisabled?: boolean | null;
  quoteMetaText?: string | null;
  status: AnyStatus;
  url?: string | null;
  boostToast: (
    reblogged?: boolean | null,
    username?: string,
    acct?: string,
  ) => string;
}

export default function useStatusContextMenu({
  allowContextMenu,
  isSizeLarge,
  previewMode,
  readOnly,
  deleted,
  quoted,
  statusRef,
  replyStatus,
  favouriteStatusNotify,
  bookmarkStatusNotify,
  confirmBoostStatus,
  canBoost,
  reblogged,
  username,
  acct,
  sameInstance,
  authenticated,
  unauthInteractionErrorMessage,
  quoteDisabled,
  quoteMetaText,
  status,
  boostToast,
}: StatusContextMenuArgs) {
  const contextMenuRef = useRef<ContextMenuHandle | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean | string>(
    false,
  );
  const [contextMenuProps, setContextMenuProps] =
    useState<ContextMenuPropsShape>({});
  const showContextMenu =
    allowContextMenu || (!isSizeLarge && !previewMode && !deleted && !quoted);

  const bindLongPressContext = useLongPress(
    isIOS && showContextMenu
      ? (e) => {
          const event = e as unknown as PointerEvent | TouchEvent;
          if ((event as PointerEvent).pointerType === 'mouse') return;
          const { clientX, clientY } =
            (event as TouchEvent).touches?.[0] || (event as PointerEvent);
          const link = ((event as Event).target as Element).closest('a');
          const href = link?.getAttribute('href');
          if (
            link &&
            statusRef.current?.contains(link) &&
            href &&
            !href.startsWith('#')
          )
            return;
          e.preventDefault();
          setContextMenuProps({
            anchorPoint: {
              x: clientX,
              y: clientY,
            },
            direction: 'right',
          });
          setIsContextMenuOpen(true);
        }
      : null,
    {
      threshold: 600,
      captureEvent: true,
      detect: LongPressEventType.Touch,
      cancelOnMovement: 2,
    },
  );

  const hotkeysEnabled = !readOnly && !previewMode && !quoted;
  const rRef = useHotkeys(
    'r, shift+r',
    (e, handler) => {
      if (e.shiftKey !== handler.shift) return;
      replyStatus(e);
    },
    {
      enabled: hotkeysEnabled,
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'r',
    },
  );
  const fRef = useHotkeys(
    'f, l',
    () => {
      void favouriteStatusNotify();
    },
    {
      enabled: hotkeysEnabled,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        !['f', 'l'].includes(e.key.toLowerCase()),
      useKey: true,
    },
  );
  const dRef = useHotkeys(
    'd',
    () => {
      void bookmarkStatusNotify();
    },
    {
      enabled: hotkeysEnabled,
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'd',
    },
  );
  const bRef = useHotkeys(
    'shift+b',
    (evt) => {
      if (!evt.shiftKey) return;

      void (async () => {
        try {
          const done = await confirmBoostStatus();
          if (!isSizeLarge && done) {
            showToast(boostToast(reblogged, username, acct));
          }
        } catch (e) {
          console.error(e);
        }
      })();
    },
    {
      enabled: hotkeysEnabled && canBoost,
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'b',
    },
  );
  const xRef = useHotkeys(
    'x',
    (e) => {
      const activeStatus = document.activeElement?.closest(
        '.status-link, .status-focus',
      );
      if (!activeStatus) return;
      const spoilerButton = activeStatus.querySelector<HTMLElement>(
        '.spoiler-button:not(.spoiling)',
      );
      if (spoilerButton) {
        e.stopPropagation();
        spoilerButton.click();
        return;
      }
      const spoilerMediaButton = activeStatus.querySelector<HTMLElement>(
        '.spoiler-media-button:not(.spoiling)',
      );
      if (spoilerMediaButton) {
        e.stopPropagation();
        spoilerMediaButton.click();
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'x',
    },
  );
  const qRef = useHotkeys(
    'q',
    () => {
      if (!sameInstance || !authenticated) {
        alert(unauthInteractionErrorMessage);
        return;
      }

      if (quoteDisabled) {
        showToast(quoteMetaText as string);
      } else {
        showCompose({
          quoteStatus: status,
        } as Parameters<typeof showCompose>[0]);
      }
    },
    {
      enabled: hotkeysEnabled,
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'q',
    },
  );

  const bindHotkeyRefs = (nodeRef: Element | null) => {
    (rRef as { current: Element | null }).current = nodeRef;
    (fRef as { current: Element | null }).current = nodeRef;
    (dRef as { current: Element | null }).current = nodeRef;
    (bRef as { current: Element | null }).current = nodeRef;
    (xRef as { current: Element | null }).current = nodeRef;
    (qRef as { current: Element | null }).current = nodeRef;
  };

  return {
    contextMenuRef,
    isContextMenuOpen,
    setIsContextMenuOpen,
    contextMenuProps,
    setContextMenuProps,
    showContextMenu,
    bindLongPressContext,
    bindHotkeyRefs,
  };
}
