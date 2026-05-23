import './compose.css';

import type { MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import { deepEqual } from 'fast-equals';
import type { SyntheticEvent } from 'react';
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { uid } from 'uid/single';
import { useSnapshot } from 'valtio';

import supportedLanguages from '../data/status-supported-languages.json';
import {
  api,
  getMastoV1Resource,
  getMastoV2Resource,
  getPreferences,
} from '../utils/api';
import { compressAtprotoImageIfNeeded } from '../utils/atproto-image-compression';
import { encodeAtprotoID } from '../utils/atproto-route';
import {
  fetchAtprotoLinkMetadata,
  getFirstPostURL,
} from '../utils/atproto-unfurl';
import {
  revokeAttachmentObjectUrl,
  revokeAttachmentObjectUrls,
  uploadComposeMediaAttachments,
} from '../utils/compose-media';
import db from '../utils/db';
import { getDtfLocale } from '../utils/dtf-locale';
import haptics from '../utils/haptics';
import { getUserLists, type ListLike } from '../utils/lists';
import localeMatch from '../utils/locale-match';
import localeCode2Text from '../utils/localeCode2Text';
import mem from '../utils/mem';
import openCompose from '../utils/open-compose';
import RTF from '../utils/relative-time-format';
import { resolveAtprotoPostURI } from '../utils/resolve-atproto-post-link';
import showToast from '../utils/show-toast';
import states, { saveStatus } from '../utils/states';
import store from '../utils/store';
import {
  getCurrentAccount,
  getCurrentAccountNS,
  getCurrentInstanceConfiguration,
} from '../utils/store-utils';
import stringLength from '../utils/string-length';
import urlRegexObj from '../utils/url-regex';
import useCloseWatcher from '../utils/useCloseWatcher';
import useInterval from '../utils/useInterval';
import useThrottledResizeObserver from '../utils/useThrottledResizeObserver';
import visibilityIconsMap from '../utils/visibility-icons-map';
import visibilityText from '../utils/visibility-text';

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

import AccountBlockComponent, { type AccountBlockProps } from './account-block';
// import Avatar from './avatar';
import CameraCaptureInput, {
  supportsCameraCapture,
} from './camera-capture-input';
import CharCountMeter from './char-count-meter';
import Textarea from './compose-textarea';
import FilePickerInput from './file-picker-input';
import GIFPickerModal from './gif-picker-modal';
import Icon from './icon';
import Loader from './loader';
import MediaAttachmentComponent, {
  type MediaAttachmentProps,
} from './media-attachment';
import MentionModal from './mention-modal';
import Menu2 from './menu2';
import Modal from './modal';
import QuoteSuggestionComponent from './quote-suggestion';
import StatusComponent, { type StatusComponentProps } from './status';

// ---------------------------------------------------------------------------
// Local type shims for still-untyped peers — narrow to what compose uses.
// These mirror the shapes already exposed by compose-textarea.tsx and drafts.tsx
// so the modal stays consistent.
// ---------------------------------------------------------------------------

interface AccountInfoLike {
  id?: string;
  acct?: string;
  username?: string;
  avatarStatic?: string;
  bot?: boolean;
  [key: string]: unknown;
}

interface MastodonMention {
  acct: string;
  [key: string]: unknown;
}

interface MediaAttachmentLike {
  id?: string | null;
  fileData?: ArrayBuffer;
  fileName?: string;
  file?: File;
  type?: string;
  size?: number;
  url?: string;
  ownedObjectUrl?: boolean;
  description?: string | null;
  [key: string]: unknown;
}

interface StatusLike {
  id?: string;
  account?: AccountInfoLike;
  mentions?: MastodonMention[];
  visibility?: string;
  language?: string | null;
  mediaAttachments?: MediaAttachmentLike[];
  quoteApproval?: Record<string, unknown> | null;
  createdAt?: string;
  url?: string;
  [key: string]: unknown;
}

interface DraftStatusLike {
  uid?: string;
  status?: string;
  language?: string | null;
  mediaAttachments?: MediaAttachmentLike[];
  threadgate?: string;
  threadgateRules?: string[];
  threadgateList?: string;
  threadgateListName?: string;
  disableQuotes?: boolean;
  [key: string]: unknown;
}

interface LinkPreviewMetadata {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  [key: string]: unknown;
}

interface LinkPreviewState {
  url: string;
  loading?: boolean;
  removed?: boolean;
  metadata?: LinkPreviewMetadata | null;
}

interface QuoteSuggestionState {
  status: StatusLike;
  instance?: string;
  url: string;
}

interface MentionPickerState {
  defaultSearchTerm?: string | null;
}

interface SharedData {
  initialText?: string;
  files?: File[] | FileList;
}

type ToolbarAction = {
  name?: string;
  defaultSearchTerm?: string | null;
  languages?: string[];
  url?: string;
  [key: string]: unknown;
};

interface OnCloseInfo {
  type?: 'edit' | 'reply' | 'post';
  newStatus?: unknown;
  instance?: string;
  fn?: () => void;
}

interface ComposeProps {
  onClose: (info?: OnCloseInfo) => void;
  replyToStatus?: StatusLike | null;
  editStatus?: StatusLike | null;
  draftStatus?: DraftStatusLike | null;
  quoteStatus?: StatusLike | null;
  standalone?: boolean;
  hasOpener?: boolean;
  sharedData?: SharedData | null;
}

interface ComposerStateShape {
  publishing?: boolean;
  publishingError?: boolean;
  minimized?: boolean;
  [key: string]: unknown;
}

// Window globals used by pop-out compose plumbing. Kept as a local cast type
// rather than a global augmentation because `__STATES__` is declared as the
// full `states` proxy in app.tsx; we narrow at usage sites instead.
interface ComposeWindowStates {
  showCompose?: unknown;
  showDrafts?: unknown;
  composerState: ComposerStateShape;
  [key: string]: unknown;
}

type ComposeOpenerWindow = Window & {
  __COMPOSE__?: unknown;
  __STATES__?: ComposeWindowStates;
};

// Narrow the still-untyped peers to the props that compose actually passes.
function AccountBlock(props: {
  account?: AccountInfoLike | null;
  accountInstance?: string;
  hideDisplayName?: boolean;
  useAvatarStatic?: boolean;
}) {
  return <AccountBlockComponent {...(props as AccountBlockProps)} />;
}

function MediaAttachment(props: {
  attachment: MediaAttachmentLike;
  disabled?: boolean;
  lang?: string;
  supportedMimeTypes?: string[];
  descriptionLimit?: number;
  onDescriptionChange?: (value: string) => void;
  onRemove?: () => void;
}) {
  return <MediaAttachmentComponent {...(props as MediaAttachmentProps)} />;
}

function QuoteSuggestion(
  props: Omit<
    Parameters<typeof QuoteSuggestionComponent>[0],
    'quoteSuggestion'
  > & {
    quoteSuggestion?: QuoteSuggestionState | null;
  },
) {
  return (
    <QuoteSuggestionComponent
      {...(props as Parameters<typeof QuoteSuggestionComponent>[0])}
    />
  );
}

function Status(props: {
  status?: StatusLike | null;
  instance?: string;
  size?: 's' | 'm' | 'l';
  previewMode?: boolean;
  readOnly?: boolean;
}) {
  return <StatusComponent {...(props as StatusComponentProps)} />;
}

// Narrow shape for masto v1/v2 used here. Mirrors what drafts.tsx shims.
interface MastoStatusesEditableSelector {
  $select(id: string | undefined): {
    fetch(): Promise<StatusLike>;
    update(params: Record<string, unknown>): Promise<unknown>;
    source: { fetch(): Promise<{ text: string }> };
  };
  create(
    params: Record<string, unknown>,
    options?: { requestInit?: { headers?: Record<string, string> } },
  ): Promise<unknown>;
}

interface MastoMediaResource {
  create(params: Record<string, unknown>): Promise<{ id?: string }>;
}

type SupportedLanguageEntry = readonly [string, string, string];
type PreferencesShape = Record<string, unknown>;

const supportedLanguagesList: SupportedLanguageEntry[] = supportedLanguages.map(
  ([code, common, native]) => [code, common, native],
);

const supportedLanguagesMap = supportedLanguagesList.reduce<
  Record<string, { common: string; native: string }>
>((acc, l) => {
  const [code, common, native] = l;
  acc[code] = {
    common,
    native,
  };
  return acc;
}, {});

// Convert camelCase to kebab-case for language codes
// e.g., "mnMong" → "mn-Mong", "msArab" → "ms-Arab"
const camelToKebabCase = (str: string): string => {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2');
};

/* NOTES:
  - Max character limit includes BOTH status text and Content Warning text
*/

// Detect devices that can't open proper custom-sized windows
// (Android phones/tablets, iOS devices, but not Chromebooks)
const isPopOutNotSupported =
  /Android|iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !/CrOS/.test(navigator.userAgent);

// localeMatch can return false when no match exists; original JS silently
// stored that value and relied on `|| DEFAULT_LANG` chains to handle the
// falsy case. Mirror the behavior — narrow to a runtime string where set,
// fall back to 'en' otherwise.
const DEFAULT_LANG: string =
  localeMatch(
    [getDtfLocale(), ...navigator.languages].filter(
      (l): l is string => typeof l === 'string',
    ),
    supportedLanguagesList.map((l) => l[0]),
    'en',
  ) || 'en';

// https://github.com/mastodon/mastodon/blob/c4a429ed47e85a6bbf0d470a41cc2f64cf120c19/app/javascript/mastodon/features/compose/util/counter.js
const usernameRegex = /(^|[^/\w])[@＠](([a-z0-9_]+)@[a-z0-9.-]+[a-z0-9]+)/gi;
const urlPlaceholder = '$2xxxxxxxxxxxxxxxxxxxxxxx';
function countableText(inputText: string): string {
  return inputText
    .replace(urlRegexObj, urlPlaceholder)
    .replace(usernameRegex, '$1@$3');
}

// const rtf = new Intl.RelativeTimeFormat();
const LF = mem(
  (locale: string | undefined) => new Intl.ListFormat(locale || undefined),
);

const ADD_LABELS = {
  camera: msg`Take photo or video`,
  media: msg`Add media`,
  gif: msg`Add GIF`,
};

function isMimeTypeSupported(
  fileType: string,
  supportedMimeTypes: string[] | undefined,
): boolean {
  if (!supportedMimeTypes) return true;
  if (supportedMimeTypes.includes(fileType)) return true;

  // If type is not supported, try to find a supported type with the same subtype
  // E.g. application/ogg -> audio/ogg
  const subtype = fileType.split('/')[1];
  const subTypeMap: Record<string, string> = {};
  supportedMimeTypes.forEach((mimeType) => {
    const [t, st] = mimeType.split('/');
    subTypeMap[st] = t;
  });

  return !!subTypeMap[subtype];
}

function fixLanguage(language: unknown): string | null {
  if (!language || typeof language !== 'string') return null;
  // If inside list, return it, else fix it
  if (supportedLanguagesMap[language]) return language;
  const fixedLanguage = camelToKebabCase(language);
  if (supportedLanguagesMap[fixedLanguage]) {
    return fixedLanguage;
  }
  return null;
}

function insertTextAtCursor({
  targetElement,
  text,
}: {
  targetElement: HTMLInputElement | HTMLTextAreaElement | null | undefined;
  text: string;
}): void {
  if (!targetElement) return;

  // Original JS reads selectionStart/selectionEnd directly; for text-y
  // inputs these are numbers in practice. Narrow with non-null assertion.
  const selectionStart = targetElement.selectionStart as number;
  const selectionEnd = targetElement.selectionEnd as number;
  const { value } = targetElement;
  let textBeforeInsert = value.slice(0, selectionStart);

  // Remove zero-width space from end of text
  textBeforeInsert = textBeforeInsert.replace(/​$/, '');

  const spaceBeforeInsert = textBeforeInsert
    ? /[\s\t\n\r]$/.test(textBeforeInsert)
      ? ''
      : ' '
    : '';

  const textAfterInsert = value.slice(selectionEnd);
  const spaceAfterInsert = /^[\s\t\n\r]/.test(textAfterInsert) ? '' : ' ';

  const newText =
    textBeforeInsert +
    spaceBeforeInsert +
    text +
    spaceAfterInsert +
    textAfterInsert;

  targetElement.value = newText;
  const newPos = selectionEnd + text.length + spaceAfterInsert.length;
  targetElement.selectionStart = targetElement.selectionEnd = newPos;
  targetElement.focus();
  dispatchComposeInput(targetElement);
}

function dispatchComposeInput(
  targetElement: HTMLInputElement | HTMLTextAreaElement,
): void {
  targetElement.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
    }),
  );
}

