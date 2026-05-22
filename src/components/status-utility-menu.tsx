import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';

import showToast from '../utils/show-toast';
import { speak, supportsTTS } from '../utils/speech';

import Icon from './icon';
import MenuLink from './menu-link';
import { getPostText } from './status-helpers';
import type { StatusMenuPartsArgs } from './status-menu-types';
import { nicePostURL } from './status-url';

type StatusUtilityMenuProps = Pick<
  StatusMenuPartsArgs,
  | 'mediaFirst'
  | 'enableTranslate'
  | 'language'
  | 'differentLanguage'
  | 'forceTranslate'
  | 'setForceTranslate'
  | 'instance'
  | 'id'
  | 'status'
  | 'isSizeLarge'
  | 'sameInstance'
  | 'onStatusLinkClick'
  | 'username'
  | 'acct'
  | 'createdDateText'
  | 'url'
  | 'isPublic'
  | 'setShowEmbed'
>;

export default function StatusUtilityMenu({
  mediaFirst,
  enableTranslate,
  language,
  differentLanguage,
  forceTranslate,
  setForceTranslate,
  instance,
  id,
  status,
  isSizeLarge,
  sameInstance,
  onStatusLinkClick,
  username,
  acct,
  createdDateText,
  url,
  isPublic,
  setShowEmbed,
}: StatusUtilityMenuProps) {
  const { t } = useLingui();
  const canTranslate =
    !mediaFirst && (enableTranslate || !language || differentLanguage);
  const showViewDivider =
    (!isSizeLarge && sameInstance) ||
    enableTranslate ||
    !language ||
    differentLanguage;

  return (
    <>
      {canTranslate && (
        <div className={supportsTTS ? 'menu-horizontal' : ''}>
          {enableTranslate ? (
            <MenuItem
              disabled={forceTranslate}
              onClick={() => {
                setForceTranslate(true);
              }}
            >
              <Icon icon="translate" />
              <span>
                <Trans>Translate</Trans>
              </span>
            </MenuItem>
          ) : (
            <MenuLink
              to={`${instance ? `/${instance}` : ''}/s/${id}?translate=1`}
            >
              <Icon icon="translate" />
              <span>
                <Trans>Translate</Trans>
              </span>
            </MenuLink>
          )}
          {supportsTTS && (
            <MenuItem
              onClick={() => {
                try {
                  const postText = getPostText(status, {
                    hideInlineQuote: true,
                  });
                  if (postText) {
                    speak(postText, language);
                  }
                } catch (error) {
                  console.error('Failed to speak text:', error);
                }
              }}
            >
              <Icon icon="speak" />
              <span>
                <Trans>Speak</Trans>
              </span>
            </MenuItem>
          )}
        </div>
      )}
      {isSizeLarge && (
        <MenuItem
          onClick={() => {
            void (async () => {
              try {
                const postText = getPostText(status, {
                  hideInlineQuote: true,
                  htmlTextOpts: {
                    truncateLinks: false,
                  },
                });
                await navigator.clipboard.writeText(postText);
                showToast(t`Post text copied`);
              } catch (e) {
                console.error(e);
                showToast(t`Unable to copy post text`);
              }
            })();
          }}
        >
          <Icon icon="clipboard" />
          <span>
            <Trans>Copy post text</Trans>
          </span>
        </MenuItem>
      )}
      {showViewDivider && <MenuDivider />}
      {!isSizeLarge && (
        <MenuLink
          to={instance ? `/${instance}/s/${id}` : `/s/${id}`}
          onClick={(e: React.MouseEvent) => {
            onStatusLinkClick(e, status);
          }}
        >
          <Icon icon="arrows-right" />
          <small>
            <Trans>
              View post by{' '}
              <span className="bidi-isolate">@{username || acct}</span>
            </Trans>
            <br />
            <span className="more-insignificant">{createdDateText}</span>
          </small>
        </MenuLink>
      )}
      <MenuItem href={url || undefined} target="_blank">
        <Icon icon="external" />
        <small
          className="menu-double-lines should-cloak"
          style={{
            maxWidth: '16em',
          }}
        >
          {nicePostURL(url)}
        </small>
      </MenuItem>
      <div className="menu-horizontal">
        <MenuItem
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(url as string);
                showToast(t`Link copied`);
              } catch (e) {
                console.error(e);
                showToast(t`Unable to copy link`);
              }
            })();
          }}
        >
          <Icon icon="link" />
          <span>
            <Trans>Copy</Trans>
          </span>
        </MenuItem>
        {isPublic &&
          navigator?.share &&
          navigator?.canShare?.({
            url: url as string | undefined,
          }) && (
            <MenuItem
              onClick={() => {
                try {
                  void navigator.share({
                    url: url as string | undefined,
                  });
                } catch (e) {
                  console.error(e);
                  alert(t`Sharing doesn't seem to work.`);
                }
              }}
            >
              <Icon icon="share" />
              <span>
                <Trans>Share…</Trans>
              </span>
            </MenuItem>
          )}
      </div>
      {isPublic && isSizeLarge && (
        <MenuItem
          onClick={() => {
            setShowEmbed(true);
          }}
        >
          <Icon icon="code" />
          <span>
            <Trans>Embed post</Trans>
          </span>
        </MenuItem>
      )}
    </>
  );
}
