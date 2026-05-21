import type { MessageDescriptor } from '@lingui/core';
import { useLingui } from '@lingui/react/macro';
import { useEffect } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import { subscribe, type Snapshot, useSnapshot } from 'valtio';

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
type StatesSnapshot = Snapshot<typeof states>;
const p = (v: unknown): Payload =>
  v !== null && typeof v === 'object' ? { ...v } : {};
const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const msgDescriptor = (value: unknown): MessageDescriptor | undefined =>
  isRecord(value) && typeof value.id === 'string'
    ? {
        id: value.id,
        comment: str(value.comment),
        message: str(value.message),
        values: isRecord(value.values) ? value.values : undefined,
      }
    : undefined;
const strOrMsg = (value: unknown): string | MessageDescriptor | undefined =>
  str(value) ?? msgDescriptor(value);
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

function reportPost(value: unknown): Parameters<typeof ReportModal>[0]['post'] {
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

function ComposeModal({
  composerState,
  showCompose,
}: {
  composerState: Payload;
  showCompose: unknown;
}) {
  const { t } = useLingui();
  const location = useLocation();

  const composePayload = p(Reflect.get(window, '__COMPOSE__'));
  const sharedData = Reflect.get(window, '__SHARED_DATA__') || null;

  return (
    <Modal
      className={`solid ${composerState.minimized ? 'min' : ''}`}
      minimized={!!composerState.minimized}
    >
      <ComposeSuspense
        replyToStatus={
          typeof showCompose !== 'boolean'
            ? p(showCompose).replyToStatus
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
          const afterClose = noArgFn(resultPayload.fn);
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
          afterClose?.();
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
  );
}

function SettingsModal() {
  return (
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
  );
}

function AccountsModal() {
  return (
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
  );
}

function AccountModal({ showAccount }: { showAccount: unknown }) {
  const showAccountPayload = p(showAccount);
  const showAccountValue = accountSheetAccount(
    showAccountPayload.account || showAccount,
  );

  if (!showAccountValue) return null;

  return (
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
  );
}

function OpenLinkModal({ showOpenLink }: { showOpenLink: unknown }) {
  const showOpenLinkPayload = p(showOpenLink);

  return (
    <Modal
      onClose={() => {
        states.showOpenLink = false;
      }}
    >
      <OpenLinkSheet
        url={strRequired(showOpenLinkPayload.url)}
        linkText={str(showOpenLinkPayload.linkText)}
        onClose={() => {
          states.showOpenLink = false;
        }}
      />
    </Modal>
  );
}

function DraftsModal() {
  return (
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
  );
}

function ActiveMediaModal({ showMediaModal }: { showMediaModal: unknown }) {
  const showMediaModalPayload = p(showMediaModal);

  return (
    <Modal
      onClick={(e) => {
        const { target } = e;
        if (
          target === e.currentTarget ||
          (target instanceof HTMLElement && target.classList.contains('media'))
        ) {
          states.showMediaModal = false;
        }
      }}
    >
      <MediaModal
        mediaAttachments={showMediaModalPayload.mediaAttachments}
        instance={str(showMediaModalPayload.instance)}
        index={num(showMediaModalPayload.mediaIndex)}
        statusID={strRequired(showMediaModalPayload.statusID)}
        onClose={() => {
          states.showMediaModal = false;
        }}
      />
    </Modal>
  );
}

function ShortcutsSettingsModal() {
  return (
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
  );
}

function GenericAccountsModal({
  showGenericAccounts,
}: {
  showGenericAccounts: unknown;
}) {
  const showGenericAccountsPayload = p(showGenericAccounts);

  return (
    <Modal
      onClose={() => {
        states.showGenericAccounts = false;
      }}
    >
      <GenericAccounts
        instance={str(showGenericAccountsPayload.instance)}
        excludeRelationshipAttrs={stringArray(
          showGenericAccountsPayload.excludeRelationshipAttrs,
        )}
        postID={str(showGenericAccountsPayload.postID)}
        onClose={() => {
          states.showGenericAccounts = false;
        }}
        blankCopy={str(showGenericAccountsPayload.blankCopy)}
      />
    </Modal>
  );
}

function MediaAltModalView({ showMediaAlt }: { showMediaAlt: unknown }) {
  const showMediaAltPayload = p(showMediaAlt);

  return (
    <Modal
      onClose={() => {
        states.showMediaAlt = false;
      }}
    >
      <MediaAltModal
        alt={str(showMediaAltPayload.alt) || strRequired(showMediaAlt)}
        lang={str(showMediaAltPayload.lang)}
        onClose={() => {
          states.showMediaAlt = false;
        }}
      />
    </Modal>
  );
}

function EmbedModalView({ showEmbedModal }: { showEmbedModal: unknown }) {
  const showEmbedModalPayload = p(showEmbedModal);

  return (
    <Modal
      className="solid"
      onClose={() => {
        states.showEmbedModal = false;
      }}
    >
      <EmbedModal
        html={str(showEmbedModalPayload.html)}
        url={str(showEmbedModalPayload.url)}
        iframeUrl={str(showEmbedModalPayload.iframeUrl)}
        title={str(showEmbedModalPayload.title)}
        width={strOrNum(showEmbedModalPayload.width)}
        height={strOrNum(showEmbedModalPayload.height)}
        onClose={() => {
          states.showEmbedModal = false;
        }}
      />
    </Modal>
  );
}

function FeedbackModalView({
  showFeedbackModal,
}: {
  showFeedbackModal: unknown;
}) {
  return (
    <Modal
      onClose={() => {
        states.showFeedbackModal = false;
      }}
    >
      <FeedbackModal
        defaultMessage={str(p(showFeedbackModal).defaultMessage)}
        onClose={() => {
          states.showFeedbackModal = false;
        }}
      />
    </Modal>
  );
}

function ActiveReportModal({ showReportModal }: { showReportModal: unknown }) {
  const reportPayload = p(showReportModal);
  const reportAccountValue = reportAccount(reportPayload.account);
  const reportPostValue = reportPost(reportPayload.post);

  if (!reportAccountValue) return null;

  return (
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
  );
}

function QrCodeModalView({ showQrCodeModal }: { showQrCodeModal: unknown }) {
  const showQrCodeModalPayload = p(showQrCodeModal);

  return (
    <Modal
      className="solid"
      onClose={() => {
        states.showQrCodeModal = false;
      }}
    >
      <QrCodeModal
        text={strRequired(showQrCodeModalPayload.text)}
        arena={str(showQrCodeModalPayload.arena)}
        backgroundMask={str(showQrCodeModalPayload.backgroundMask)}
        caption={str(showQrCodeModalPayload.caption)}
        onClose={() => {
          states.showQrCodeModal = false;
        }}
        onScannerClick={noArgFn(showQrCodeModalPayload.onScannerClick)}
      />
    </Modal>
  );
}

function QrScannerModalView({
  showQrScannerModal,
}: {
  showQrScannerModal: unknown;
}) {
  const showQrScannerModalPayload = p(showQrScannerModal);

  return (
    <Modal
      className="solid"
      onClose={() => {
        states.showQrScannerModal = false;
      }}
    >
      <QrScannerModal
        checkValidity={textValidator(showQrScannerModalPayload.checkValidity)}
        actionableText={strOrMsg(showQrScannerModalPayload.actionableText)}
        onClose={(arg?: { text: string } | MouseEvent) => {
          const onClose = scannerClose(showQrScannerModalPayload.onClose);
          if (onClose) {
            onClose(arg);
          }
          states.showQrScannerModal = false;
        }}
      />
    </Modal>
  );
}

function ImportExportAccountsModal({
  showImportExportAccounts,
}: {
  showImportExportAccounts: unknown;
}) {
  return (
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
          typeof showImportExportAccounts === 'object'
            ? bool(p(showImportExportAccounts).exportDisabled)
            : false
        }
      />
    </Modal>
  );
}

function OrderedModals({
  isLoggedIn,
  snapStates,
}: {
  isLoggedIn: boolean;
  snapStates: StatesSnapshot;
}) {
  const composerState = p(snapStates.composerState);

  return (
    <>
      {isLoggedIn && !!snapStates.showCompose && (
        <ComposeModal
          composerState={composerState}
          showCompose={snapStates.showCompose}
        />
      )}
      {isLoggedIn && !!snapStates.showSettings && <SettingsModal />}
      {isLoggedIn && !!snapStates.showAccounts && <AccountsModal />}
      {!!snapStates.showAccount && (
        <AccountModal showAccount={snapStates.showAccount} />
      )}
      {!!snapStates.showOpenLink && (
        <OpenLinkModal showOpenLink={snapStates.showOpenLink} />
      )}
      {isLoggedIn && !!snapStates.showDrafts && <DraftsModal />}
      {!!snapStates.showMediaModal && (
        <ActiveMediaModal showMediaModal={snapStates.showMediaModal} />
      )}
      {isLoggedIn && !!snapStates.showShortcutsSettings && (
        <ShortcutsSettingsModal />
      )}
      {!!snapStates.showGenericAccounts && (
        <GenericAccountsModal
          showGenericAccounts={snapStates.showGenericAccounts}
        />
      )}
      {!!snapStates.showMediaAlt && (
        <MediaAltModalView showMediaAlt={snapStates.showMediaAlt} />
      )}
      {!!snapStates.showEmbedModal && (
        <EmbedModalView showEmbedModal={snapStates.showEmbedModal} />
      )}
      {!!snapStates.showFeedbackModal && (
        <FeedbackModalView showFeedbackModal={snapStates.showFeedbackModal} />
      )}
      {isLoggedIn && !!snapStates.showReportModal && (
        <ActiveReportModal showReportModal={snapStates.showReportModal} />
      )}
      {!!snapStates.showQrCodeModal && (
        <QrCodeModalView showQrCodeModal={snapStates.showQrCodeModal} />
      )}
      {!!snapStates.showQrScannerModal && (
        <QrScannerModalView
          showQrScannerModal={snapStates.showQrScannerModal}
        />
      )}
      {isLoggedIn && !!snapStates.showImportExportAccounts && (
        <ImportExportAccountsModal
          showImportExportAccounts={snapStates.showImportExportAccounts}
        />
      )}
    </>
  );
}

export default function Modals() {
  const snapStates = useSnapshot(states);
  const isLoggedIn = useAuth();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void preload();
    }, 1000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <>
      <OrderedModals isLoggedIn={isLoggedIn} snapStates={snapStates} />
    </>
  );
}
