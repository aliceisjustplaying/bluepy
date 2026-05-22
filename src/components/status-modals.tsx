import Modal from './modal';
import PostEmbedModal from './post-embed-modal';
import QuoteChainModal from './quote-chain-modal';
import QuotesModal from './quotes-modal';
import type { AnyStatus, RenderStatus } from './status-types';

interface StatusModalsProps {
  showEmbed: boolean;
  setShowEmbed: (value: boolean) => void;
  showQuotes: boolean;
  setShowQuotes: (value: boolean) => void;
  showQuoteChain: boolean;
  setShowQuoteChain: (value: boolean) => void;
  status: AnyStatus;
  id: string;
  instance?: string;
  renderStatus: RenderStatus;
}

export default function StatusModals({
  showEmbed,
  setShowEmbed,
  showQuotes,
  setShowQuotes,
  showQuoteChain,
  setShowQuoteChain,
  status,
  id,
  instance,
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
