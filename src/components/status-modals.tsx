import type { ReactNode, RefObject } from 'react';

import Modal from './modal';
import PostEmbedModal from './post-embed-modal';
import QuoteChainModal from './quote-chain-modal';
import QuotesModal from './quotes-modal';
import EditedAtModal from './status-edit-history-modal';
import type { AnyStatus, RenderStatus } from './status-types';

interface StatusModalsProps {
  showEdited: string | false;
  setShowEdited: (value: string | false) => void;
  showEmbed: boolean;
  setShowEmbed: (value: boolean) => void;
  showQuotes: boolean;
  setShowQuotes: (value: boolean) => void;
  showQuoteChain: boolean;
  setShowQuoteChain: (value: boolean) => void;
  status: AnyStatus;
  id: string;
  instance?: string;
  fetchStatusHistory: (statusID: string) => Promise<AnyStatus[] | undefined>;
  renderHistoryStatus: (
    historyStatus: AnyStatus,
    historyInstance?: string,
  ) => ReactNode;
  statusRef: RefObject<HTMLElement | null>;
  renderStatus: RenderStatus;
}

export default function StatusModals({
  showEdited,
  setShowEdited,
  showEmbed,
  setShowEmbed,
  showQuotes,
  setShowQuotes,
  showQuoteChain,
  setShowQuoteChain,
  status,
  id,
  instance,
  fetchStatusHistory,
  renderHistoryStatus,
  statusRef,
  renderStatus,
}: StatusModalsProps) {
  return (
    <>
      {!!showEdited && (
        <Modal
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowEdited(false);
            }
          }}
        >
          <EditedAtModal
            statusID={showEdited}
            instance={instance}
            fetchStatusHistory={() => fetchStatusHistory(showEdited)}
            renderStatus={renderHistoryStatus}
            onClose={() => {
              setShowEdited(false);
              statusRef.current?.focus();
            }}
          />
        </Modal>
      )}
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