function clickFileInput(inputId: string): void {
  const input = document.getElementById(inputId);
  if (input instanceof HTMLInputElement) input.click();
}

function Compose({
  onClose,
  replyToStatus,
  editStatus,
  draftStatus,
  quoteStatus,
  standalone,
  hasOpener,
  sharedData,
}: ComposeProps) {
  const { i18n, t } = useLingui();
  // Lingui macro hides `_` on the returned object; the runtime still exposes
  // it on i18n. Mirror the JS destructure for compatibility with `_(msg)`.
  const _ = (descriptor: MessageDescriptor): string => i18n._(descriptor);
  const rtf = RTF(i18n.locale);
  const lf = LF(i18n.locale);
  const menuCameraInputId = useId();
  const menuMediaInputId = useId();
  const toolbarCameraInputId = useId();
  const toolbarMediaInputId = useId();

  const apiResult = api();
  const { masto } = apiResult;
  const statusesEndpoint = getMastoV1Resource<MastoStatusesEditableSelector>(
    masto,
    'statuses',
  );
  const mediaEndpoint = getMastoV2Resource<MastoMediaResource>(masto, 'media');
  const { instance } = apiResult;
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const UID = useRef(draftStatus?.uid || uid());
  console.log('Compose UID', UID.current);

  const currentAccount = useMemo(getCurrentAccount, []);
  const currentAccountInfo = currentAccount?.info;
  const isAtprotoCompose =
    !!currentAccount?.atproto || currentAccount?.instanceURL === 'bsky.social';

  interface ConfigurationShape {
    statuses?: {
      maxCharacters?: number;
      maxMediaAttachments?: number;
      charactersReservedPerUrl?: number;
    };
    mediaAttachments?: {
      supportedMimeTypes?: string[];
      imageSizeLimit?: number;
      imageMatrixLimit?: number;
      videoSizeLimit?: number;
      videoMatrixLimit?: number;
      videoFrameRateLimit?: number;
      descriptionLimit?: number;
    };
  }

  const configuration = getCurrentInstanceConfiguration() as
    | ConfigurationShape
    | null
    | undefined;
  console.log('⚙️ Configuration', configuration);

  const {
    statuses: {
      maxCharacters,
      maxMediaAttachments, // Beware: it can be undefined!
    } = {},
    mediaAttachments: { supportedMimeTypes, descriptionLimit } = {},
  } = configuration || {};
  const supportedImagesVideosTypes = supportedMimeTypes?.filter(
    (mimeType: string) => /^(image|video)/i.test(mimeType),
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [language, setLanguage] = useState<string>(
    store.session.get('currentLanguage') || DEFAULT_LANG,
  );
  const prevLanguage = useRef<string>(language);
  const [mediaAttachments, setMediaAttachments] = useState<
    MediaAttachmentLike[]
  >([]);
  const mediaAttachmentsRef = useRef<MediaAttachmentLike[]>([]);
  mediaAttachmentsRef.current = mediaAttachments;
  const [quoteSuggestion, setQuoteSuggestion] =
    useState<QuoteSuggestionState | null>(null);
  const [localQuoteStatus, setLocalQuoteStatus] = useState<
    StatusLike | null | undefined
  >(quoteStatus);
  const [linkPreview, setLinkPreview] = useState<LinkPreviewState | null>(null);
  const linkPreviewRef = useRef<{
    id: number;
    timeout: ReturnType<typeof setTimeout> | null;
  }>({ id: 0, timeout: null });

  const prefs = getPreferences() as PreferencesShape;
  const prefString = (key: string): string | undefined => {
    const v = prefs[key];
    return typeof v === 'string' ? v : undefined;
  };

  const defaultPrefThreadgate =
    prefString('posting:default:threadgate') || 'everybody';

  const [threadgate, setThreadgate] = useState<string>(() => {
    const saved = store.session.get('currentThreadgate');
    if (saved === 'everybody' || saved === 'nobody' || saved === 'custom') {
      return saved;
    }
    if (
      saved === 'mention' ||
      saved === 'following' ||
      saved === 'followers' ||
      saved === 'list'
    ) {
      return 'custom';
    }
    if (
      defaultPrefThreadgate === 'everybody' ||
      defaultPrefThreadgate === 'nobody'
    ) {
      return defaultPrefThreadgate;
    }
    return 'custom';
  });
  const [threadgateRules, setThreadgateRules] = useState<string[]>(() => {
    const savedThreadgate = store.session.get('currentThreadgate');
    try {
      const savedRules = store.session.get('currentThreadgateRules');
      if (savedRules) {
        const parsed: unknown = JSON.parse(savedRules);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((rule) => typeof rule === 'string')
        ) {
          return parsed;
        }
        if (
          Array.isArray(parsed) &&
          (savedThreadgate === 'everybody' || savedThreadgate === 'nobody')
        ) {
          return [];
        }
      }
    } catch {}
    if (
      savedThreadgate === 'mention' ||
      savedThreadgate === 'following' ||
      savedThreadgate === 'followers' ||
      savedThreadgate === 'list'
    ) {
      return [savedThreadgate];
    }
    if (
      defaultPrefThreadgate !== 'everybody' &&
      defaultPrefThreadgate !== 'nobody'
    ) {
      return [defaultPrefThreadgate];
    }
    return [];
  });
  const [threadgateList, setThreadgateList] = useState<string>(
    store.session.get('currentThreadgateList') || '',
  );
  const [threadgateListName, setThreadgateListName] = useState<string>(
    store.session.get('currentThreadgateListName') || '',
  );
  const [disableQuotes, setDisableQuotes] = useState<boolean>(
    store.session.get('currentDisableQuotes') === 'true' ||
      prefString('posting:default:quote_policy') === 'nobody' ||
      false,
  );
  const [userLists, setUserLists] = useState<ListLike[]>([]);

  useEffect(() => {
    if (isAtprotoCompose) {
      const loadLists = async () => {
        try {
          const lists = await getUserLists();
          setUserLists(lists);
        } catch (err) {
          console.error('Failed to load user lists', err);
        }
      };
      void loadLists();
    }
  }, [isAtprotoCompose]);
  useEffect(() => {
    if (
      !threadgateRules.includes('list') ||
      threadgateList ||
      userLists.length === 0
    ) {
      return;
    }
    const firstList = userLists[0];
    if (!firstList) return;
    const uri = firstList._atproto?.uri || decodeURIComponent(firstList.id);
    setThreadgateList(uri);
    setThreadgateListName(firstList.title || '');
    store.session.set('currentThreadgateList', uri);
    store.session.set('currentThreadgateListName', firstList.title || '');
  }, [threadgateRules, threadgateList, userLists]);

  const replyGateIcon = (() => {
    if (threadgate === 'nobody') return 'block';
    if (threadgate !== 'custom') return 'earth';
    const order = ['followers', 'following', 'mention', 'list'];
    const sortedRules = order.filter((r) => threadgateRules.includes(r));
    const key = sortedRules.length > 0 ? sortedRules.join('_') : 'everybody';
    return (
      visibilityIconsMap[key as keyof typeof visibilityIconsMap] || 'earth'
    );
  })();

  const replyGateSummary = (() => {
    if (threadgate === 'nobody') return _(visibilityText.nobody);
    if (threadgate !== 'custom') return _(visibilityText.everybody);
    const order = ['followers', 'following', 'mention', 'list'];
    const sortedRules = order.filter((r) => threadgateRules.includes(r));
    if (sortedRules.length === 0) return _(visibilityText.everybody);
    const key = sortedRules.join('_');
    return _(visibilityText[key as keyof typeof visibilityText]);
  })();

  const currentQuoteStatus = localQuoteStatus || quoteStatus;
  const canShowLinkPreview =
    currentAccount?.atproto &&
    !editStatus &&
    !currentQuoteStatus?.id &&
    mediaAttachments.length === 0;

  const updateLinkPreview = (text: string): void => {
    if (linkPreviewRef.current.timeout) {
      clearTimeout(linkPreviewRef.current.timeout);
    }
    if (!canShowLinkPreview) {
      setLinkPreview(null);
      return;
    }
    const url = getFirstPostURL(text || '');
    if (!url) {
      setLinkPreview(null);
      return;
    }
    if (linkPreview?.url === url && linkPreview?.removed) return;
    if (linkPreview?.url === url && linkPreview?.metadata) return;

    const requestId = linkPreviewRef.current.id + 1;
    linkPreviewRef.current.id = requestId;
    setLinkPreview({ url, loading: true });
    linkPreviewRef.current.timeout = setTimeout(() => {
      void (async () => {
        try {
          const metadata = (await fetchAtprotoLinkMetadata(url)) as
            | LinkPreviewMetadata
            | null
            | undefined;
          if (requestId !== linkPreviewRef.current.id) return;
          setLinkPreview(metadata ? { url, metadata } : null);
        } catch (e) {
          console.error(e);
          if (requestId === linkPreviewRef.current.id) setLinkPreview(null);
        }
      })();
    }, 300);
  };

  const processFiles = async (
    files: File[] | FileList | null | undefined,
  ): Promise<MediaAttachmentLike[] | null | undefined> => {
    const supportedFiles: File[] = [];
    const unsupportedFiles: File[] = [];
    for (const file of files || []) {
      if (!isMimeTypeSupported(file.type, supportedMimeTypes)) {
        unsupportedFiles.push(file);
      } else {
        supportedFiles.push(file);
      }
    }

    if (unsupportedFiles.length > 0) {
      alert(
        plural(unsupportedFiles.length, {
          one: `File ${unsupportedFiles[0].name} is not supported.`,
          other: `Files ${lf.format(
            unsupportedFiles.map((f) => f.name),
          )} are not supported.`,
        }),
      );
    }

    if (supportedFiles.length > 0) {
      // Auto-cut-off files to avoid exceeding maxMediaAttachments
      let allowedFiles = supportedFiles;
      if (maxMediaAttachments !== undefined) {
        const max = maxMediaAttachments - mediaAttachments.length;
        if (max <= 0) {
          alert(
            plural(maxMediaAttachments, {
              one: 'You can only attach up to 1 file.',
              other: 'You can only attach up to # files.',
            }),
          );
          return undefined;
        }
        allowedFiles = allowedFiles.slice(0, max);
      }
      return Promise.all(
        allowedFiles.map(async (file) => {
          const uploadFile = await compressAtprotoImageIfNeeded(file);
          return {
            fileData: await uploadFile.arrayBuffer(),
            fileName: uploadFile.name,
            type: uploadFile.type,
            size: uploadFile.size,
            url: URL.createObjectURL(uploadFile),
            ownedObjectUrl: true,
            id: null,
            description: null,
          };
        }),
      );
    }
    return null;
  };

  const handlePastedLink = async (url: string): Promise<void> => {
    // ATProto-only: a pasted Bluesky post link (bsky.app or our own permalink)
    // can become a native quote. Quotes are protocol-level embeds, so every
    // resolvable post is quotable — there is no Mastodon visibility/approval
    // gate to consult.

    // Quotes cannot coexist with media attachments
    if (mediaAttachments.length > 0) {
      return;
    }
    // Cannot add/remove/replace current quote when editing
    if (editStatus) {
      return;
    }

    try {
      const quoteURI = await resolveAtprotoPostURI(url);
      if (!quoteURI) return;
      const status = await statusesEndpoint
        .$select(encodeAtprotoID(quoteURI))
        .fetch();
      if (!status?.id) return;
      saveStatus(status as Parameters<typeof saveStatus>[0], instance, {
        skipThreading: true,
      });
      // Don't show suggestion if it's the same as current quote
      if (currentQuoteStatus?.id === status.id) {
        return;
      }
      setQuoteSuggestion({
        status,
        instance,
        url,
      });
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!canShowLinkPreview) {
      if (linkPreviewRef.current.timeout) {
        clearTimeout(linkPreviewRef.current.timeout);
      }
      setLinkPreview(null);
    }
  }, [canShowLinkPreview]);

  const oninputTextarea = (): void => {
    if (!textareaRef.current) return;
    dispatchComposeInput(textareaRef.current);
  };
  const focusTextarea = (cursorPosition?: number): void => {
    setTimeout(() => {
      if (!textareaRef.current) return;
      // If cursor position is provided, set it
      if (cursorPosition !== undefined) {
        textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
      }
      console.debug('FOCUS textarea');
      textareaRef.current?.focus();
    }, 300);
  };
  const lastFocusedFieldRef = useRef<HTMLElement | null>(null);
  const focusLastFocusedField = (): void => {
    setTimeout(() => {
      if (!lastFocusedFieldRef.current) return;
      lastFocusedFieldRef.current.focus();
    }, 0);
  };
  const composeContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const composeContainer = composeContainerRef.current;
    if (!composeContainer) return undefined;

    const handleFocus = (e: FocusEvent): void => {
      // Toggle focused if in or out if any fields are focused
      composeContainer.classList.toggle('focused', e.type === 'focusin');

      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const isFormElement = ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(
        target.tagName,
      );
      if (isFormElement) {
        lastFocusedFieldRef.current = target;
      }
    };

    composeContainer.addEventListener('focusin', handleFocus);
    composeContainer.addEventListener('focusout', handleFocus);

    return () => {
      composeContainer.removeEventListener('focusin', handleFocus);
      composeContainer.removeEventListener('focusout', handleFocus);
    };
  }, []);

  // Latest-value refs so the load effect below can read fresh values without
  // depending on identities that would re-run the effect on every render.
  const prefStringRef = useRef(prefString);
  prefStringRef.current = prefString;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const statusesEndpointRef = useRef(statusesEndpoint);
  statusesEndpointRef.current = statusesEndpoint;
  useEffect(() => {
    const prefStringFn = prefStringRef.current;
    const prefsLocal = prefsRef.current;
    const statusesEndpointLocal = statusesEndpointRef.current;
    if (replyToStatus) {
      const { language: replyLanguage } = replyToStatus;
      setLanguage(
        fixLanguage(replyLanguage) ||
          prefStringFn('posting:default:language')?.toLowerCase() ||
          DEFAULT_LANG,
      );
    } else if (editStatus) {
      const {
        language: editLanguage,
        mediaAttachments: editMediaAttachments,
      } = editStatus;
      setUIState('loading');
      void (async () => {
        try {
          const statusSource = await statusesEndpointLocal
            .$select(editStatus.id)
            .source.fetch();
          console.log({ statusSource });
          const { text } = statusSource;
          const textarea = textareaRef.current;
          if (!textarea) return;
          textarea.value = text;
          textarea.dataset.source = text;
          oninputTextarea();
          focusTextarea();
          setLanguage(
            editLanguage ||
              prefStringFn('posting:default:language')?.toLowerCase() ||
              DEFAULT_LANG,
          );
          setMediaAttachments(editMediaAttachments ?? []);
          setUIState('default');
        } catch (e) {
          console.error(e);
          alert((e as { reason?: string } | null)?.reason || (e as string));
          setUIState('error');
        }
      })();
    } else {
      focusTextarea();
      console.log('Apply prefs', prefsLocal);
      const defaultLang = prefStringFn('posting:default:language');
      if (defaultLang) {
        setLanguage(defaultLang.toLowerCase());
      }
    }
    if (draftStatus) {
      const {
        status,
        language: draftLanguage,
        mediaAttachments: draftMediaAttachments,
      } = draftStatus;
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.value = status ?? '';
      oninputTextarea();
      // status starts with newline or space, focus on first position
      const cursorPos = /^\n|\s/.test(status ?? '') ? 0 : undefined;
      focusTextarea(cursorPos);
      setLanguage(
        draftLanguage ||
          prefStringFn('posting:default:language')?.toLowerCase() ||
          DEFAULT_LANG,
      );
      if (draftMediaAttachments) setMediaAttachments(draftMediaAttachments);
      if (draftStatus.threadgate) {
        const tg = draftStatus.threadgate;
        if (tg === 'everybody' || tg === 'nobody' || tg === 'custom') {
          setThreadgate(tg);
        } else {
          setThreadgate('custom');
          setThreadgateRules([tg]);
        }
      }
      if (draftStatus.threadgateRules) {
        setThreadgateRules(draftStatus.threadgateRules);
      }
      if (draftStatus.threadgateList) {
        setThreadgateList(draftStatus.threadgateList);
      }
      if (draftStatus.threadgateListName) {
        setThreadgateListName(draftStatus.threadgateListName);
      }
      if (draftStatus.disableQuotes !== undefined) {
        setDisableQuotes(draftStatus.disableQuotes);
      }
    }
    // Effect deliberately runs only when an explicit source status changes;
    // prefString/prefs/masto are read through latest-value
    // refs declared below so we always see fresh values without re-running on
    // every render.
  }, [draftStatus, editStatus, replyToStatus]);

  const processFilesRef = useRef(processFiles);
  processFilesRef.current = processFiles;

  const applySharedData = useEffectEvent(() => {
    if (sharedData) {
      const { initialText, files } = sharedData;

      if (initialText && textareaRef.current) {
        textareaRef.current.value = initialText;
        oninputTextarea();
      }

      if (files && files.length > 0) {
        void (async () => {
          try {
            const mediaFiles = await processFiles(files);
            if (mediaFiles) {
              setMediaAttachments(mediaFiles);
            }
          } catch (err) {
            console.error('Failed to process file(s):', err);
          }
        })();
      }
    }
  });
  useEffect(() => {
    applySharedData();
  }, [sharedData]);

  // focus textarea when state.composerState.minimized turns false
  const snapStates = useSnapshot(states);
  useEffect(() => {
    if (!snapStates.composerState.minimized) {
      focusTextarea();
    }
  }, [snapStates.composerState.minimized]);

  const formRef = useRef<HTMLFormElement | null>(null);

  const beforeUnloadCopy = t`You have unsaved changes. Discard this post?`;
  const canClose = (): boolean => {
    const textarea = textareaRef.current;
    const value = textarea?.value ?? '';
    const dataset = textarea?.dataset;

    // check if loading
    if (uiState === 'loading') {
      console.log('canClose', { uiState });
      return false;
    }

    // check for status and media attachments
    const hasValue = (value || '')
      .trim()
      .replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
    const hasMediaAttachments = mediaAttachments.length > 0;
    if (!hasValue && !hasMediaAttachments) {
      console.log('canClose', { value, mediaAttachments });
      return true;
    }

    // check if all media attachments have IDs
    const hasIDMediaAttachments =
      mediaAttachments.length > 0 &&
      mediaAttachments.every((media) => media.id);
    if (hasIDMediaAttachments) {
      console.log('canClose', { hasIDMediaAttachments });
      return true;
    }

    // check if status is same with source
    const sameWithSource = value === dataset?.source;
    if (sameWithSource) {
      console.log('canClose', { sameWithSource });
      return true;
    }

    console.log('canClose', {
      value,
      hasMediaAttachments,
      hasIDMediaAttachments,
      sameWithSource,
      uiState,
    });

    return false;
  };

  const confirmClose = (): boolean => {
    if (!canClose()) {
      const yes = confirm(beforeUnloadCopy);
      return yes;
    }
    return true;
  };

  const prevBackgroundDraft = useRef<Record<string, unknown>>({});
  const draftKey = (): string => {
    const ns = getCurrentAccountNS();
    return `${ns}#${UID.current}`;
  };
  const composerState = states.composerState;
  const shouldSaveDraftOnUnmountRef = useRef(true);
  const deleteDraft = (): void => {
    void db.drafts.del(draftKey());
    prevBackgroundDraft.current = {};
  };
  const discardDraft = (): void => {
    shouldSaveDraftOnUnmountRef.current = false;
    deleteDraft();
  };
  const transferDraft = (): void => {
    saveUnsavedDraft();
    shouldSaveDraftOnUnmountRef.current = false;
  };

  // Latest-value refs so the mount-only beforeunload handler always sees
  // fresh canClose() and beforeUnloadCopy without re-binding the listener
  // on every render.
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;
  const beforeUnloadCopyRef = useRef(beforeUnloadCopy);
  beforeUnloadCopyRef.current = beforeUnloadCopy;
  useEffect(() => {
    // Show warning if user tries to close window with unsaved changes
    const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!canCloseRef.current()) {
        e.preventDefault();
        Reflect.set(e, 'returnValue', beforeUnloadCopyRef.current);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload, {
      capture: true,
    });
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload, {
        capture: true,
      });
    };
  }, []);

  const getCharCount = (): number => {
    const { value = '' } = textareaRef.current ?? {};
    return stringLength(countableText(value));
  };
  const updateCharCount = (): void => {
    const count = getCharCount();
    states.composerCharacterCount = count;
  };
  useEffect(updateCharCount, []);

  const supportsCloseWatcher = window.CloseWatcher;
  const escDownRef = useRef<boolean>(false);
  useHotkeys(
    'esc',
    () => {
      escDownRef.current = true;
      // This won't be true if this event is already handled and not propagated 🤞
    },
    {
      enabled: !supportsCloseWatcher,
      enableOnFormTags: true,
      useKey: true,
      ignoreEventWhen: (e) => e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
    },
  );
  useHotkeys(
    'esc',
    () => {
      if (!standalone && escDownRef.current && confirmClose()) {
        discardDraft();
        onClose();
      }
      escDownRef.current = false;
    },
    {
      enabled: !supportsCloseWatcher,
      enableOnFormTags: true,
      // Use keyup because Esc keydown will close the confirm dialog on Safari
      keyup: true,
      ignoreEventWhen: (e) => {
        const modals = document.querySelectorAll('#modal-container > *');
        const hasModal = modals.length > 0;
        const hasOnlyComposer =
          modals.length === 1 && modals[0].querySelector('#compose-container');
        return (
          (hasModal && !hasOnlyComposer) ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          e.shiftKey
        );
      },
      useKey: true,
    },
  );
  useCloseWatcher(() => {
    if (!standalone && confirmClose()) {
      discardDraft();
      onClose();
    }
  }, []);

  const saveUnsavedDraft = (): void => {
    // Not enabling this for editing status
    // I don't think this warrant a draft mode for a status that's already posted
    // Maybe it could be a big edit change but it should be rare
    if (editStatus) return;
    if (composerState.minimized) return;
    const key = draftKey();
    if (canClose()) {
      if (prevBackgroundDraft.current.key === key) {
        deleteDraft();
      }
      return;
    }
    const backgroundDraft: Record<string, unknown> = {
      key,
      replyTo: replyToStatus
        ? {
            /* Smaller payload of replyToStatus. Reasons:
              - No point storing whole thing
              - Could have media attachments
              - Could be deleted/edited later
            */
            id: replyToStatus.id,
            account: {
              id: replyToStatus.account?.id,
              username: replyToStatus.account?.username,
              acct: replyToStatus.account?.acct,
            },
          }
        : null,
      draftStatus: {
        uid: UID.current,
        status: textareaRef.current?.value ?? '',
        language,
        mediaAttachments,
        threadgate,
        threadgateRules,
        threadgateList,
        threadgateListName,
        disableQuotes,
      },
      quote: currentQuoteStatus?.id
        ? {
            // Smaller payload, same reason as replyTo
            id: currentQuoteStatus.id,
          }
        : null,
    };
    if (!deepEqual(backgroundDraft, prevBackgroundDraft.current)) {
      console.debug('not equal', backgroundDraft, prevBackgroundDraft.current);
      void (async () => {
        try {
          await db.drafts.set(key, {
            ...backgroundDraft,
            state: 'unsaved',
            updatedAt: Date.now(),
          });
          console.debug('DRAFT saved', key, backgroundDraft);
        } catch (e) {
          console.error('DRAFT failed', key, e);
        }
      })();
      prevBackgroundDraft.current = structuredClone(backgroundDraft);
    }
  };
  useInterval(saveUnsavedDraft, 5000); // background save every 5s
  // Latest-value ref so the mount-only initial-save effect below always sees
  // the current saveUnsavedDraft without re-running on every render.
  const saveUnsavedDraftRef = useRef(saveUnsavedDraft);
  saveUnsavedDraftRef.current = saveUnsavedDraft;
  useEffect(() => {
    saveUnsavedDraftRef.current();
    return () => {
      if (shouldSaveDraftOnUnmountRef.current) {
        saveUnsavedDraftRef.current();
      }
      revokeAttachmentObjectUrls(mediaAttachmentsRef.current);
    };
  }, []);

  useEffect(() => {
    const handleItems = (e: ClipboardEvent | DragEvent): void => {
      // Ignore drops when a sheet is open
      if (document.querySelector('.sheet')) return;

      const clipboardData =
        (e as ClipboardEvent).clipboardData || (e as DragEvent).dataTransfer;
      if (!clipboardData) return;
      const { items } = clipboardData;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
          try {
            const mediaFiles = await processFilesRef.current(files);
            if (mediaFiles) {
              setMediaAttachments((prev) => [...prev, ...mediaFiles]);
            }
          } catch (err) {
            console.error('Failed to process file(s):', err);
          }
        })();
      }
    };
    window.addEventListener('paste', handleItems);
    const handleDragover = (e: DragEvent): void => {
      // Prevent default if there's files
      if (e.dataTransfer && e.dataTransfer.items.length > 0) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('dragover', handleDragover);
    window.addEventListener('drop', handleItems);
    return () => {
      window.removeEventListener('paste', handleItems);
      window.removeEventListener('dragover', handleDragover);
      window.removeEventListener('drop', handleItems);
    };
    // mediaAttachments rebinds when the attachment count changes, which is
    // the only state the inner handler cares about (read indirectly through
    // its closure). processFiles is read through processFilesRef.
  }, [mediaAttachments]);

  const [showMentionPicker, setShowMentionPicker] = useState<
    boolean | MentionPickerState
  >(false);
  const [showGIFPicker, setShowGIFPicker] = useState<boolean>(false);

  const [autoDetectedLanguages, setAutoDetectedLanguages] = useState<
    string[] | null
  >(null);
  const [topSupportedLanguages, restSupportedLanguages] = useMemo<
    [SupportedLanguageEntry[], SupportedLanguageEntry[]]
  >(() => {
    const topLanguages: SupportedLanguageEntry[] = [];
    const restLanguages: SupportedLanguageEntry[] = [];
    const contentTranslationHideLanguages =
      states.settings.contentTranslationHideLanguages ?? [];
    supportedLanguagesList.forEach((l) => {
      const [code] = l;
      if (
        code === language ||
        code === prevLanguage.current ||
        code === DEFAULT_LANG ||
        contentTranslationHideLanguages.includes(code) ||
        (autoDetectedLanguages?.length && autoDetectedLanguages.includes(code))
      ) {
        topLanguages.push(l);
      } else {
        restLanguages.push(l);
      }
    });
    topLanguages.sort(([codeA, commonA], [codeB, commonB]) => {
      if (codeA === language) return -1;
      if (codeB === language) return 1;
      return commonA.localeCompare(commonB);
    });
    restLanguages.sort(([, commonA], [, commonB]) =>
      commonA.localeCompare(commonB),
    );
    return [topLanguages, restLanguages];
  }, [language, autoDetectedLanguages]);

  const replyToStatusMonthsAgo = useMemo<number>(
    () =>
      replyToStatus?.createdAt
        ? Math.floor(
            (Date.now() - Date.parse(replyToStatus.createdAt)) /
              (1000 * 60 * 60 * 24 * 30),
          )
        : 0,
    [replyToStatus],
  );

  const onMinimize = (): void => {
    saveUnsavedDraft();
    composerState.minimized = true;
  };

  const mediaButtonDisabled =
    uiState === 'loading' ||
    (maxMediaAttachments !== undefined &&
      mediaAttachments.length >= maxMediaAttachments); /* ||
    !!currentQuoteStatus?.id; */

  const highlightLanguageField =
    language !== prevLanguage.current ||
    (autoDetectedLanguages?.length &&
      !autoDetectedLanguages.includes(language));

  const addSubToolbarRef = useRef<HTMLSpanElement | null>(null);
  const [showAddButton, setShowAddButton] = useState<boolean>(true);
  const BUTTON_WIDTH = 42; // roughly one button width
  useThrottledResizeObserver<HTMLSpanElement>({
    ref: addSubToolbarRef,
    box: 'border-box',
    onResize: ({ width }) => {
      // If scrollable, it's truncated
      const toolbar = addSubToolbarRef.current;
      if (!toolbar) return;
      const { scrollWidth } = toolbar;
      const truncated = width !== undefined && scrollWidth > width;
      const overTruncated = width !== undefined && width < BUTTON_WIDTH * 4;
      setShowAddButton(overTruncated || truncated);
      toolbar.hidden = overTruncated;
    },
  });

  return (
    <div id="compose-container-outer" ref={composeContainerRef}>
      <div
        id="compose-container"
        tabIndex={-1}
        className={standalone ? 'standalone' : ''}
      >
        <div className="compose-top">
          {Boolean(currentAccountInfo?.avatarStatic) && (
            // <Avatar
            //   url={currentAccountInfo.avatarStatic}
            //   size="xl"
            //   alt={currentAccountInfo.username}
            //   squircle={currentAccountInfo?.bot}
            // />
            <AccountBlock
              account={currentAccountInfo}
              accountInstance={
                currentAccount?.atproto
                  ? undefined
                  : currentAccount?.instanceURL
              }
              hideDisplayName
              useAvatarStatic
            />
          )}
          {!standalone ? (
            <span className="compose-controls">
              {!isPopOutNotSupported && (
                <button
                  type="button"
                  className="plain4 pop-button"
                  disabled={uiState === 'loading'}
                  onClick={() => {
                    // If there are non-ID media attachments (not yet uploaded), show confirmation dialog because they are not going to be passed to the new window
                    // const containNonIDMediaAttachments =
                    //   mediaAttachments.length > 0 &&
                    //   mediaAttachments.some((media) => !media.id);
                    // if (containNonIDMediaAttachments) {
                    //   const yes = confirm(
                    //     'You have media attachments that are not yet uploaded. Opening a new window will discard them and you will need to re-attach them. Are you sure you want to continue?',
                    //   );
                    //   if (!yes) {
                    //     return;
                    //   }
                    // }

                    // const mediaAttachmentsWithIDs = mediaAttachments.filter(
                    //   (media) => media.id,
                    // );

                    const newWin = openCompose({
                      editStatus,
                      replyToStatus,
                      draftStatus: {
                        uid: UID.current,
                        status: textareaRef.current?.value ?? '',
                        language,
                        mediaAttachments,
                        threadgate,
                        threadgateRules,
                        threadgateList,
                        threadgateListName,
                        disableQuotes,
                      },
                      quoteStatus: currentQuoteStatus,
                    });

                    if (!newWin) {
                      return;
                    }

                    transferDraft();
                    onClose();
                  }}
                >
                  <Icon icon="popout" alt={t`Pop out`} />
                </button>
              )}
              <button
                type="button"
                className="plain4 min-button"
                onClick={onMinimize}
              >
                <Icon icon="minimize" alt={t`Minimize`} />
              </button>{' '}
              <button
                type="button"
                className="plain4 close-button"
                disabled={uiState === 'loading'}
                onClick={() => {
                  if (confirmClose()) {
                    discardDraft();
                    onClose();
                  }
                }}
              >
                <Icon icon="x" alt={t`Close`} />
              </button>
            </span>
          ) : (
            hasOpener && (
              <button
                type="button"
                className="light pop-button"
                disabled={uiState === 'loading'}
                onClick={() => {
                  // If there are non-ID media attachments (not yet uploaded), show confirmation dialog because they are not going to be passed to the new window
                  // const containNonIDMediaAttachments =
                  //   mediaAttachments.length > 0 &&
                  //   mediaAttachments.some((media) => !media.id);
                  // if (containNonIDMediaAttachments) {
                  //   const yes = confirm(
                  //     'You have media attachments that are not yet uploaded. Opening a new window will discard them and you will need to re-attach them. Are you sure you want to continue?',
                  //   );
                  //   if (!yes) {
                  //     return;
                  //   }
                  // }

                  if (!window.opener) {
                    alert(t`Looks like you closed the parent window.`);
                    return;
                  }

                  const opener = window.opener as ComposeOpenerWindow;
                  const openerStates = opener.__STATES__ as ComposeWindowStates;

                  if (openerStates.showCompose) {
                    if (openerStates.composerState?.publishing) {
                      alert(
                        t`Looks like you already have a compose field open in the parent window and currently publishing. Please wait for it to be done and try again later.`,
                      );
                      return;
                    }

                    let confirmText = t`Looks like you already have a compose field open in the parent window. Popping in this window will discard the changes you made in the parent window. Continue?`;
                    const yes = confirm(confirmText);
                    if (!yes) return;
                  }

                  // const mediaAttachmentsWithIDs = mediaAttachments.filter(
                  //   (media) => media.id,
                  // );

                  transferDraft();
                  onClose({
                    fn: () => {
                      const passData = {
                        editStatus,
                        replyToStatus,
                        draftStatus: {
                          uid: UID.current,
                          status: textareaRef.current?.value ?? '',
                          language,
                          mediaAttachments,
                          threadgate,
                          threadgateRules,
                          threadgateList,
                          threadgateListName,
                          disableQuotes,
                        },
                        quoteStatus: currentQuoteStatus,
                      };
                      opener.__COMPOSE__ = passData; // Pass it here instead of `showCompose` due to some weird proxy issue again
                      if (openerStates.showCompose) {
                        openerStates.showCompose = false;
                        setTimeout(() => {
                          openerStates.showCompose = true;
                        }, 10);
                      } else {
                        openerStates.showCompose = true;
                      }
                      if (openerStates.composerState.minimized) {
                        // Maximize it
                        openerStates.composerState.minimized = false;
                      }
                    },
                  });
                }}
              >
                <Icon icon="popin" alt={t`Pop in`} />
              </button>
            )
          )}
        </div>
        {!!replyToStatus && (
          <details className="status-preview" open>
            <Status status={replyToStatus} size="s" previewMode />
            <summary className="status-preview-legend reply-to">
              {replyToStatusMonthsAgo > 0 ? (
                <Trans>
                  Replying to @
                  {replyToStatus.account?.acct ||
                    replyToStatus.account?.username}
                  &rsquo;s post (
                  <strong>
                    {rtf.format(-replyToStatusMonthsAgo, 'month')}
                  </strong>
                  )
                </Trans>
              ) : (
                <Trans>
                  Replying to @
                  {replyToStatus.account?.acct ||
                    replyToStatus.account?.username}
                  &rsquo;s post
                </Trans>
              )}
            </summary>
          </details>
        )}
        {!!editStatus && (
          <details className="status-preview">
            <Status status={editStatus} size="s" previewMode />
            <summary className="status-preview-legend">
              <Trans>Editing source post</Trans>
            </summary>
          </details>
        )}
        <form
          ref={formRef}
          style={{
            pointerEvents: uiState === 'loading' ? 'none' : 'auto',
            opacity: uiState === 'loading' ? 0.5 : 1,
          }}
          onClick={() => {
            setTimeout(() => {
              if (!document.activeElement) {
                lastFocusedFieldRef.current?.focus?.();
              }
            }, 10);
          }}
          onKeyDown={(keyEvent: React.KeyboardEvent<HTMLFormElement>) => {
            if (
              keyEvent.key === 'Enter' &&
              (keyEvent.ctrlKey || keyEvent.metaKey)
            ) {
              keyEvent.preventDefault();
              keyEvent.currentTarget.requestSubmit();
            }
          }}
          onSubmit={(submitEvent: SyntheticEvent<HTMLFormElement>) => {
            submitEvent.preventDefault();

            const formData = new FormData(
              submitEvent.target as HTMLFormElement,
            );
            const entries = Object.fromEntries(formData.entries()) as Record<
              string,
              FormDataEntryValue
            >;
            console.log('ENTRIES', entries);
            const rawStatus = entries.status;

            let status: string | undefined =
              typeof rawStatus === 'string' ? rawStatus : undefined;

            // Let the backend validate character limits.
            // TODO: check for URLs and use `charactersReservedPerUrl` to calculate max characters

            if (mediaAttachments.length > 0) {
              // If there are media attachments, check if they have no descriptions
              const hasNoDescriptions = mediaAttachments.some(
                (media) => !media.description?.trim?.(),
              );
              if (hasNoDescriptions) {
                const yes = confirm(
                  t`Some media have no descriptions. Continue?`,
                );
                if (!yes) return;
              }
            }

            status = status === '' ? undefined : status;

            if (
              isAtprotoCompose &&
              !editStatus &&
              !replyToStatus &&
              threadgate === 'custom' &&
              threadgateRules.includes('list') &&
              !threadgateList
            ) {
              alert(t`Select a list before publishing this post.`);
              return;
            }

            // states.composerState.minimized = true;
            composerState.publishing = true;
            setUIState('loading');
            void (async () => {
              try {
                console.log('MEDIA ATTACHMENTS', mediaAttachments);
                let submitMediaAttachments = mediaAttachments;
                if (mediaAttachments.length > 0) {
                  // Upload media attachments first
                  const mediaPromises = mediaAttachments.map(
                    async (attachment) => {
                      const [uploadedAttachment] =
                        await uploadComposeMediaAttachments(
                          [attachment],
                          (params) => {
                            console.log('UPLOADING', attachment);
                            return mediaEndpoint.create(
                              removeNullUndefined({
                                file: params.file,
                                description: params.description,
                              }),
                            );
                          },
                        );
                      return uploadedAttachment;
                    },
                  );
                  const results = await Promise.allSettled(mediaPromises);

                  // If any failed, return
                  if (
                    results.some((result) => {
                      return (
                        result.status === 'rejected' ||
                        !(result.value as { id?: string } | undefined)?.id
                      );
                    })
                  ) {
                    composerState.publishing = false;
                    composerState.publishingError = true;
                    setUIState('error');
                    // Alert all the reasons
                    results.forEach((result, index) => {
                      if (result.status === 'rejected') {
                        console.error(result);
                        alert(
                          result.reason ||
                            t`Attachment #${mediaAttachments[index]?.fileName || index + 1} failed`,
                        );
                      }
                    });
                    return;
                  }

                  submitMediaAttachments = results.map((result) => {
                    if (result.status === 'fulfilled') return result.value;
                    throw result.reason;
                  });
                  setMediaAttachments(submitMediaAttachments);
                  console.log({
                    results,
                    mediaAttachments: submitMediaAttachments,
                  });
                }

                /* NOTE:
                Using snakecase here because masto.js's `isObject` returns false for `params`, ONLY happens when opening in pop-out window. This is maybe due to `window.masto` variable being passed from the parent window. The check that failed is `x.constructor === Object`, so maybe the `Object` in new window is different than parent window's?
                Code: https://github.com/neet/masto.js/blob/dd0d649067b6a2b6e60fbb0a96597c373a255b00/src/serializers/is-object.ts#L2

                // TODO: Note above is no longer true in Masto.js v6. Revisit this.
              */
                let params: Record<string, unknown> = {
                  status,
                  language,
                  // mediaIds: mediaAttachments.map((attachment) => attachment.id),
                  media_ids: submitMediaAttachments.map(
                    (attachment) => attachment.id,
                  ),
                };
                if (!editStatus) {
                  if (currentQuoteStatus?.id) {
                    params.quoted_status_id = currentQuoteStatus.id;
                  }
                  // params.inReplyToId = replyToStatus?.id || undefined;
                  params.in_reply_to_id = replyToStatus?.id || undefined;
                  if (linkPreview?.removed) {
                    params.disable_card = true;
                  } else if (linkPreview?.metadata) {
                    params.card_url = linkPreview.url;
                  }
                }
                if (isAtprotoCompose && !editStatus && !replyToStatus) {
                  params.disableQuotes = disableQuotes;
                  if (threadgate === 'nobody') {
                    params.threadgate = [{ type: 'nobody' }];
                  } else if (threadgate === 'custom') {
                    const rules: { type: string; list?: string }[] = [];
                    if (threadgateRules.includes('mention')) {
                      rules.push({ type: 'mention' });
                    }
                    if (threadgateRules.includes('following')) {
                      rules.push({ type: 'following' });
                    }
                    if (threadgateRules.includes('followers')) {
                      rules.push({ type: 'followers' });
                    }
                    if (threadgateRules.includes('list') && threadgateList) {
                      rules.push({ type: 'list', list: threadgateList });
                    }
                    params.threadgate =
                      rules.length > 0 ? rules : [{ type: 'everybody' }];
                  } else {
                    params.threadgate = [{ type: 'everybody' }];
                  }
                }
                params = removeNullUndefined(params);
                console.log('POST', params);

                let newStatus: unknown;
                if (editStatus) {
                  newStatus = await statusesEndpoint
                    .$select(editStatus.id)
                    .update(params);
                  saveStatus(
                    newStatus as Parameters<typeof saveStatus>[0],
                    instance,
                    {
                      skipThreading: true,
                    },
                  );
                } else {
                  try {
                    newStatus = await statusesEndpoint.create(params, {
                      requestInit: {
                        headers: {
                          'Idempotency-Key': UID.current,
                        },
                      },
                    });
                  } catch {
                    // If idempotency key fails, try again without it
                    newStatus = await statusesEndpoint.create(params);
                  }
                }
                composerState.minimized = false;
                composerState.publishing = false;
                setUIState('default');
                discardDraft();
                revokeAttachmentObjectUrls(submitMediaAttachments);

                // Close
                onClose({
                  // type: post, reply, edit
                  type: editStatus ? 'edit' : replyToStatus ? 'reply' : 'post',
                  newStatus,
                  instance,
                });
              } catch (e) {
                composerState.publishing = false;
                composerState.publishingError = true;
                console.error(e);
                alert(
                  (e as { reason?: string } | null)?.reason || (e as string),
                );
                setUIState('error');
              }
            })();
          }}
        >
          <div>
            <Textarea
              ref={textareaRef}
              placeholder={
                replyToStatus
                  ? t`Post your reply`
                  : editStatus
                    ? t`Edit your post`
                    : t`What are you doing?`
              }
              required={mediaAttachments?.length === 0}
              disabled={uiState === 'loading'}
              lang={language}
              onInput={() => {
                updateCharCount();
                updateLinkPreview(textareaRef.current?.value || '');
              }}
              maxCharacters={maxCharacters}
              onTrigger={(action: ToolbarAction) => {
                if (action?.name === 'mention') {
                  setShowMentionPicker({
                    defaultSearchTerm: action?.defaultSearchTerm || null,
                  });
                } else if (
                  action?.name === 'auto-detect-language' &&
                  action?.languages
                ) {
                  setAutoDetectedLanguages(action.languages);
                } else if (action?.name === 'pasted-link' && action?.url) {
                  void handlePastedLink(action.url);
                }
              }}
            />
          </div>
          {!!linkPreview && !linkPreview.removed && (
            <div className="compose-link-preview">
              {linkPreview.loading ? (
                <div className="compose-link-preview-body">
                  <span className="compose-link-preview-title">
                    Loading link preview...
                  </span>
                  <small>{linkPreview.url}</small>
                </div>
              ) : (
                <>
                  {!!linkPreview.metadata?.image && (
                    <img
                      src={linkPreview.metadata.image}
                      alt=""
                      loading="lazy"
                    />
                  )}
                  <div className="compose-link-preview-body">
                    <span className="compose-link-preview-title">
                      {linkPreview.metadata?.title || linkPreview.url}
                    </span>
                    {!!linkPreview.metadata?.description && (
                      <small>{linkPreview.metadata.description}</small>
                    )}
                    <small>
                      {linkPreview.metadata?.url || linkPreview.url}
                    </small>
                  </div>
                </>
              )}
              <button
                type="button"
                className="plain4 close-button small"
                onClick={() => {
                  if (linkPreviewRef.current.timeout) {
                    clearTimeout(linkPreviewRef.current.timeout);
                  }
                  setLinkPreview(
                    linkPreview ? { ...linkPreview, removed: true } : null,
                  );
                  focusTextarea();
                }}
              >
                <Icon icon="x" alt={t`Cancel`} />
              </button>
            </div>
          )}
          {mediaAttachments?.length > 0 && (
            <div className="media-attachments">
              {mediaAttachments.map((attachment, i) => {
                const { id, file } = attachment;
                const fileID: string | number = file
                  ? file.size + file.type + file.name
                  : Number.NaN;
                return (
                  <MediaAttachment
                    key={id || fileID || i}
                    attachment={attachment}
                    disabled={uiState === 'loading'}
                    lang={language}
                    supportedMimeTypes={supportedMimeTypes}
                    descriptionLimit={descriptionLimit}
                    onDescriptionChange={(value) => {
                      setMediaAttachments((attachments) => {
                        const newAttachments = [...attachments];
                        newAttachments[i] = {
                          ...newAttachments[i],
                          description: value,
                        };
                        return newAttachments;
                      });
                    }}
                    onRemove={() => {
                      setMediaAttachments((attachments) => {
                        revokeAttachmentObjectUrl(attachments[i]);
                        return attachments.filter((_a, j) => j !== i);
                      });
                    }}
                  />
                );
              })}
            </div>
          )}
          {!!currentQuoteStatus?.id && (
            <div className="quote-status">
              <Status
                status={currentQuoteStatus}
                instance={instance}
                size="s"
                readOnly
              />
            </div>
          )}
          <QuoteSuggestion
            quoteSuggestion={quoteSuggestion}
            hasCurrentQuoteStatus={!!currentQuoteStatus?.id}
            onAccept={() => {
              if (!quoteSuggestion) return;
              const { status } = quoteSuggestion;

              // Remove the pasted link from textarea
              const currentValue = textareaRef.current?.value || '';
              // Find pasted link nearest to last cursor position
              const lastCursorPos = textareaRef.current?.selectionStart || 0;
              const pastedLinkPos = currentValue.lastIndexOf(
                quoteSuggestion.url,
                lastCursorPos,
              );
              const newValue =
                currentValue.slice(0, pastedLinkPos) +
                currentValue.slice(pastedLinkPos + quoteSuggestion.url.length);
              if (textareaRef.current) {
                textareaRef.current.value = newValue;
                dispatchComposeInput(textareaRef.current);
              }

              const hasCurrentQuote = !!currentQuoteStatus?.id;
              if (hasCurrentQuote) {
                // If there's already a quote, replacement doesn't need transition
                setQuoteSuggestion(null);
                setLocalQuoteStatus(status);
              } else {
                // Transition the unfurled quote to the quote preview
                const startVT = (document as ViewTransitionDocument)
                  .startViewTransition;
                if (startVT) {
                  startVT(() => {
                    setQuoteSuggestion(null);
                    setLocalQuoteStatus(status);
                  });
                } else {
                  setQuoteSuggestion(null);
                  setLocalQuoteStatus(status);
                }
              }
              focusTextarea();
            }}
            onCancel={() => {
              setQuoteSuggestion(null);
            }}
          />
          {isAtprotoCompose && !editStatus && !replyToStatus && (
            <details className="atproto-interaction-settings">
              <summary className="atproto-interaction-settings-summary">
                <Icon
                  icon={replyGateIcon}
                  size="s"
                  className="atproto-interaction-settings-icon"
                />
                <span className="atproto-interaction-settings-title">
                  <span>{replyGateSummary}</span>
                </span>
                <Icon
                  icon="chevron-down"
                  size="s"
                  className="atproto-interaction-settings-chevron"
                />
              </summary>
              <div className="atproto-interaction-settings-panel">
                <div className="reply-pills-container">
                  <span className="reply-pills-label">
                    <Trans>Who can reply:</Trans>
                  </span>
                  <div className="reply-pills-list">
                    {/* Anyone Button */}
                    <button
                      type="button"
                      className={`reply-pill-btn ${threadgate === 'everybody' ? 'active' : ''}`}
                      onClick={() => {
                        setThreadgate('everybody');
                        setThreadgateRules([]);
                        store.session.set('currentThreadgate', 'everybody');
                        store.session.set(
                          'currentThreadgateRules',
                          JSON.stringify([]),
                        );
                      }}
                      disabled={uiState === 'loading'}
                    >
                      <Icon icon="earth" size="s" />
                      <span>
                        <Trans>Anyone</Trans>
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`reply-pill-btn ${threadgate === 'custom' ? 'active' : ''}`}
                      onClick={() => {
                        const nextRules =
                          threadgateRules.length > 0
                            ? threadgateRules
                            : ['following', 'mention'];
                        setThreadgate('custom');
                        setThreadgateRules(nextRules);
                        store.session.set('currentThreadgate', 'custom');
                        store.session.set(
                          'currentThreadgateRules',
                          JSON.stringify(nextRules),
                        );
                      }}
                      disabled={uiState === 'loading'}
                    >
                      <Icon icon="group" size="s" />
                      <span>
                        <Trans>Some</Trans>
                      </span>
                    </button>

                    {/* Nobody Button */}
                    <button
                      type="button"
                      className={`reply-pill-btn ${threadgate === 'nobody' ? 'active' : ''}`}
                      onClick={() => {
                        setThreadgate('nobody');
                        setThreadgateRules([]);
                        store.session.set('currentThreadgate', 'nobody');
                        store.session.set(
                          'currentThreadgateRules',
                          JSON.stringify([]),
                        );
                      }}
                      disabled={uiState === 'loading'}
                    >
                      <Icon icon="block" size="s" />
                      <span>
                        <Trans>Nobody</Trans>
                      </span>
                    </button>
                  </div>
                </div>

                {threadgate === 'custom' && (
                  <div className="reply-detail-pills-container">
                    <span className="reply-pills-label">
                      <Trans>Allowed:</Trans>
                    </span>
                    <div className="reply-pills-list">
                      {/* Your followers */}
                      <button
                        type="button"
                        className={`reply-pill-btn ${threadgateRules.includes('followers') ? 'active' : ''}`}
                        onClick={() => {
                          const isChecked =
                            threadgateRules.includes('followers');
                          const nextRules = isChecked
                            ? threadgateRules.filter((r) => r !== 'followers')
                            : [...threadgateRules, 'followers'];
                          setThreadgateRules(nextRules);
                          setThreadgate(
                            nextRules.length > 0 ? 'custom' : 'everybody',
                          );
                          store.session.set(
                            'currentThreadgate',
                            nextRules.length > 0 ? 'custom' : 'everybody',
                          );
                          store.session.set(
                            'currentThreadgateRules',
                            JSON.stringify(nextRules),
                          );
                        }}
                        disabled={uiState === 'loading'}
                      >
                        <Icon icon="lock" size="s" />
                        <span>
                          <Trans>Followers</Trans>
                        </span>
                      </button>

                      {/* People you follow */}
                      <button
                        type="button"
                        className={`reply-pill-btn ${threadgateRules.includes('following') ? 'active' : ''}`}
                        onClick={() => {
                          const isChecked =
                            threadgateRules.includes('following');
                          const nextRules = isChecked
                            ? threadgateRules.filter((r) => r !== 'following')
                            : [...threadgateRules, 'following'];
                          setThreadgateRules(nextRules);
                          setThreadgate(
                            nextRules.length > 0 ? 'custom' : 'everybody',
                          );
                          store.session.set(
                            'currentThreadgate',
                            nextRules.length > 0 ? 'custom' : 'everybody',
                          );
                          store.session.set(
                            'currentThreadgateRules',
                            JSON.stringify(nextRules),
                          );
                        }}
                        disabled={uiState === 'loading'}
                      >
                        <Icon icon="group" size="s" />
                        <span>
                          <Trans>Following</Trans>
                        </span>
                      </button>

                      {/* People you mention */}
                      <button
                        type="button"
                        className={`reply-pill-btn ${threadgateRules.includes('mention') ? 'active' : ''}`}
                        onClick={() => {
                          const isChecked = threadgateRules.includes('mention');
                          const nextRules = isChecked
                            ? threadgateRules.filter((r) => r !== 'mention')
                            : [...threadgateRules, 'mention'];
                          setThreadgateRules(nextRules);
                          setThreadgate(
                            nextRules.length > 0 ? 'custom' : 'everybody',
                          );
                          store.session.set(
                            'currentThreadgate',
                            nextRules.length > 0 ? 'custom' : 'everybody',
                          );
                          store.session.set(
                            'currentThreadgateRules',
                            JSON.stringify(nextRules),
                          );
                        }}
                        disabled={uiState === 'loading'}
                      >
                        <Icon icon="message" size="s" />
                        <span>
                          <Trans>Mentioned</Trans>
                        </span>
                      </button>

                      {/* People from list */}
                      <button
                        type="button"
                        className={`reply-pill-btn ${threadgateRules.includes('list') ? 'active' : ''}`}
                        onClick={() => {
                          const isChecked = threadgateRules.includes('list');
                          if (
                            !isChecked &&
                            !threadgateList &&
                            userLists.length === 0
                          ) {
                            alert(t`No user lists found.`);
                            return;
                          }
                          const nextRules = isChecked
                            ? threadgateRules.filter((r) => r !== 'list')
                            : [...threadgateRules, 'list'];
                          setThreadgateRules(nextRules);
                          setThreadgate(
                            nextRules.length > 0 ? 'custom' : 'everybody',
                          );
                          store.session.set(
                            'currentThreadgate',
                            nextRules.length > 0 ? 'custom' : 'everybody',
                          );
                          store.session.set(
                            'currentThreadgateRules',
                            JSON.stringify(nextRules),
                          );
                          if (
                            !isChecked &&
                            !threadgateList &&
                            userLists.length > 0
                          ) {
                            const firstList = userLists[0];
                            const uri =
                              firstList._atproto?.uri ||
                              decodeURIComponent(firstList.id);
                            setThreadgateList(uri);
                            setThreadgateListName(firstList.title || '');
                            store.session.set('currentThreadgateList', uri);
                            store.session.set(
                              'currentThreadgateListName',
                              firstList.title || '',
                            );
                          }
                        }}
                        disabled={uiState === 'loading'}
                      >
                        <Icon icon="building" size="s" />
                        <span>
                          <Trans>From List</Trans>
                        </span>
                      </button>
                    </div>

                    {threadgateRules.includes('list') && (
                      <div className="reply-list-dropdown-container-compact">
                        {userLists.length > 0 ? (
                          <Menu2
                            align="center"
                            overflow="auto"
                            menuClassName="threadgate-list-menu"
                            portal={{ target: document.body }}
                            containerProps={{
                              style: {
                                zIndex: 1001,
                              },
                            }}
                            menuButton={({ open }: { open: boolean }) => (
                              <button
                                type="button"
                                className={`rule-list-select-bluepy-compact ${
                                  open ? 'active' : ''
                                }`}
                                disabled={uiState === 'loading'}
                                dir="auto"
                              >
                                <span>
                                  {threadgateListName || (
                                    <Trans>Select a list...</Trans>
                                  )}
                                </span>
                                <Icon icon="chevron-down" size="s" />
                              </button>
                            )}
                          >
                            {userLists.map((list) => {
                              const uri =
                                list._atproto?.uri ||
                                decodeURIComponent(list.id);
                              const selected = uri === threadgateList;
                              return (
                                <MenuItem
                                  key={uri}
                                  className={`threadgate-list-menu-item ${
                                    selected ? 'selected' : ''
                                  }`}
                                  onClick={() => {
                                    setThreadgateList(uri);
                                    store.session.set(
                                      'currentThreadgateList',
                                      uri,
                                    );
                                    const name = list.title || '';
                                    setThreadgateListName(name);
                                    store.session.set(
                                      'currentThreadgateListName',
                                      name,
                                    );
                                  }}
                                >
                                  <span className="threadgate-list-menu-check">
                                    {selected && (
                                      <Icon icon="check-circle" size="s" />
                                    )}
                                  </span>
                                  <span>{list.title}</span>
                                </MenuItem>
                              );
                            })}
                          </Menu2>
                        ) : (
                          <span className="no-lists-warning-compact">
                            <Trans>(No user lists found)</Trans>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          )}
          <div className="toolbar compose-footer">
            <span className="add-toolbar-button-group spacer">
              {showAddButton && (
                <>
                  {supportsCameraCapture && (
                    <CameraCaptureInput
                      id={menuCameraInputId}
                      hidden
                      supportedMimeTypes={supportedImagesVideosTypes}
                      disabled={mediaButtonDisabled}
                      setMediaAttachments={setMediaAttachments}
                    />
                  )}
                  <FilePickerInput
                    id={menuMediaInputId}
                    hidden
                    supportedMimeTypes={supportedMimeTypes}
                    maxMediaAttachments={maxMediaAttachments}
                    mediaAttachments={mediaAttachments}
                    disabled={mediaButtonDisabled}
                    setMediaAttachments={setMediaAttachments}
                  />
                  <Menu2
                    portal={{
                      target: document.body,
                    }}
                    containerProps={{
                      style: {
                        zIndex: 1001,
                      },
                    }}
                    menuButton={({ open }: { open: boolean }) => (
                      <button
                        type="button"
                        className={`toolbar-button add-button ${
                          open ? 'active' : ''
                        }`}
                      >
                        <Icon icon="plus" title={t`Add`} />
                      </button>
                    )}
                  >
                    {supportsCameraCapture && (
                      <MenuItem
                        disabled={mediaButtonDisabled}
                        className="compose-menu-add-media"
                        onClick={(event) => {
                          event.keepOpen = true;
                          clickFileInput(menuCameraInputId);
                        }}
                      >
                        <Icon icon="camera" />{' '}
                        <span>{_(ADD_LABELS.camera)}</span>
                      </MenuItem>
                    )}
                    <MenuItem
                      disabled={mediaButtonDisabled}
                      className="compose-menu-add-media"
                      onClick={(event) => {
                        event.keepOpen = true;
                        clickFileInput(menuMediaInputId);
                      }}
                    >
                      <Icon icon="media" /> <span>{_(ADD_LABELS.media)}</span>
                    </MenuItem>
                    {states.settings.composerGIFPicker && (
                      <MenuItem
                        disabled={mediaButtonDisabled}
                        onClick={() => {
                          setShowGIFPicker(true);
                        }}
                      >
                        <span className="icon icon-gif" role="img" />
                        <span>{_(ADD_LABELS.gif)}</span>
                      </MenuItem>
                    )}
                  </Menu2>
                </>
              )}
              <span
                className="add-sub-toolbar-button-group"
                ref={addSubToolbarRef}
                hidden
              >
                {supportsCameraCapture && (
                  // TODO(oxlint:jsx-a11y/label-has-associated-control): the
                  // wrapped CameraCaptureInput renders the actual <input
                  // type="file"> — the rule cannot see through the component
                  // boundary.
                  <label
                    className="toolbar-button"
                    htmlFor={toolbarCameraInputId}
                  >
                    <CameraCaptureInput
                      id={toolbarCameraInputId}
                      supportedMimeTypes={supportedImagesVideosTypes}
                      mediaAttachments={mediaAttachments}
                      disabled={mediaButtonDisabled}
                      setMediaAttachments={setMediaAttachments}
                    />
                    <Icon icon="camera" alt={_(ADD_LABELS.camera)} />
                  </label>
                )}
                {/* TODO(oxlint:jsx-a11y/label-has-associated-control): the
                    wrapped FilePickerInput renders the actual <input
                    type="file"> — the rule cannot see through the
                    component boundary. */}
                <label className="toolbar-button" htmlFor={toolbarMediaInputId}>
                  <FilePickerInput
                    id={toolbarMediaInputId}
                    supportedMimeTypes={supportedMimeTypes}
                    maxMediaAttachments={maxMediaAttachments}
                    mediaAttachments={mediaAttachments}
                    disabled={mediaButtonDisabled}
                    setMediaAttachments={setMediaAttachments}
                  />
                  <Icon icon="media" alt={_(ADD_LABELS.media)} />
                </label>
                {states.settings.composerGIFPicker && (
                  <button
                    type="button"
                    className="toolbar-button gif-picker-button"
                    disabled={mediaButtonDisabled}
                    onClick={() => {
                      setShowGIFPicker(true);
                    }}
                  >
                    <span
                      className="icon icon-gif"
                      aria-label={_(ADD_LABELS.gif)}
                    />
                  </button>
                )}
              </span>
            </span>
            {uiState === 'loading' ? (
              <Loader abrupt />
            ) : (
              <CharCountMeter
                maxCharacters={maxCharacters}
                // After the ternary uiState is narrowed away from 'loading';
                // mirror the JS expression for behavior parity.
                hidden={(uiState as string) === 'loading'}
              />
            )}
            <label
              className={`toolbar-button ${
                highlightLanguageField ? 'highlight' : ''
              }`}
            >
              <span className="icon-text">
                {supportedLanguagesMap[language]?.native || language}
              </span>
              <select
                name="language"
                value={language}
                onChange={(e: SyntheticEvent<HTMLSelectElement>) => {
                  const { value } = e.target as HTMLSelectElement;
                  setLanguage(value || DEFAULT_LANG);
                  store.session.set('currentLanguage', value || DEFAULT_LANG);
                }}
                disabled={uiState === 'loading'}
                dir="auto"
              >
                {topSupportedLanguages.map(([code, common, native]) => {
                  const commonText = localeCode2Text({
                    code,
                    fallback: common,
                  });
                  const showCommon = commonText !== native;
                  return (
                    <option value={code} key={code}>
                      {showCommon ? `${native} - ${commonText}` : commonText}
                    </option>
                  );
                })}
                <hr />
                {restSupportedLanguages.map(([code, common, native]) => {
                  const commonText = localeCode2Text({
                    code,
                    fallback: common,
                  });
                  const showCommon = commonText !== native;
                  return (
                    <option value={code} key={code}>
                      {showCommon ? `${native} - ${commonText}` : commonText}
                    </option>
                  );
                })}
              </select>
            </label>{' '}
            <button
              type="submit"
              disabled={uiState === 'loading'}
              onClick={() => {
                void haptics.trigger('medium');
              }}
            >
              {replyToStatus
                ? t`Reply`
                : editStatus
                  ? t`Update`
                  : t({
                      message: 'Post',
                      context: 'Submit button in composer',
                    })}
            </button>
          </div>
        </form>
      </div>
      {showMentionPicker && (
        <Modal
          onClose={() => {
            setShowMentionPicker(false);
            focusLastFocusedField();
          }}
        >
          <MentionModal
            onClose={() => {
              setShowMentionPicker(false);
            }}
            defaultSearchTerm={
              typeof showMentionPicker === 'object'
                ? showMentionPicker?.defaultSearchTerm
                : undefined
            }
            onSelect={(socialAddress: string) => {
              const textarea = textareaRef.current;
              if (textarea) {
                insertTextAtCursor({
                  targetElement: textarea,
                  text: '@' + socialAddress,
                });
              }
            }}
          />
        </Modal>
      )}
      {showGIFPicker && (
        <Modal
          onClose={() => {
            setShowGIFPicker(false);
            focusLastFocusedField();
          }}
        >
          <GIFPickerModal
            onClose={() => {
              setShowGIFPicker(false);
            }}
            onSelect={({
              url,
              type,
              alt_text,
            }: {
              url: string;
              type: string;
              alt_text?: string;
            }) => {
              console.log('GIF URL', url);
              // Preserve original JS: `>= undefined` evaluates to false via
              // NaN coercion. plural(undefined, ...) would explode, but the
              // guard above means it is only called when max is defined.
              if (mediaAttachments.length >= (maxMediaAttachments as number)) {
                alert(
                  plural(maxMediaAttachments as number, {
                    one: 'You can only attach up to 1 file.',
                    other: 'You can only attach up to # files.',
                  }),
                );
                return;
              }
              // Download the GIF and insert it as media attachment
              void (async () => {
                let theToast: { hideToast?: () => void } | undefined;
                try {
                  theToast = showToast({
                    text: t`Downloading GIF…`,
                    duration: -1,
                  });
                  const blob = await fetch(url, {
                    referrerPolicy: 'no-referrer',
                  }).then((res) => res.blob());
                  const fileData = await blob.arrayBuffer();
                  const newMediaAttachments: MediaAttachmentLike[] = [
                    ...mediaAttachments,
                    {
                      fileData,
                      fileName:
                        type === 'video/mp4' ? 'video.mp4' : 'image.gif',
                      type,
                      size: blob.size,
                      id: null,
                      description: alt_text || '',
                    },
                  ];
                  setMediaAttachments(newMediaAttachments);
                  theToast?.hideToast?.();
                } catch (err) {
                  console.error(err);
                  theToast?.hideToast?.();
                  showToast(t`Failed to download GIF`);
                }
              })();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function removeNullUndefined(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  for (const key in obj) {
    if (obj[key] === null || obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
}

export default Compose;
