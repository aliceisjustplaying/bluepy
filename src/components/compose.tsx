import './compose.css';

import type { MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import { deepEqual } from 'fast-equals';
import type { RefObject, SyntheticEvent } from 'react';
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
import {
  fetchAtprotoLinkMetadata,
  getFirstPostURL,
} from '../utils/atproto-unfurl';
import db from '../utils/db';
import { getDtfLocale } from '../utils/dtf-locale';
import haptics from '../utils/haptics';
import localeMatch from '../utils/locale-match';
import localeCode2Text from '../utils/localeCode2Text';
import mem from '../utils/mem';
import openCompose from '../utils/open-compose';
import {
  getPostQuoteApprovalPolicy,
  supportsNativeQuote,
} from '../utils/quote-utils';
import RTF from '../utils/relative-time-format';
import showToast from '../utils/show-toast';
import states, { saveStatus } from '../utils/states';
import store from '../utils/store';
import {
  getCurrentAccount,
  getCurrentAccountNS,
  getCurrentInstanceConfiguration,
} from '../utils/store-utils';
import stringLength from '../utils/string-length';
import supports from '../utils/supports';
import unfurlMastodonLink from '../utils/unfurl-link';
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
import ComposePoll, { expiryOptions, type PollState } from './compose-poll';
import Textarea from './compose-textarea';
import CustomEmojisModal from './custom-emojis-modal';
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
import ScheduledAtField, {
  getLocalTimezoneName,
  MIN_SCHEDULED_AT,
} from './ScheduledAtField';
import StatusComponent, { type StatusComponentProps } from './status';
import TextExpander from './text-expander';

// ---------------------------------------------------------------------------
// Local type shims for still-untyped peers — narrow to what compose uses.
// These mirror the shapes already exposed by compose-textarea.tsx,
// compose-poll.tsx, and drafts.tsx so the modal stays consistent.
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

interface PollOption {
  title?: string;
  [key: string]: unknown;
}

interface StatusPoll {
  options?: Array<PollOption | string>;
  expiresIn?: number | string;
  expiresAt?: string | number | null;
  multiple?: boolean;
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
  description?: string | null;
  [key: string]: unknown;
}

interface StatusLike {
  id?: string;
  account?: AccountInfoLike;
  mentions?: MastodonMention[];
  visibility?: string;
  language?: string | null;
  sensitive?: boolean;
  spoilerText?: string;
  poll?: StatusPoll | null;
  mediaAttachments?: MediaAttachmentLike[];
  quoteApproval?: Record<string, unknown> | null;
  quoteApprovalPolicy?: string;
  createdAt?: string;
  url?: string;
  [key: string]: unknown;
}

interface DraftStatusLike {
  uid?: string;
  status?: string;
  spoilerText?: string;
  visibility?: string;
  language?: string | null;
  sensitive?: boolean | null;
  sensitiveMedia?: boolean | null;
  poll?: StatusPoll | null;
  mediaAttachments?: MediaAttachmentLike[];
  scheduledAt?: Date | string | null;
  quoteApprovalPolicy?: string;
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

interface EmojiPickerState {
  targetElement?: RefObject<HTMLElement | null> | null;
  defaultSearchTerm?: string | null;
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
  scheduledAt?: string | undefined;
  fn?: () => void;
}

interface ComposeProps {
  onClose: (info?: OnCloseInfo) => void;
  replyToStatus?: StatusLike | null;
  replyMode?: 'all' | 'author-only' | 'author-first';
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
    source: {
      fetch(): Promise<{ text: string; spoilerText: string }>;
    };
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

const expirySeconds = Object.keys(expiryOptions);
const oneDay = 24 * 60 * 60;

const expiresInFromExpiresAt = (
  expiresAt: string | number | Date | null | undefined,
): number | string => {
  if (!expiresAt) return oneDay;
  const delta = (Date.parse(String(expiresAt)) - Date.now()) / 1000;
  // Original JS compared string seconds to numeric delta; find on string keys
  // returned a string. Coerce-compare to keep equivalent runtime semantics.
  return expirySeconds.find((s) => Number(s) >= delta) || oneDay;
};

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
  customEmoji: msg`Add custom emoji`,
  gif: msg`Add GIF`,
  poll: msg`Add poll`,
  sensitive: msg`Add content warning`,
  scheduledPost: msg`Schedule post`,
};

const DEFAULT_SCHEDULED_AT = Math.max(10 * 60 * 1000, MIN_SCHEDULED_AT); // 10 mins

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
  targetElement.dispatchEvent(new Event('input'));
}

function Compose({
  onClose,
  replyToStatus,
  replyMode = 'all',
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
    polls?: {
      maxOptions?: number;
      maxCharactersPerOption?: number;
      maxExpiration?: number;
      minExpiration?: number;
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
    polls: {
      maxOptions,
      maxCharactersPerOption,
      maxExpiration,
      minExpiration,
    } = {},
  } = configuration || {};
  const supportedImagesVideosTypes = supportedMimeTypes?.filter(
    (mimeType: string) => /^(image|video)/i.test(mimeType),
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const spoilerTextRef = useRef<HTMLInputElement | null>(null);

  const [visibility, setVisibility] = useState<string>('public');
  const [quoteApprovalPolicy, setQuoteApprovalPolicy] =
    useState<string>('public');
  const [sensitive, setSensitive] = useState<boolean>(false);
  const [sensitiveMedia, setSensitiveMedia] = useState<boolean>(false);
  const [language, setLanguage] = useState<string>(
    store.session.get('currentLanguage') || DEFAULT_LANG,
  );
  const prevLanguage = useRef<string>(language);
  const [mediaAttachments, setMediaAttachments] = useState<
    MediaAttachmentLike[]
  >([]);
  const [poll, setPoll] = useState<PollState | null>(null);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [quoteSuggestion, setQuoteSuggestion] =
    useState<QuoteSuggestionState | null>(null);
  const [localQuoteStatus, setLocalQuoteStatus] = useState<
    StatusLike | null | undefined
  >(quoteStatus);
  const [quoteCleared, setQuoteCleared] = useState<boolean>(false);
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

  const currentQuoteStatus = quoteCleared
    ? null
    : localQuoteStatus || quoteStatus;
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

  // Quote eligibility logic duplicated from status.jsx
  const checkQuoteEligibility = (status: StatusLike): boolean => {
    if (!supportsNativeQuote()) return false;

    const { visibility: statusVisibility, quoteApproval, account } = status;
    const isSelf =
      !!currentAccountInfo && currentAccountInfo.id === account?.id;
    const isPublic = ['public', 'unlisted'].includes(statusVisibility ?? '');
    const isMineAndPrivate = isSelf && statusVisibility === 'private';

    const quoteApprovalNarrowed = quoteApproval as
      | { currentUser?: string }
      | null
      | undefined;
    const isQuoteAutomaticallyAccepted =
      quoteApprovalNarrowed?.currentUser === 'automatic' &&
      (isPublic || isMineAndPrivate);
    const isQuoteManuallyAccepted =
      quoteApprovalNarrowed?.currentUser === 'manual' &&
      (isPublic || isMineAndPrivate);

    if (!isPublic && !isSelf) {
      return false;
    } else if (isQuoteAutomaticallyAccepted) {
      return true;
    } else if (isQuoteManuallyAccepted) {
      return true;
    } else {
      return false;
    }
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
        allowedFiles.map(async (file) => ({
          fileData: await file.arrayBuffer(),
          fileName: file.name,
          type: file.type,
          size: file.size,
          url: URL.createObjectURL(file),
          id: null,
          description: null,
        })),
      );
    }
    return null;
  };

  const handlePastedLink = async (url: string): Promise<void> => {
    // Handle QP links
    if (supportsNativeQuote()) {
      // Quotes cannot coexist with media attachments or polls
      if (mediaAttachments.length > 0 || poll) {
        return;
      }

      // Cannot add/remove/replace current quote when editing
      if (editStatus) {
        return;
      }

      // Don't show quote suggestion when visibility is 'direct'
      if (visibility === 'direct') {
        return;
      }

      try {
        // unfurl-link.ts exposes a snapshot type without `id`/`instance`/
        // `originalURL` keys publicly; the runtime data does carry them on
        // resolved hits, so narrow here for the keys we read.
        const unfurledData = (await unfurlMastodonLink(instance, url)) as
          | {
              id?: string;
              instance?: string;
              originalURL?: string;
              [key: string]: unknown;
            }
          | null
          | undefined;
        if (unfurledData?.id) {
          const status = (
            states.statuses as Record<string, StatusLike | undefined>
          )[`${unfurledData.instance}/${unfurledData.id}`];
          if (status && checkQuoteEligibility(status)) {
            // Don't show suggestion if it's the same as current quote
            if (currentQuoteStatus?.id === status.id) {
              return;
            }

            setQuoteSuggestion({
              status,
              instance: unfurledData.instance,
              url: unfurledData.originalURL ?? url,
            });
          }
        }
      } catch (error) {
        console.error(error);
      }
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
    textareaRef.current.dispatchEvent(new Event('input'));
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
  const lastFocusedEmojiFieldRef = useRef<HTMLElement | null>(null);
  const focusLastFocusedField = (): void => {
    setTimeout(() => {
      if (!lastFocusedFieldRef.current) return;
      lastFocusedFieldRef.current.focus();
    }, 0);
  };
  const composeContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const handleFocus = (e: FocusEvent): void => {
      // Toggle focused if in or out if any fields are focused
      // The container is non-null at handler time (the listener is only
      // attached when composeContainer was defined). Mirror the original JS
      // direct access.
      (composeContainerRef.current as HTMLDivElement).classList.toggle(
        'focused',
        e.type === 'focusin',
      );

      const target = e.target as HTMLElement;
      if (target.hasAttribute('data-allow-custom-emoji')) {
        lastFocusedEmojiFieldRef.current = target;
      }
      const isFormElement = ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(
        target.tagName,
      );
      if (isFormElement) {
        lastFocusedFieldRef.current = target;
      }
    };

    const composeContainer = composeContainerRef.current;
    if (composeContainer) {
      composeContainer.addEventListener('focusin', handleFocus);
      composeContainer.addEventListener('focusout', handleFocus);
    }

    return () => {
      if (composeContainer) {
        composeContainer.removeEventListener('focusin', handleFocus);
        composeContainer.removeEventListener('focusout', handleFocus);
      }
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
  const currentAccountAcctRef = useRef(currentAccountInfo?.acct);
  currentAccountAcctRef.current = currentAccountInfo?.acct;

  useEffect(() => {
    const prefStringFn = prefStringRef.current;
    const prefsLocal = prefsRef.current;
    const statusesEndpointLocal = statusesEndpointRef.current;
    const currentAcct = currentAccountAcctRef.current;
    if (replyToStatus) {
      // sensitive read here only for parity with the original JS destructure
      // (it is read from `!!spoilerText` below). Keep destructure shape stable.
      const {
        spoilerText,
        visibility: replyVisibility,
        language: replyLanguage,
      } = replyToStatus;
      if (spoilerText && spoilerTextRef.current) {
        spoilerTextRef.current.value = spoilerText;
      }
      const account = replyToStatus.account ?? {};
      const mentionsList = replyToStatus.mentions ?? [];
      const mentions = new Set<string | undefined>([
        account.acct,
        ...mentionsList.map((m) => m.acct),
      ]);
      const allMentions = [...mentions].filter(
        (m): m is string => typeof m === 'string' && m !== currentAcct,
      );

      if (allMentions.length > 0) {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const authorMention = `@${account.acct ?? ''}`;
        const otherMentions = allMentions
          .filter((m) => m !== account.acct)
          .map((m) => `@${m}`);

        if (replyMode === 'author-only') {
          // Mode 1: Only mention the author
          textarea.value = `${authorMention} `;
          oninputTextarea();
          focusTextarea();
        } else if (replyMode === 'author-first') {
          // Mode 2: Mention author first, then others at the end after 2 newlines
          if (otherMentions.length > 0) {
            textarea.value = `${authorMention} \n\n${otherMentions.join(' ')}`;
            oninputTextarea();
            // Set cursor position after the author mention
            const cursorPosition = authorMention.length + 1; // +1 for the space
            focusTextarea(cursorPosition);
          } else {
            // If no other mentions, just mention the author
            textarea.value = `${authorMention} `;
            oninputTextarea();
            focusTextarea();
          }
        } else {
          // Mode 3 (default 'all'): All mentions at the beginning
          textarea.value = `${allMentions.map((m) => `@${m}`).join(' ')} `;
          oninputTextarea();
          focusTextarea();
        }
      }
      const defaultVisPref = prefStringFn('posting:default:visibility');
      // Preserve original: passes `visibility` directly when no pref override.
      setVisibility(
        replyVisibility === 'public' && defaultVisPref
          ? defaultVisPref.toLowerCase()
          : (replyVisibility as string),
      );
      setLanguage(
        fixLanguage(replyLanguage) ||
          prefStringFn('posting:default:language')?.toLowerCase() ||
          DEFAULT_LANG,
      );
      setSensitive(!!spoilerText);
    } else if (editStatus) {
      const {
        visibility: editVisibility,
        language: editLanguage,
        sensitive: editSensitive,
        poll: editPoll,
        mediaAttachments: editMediaAttachments,
        quoteApproval,
      } = editStatus;
      const composablePoll = editPoll?.options
        ? {
            ...editPoll,
            options: editPoll.options.map(
              (o) => (typeof o === 'string' ? o : o?.title || o) as string,
            ),
            expiresIn:
              editPoll?.expiresIn || expiresInFromExpiresAt(editPoll.expiresAt),
            multiple: !!editPoll.multiple,
          }
        : null;
      setUIState('loading');
      void (async () => {
        try {
          const statusSource = await statusesEndpointLocal
            .$select(editStatus.id)
            .source.fetch();
          console.log({ statusSource });
          const { text, spoilerText } = statusSource;
          const textarea = textareaRef.current;
          if (!textarea) return;
          textarea.value = text;
          textarea.dataset.source = text;
          oninputTextarea();
          focusTextarea();
          if (spoilerTextRef.current) {
            spoilerTextRef.current.value = spoilerText;
          }
          // Original JS passed `visibility` directly; preserve that (may be
          // undefined for some statuses, mirroring the JS state shape).
          setVisibility(editVisibility as string);
          setLanguage(
            editLanguage ||
              prefStringFn('posting:default:language')?.toLowerCase() ||
              DEFAULT_LANG,
          );
          if (supportsNativeQuote()) {
            const postQuoteApprovalPolicy =
              getPostQuoteApprovalPolicy(quoteApproval);
            setQuoteApprovalPolicy(postQuoteApprovalPolicy);
          }
          setSensitive(!!editSensitive);
          if (composablePoll) setPoll(composablePoll);
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
      const defaultVis = prefStringFn('posting:default:visibility');
      if (defaultVis) {
        setVisibility(defaultVis.toLowerCase());
      }
      const defaultLang = prefStringFn('posting:default:language');
      if (defaultLang) {
        setLanguage(defaultLang.toLowerCase());
      }
      if (prefsLocal['posting:default:sensitive']) {
        setSensitive(!!prefsLocal['posting:default:sensitive']);
      }
      const defaultQuotePolicy = prefStringFn('posting:default:quote_policy');
      if (defaultQuotePolicy) {
        let policy = defaultQuotePolicy.toLowerCase();
        if (defaultVis) {
          const visLower = defaultVis.toLowerCase();
          if (visLower === 'private' || visLower === 'direct') {
            policy = 'nobody';
          }
        }
        setQuoteApprovalPolicy(policy);
      }
    }
    if (draftStatus) {
      const {
        status,
        spoilerText,
        visibility: draftVisibility,
        language: draftLanguage,
        sensitive: draftSensitive,
        sensitiveMedia: draftSensitiveMedia,
        poll: draftPoll,
        mediaAttachments: draftMediaAttachments,
        scheduledAt: draftScheduledAt,
        quoteApprovalPolicy: draftQuoteApprovalPolicy,
      } = draftStatus;
      const composablePoll = draftPoll?.options
        ? {
            ...draftPoll,
            options: draftPoll.options.map(
              (o) => (typeof o === 'string' ? o : o?.title || o) as string,
            ),
            expiresIn:
              draftPoll?.expiresIn ||
              expiresInFromExpiresAt(draftPoll.expiresAt),
            multiple: !!draftPoll.multiple,
          }
        : null;
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.value = status ?? '';
      oninputTextarea();
      // status starts with newline or space, focus on first position
      const cursorPos = /^\n|\s/.test(status ?? '') ? 0 : undefined;
      focusTextarea(cursorPos);
      if (spoilerText && spoilerTextRef.current)
        spoilerTextRef.current.value = spoilerText;
      if (draftVisibility) setVisibility(draftVisibility);
      setLanguage(
        draftLanguage ||
          prefStringFn('posting:default:language')?.toLowerCase() ||
          DEFAULT_LANG,
      );
      // Match JS guard: only skip when explicitly null. Coerce to boolean
      // because the state is typed boolean; undefined would silently set the
      // store to undefined in JS, which downstream readers already treat as
      // falsy via `!!` checks.
      if (draftSensitiveMedia !== null)
        setSensitiveMedia(!!draftSensitiveMedia);
      if (draftSensitive !== null) setSensitive(!!draftSensitive);
      if (composablePoll) setPoll(composablePoll);
      if (draftMediaAttachments) setMediaAttachments(draftMediaAttachments);
      if (draftScheduledAt) {
        const d =
          draftScheduledAt instanceof Date
            ? draftScheduledAt
            : new Date(draftScheduledAt);
        setScheduledAt(d);
      }
      if (draftQuoteApprovalPolicy)
        setQuoteApprovalPolicy(draftQuoteApprovalPolicy);
    }
    // Effect deliberately runs only when an explicit source status changes;
    // prefString/prefs/masto/currentAccountInfo are read through latest-value
    // refs declared below so we always see fresh values without re-running on
    // every render.
  }, [draftStatus, editStatus, replyToStatus, replyMode]);

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

    // check if status contains only "@acct", if replying
    const isSelf = replyToStatus?.account?.id === currentAccountInfo?.id;
    const hasOnlyAcct =
      !!replyToStatus &&
      value.trim() === `@${replyToStatus.account?.acct ?? ''}`;
    // TODO: check for mentions, or maybe just generic "@username<space>", including multiple mentions like "@username1<space>@username2<space>"
    if (!isSelf && hasOnlyAcct) {
      console.log('canClose', { isSelf, hasOnlyAcct });
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
      poll,
      isSelf,
      hasOnlyAcct,
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
    const { value: spoilerText = '' } = spoilerTextRef.current ?? {};
    return stringLength(countableText(value)) + stringLength(spoilerText);
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
        const hasModal = !!modals;
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
      onClose();
    }
  }, []);

  const prevBackgroundDraft = useRef<Record<string, unknown>>({});
  const draftKey = (): string => {
    const ns = getCurrentAccountNS();
    return `${ns}#${UID.current}`;
  };
  const composerState = states.composerState;
  const saveUnsavedDraft = (): void => {
    // Not enabling this for editing status
    // I don't think this warrant a draft mode for a status that's already posted
    // Maybe it could be a big edit change but it should be rare
    if (editStatus) return;
    if (composerState.minimized) return;
    const key = draftKey();
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
        spoilerText: spoilerTextRef.current?.value ?? '',
        visibility,
        language,
        sensitive,
        sensitiveMedia,
        poll,
        mediaAttachments,
        scheduledAt,
        quoteApprovalPolicy,
      },
      quote: currentQuoteStatus?.id
        ? {
            // Smaller payload, same reason as replyTo
            id: currentQuoteStatus.id,
          }
        : null,
    };
    if (
      !deepEqual(backgroundDraft, prevBackgroundDraft.current) &&
      !canClose()
    ) {
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
    // If unmounted, means user discarded the draft
    // Also means pop-out 🙈, but it's okay because the pop-out will persist the ID and re-create the draft
    return () => {
      void db.drafts.del(draftKey());
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
  const [showEmoji2Picker, setShowEmoji2Picker] = useState<
    boolean | EmojiPickerState
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
      mediaAttachments.length >= maxMediaAttachments) ||
    !!poll; /* ||
    !!currentQuoteStatus?.id; */

  const cwButtonDisabled = uiState === 'loading' || sensitive;
  const onCWButtonClick = (): void => {
    setSensitive(true);
    setTimeout(() => {
      spoilerTextRef.current?.focus();
    }, 0);
  };

  // If maxOptions is not defined or defined and is greater than 1, show poll button
  const showPollButton = maxOptions == null || maxOptions > 1;
  const pollButtonDisabled =
    uiState === 'loading' || !!poll || !!mediaAttachments.length; /* ||
    !!currentQuoteStatus?.id; */
  const onPollButtonClick = (): void => {
    setPoll({
      options: ['', ''],
      expiresIn: 24 * 60 * 60, // 1 day
      multiple: false,
    });
    // Focus first choice field
    setTimeout(() => {
      composeContainerRef.current
        ?.querySelector<HTMLInputElement>('.poll-choice input[type="text"]')
        ?.focus();
    }, 0);
  };

  const highlightLanguageField =
    language !== prevLanguage.current ||
    (autoDetectedLanguages?.length &&
      !autoDetectedLanguages.includes(language));
  const highlightVisibilityField = visibility !== 'public';

  const highlightQuoteApprovalPolicyField = quoteApprovalPolicy !== 'public';
  const disableQuotePolicy =
    visibility === 'private' || visibility === 'direct';

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

  const showScheduledAt =
    !editStatus && currentAccount?.instanceURL !== 'bsky.social';
  const scheduledAtButtonDisabled = uiState === 'loading' || !!scheduledAt;
  const onScheduledAtClick = (): void => {
    const date = new Date(Date.now() + DEFAULT_SCHEDULED_AT);
    setScheduledAt(date);
  };

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
              accountInstance={currentAccount?.instanceURL}
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
                        spoilerText: spoilerTextRef.current?.value ?? '',
                        visibility,
                        language,
                        sensitive,
                        poll,
                        mediaAttachments,
                        scheduledAt,
                      },
                      quoteStatus: currentQuoteStatus,
                    });

                    if (!newWin) {
                      return;
                    }

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

                  onClose({
                    fn: () => {
                      const passData = {
                        editStatus,
                        replyToStatus,
                        replyMode,
                        draftStatus: {
                          uid: UID.current,
                          status: textareaRef.current?.value ?? '',
                          spoilerText: spoilerTextRef.current?.value ?? '',
                          visibility,
                          language,
                          sensitive,
                          sensitiveMedia,
                          poll,
                          mediaAttachments,
                          scheduledAt,
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
          className={`form-visibility-${visibility}`}
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
              formRef.current?.dispatchEvent(
                new Event('submit', { cancelable: true }),
              );
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
            const rawVisibility = entries.visibility;
            const rawSensitive = entries.sensitive;
            const rawSensitiveMedia = entries.sensitiveMedia;
            const rawSpoilerText = entries.spoilerText;
            const rawScheduledAt = entries.scheduledAt;
            const rawQuoteApprovalPolicy = entries.quoteApprovalPolicy;

            // Pre-cleanup
            // checkboxes return "on" if checked
            const sensitiveBool: boolean = rawSensitive === 'on';
            const sensitiveMediaBool: boolean = rawSensitiveMedia === 'on';

            // Convert datetime-local input value to RFC3339 Date string value
            const scheduledAtIso: string | undefined = rawScheduledAt
              ? new Date(rawScheduledAt as string).toISOString()
              : undefined;

            let status: string | undefined =
              typeof rawStatus === 'string' ? rawStatus : undefined;
            let spoilerText: string | undefined =
              typeof rawSpoilerText === 'string' ? rawSpoilerText : undefined;
            const submitVisibility: string | undefined =
              typeof rawVisibility === 'string' ? rawVisibility : undefined;
            const submitQuoteApprovalPolicy: string | undefined =
              typeof rawQuoteApprovalPolicy === 'string'
                ? rawQuoteApprovalPolicy
                : undefined;

            // Validation
            /* Let the backend validate this
          if (stringLength(status) > maxCharacters) {
            alert(`Status is too long! Max characters: ${maxCharacters}`);
            return;
          }
          if (
            sensitive &&
            stringLength(status) + stringLength(spoilerText) > maxCharacters
          ) {
            alert(
              `Status and content warning is too long! Max characters: ${maxCharacters}`,
            );
            return;
          }
          */
            if (poll) {
              if (poll.options.length < 2) {
                alert(t`Poll must have at least 2 options`);
                return;
              }
              if (poll.options.some((option) => option === '')) {
                alert(t`Some poll choices are empty`);
                return;
              }
            }
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

            // Post-cleanup
            spoilerText = (sensitiveBool && spoilerText) || undefined;
            status = status === '' ? undefined : status;

            // states.composerState.minimized = true;
            composerState.publishing = true;
            setUIState('loading');
            void (async () => {
              try {
                console.log('MEDIA ATTACHMENTS', mediaAttachments);
                if (mediaAttachments.length > 0) {
                  // Upload media attachments first
                  const mediaPromises = mediaAttachments.map((attachment) => {
                    const { fileData, fileName, file, type, description, id } =
                      attachment;
                    console.log('UPLOADING', attachment);
                    if (id) {
                      // If already uploaded
                      return Promise.resolve(attachment);
                    } else {
                      // Reconstruct File from fileData, or fall back to legacy file object
                      const fileObj = fileData
                        ? new File([fileData], fileName || 'upload', { type })
                        : file;
                      const params = removeNullUndefined({
                        file: fileObj,
                        description,
                      });
                      return mediaEndpoint.create(params).then((res) => {
                        if (res.id) {
                          attachment.id = res.id;
                        }
                        return res;
                      });
                    }
                  });
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
                    results.forEach((result) => {
                      if (result.status === 'rejected') {
                        console.error(result);
                        // Note: original referenced `i` which wasn't in scope;
                        // preserve that pre-existing behavior — message reads
                        // "Attachment #undefined failed" at runtime. Follow-up
                        // bug, not changed in this TS migration.
                        const i: number | undefined = undefined;
                        alert(result.reason || t`Attachment #${i} failed`);
                      }
                    });
                    return;
                  }

                  console.log({ results, mediaAttachments });
                }

                /* NOTE:
                Using snakecase here because masto.js's `isObject` returns false for `params`, ONLY happens when opening in pop-out window. This is maybe due to `window.masto` variable being passed from the parent window. The check that failed is `x.constructor === Object`, so maybe the `Object` in new window is different than parent window's?
                Code: https://github.com/neet/masto.js/blob/dd0d649067b6a2b6e60fbb0a96597c373a255b00/src/serializers/is-object.ts#L2

                // TODO: Note above is no longer true in Masto.js v6. Revisit this.
              */
                let params: Record<string, unknown> = {
                  status,
                  // spoilerText,
                  spoiler_text: spoilerText,
                  language,
                  sensitive: sensitiveBool || sensitiveMediaBool,
                  poll,
                  // mediaIds: mediaAttachments.map((attachment) => attachment.id),
                  media_ids: mediaAttachments.map(
                    (attachment) => attachment.id,
                  ),
                };
                if (editStatus) {
                  if (supportsNativeQuote()) {
                    params.quote_approval_policy = quoteApprovalPolicy;
                  }
                  if (
                    supports('@mastodon') ||
                    supports('@gotosocial/edit-media-attributes')
                  ) {
                    params.media_attributes = mediaAttachments.map(
                      (attachment) => {
                        return {
                          id: attachment.id,
                          description: attachment.description,
                          // focus
                          // thumbnail
                        };
                      },
                    );
                  }
                } else {
                  if (supportsNativeQuote()) {
                    params.quote_approval_policy = submitQuoteApprovalPolicy;
                    if (currentQuoteStatus?.id) {
                      params.quoted_status_id = currentQuoteStatus.id;
                    }
                  }
                  params.visibility = submitVisibility;
                  // params.inReplyToId = replyToStatus?.id || undefined;
                  params.in_reply_to_id = replyToStatus?.id || undefined;
                  params.scheduled_at = scheduledAtIso;
                  if (linkPreview?.removed) {
                    params.disable_card = true;
                  } else if (linkPreview?.metadata) {
                    params.card_url = linkPreview.url;
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

                // Close
                onClose({
                  // type: post, reply, edit
                  type: editStatus ? 'edit' : replyToStatus ? 'reply' : 'post',
                  newStatus,
                  instance,
                  scheduledAt: scheduledAtIso,
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
            <div
              className={`compose-cw-container ${sensitive ? '' : 'collapsed'}`}
            >
              <input
                type="hidden"
                name="sensitive"
                value={sensitive ? 'on' : 'off'}
              />
              {/* mimic the old checkbox */}
              <TextExpander
                keys=":"
                className="spoiler-text-field-container"
                onTrigger={(action) => {
                  if (action?.name === 'custom-emojis') {
                    setShowEmoji2Picker({
                      targetElement:
                        spoilerTextRef as RefObject<HTMLElement | null>,
                      defaultSearchTerm:
                        typeof action?.defaultSearchTerm === 'string'
                          ? action.defaultSearchTerm || null
                          : null,
                    });
                  }
                }}
              >
                <input
                  ref={spoilerTextRef}
                  type="text"
                  name="spoilerText"
                  placeholder={t`Content warning`}
                  data-allow-custom-emoji="true"
                  disabled={uiState === 'loading'}
                  className="spoiler-text-field"
                  lang={language}
                  spellCheck
                  autoComplete="off"
                  dir="auto"
                  onInput={() => {
                    updateCharCount();
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (
                      e.key === 'Enter' &&
                      !e.ctrlKey &&
                      !e.metaKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      focusTextarea();
                    }
                  }}
                />
              </TextExpander>
              <button
                type="button"
                className="close-button plain4 small"
                onClick={() => {
                  setSensitive(false);
                  textareaRef.current?.focus();
                }}
              >
                <Icon icon="x" alt={t`Cancel`} />
              </button>
            </div>
            <Textarea
              ref={textareaRef}
              data-allow-custom-emoji="true"
              placeholder={
                replyToStatus
                  ? t`Post your reply`
                  : editStatus
                    ? t`Edit your post`
                    : poll
                      ? t`Ask a question`
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
                if (action?.name === 'custom-emojis') {
                  setShowEmoji2Picker({
                    targetElement: lastFocusedEmojiFieldRef,
                    defaultSearchTerm: action?.defaultSearchTerm || null,
                  });
                } else if (action?.name === 'mention') {
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
                        return attachments.filter((_a, j) => j !== i);
                      });
                    }}
                  />
                );
              })}
              <label className="media-sensitive">
                <input
                  name="sensitiveMedia"
                  type="checkbox"
                  checked={sensitiveMedia}
                  disabled={uiState === 'loading'}
                  onChange={(e: SyntheticEvent<HTMLInputElement>) => {
                    const nextSensitiveMedia = (e.target as HTMLInputElement)
                      .checked;
                    setSensitiveMedia(nextSensitiveMedia);
                  }}
                />{' '}
                <span>
                  <Trans>Mark media as sensitive</Trans>
                </span>{' '}
                <Icon icon={`eye-${sensitiveMedia ? 'close' : 'open'}`} />
              </label>
            </div>
          )}
          {!!poll && (
            <ComposePoll
              lang={language}
              maxOptions={maxOptions as number}
              maxExpiration={maxExpiration as number}
              minExpiration={minExpiration as number}
              maxCharactersPerOption={maxCharactersPerOption}
              poll={poll}
              disabled={uiState === 'loading'}
              onInput={(nextPoll) => {
                if (nextPoll) {
                  const newPoll = { ...nextPoll };
                  setPoll(newPoll);
                } else {
                  setPoll(null);
                  focusLastFocusedField();
                }
              }}
            />
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
          {scheduledAt && (
            <div className="toolbar scheduled-at">
              <span>
                <label>
                  <Trans>
                    Posting on{' '}
                    <ScheduledAtField
                      scheduledAt={scheduledAt}
                      setScheduledAt={setScheduledAt}
                    />
                  </Trans>
                </label>{' '}
                <small className="tag insignificant">
                  {getLocalTimezoneName()}
                </small>
              </span>
              <button
                type="button"
                className="plain4 close-button small"
                onClick={() => {
                  setScheduledAt(null);
                  focusLastFocusedField();
                }}
              >
                <Icon icon="x" alt={t`Cancel`} />
              </button>
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
                textareaRef.current.dispatchEvent(new Event('input'));
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
          <div className="toolbar compose-footer">
            <span className="add-toolbar-button-group spacer">
              {showAddButton && (
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
                    >
                      {/* TODO(oxlint:jsx-a11y/label-has-associated-control):
                          the wrapped CameraCaptureInput renders the actual
                          <input type="file"> — the rule cannot see through
                          the component boundary. */}
                      <label
                        className="compose-menu-add-media-field"
                        htmlFor={menuCameraInputId}
                      >
                        <CameraCaptureInput
                          id={menuCameraInputId}
                          hidden
                          supportedMimeTypes={supportedImagesVideosTypes}
                          disabled={mediaButtonDisabled}
                          setMediaAttachments={setMediaAttachments}
                        />
                      </label>
                      <Icon icon="camera" /> <span>{_(ADD_LABELS.camera)}</span>
                    </MenuItem>
                  )}
                  <MenuItem
                    disabled={mediaButtonDisabled}
                    className="compose-menu-add-media"
                  >
                    {/* TODO(oxlint:jsx-a11y/label-has-associated-control):
                        the wrapped FilePickerInput renders the actual
                        <input type="file"> — the rule cannot see through
                        the component boundary. */}
                    <label
                      className="compose-menu-add-media-field"
                      htmlFor={menuMediaInputId}
                    >
                      <FilePickerInput
                        id={menuMediaInputId}
                        hidden
                        supportedMimeTypes={supportedMimeTypes}
                        maxMediaAttachments={maxMediaAttachments}
                        mediaAttachments={mediaAttachments}
                        disabled={mediaButtonDisabled}
                        setMediaAttachments={setMediaAttachments}
                      />
                    </label>
                    <Icon icon="media" /> <span>{_(ADD_LABELS.media)}</span>
                  </MenuItem>
                  <MenuItem
                    disabled={cwButtonDisabled}
                    onClick={onCWButtonClick}
                  >
                    <Icon icon="alert" /> <span>{_(ADD_LABELS.sensitive)}</span>
                  </MenuItem>
                  {showPollButton && (
                    <MenuItem
                      disabled={pollButtonDisabled}
                      onClick={onPollButtonClick}
                    >
                      <Icon icon="poll" /> <span>{_(ADD_LABELS.poll)}</span>
                    </MenuItem>
                  )}
                  <MenuDivider />
                  <MenuItem
                    onClick={() => {
                      setShowEmoji2Picker({
                        targetElement: lastFocusedEmojiFieldRef,
                      });
                    }}
                  >
                    <Icon icon="emoji2" />{' '}
                    <span>{_(ADD_LABELS.customEmoji)}</span>
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
                  {showScheduledAt && (
                    <>
                      <MenuDivider />
                      <MenuItem
                        disabled={scheduledAtButtonDisabled}
                        onClick={onScheduledAtClick}
                      >
                        <Icon icon="schedule" />{' '}
                        <span>{_(ADD_LABELS.scheduledPost)}</span>
                      </MenuItem>
                    </>
                  )}
                </Menu2>
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
                <button
                  type="button"
                  className="toolbar-button"
                  disabled={cwButtonDisabled}
                  onClick={onCWButtonClick}
                >
                  <Icon icon="alert" alt={_(ADD_LABELS.sensitive)} />
                </button>
                {showPollButton && (
                  <button
                    type="button"
                    className="toolbar-button"
                    disabled={pollButtonDisabled}
                    onClick={onPollButtonClick}
                  >
                    <Icon icon="poll" alt={_(ADD_LABELS.poll)} />
                  </button>
                )}
                <div className="toolbar-divider" />
                {/* <button
                  type="button"
                  className="toolbar-button"
                  disabled={uiState === 'loading'}
                  onClick={() => {
                    setShowMentionPicker(true);
                  }}
                >
                  <Icon icon="at" />
                </button> */}
                <button
                  type="button"
                  className="toolbar-button"
                  disabled={uiState === 'loading'}
                  onClick={() => {
                    setShowEmoji2Picker({
                      targetElement: lastFocusedEmojiFieldRef,
                    });
                  }}
                >
                  <Icon icon="emoji2" alt={_(ADD_LABELS.customEmoji)} />
                </button>
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
                {showScheduledAt && (
                  <>
                    <div className="toolbar-divider" />
                    <button
                      type="button"
                      className={`toolbar-button ${scheduledAt ? 'highlight' : ''}`}
                      disabled={scheduledAtButtonDisabled}
                      onClick={onScheduledAtClick}
                    >
                      <Icon icon="schedule" alt={_(ADD_LABELS.scheduledPost)} />
                    </button>
                  </>
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
            {supportsNativeQuote() && (
              <label
                className={`toolbar-button ${highlightQuoteApprovalPolicyField ? 'highlight' : ''}`}
              >
                <Icon icon="quote2" alt="Quote settings" />
                {quoteApprovalPolicy === 'followers' && (
                  <Icon icon="group" className="insignificant" />
                )}
                {quoteApprovalPolicy === 'nobody' && (
                  <Icon icon="block" className="insignificant" />
                )}
                <select
                  name="quoteApprovalPolicy"
                  value={quoteApprovalPolicy}
                  onChange={(e: SyntheticEvent<HTMLSelectElement>) => {
                    setQuoteApprovalPolicy(
                      (e.target as HTMLSelectElement).value,
                    );
                  }}
                  disabled={uiState === 'loading'}
                  dir="auto"
                >
                  <option value="public" disabled={disableQuotePolicy}>
                    <Trans>Anyone can quote</Trans>
                  </option>
                  <option value="followers" disabled={disableQuotePolicy}>
                    <Trans>Your followers can quote</Trans>
                  </option>
                  <option value="nobody">
                    <Trans>Only you can quote</Trans>
                  </option>
                </select>
              </label>
            )}
            <label
              className={`toolbar-button ${highlightVisibilityField ? 'highlight' : ''}`}
              title={_(
                visibilityText[visibility as keyof typeof visibilityText],
              )}
            >
              {visibility === 'public' || visibility === 'direct' ? (
                <Icon
                  icon={
                    visibilityIconsMap[
                      visibility as keyof typeof visibilityIconsMap
                    ]
                  }
                  alt={_(
                    visibilityText[visibility as keyof typeof visibilityText],
                  )}
                />
              ) : (
                <span className="icon-text">
                  {_(visibilityText[visibility as keyof typeof visibilityText])}
                </span>
              )}
              <select
                name="visibility"
                value={visibility}
                onChange={(e: SyntheticEvent<HTMLSelectElement>) => {
                  const target = e.target as HTMLSelectElement;
                  setVisibility(target.value);
                  if (target.value === 'private' || target.value === 'direct') {
                    setQuoteApprovalPolicy('nobody');
                  }

                  if (target.value === 'direct' && currentQuoteStatus?.id) {
                    const quoteURL = currentQuoteStatus.url;
                    if (quoteURL) {
                      const currentText = textareaRef.current?.value ?? '';
                      if (!currentText.includes(quoteURL)) {
                        const textarea = textareaRef.current;
                        if (textarea) {
                          textarea.value =
                            currentText + (currentText ? '\n' : '') + quoteURL;
                          oninputTextarea();
                        }
                      }
                    }
                    setQuoteCleared(true);
                    showToast(t`Quotes can't be embedded in private mentions.`);
                  } else if (target.value !== 'direct' && quoteCleared) {
                    const quoteURL = (localQuoteStatus || quoteStatus)?.url;
                    if (quoteURL && textareaRef.current) {
                      const currentValue = textareaRef.current.value;
                      const linkPos = currentValue.indexOf(quoteURL);
                      if (linkPos !== -1) {
                        let newValue =
                          currentValue.slice(0, linkPos) +
                          currentValue.slice(linkPos + quoteURL.length);
                        newValue = newValue.replace(/\n+$/, '');
                        textareaRef.current.value = newValue;
                        oninputTextarea();
                      }
                    }
                    setQuoteCleared(false);
                  }
                }}
                disabled={uiState === 'loading' || !!editStatus}
                dir="auto"
              >
                <option value="public">
                  <Trans>Public</Trans>
                </option>
                {(supports('@pleroma/local-visibility-post') ||
                  supports('@akkoma/local-visibility-post')) && (
                  <option value="local">
                    <Trans>Local</Trans>
                  </option>
                )}
                <option value="unlisted">
                  <Trans>Quiet public</Trans>
                </option>
                <option value="private">
                  <Trans>Followers</Trans>
                </option>
                <option value="direct">
                  <Trans>Private mention</Trans>
                </option>
              </select>
            </label>{' '}
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
              {scheduledAt
                ? t`Schedule`
                : replyToStatus
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
      {showEmoji2Picker && (
        <Modal
          onClose={() => {
            setShowEmoji2Picker(false);
            focusLastFocusedField();
          }}
        >
          <CustomEmojisModal
            instance={instance}
            onClose={() => {
              setShowEmoji2Picker(false);
            }}
            defaultSearchTerm={
              typeof showEmoji2Picker === 'object'
                ? showEmoji2Picker?.defaultSearchTerm
                : undefined
            }
            onSelect={(emojiShortcode: string) => {
              const emojiState =
                typeof showEmoji2Picker === 'object' ? showEmoji2Picker : null;
              const targetElement =
                (emojiState?.targetElement?.current as
                  | HTMLInputElement
                  | HTMLTextAreaElement
                  | null
                  | undefined) || textareaRef.current;
              if (targetElement) {
                insertTextAtCursor({ targetElement, text: emojiShortcode });
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
