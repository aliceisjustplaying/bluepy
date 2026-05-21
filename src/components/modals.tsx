import { useLingui } from '@lingui/react/macro';
import { useEffect } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import { subscribe, useSnapshot } from 'valtio';

import Accounts from '../pages/accounts';
import Settings from '../pages/settings';
import { useAuth } from '../utils/auth-context';
import focusDeck from '../utils/focus-deck';
import { canonicalizeAppPath, navigatePath } from '../utils/router';
import showToast from '../utils/show-toast';
import states from '../utils/states';

import AccountSheet from './account-sheet';
import ComposeSuspense, { preload } from './compose-suspense';
import Drafts from './drafts';
import EmbedModal from './embed-modal';
import FeedbackModal from './feedback-modal';
import GenericAccounts from './generic-accounts';
import ImportExportAccounts from './import-export-accounts';
import MediaAltModal from './media-alt-modal';
import MediaModalComponent, { type MediaModalProps } from './media-modal';
import Modal from './modal';
import OpenLinkSheet from './open-link-sheet';
import QrCodeModal from './qr-code-modal';
import QrScannerModal from './qr-scanner-modal';
import ReportModal from './report-modal';
import ShortcutsSettings from './shortcuts-settings';

function MediaModal(props: {
  mediaAttachments?: unknown;
  statusID?: string;
  instance?: string;
  lang?: string;
  index?: number;
  onClose?: () => void;
}) {
  const mediaAttachments = Array.isArray(props.mediaAttachments)
    ? props.mediaAttachments.filter(isMediaModalAttachment)
    : [];
  return <MediaModalComponent {...props} mediaAttachments={mediaAttachments} />;
}

// `show*` payloads in `states` are typed as `unknown` because the same key
// holds either `false` or a payload object describing what to render. Cast
// to `Payload` (loose record) at the read site rather than introducing many
// narrow interfaces.
type Payload = Record<string, unknown>;
const p = (v: unknown): Payload =>
  v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v)) : {};
const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const strRequired = (value: unknown): string =>
  typeof value === 'string' ? value : '';
const num = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;
const strOrNum = (value: unknown): string | number | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined;
const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;
const stringArray = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isMediaModalAttachment(
  value: unknown,
): value is MediaModalProps['mediaAttachments'][number] {
  return isRecord(value) && typeof value.type === 'string';
}

function isAccountObject(
  value: unknown,
): value is Exclude<Parameters<typeof AccountSheet>[0]['account'], string> {
  return isRecord(value) && typeof value.id === 'string';
}

function isReportAccount(
  value: unknown,
): value is Parameters<typeof ReportModal>[0]['account'] {
  return isRecord(value) && typeof value.id === 'string';
}

function accountSheetAccount(
  value: unknown,
): Parameters<typeof AccountSheet>[0]['account'] | undefined {
  if (typeof value === 'string') return value;
  return isAccountObject(value) ? value : undefined;
}

function reportAccount(
  value: unknown,
): Parameters<typeof ReportModal>[0]['account'] | undefined {
  return isReportAccount(value) ? value : undefined;
}

function reportPost(
  value: unknown,
): Parameters<typeof ReportModal>[0]['post'] {
  return isRecord(value) ? value : undefined;
}

const isNoArgFunction = (value: unknown): value is () => unknown =>
  typeof value === 'function';
const isTextValidator = (value: unknown): value is (text: string) => unknown =>
  typeof value === 'function';
const isScannerClose = (
  value: unknown,
): value is (arg?: { text: string } | MouseEvent) => unknown =>
  typeof value === 'function';

const noArgFn = (value: unknown): (() => void) | undefined =>
  isNoArgFunction(value) ? () => value() : undefined;
const textValidator = (
  value: unknown,
): ((text: string) => boolean) | undefined =>
  isTextValidator(value)
    ? (text) => {
        const result = value(text);
        return typeof result === 'boolean' ? result : false;
      }
    : undefined;
const scannerClose = (
  value: unknown,
): ((arg?: { text: string } | MouseEvent) => void) | undefined =>
  isScannerClose(value)
    ? (arg) => {
        value(arg);
      }
    : undefined;

function toPrevLocation(
  location: Location,
): NonNullable<typeof states.prevLocation> {
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    state: location.state,
    key: location.key,
  };
}

subscribe(states, (changes) => {
  for (const [, path, value] of changes) {
    // When closing modal, focus on deck
    const pathString = Array.isArray(path) ? path.join('.') : String(path);
    if (/^show/i.test(pathString) && !value) {
      focusDeck();
    }
  }
});

