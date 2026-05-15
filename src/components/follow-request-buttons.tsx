import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'preact/hooks';

import { api } from '../utils/api';
import haptics from '../utils/haptics';

import Icon from './icon';
import Loader from './loader';

export interface FollowRequestButtonsProps {
  accountID: string;
  onChange?: () => void;
}

type RequestState = 'accept' | 'reject' | null;
type Relationship = { followedBy?: boolean } | null;

interface FollowRequestsResource {
  $select(id: string): {
    authorize(): Promise<Relationship>;
    reject(): Promise<Relationship>;
  };
}

function FollowRequestButtons({
  accountID,
  onChange,
}: FollowRequestButtonsProps) {
  const { t } = useLingui();
  const { masto } = api();
  const followRequests = masto.v1.followRequests as FollowRequestsResource;
  const [uiState, setUIState] = useState('default');
  const [requestState, setRequestState] = useState<RequestState>(null); // accept, reject
  const [relationship, setRelationship] = useState<Relationship>(null);

  const hasRelationship = relationship !== null;

  return (
    <p class="follow-request-buttons">
      <button
        type="button"
        disabled={uiState === 'loading' || hasRelationship}
        onClick={() => {
          void haptics.trigger('success');
          setUIState('loading');
          setRequestState('accept');
          void (async () => {
            try {
              const rel = await followRequests.$select(accountID).authorize();
              if (!rel?.followedBy) {
                throw new Error('Follow request not accepted');
              }
              setRelationship(rel);
              onChange?.();
            } catch (e) {
              console.error(e);
            }
            setUIState('default');
          })();
        }}
      >
        <Trans>Accept</Trans>
      </button>{' '}
      <button
        type="button"
        disabled={uiState === 'loading' || hasRelationship}
        class="light danger"
        onClick={() => {
          void haptics.trigger('light');
          setUIState('loading');
          setRequestState('reject');
          void (async () => {
            try {
              const rel = await followRequests.$select(accountID).reject();
              if (rel?.followedBy) {
                throw new Error('Follow request not rejected');
              }
              setRelationship(rel);
              onChange?.();
            } catch (e) {
              console.error(e);
              setUIState('default');
            }
          })();
        }}
      >
        <Trans>Reject</Trans>
      </button>
      <span class="follow-request-states">
        {hasRelationship && requestState ? (
          requestState === 'accept' ? (
            <Icon
              icon="check-circle"
              alt={t`Accepted`}
              class="follow-accepted"
            />
          ) : (
            <Icon icon="x-circle" alt={t`Rejected`} class="follow-rejected" />
          )
        ) : (
          <Loader hidden={uiState !== 'loading'} />
        )}
      </span>
    </p>
  );
}

export default FollowRequestButtons;
