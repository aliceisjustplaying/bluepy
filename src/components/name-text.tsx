import './name-text.css';

import { useLingui } from '@lingui/react';

import { api } from '../utils/api';
import mem from '../utils/mem';
import { canonicalizeAppPath } from '../utils/router';
import states from '../utils/states';

import Avatar from './avatar';
import EmojiText from './emoji-text';
import RolesTags from './roles-tags';

interface NameTextEmoji {
  shortcode: string;
  url: string;
  staticUrl?: string;
}

interface NameTextRole {
  name?: string;
}

export interface NameTextAccount {
  acct: string;
  avatar?: string;
  avatarStatic?: string;
  id: string;
  url: string;
  displayName?: string;
  emojis?: readonly NameTextEmoji[];
  bot?: boolean;
  username: string;
  roles?: NameTextRole[] | null;
  [key: string]: unknown;
}

export interface NameTextProps {
  account: NameTextAccount | null | undefined;
  instance?: string;
  showAvatar?: boolean;
  showAcct?: boolean;
  short?: boolean;
  external?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => unknown;
}

const nameCollator = mem((locale: string | undefined) => {
  const options: Intl.CollatorOptions = {
    sensitivity: 'base',
  };
  try {
    return new Intl.Collator(locale || undefined, options);
  } catch {
    return new Intl.Collator(undefined, options);
  }
});

const ACCT_REGEX = /([^@]+)(@.+)/i;
const SHORTCODES_REGEX = /(:(\w|\+|-)+:)(?=|[!.?]|$)/g;
const SPACES_REGEX = /\s+/g;
const NON_ALPHA_NUMERIC_REGEX = /[^a-z0-9@.]/gi;

function NameText({
  account,
  instance,
  showAvatar,
  showAcct,
  short,
  external,
  onClick,
}: NameTextProps) {
  const { i18n } = useLingui();
  if (!account) return null;
  const {
    acct,
    avatar,
    avatarStatic,
    id,
    url,
    displayName,
    bot,
    username,
    roles,
  } = account;
  const [, acct1, acct2] = acct.match(ACCT_REGEX) || [undefined, acct];

  if (!instance) instance = api().instance;

  const trimmedUsername = username.toLowerCase().trim();
  const trimmedDisplayName = (displayName || '').toLowerCase().trim();
  const shortenedDisplayName = trimmedDisplayName
    .replace(SHORTCODES_REGEX, '') // Remove shortcodes, regex from https://regex101.com/r/iE9uV0/1
    .replace(SPACES_REGEX, ''); // E.g. "My name" === "myname"
  const shortenedAlphaNumericDisplayName = shortenedDisplayName.replace(
    NON_ALPHA_NUMERIC_REGEX,
    '',
  ); // Remove non-alphanumeric characters

  const hideUsername =
    (!short &&
      (trimmedUsername === trimmedDisplayName ||
        trimmedUsername === shortenedDisplayName ||
        trimmedUsername === shortenedAlphaNumericDisplayName ||
        nameCollator(i18n.locale).compare(
          trimmedUsername,
          shortenedDisplayName,
        ) === 0)) ||
    shortenedAlphaNumericDisplayName === acct.toLowerCase();

  return (
    <a
      className={`name-text ${showAcct ? 'show-acct' : ''} ${short ? 'short' : ''}`}
      href={url}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      title={
        displayName
          ? `${displayName} (${acct2 ? '' : '@'}${acct})`
          : `${acct2 ? '' : '@'}${acct}`
      }
      onClick={(e) => {
        if (external) return;
        if (e.shiftKey) return; // Save link? 🤷‍♂️
        e.preventDefault();
        e.stopPropagation();
        if (onClick) {
          onClick(e);
          return;
        }
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
          const internalURL = canonicalizeAppPath(`/${instance}/a/${id}`);
          window.open(internalURL, '_blank');
          return;
        }
        states.showAccount = {
          account,
          instance,
        };
      }}
    >
      {showAvatar && (
        <>
          <Avatar url={avatarStatic || avatar} squircle={bot} />{' '}
        </>
      )}
      {displayName && !short ? (
        <>
          <b dir="auto">
            <EmojiText text={displayName} />
          </b>
          {!showAcct && !hideUsername && (
            <>
              {' '}
              <i className="bidi-isolate">@{username}</i>
              <RolesTags
                roles={roles}
                accountId={id}
                accountUrl={url}
                hideSelf
              />
            </>
          )}
        </>
      ) : short ? (
        <i>{username}</i>
      ) : (
        <b>{username}</b>
      )}
      {showAcct && (
        <>
          <br />
          <i className="bidi-isolate">
            {acct2 ? '' : '@'}
            {acct1}
            {!!acct2 && <span className="ib">{acct2}</span>}
          </i>
          <RolesTags roles={roles} accountUrl={url} />
        </>
      )}
    </a>
  );
}

export default NameText;