export default function Modals() {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const location = useLocation();
  const isLoggedIn = useAuth();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void preload();
    }, 1000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  const composerState = p(snapStates.composerState);
  const composePayload = p(Reflect.get(window, '__COMPOSE__'));
  const sharedData = Reflect.get(window, '__SHARED_DATA__') || null;
  const showAccountPayload = p(snapStates.showAccount);
  const showAccountValue = accountSheetAccount(
    showAccountPayload.account || snapStates.showAccount,
  );
  const reportPayload = p(snapStates.showReportModal);
  const reportAccountValue = reportAccount(reportPayload.account);
  const reportPostValue = reportPost(reportPayload.post);

  return (
    <>
      {isLoggedIn && !!snapStates.showCompose && (
        <Modal
          className={`solid ${composerState.minimized ? 'min' : ''}`}
          minimized={!!composerState.minimized}
        >
          <ComposeSuspense
            replyToStatus={
              typeof snapStates.showCompose !== 'boolean'
                ? p(snapStates.showCompose).replyToStatus
                : composePayload.replyToStatus || null
            }
            editStatus={
              p(states.showCompose).editStatus || composePayload.editStatus || null
            }
            draftStatus={
              p(states.showCompose).draftStatus ||
              composePayload.draftStatus ||
              null
            }
            quoteStatus={
              p(states.showCompose).quoteStatus ||
              composePayload.quoteStatus ||
              null
            }
            sharedData={sharedData}
            onClose={(results: Payload | undefined) => {
              const resultPayload = p(results);
              const newStatus = p(resultPayload.newStatus);
              const instance = str(resultPayload.instance);
              const resultType = str(resultPayload.type);
              const type =
                resultType === 'reply' || resultType === 'edit'
                  ? resultType
                  : 'post';
              const newStatusId = str(newStatus.id);
              states.showCompose = false;
              Reflect.set(window, '__COMPOSE__', null);
              Reflect.set(window, '__SHARED_DATA__', null);
              if (newStatusId) {
                states.reloadStatusPage++;
                const toastText = {
                  post: t`Post published. Check it out.`,
                  reply: t`Reply posted. Check it out.`,
                  edit: t`Post updated. Check it out.`,
                }[type || 'post'];
                showToast({
                  text: toastText,
                  delay: 1000,
                  duration: 10_000, // 10 seconds
                  onClick: (toast: { hideToast: () => void }) => {
                    toast.hideToast();
                    states.prevLocation = toPrevLocation(location);
                    navigatePath(
                      canonicalizeAppPath(
                        instance
                          ? `/${instance}/s/${newStatusId}`
                          : `/s/${newStatusId}`,
                      ),
                    );
                  },
                });
              }
            }}
          />
        </Modal>
      )}
      {isLoggedIn && !!snapStates.showSettings && (
        <Modal
          onClose={() => {
            states.showSettings = false;
          }}
        >
          <Settings
            onClose={() => {
              states.showSettings = false;
            }}
          />
        </Modal>
      )}
      {isLoggedIn && !!snapStates.showAccounts && (
        <Modal
          onClose={() => {
            states.showAccounts = false;
          }}
        >
          <Accounts
            onClose={() => {
              states.showAccounts = false;
            }}
          />
        </Modal>
      )}
      {!!snapStates.showAccount && showAccountValue && (
        <Modal
          onClose={() => {
            states.showAccount = false;
          }}
        >
          <AccountSheet
            account={showAccountValue}
            instance={str(showAccountPayload.instance)}
            onClose={() => {
              states.showAccount = false;
              // states.showGenericAccounts = false;
              // if (destination) {
              //   states.showAccounts = false;
              // }
            }}
          />
        </Modal>
      )}
      {!!snapStates.showOpenLink && (
        <Modal
          onClose={() => {
            states.showOpenLink = false;
          }}
        >
          <OpenLinkSheet
            url={strRequired(p(snapStates.showOpenLink).url)}
            linkText={str(p(snapStates.showOpenLink).linkText)}
            onClose={() => {
              states.showOpenLink = false;
            }}
          />
        </Modal>
      )}
      {isLoggedIn && !!snapStates.showDrafts && (
        <Modal
          onClose={() => {
            states.showDrafts = false;
          }}
        >
          <Drafts
            onClose={() => {
              states.showDrafts = false;
            }}
          />
        </Modal>
      )}
      {!!snapStates.showMediaModal && (
        <Modal
          onClick={(e) => {
            const { target } = e;
            if (
              target === e.currentTarget ||
              (target instanceof HTMLElement &&
                target.classList.contains('media'))
            ) {
              states.showMediaModal = false;
            }
          }}
        >
          <MediaModal
            mediaAttachments={p(snapStates.showMediaModal).mediaAttachments}
            instance={str(p(snapStates.showMediaModal).instance)}
            index={num(p(snapStates.showMediaModal).mediaIndex)}
            statusID={strRequired(p(snapStates.showMediaModal).statusID)}
            onClose={() => {
              states.showMediaModal = false;
            }}
          />
        </Modal>
      )}
      {isLoggedIn && !!snapStates.showShortcutsSettings && (
        <Modal
          onClose={() => {
            states.showShortcutsSettings = false;
          }}
        >
          <ShortcutsSettings
            onClose={() => {
              states.showShortcutsSettings = false;
            }}
          />
        </Modal>
      )}
      {!!snapStates.showGenericAccounts && (
        <Modal
          onClose={() => {
            states.showGenericAccounts = false;
          }}
        >
          <GenericAccounts
            instance={str(p(snapStates.showGenericAccounts).instance)}
            excludeRelationshipAttrs={
              stringArray(
                p(snapStates.showGenericAccounts).excludeRelationshipAttrs,
              )
            }
            postID={str(p(snapStates.showGenericAccounts).postID)}
            onClose={() => {
              states.showGenericAccounts = false;
            }}
            blankCopy={str(p(snapStates.showGenericAccounts).blankCopy)}
          />
        </Modal>
      )}
      {!!snapStates.showMediaAlt && (
        <Modal
          onClose={() => {
            states.showMediaAlt = false;
          }}
        >
          <MediaAltModal
            alt={
              str(p(snapStates.showMediaAlt).alt) ||
              strRequired(snapStates.showMediaAlt)
            }
            lang={str(p(snapStates.showMediaAlt).lang)}
            onClose={() => {
              states.showMediaAlt = false;
            }}
          />
        </Modal>
      )}
      {!!snapStates.showEmbedModal && (
        <Modal
          className="solid"
          onClose={() => {
            states.showEmbedModal = false;
          }}
        >
          <EmbedModal
            html={str(p(snapStates.showEmbedModal).html)}
            url={str(p(snapStates.showEmbedModal).url)}
            iframeUrl={str(p(snapStates.showEmbedModal).iframeUrl)}
            title={str(p(snapStates.showEmbedModal).title)}
            width={strOrNum(p(snapStates.showEmbedModal).width)}
            height={strOrNum(p(snapStates.showEmbedModal).height)}
            onClose={() => {
              states.showEmbedModal = false;
            }}
          />
        </Modal>
      )}
      {!!snapStates.showFeedbackModal && (
        <Modal
          onClose={() => {
            states.showFeedbackModal = false;
          }}
        >
          <FeedbackModal
            defaultMessage={str(p(snapStates.showFeedbackModal).defaultMessage)}
            onClose={() => {
              states.showFeedbackModal = false;
            }}
          />
        </Modal>
      )}
      {isLoggedIn && !!snapStates.showReportModal && reportAccountValue && (
        <Modal
          onClose={() => {
            states.showReportModal = false;
          }}
        >
          <ReportModal
            account={reportAccountValue}
            post={reportPostValue}
            onClose={() => {
              states.showReportModal = false;
            }}
          />
        </Modal>
      )}
      {!!snapStates.showQrCodeModal && (
        <Modal
          className="solid"
          onClose={() => {
            states.showQrCodeModal = false;
          }}
        >
          <QrCodeModal
            text={strRequired(p(snapStates.showQrCodeModal).text)}
            arena={str(p(snapStates.showQrCodeModal).arena)}
            backgroundMask={str(p(snapStates.showQrCodeModal).backgroundMask)}
            caption={str(p(snapStates.showQrCodeModal).caption)}
            onClose={() => {
              states.showQrCodeModal = false;
            }}
            onScannerClick={
              noArgFn(p(snapStates.showQrCodeModal).onScannerClick)
            }
          />
        </Modal>
      )}
      {!!snapStates.showQrScannerModal && (
        <Modal
          className="solid"
          onClose={() => {
            states.showQrScannerModal = false;
          }}
        >
          <QrScannerModal
            checkValidity={
              textValidator(p(snapStates.showQrScannerModal).checkValidity)
            }
            actionableText={str(
              p(snapStates.showQrScannerModal).actionableText,
            )}
            onClose={(arg?: { text: string } | MouseEvent) => {
              const onClose = scannerClose(
                p(snapStates.showQrScannerModal).onClose,
              );
              if (onClose) {
                onClose(arg);
              }
              states.showQrScannerModal = false;
            }}
          />
        </Modal>
      )}
      {isLoggedIn && !!snapStates.showImportExportAccounts && (
        <Modal
          onClose={() => {
            states.showImportExportAccounts = false;
          }}
        >
          <ImportExportAccounts
            onClose={() => {
              states.showImportExportAccounts = false;
            }}
            exportDisabled={
              typeof snapStates.showImportExportAccounts === 'object'
                ? bool(p(snapStates.showImportExportAccounts).exportDisabled)
                : false
            }
          />
        </Modal>
      )}
    </>
  );
}
