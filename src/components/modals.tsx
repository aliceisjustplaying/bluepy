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
  return <MediaModalComponent {...(props as MediaModalProps)} />;
}

// `show*` payloads in `states` are typed as `unknown` because the same key
// holds either `false` or a payload object describing what to render. Cast
// to `Payload` (loose record) at the read site rather than introducing many
// narrow interfaces.
type Payload = Record<string, unknown>;
const p = (v: unknown): Payload => (v as Payload) || ({} as Payload);

type WindowWithCompose = Window & {
  __COMPOSE__?: Payload | null;
  __SHARED_DATA__?: unknown;
};

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

  useEffect(() => {
    if (!snapStates.showGenericAccounts) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        states.showGenericAccounts = false;
      }
    };
    document.addEventListener('keydown', closeOnEscape, { capture: true });
    document.addEventListener('keyup', closeOnEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', closeOnEscape, { capture: true });
      document.removeEventListener('keyup', closeOnEscape, { capture: true });
    };
  }, [snapStates.showGenericAccounts]);

  const composerState = snapStates.composerState as Payload;
  const composeWindow = window as WindowWithCompose;

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
                : composeWindow.__COMPOSE__?.replyToStatus || null
            }
            editStatus={
              p(states.showCompose).editStatus ||
              composeWindow.__COMPOSE__?.editStatus ||
              null
            }
            draftStatus={
              p(states.showCompose).draftStatus ||
              composeWindow.__COMPOSE__?.draftStatus ||
              null
            }
            quoteStatus={
              p(states.showCompose).quoteStatus ||
              composeWindow.__COMPOSE__?.quoteStatus ||
              null
            }
            sharedData={composeWindow.__SHARED_DATA__ || null}
            onClose={(results: Payload | undefined) => {
              const { newStatus, instance, type } = (results || {}) as {
                newStatus?: { id: string } | null;
                instance?: string | null;
                type?: 'post' | 'reply' | 'edit';
              };
              states.showCompose = false;
              composeWindow.__COMPOSE__ = null;
              composeWindow.__SHARED_DATA__ = null;
              if (newStatus) {
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
                          ? `/${instance}/s/${newStatus.id}`
                          : `/s/${newStatus.id}`,
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
      {!!snapStates.showAccount && (
        <Modal
          onClose={() => {
            states.showAccount = false;
          }}
        >
          <AccountSheet
            account={
              (p(snapStates.showAccount).account ||
                snapStates.showAccount) as Parameters<
                typeof AccountSheet
              >[0]['account']
            }
            instance={p(snapStates.showAccount).instance as string | undefined}
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
            url={p(snapStates.showOpenLink).url as string}
            linkText={p(snapStates.showOpenLink).linkText as string | undefined}
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
            const target = e.target as HTMLElement | null;
            if (
              target === e.currentTarget ||
              target?.classList?.contains('media')
            ) {
              states.showMediaModal = false;
            }
          }}
        >
          <MediaModal
            mediaAttachments={p(snapStates.showMediaModal).mediaAttachments}
            instance={
              p(snapStates.showMediaModal).instance as string | undefined
            }
            index={p(snapStates.showMediaModal).mediaIndex as number}
            statusID={p(snapStates.showMediaModal).statusID as string}
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
            instance={
              p(snapStates.showGenericAccounts).instance as string | undefined
            }
            excludeRelationshipAttrs={
              p(snapStates.showGenericAccounts).excludeRelationshipAttrs as
                | readonly string[]
                | undefined
            }
            postID={
              p(snapStates.showGenericAccounts).postID as string | undefined
            }
            onClose={() => {
              states.showGenericAccounts = false;
            }}
            blankCopy={
              p(snapStates.showGenericAccounts).blankCopy as string | undefined
            }
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
              (p(snapStates.showMediaAlt).alt ||
                snapStates.showMediaAlt) as string
            }
            lang={p(snapStates.showMediaAlt).lang as string | undefined}
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
            html={p(snapStates.showEmbedModal).html as string | undefined}
            url={p(snapStates.showEmbedModal).url as string | undefined}
            iframeUrl={
              p(snapStates.showEmbedModal).iframeUrl as string | undefined
            }
            title={p(snapStates.showEmbedModal).title as string | undefined}
            width={
              p(snapStates.showEmbedModal).width as number | string | undefined
            }
            height={
              p(snapStates.showEmbedModal).height as number | string | undefined
            }
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
            defaultMessage={
              p(snapStates.showFeedbackModal).defaultMessage as
                | string
                | undefined
            }
            onClose={() => {
              states.showFeedbackModal = false;
            }}
          />
        </Modal>
      )}
      {isLoggedIn && !!snapStates.showReportModal && (
        <Modal
          onClose={() => {
            states.showReportModal = false;
          }}
        >
          <ReportModal
            account={
              p(snapStates.showReportModal).account as Parameters<
                typeof ReportModal
              >[0]['account']
            }
            post={
              p(snapStates.showReportModal).post as Parameters<
                typeof ReportModal
              >[0]['post']
            }
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
            text={p(snapStates.showQrCodeModal).text as string}
            arena={p(snapStates.showQrCodeModal).arena as string | undefined}
            backgroundMask={
              p(snapStates.showQrCodeModal).backgroundMask as string | undefined
            }
            caption={
              p(snapStates.showQrCodeModal).caption as string | undefined
            }
            onClose={() => {
              states.showQrCodeModal = false;
            }}
            onScannerClick={
              p(snapStates.showQrCodeModal).onScannerClick as
                | (() => void)
                | undefined
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
              p(snapStates.showQrScannerModal).checkValidity as
                | ((text: string) => boolean)
                | undefined
            }
            actionableText={
              p(snapStates.showQrScannerModal).actionableText as
                | string
                | undefined
            }
            onClose={(arg?: { text: string } | MouseEvent) => {
              const onClose = p(snapStates.showQrScannerModal).onClose as
                | ((arg?: { text: string } | MouseEvent) => void)
                | undefined;
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
                ? (p(snapStates.showImportExportAccounts).exportDisabled as
                    | boolean
                    | undefined)
                : false
            }
          />
        </Modal>
      )}
    </>
  );
}
