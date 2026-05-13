import { Trans } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { api } from '../utils/api';
import { fetchRelationships } from '../utils/relationships';
import supports from '../utils/supports';

import AccountBlock from './account-block';
import Loader from './loader';

interface AccountEndorsementsEndpoint {
  $select(id: string): {
    endorsements: {
      list(params: { limit: number }): Promise<mastodon.v1.Account[]>;
    };
  };
}

const ENDORSEMENTS_LIMIT = 80;

type EndorsementsUIState = 'default' | 'loading' | 'error';

interface EndorsementsProps {
  accountID: string;
  info: { username: string };
  open?: boolean | string;
  onlyOpenIfHasEndorsements?: boolean;
}

function Endorsements({
  accountID: id,
  info,
  open = false,
  onlyOpenIfHasEndorsements = false,
}: EndorsementsProps) {
  const { masto } = api();
  const endorsementsContainer = useRef<HTMLDivElement | null>(null);
  const [endorsementsUIState, setEndorsementsUIState] =
    useState<EndorsementsUIState>('default');
  const [endorsements, setEndorsements] = useState<mastodon.v1.Account[]>([]);
  const [relationshipsMap, setRelationshipsMap] = useState<
    Record<string, mastodon.v1.Relationship>
  >({});

  // `masto.v1.accounts` is a proxy returning fresh references per access;
  // memoize the typed endpoint so the effect's dep list captures a stable
  // reference. The underlying client is stable for the component's lifetime.
  const accountsEndpoint = useMemo(
    () => masto.v1.accounts as unknown as AccountEndorsementsEndpoint,
    [masto],
  );

  // Read the latest `relationshipsMap` inside the effect without subscribing
  // to it — the map is used as a skip-list input to fetchRelationships, and
  // re-running the effect each time we update it would loop indefinitely.
  const relationshipsMapRef = useRef(relationshipsMap);
  useEffect(() => {
    relationshipsMapRef.current = relationshipsMap;
  }, [relationshipsMap]);

  useEffect(() => {
    if (!supports('@mastodon/endorsements')) return;
    if (!open) return;
    void (async () => {
      setEndorsementsUIState('loading');
      try {
        const accounts = await accountsEndpoint.$select(id).endorsements.list({
          limit: ENDORSEMENTS_LIMIT,
        });
        console.log({ endorsements: accounts });
        if (!accounts.length) {
          setEndorsementsUIState('default');
          return;
        }
        setEndorsements(accounts);
        setEndorsementsUIState('default');
        setTimeout(() => {
          endorsementsContainer.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          });
        }, 300);

        const relationships = await fetchRelationships(
          accounts,
          relationshipsMapRef.current,
        );
        if (relationships) {
          setRelationshipsMap(relationships);
        }
      } catch (e) {
        console.error(e);
        setEndorsementsUIState('error');
      }
    })();
  }, [open, id, accountsEndpoint]);

  const reallyOpen = onlyOpenIfHasEndorsements
    ? open && endorsements.length > 0
    : open;

  if (!reallyOpen) return null;

  return (
    <div class="shazam-container">
      <div class="shazam-container-inner">
        <div class="endorsements-container" ref={endorsementsContainer}>
          <h3>
            <Trans>Profiles featured by @{info.username}</Trans>
          </h3>
          {endorsementsUIState === 'loading' ? (
            <p class="ui-state">
              <Loader abrupt />
            </p>
          ) : endorsements.length > 0 ? (
            <ul
              class={`endorsements ${
                endorsements.length > 10 ? 'expanded' : ''
              }`}
            >
              {endorsements.map((account) => (
                <li key={account.id}>
                  <AccountBlock
                    account={account}
                    showStats
                    avatarSize="xxl"
                    relationship={relationshipsMap[account.id]}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p class="ui-state insignificant">
              <Trans>No featured profiles.</Trans>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Endorsements;
