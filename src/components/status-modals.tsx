import states from '../utils/states';

import Modal from './modal';
import PostEmbedModal from './post-embed-modal';
import QuoteChainModal from './quote-chain-modal';
import QuoteSettingsSheet from './quote-settings-sheet';
import QuotesModal from './quotes-modal';
import type { AnyStatus, RenderStatus } from './status-types';

type QuoteSettingsPost = Parameters<typeof QuoteSettingsSheet>[0]['post'];

interface StatusModalsProps {
  showEmbed: boolean;
  setShowEmbed: (value: boolean) => void;
  showQuoteSettings: boolean;
  setShowQuoteSettings: (value: boolean) => void;
  showQuotes: boolean;
  setShowQuotes: (value: boolean) => void;
  showQuoteChain: boolean;
  setShowQuoteChain: (value: boolean) => void;
  status: AnyStatus;
  id: string;
  instance?: string;
  postQuoteApprovalPolicy?: string | null;
  renderStatus: RenderStatus;
}

export default function StatusModals({
  showEmbed,
  setShowEmbed,
  showQuoteSettings,
  setShowQuoteSettings,
  showQuotes,
  setShowQuotes,
  showQuoteChain,
  setShowQuoteChain,
  status,
  id,
  instance,
  postQuoteApprovalPolicy,
  renderStatus,
}: StatusModalsProps) {
  return (
    <>
      {showEmbed && (
        <Modal
          onClose={() => {
            setShowEmbed(false);
          }}
        >
          <PostEmbedModal
            post={status}
            instance={instance}
            onClose={() => {
              setShowEmbed(false);
            }}
          />
        </Modal>
      )}
      {showQuoteSettings && (
        <Modal
          onClose={() => {
            setShowQuoteSettings(false);
            states.reloadStatusPage++;
          }}
        >
          <QuoteSettingsSheet
            onClose={() => {
              setShowQuoteSettings(false);
              states.reloadStatusPage++;
            }}
            post={status as QuoteSettingsPost}
            currentPolicy={postQuoteApprovalPolicy}
            renderStatus={renderStatus}
          />
        </Modal>
      )}
      {showQuotes && (
        <Modal
          onClose={() => {
            setShowQuotes(false);
          }}
        >
          <QuotesModal
            statusId={id}
            instance={instance}
            onClose={() => {
              setShowQuotes(false);
            }}
            renderStatus={renderStatus}
          />
        </Modal>
      )}
      {showQuoteChain && (
        <Modal
          onClose={() => {
            setShowQuoteChain(false);
          }}
        >
          <QuoteChainModal
            statusId={id}
            instance={instance}
            onClose={() => {
              setShowQuoteChain(false);
            }}
            renderStatus={renderStatus}
          />
        </Modal>
      )}
    </>
  );
}
