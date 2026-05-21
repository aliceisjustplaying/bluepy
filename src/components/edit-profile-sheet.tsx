import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { Ref } from 'react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { api, getMastoV1Resource } from '../utils/api';
import states from '../utils/states';

import Icon from './icon';
import Loader from './loader';

const SUPPORTED_IMAGE_FORMATS = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];
const SUPPORTED_IMAGE_FORMATS_STR = SUPPORTED_IMAGE_FORMATS.join(',');

type ProfileField = Partial<mastodon.v1.AccountField> & {
  [key: string]: unknown;
};

type ProfileAccount = mastodon.v1.AccountCredentials & {
  [key: string]: unknown;
};

interface MastoAccountsUpdate {
  verifyCredentials(): Promise<ProfileAccount | null | undefined>;
  updateCredentials(params: {
    header?: FormDataEntryValue | null;
    avatar?: FormDataEntryValue | null;
    displayName?: FormDataEntryValue | null;
    note?: FormDataEntryValue | null;
    fieldsAttributes: ProfileField[];
  }): Promise<ProfileAccount>;
}

interface FieldsAttributesRowProps {
  name?: string;
  value?: string;
  disabled?: boolean;
  index: number;
}

interface EditProfileFieldsTableProps {
  ref?: Ref<HTMLTableElement>;
  fields: readonly mastodon.v1.AccountField[];
  disabled?: boolean;
}

interface EditProfileActionsProps {
  disabled?: boolean;
  onCancel: () => void;
}

interface EditProfileSheetCloseResult {
  state: 'success';
  account: ProfileAccount;
}

export interface EditProfileSheetProps {
  onClose?: (result?: EditProfileSheetCloseResult) => void;
}

type ProfileUIState = 'default' | 'error' | 'loading';

interface ProfileState {
  uiState: ProfileUIState;
  account: ProfileAccount | null;
}

type ProfileAction =
  | { type: 'loaded'; account: ProfileAccount | null }
  | { type: 'error' };

function profileReducer(
  state: ProfileState,
  action: ProfileAction,
): ProfileState {
  switch (action.type) {
    case 'loaded':
      return { uiState: 'default', account: action.account };
    case 'error':
      return { ...state, uiState: 'error' };
  }
  return state;
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function FieldsAttributesRow({
  name,
  value,
  disabled,
  index: i,
}: FieldsAttributesRowProps) {
  const [hasValue, setHasValue] = useState(!!value);
  return (
    <tr>
      <td>
        <input
          type="text"
          name={`fields_attributes[${i}][name]`}
          defaultValue={name}
          disabled={disabled}
          maxLength={255}
          required={hasValue}
          dir="auto"
          enterKeyHint="done"
        />
      </td>
      <td>
        <input
          type="text"
          name={`fields_attributes[${i}][value]`}
          defaultValue={value}
          disabled={disabled}
          maxLength={255}
          onChange={(e) => {
            setHasValue(!!e.currentTarget.value);
          }}
          dir="auto"
          enterKeyHint="done"
        />
      </td>
    </tr>
  );
}

function EditProfileFieldsTable({
  ref,
  fields,
  disabled,
}: EditProfileFieldsTableProps) {
  return (
    <table ref={ref}>
      <thead>
        <tr>
          <th>
            <Trans>Label</Trans>
          </th>
          <th>
            <Trans>Content</Trans>
          </th>
        </tr>
      </thead>
      <tbody>
        {Array.from({
          length: Math.max(4, fields.length),
        }).map((_, i) => {
          const field = fields[i];
          return (
            <FieldsAttributesRow
              key={i}
              name={field?.name ?? ''}
              value={field?.value ?? ''}
              index={i}
              disabled={disabled}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function EditProfileActions({ disabled, onCancel }: EditProfileActionsProps) {
  return (
    <footer>
      <button
        type="button"
        className="light"
        disabled={disabled}
        onClick={onCancel}
      >
        <Trans>Cancel</Trans>
      </button>
      <button type="submit" disabled={disabled}>
        <Trans>Save</Trans>
      </button>
    </footer>
  );
}

function EditProfileSheet({ onClose = () => {} }: EditProfileSheetProps) {
  const { t } = useLingui();
  const { masto } = api();
  const [{ uiState, account }, dispatchProfile] = useReducer(profileReducer, {
    uiState: 'loading',
    account: null,
  });
  const [headerPreview, setHeaderPreview] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const isProfileLoading = uiState === ('loading' as ProfileUIState);

  // `masto.v1.accounts` is a proxy returning a fresh reference on every
  // property access; depending on the raw expression would re-fire this
  // effect every render. Snapshot it once — the underlying client is stable
  // for the sheet's lifetime — and use the memoized reference as the dep.
  const accountsApi = useMemo(
    () => getMastoV1Resource<MastoAccountsUpdate>(masto, 'accounts'),
    [masto],
  );

  useEffect(() => {
    void (async () => {
      try {
        const acc = await accountsApi.verifyCredentials();
        dispatchProfile({ type: 'loaded', account: acc ?? null });
      } catch (err) {
        console.error(err);
        dispatchProfile({ type: 'error' });
      }
    })();
  }, [accountsApi]);

  console.log('EditProfileSheet', account);
  const { displayName, source, avatar, header } = account || {};
  const { note, fields } = source || {};
  const profileFields = Array.isArray(fields) ? fields : [];
  const fieldsAttributesRef = useRef<HTMLTableElement | null>(null);

  const avatarMediaAttachments = [
    ...(avatar ? [{ type: 'image', url: avatar }] : []),
    ...(avatarPreview ? [{ type: 'image', url: avatarPreview }] : []),
  ];
  const headerMediaAttachments = [
    ...(header ? [{ type: 'image', url: header }] : []),
    ...(headerPreview ? [{ type: 'image', url: headerPreview }] : []),
  ];

  return (
    <div className="sheet" id="edit-profile-container">
      {!!onClose && (
        <button
          type="button"
          className="sheet-close"
          onClick={() => {
            onClose();
          }}
        >
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <b>
          <Trans>Edit profile</Trans>
        </b>
      </header>
      <main>
        {uiState === 'loading' ? (
          <p className="ui-state">
            <Loader abrupt />
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const headerField = formData.get('header');
              const avatarField = formData.get('avatar');
              const displayNameField = formData.get('display_name');
              const noteField = formData.get('note');
              const fieldsAttributesFields =
                fieldsAttributesRef.current?.querySelectorAll<HTMLInputElement>(
                  'input[name^="fields_attributes"]',
                );
              const fieldsAttributes: ProfileField[] = [];
              fieldsAttributesFields?.forEach((field) => {
                const fieldName = field.name;
                const [, indexStr, key] =
                  fieldName.match(/fields_attributes\[(\d+)\]\[(.+)\]/) || [];
                const value = field.value ? field.value.trim() : '';
                if (indexStr && key && value) {
                  const idx = Number(indexStr);
                  if (!fieldsAttributes[idx]) fieldsAttributes[idx] = {};
                  fieldsAttributes[idx][key] = value;
                }
              });
              // Fill in the blanks
              fieldsAttributes.forEach((field) => {
                if (field.name && !field.value) {
                  field.value = '';
                }
              });

              void (async () => {
                try {
                  const newAccount = await accountsApi.updateCredentials({
                    header: headerField,
                    avatar: avatarField,
                    displayName: displayNameField,
                    note: noteField,
                    fieldsAttributes,
                  });
                  console.log('updated account', newAccount);
                  onClose?.({
                    state: 'success',
                    account: newAccount,
                  });
                } catch (err) {
                  console.error(err);
                  const message = errorMessage(err);
                  alert(message || t`Unable to update profile.`);
                }
              })();
            }}
          >
            <div className="edit-profile-media-container">
              <label>
                <Trans>Header picture</Trans>{' '}
                <input
                  type="file"
                  name="header"
                  accept={SUPPORTED_IMAGE_FORMATS_STR}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) {
                      const blob = URL.createObjectURL(file);
                      setHeaderPreview(blob);
                    }
                  }}
                />
              </label>
              <div className="edit-profile-media-field">
                {header ? (
                  <button
                    type="button"
                    className="edit-media plain"
                    style={{
                      padding: 0,
                      backgroundColor: 'transparent',
                      font: 'inherit',
                      lineHeight: 0,
                    }}
                    onClick={() => {
                      states.showMediaModal = {
                        mediaAttachments: headerMediaAttachments,
                        mediaIndex: 0,
                      };
                    }}
                  >
                    <img src={header} alt="" />
                  </button>
                ) : (
                  <div className="edit-media"></div>
                )}
                {headerPreview && (
                  <>
                    <Icon icon="arrow-right" />
                    <button
                      type="button"
                      className="edit-media plain"
                      style={{
                        padding: 0,
                        backgroundColor: 'transparent',
                        font: 'inherit',
                        lineHeight: 0,
                      }}
                      onClick={() => {
                        states.showMediaModal = {
                          mediaAttachments: headerMediaAttachments,
                          mediaIndex: 1,
                        };
                      }}
                    >
                      <img src={headerPreview} alt="" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="edit-profile-media-container">
              <label>
                <Trans>Profile picture</Trans>{' '}
                <input
                  type="file"
                  name="avatar"
                  accept={SUPPORTED_IMAGE_FORMATS_STR}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) {
                      const blob = URL.createObjectURL(file);
                      setAvatarPreview(blob);
                    }
                  }}
                />
              </label>
              <div className="edit-profile-media-field">
                {avatar ? (
                  <button
                    type="button"
                    className="edit-media plain"
                    style={{
                      padding: 0,
                      backgroundColor: 'transparent',
                      font: 'inherit',
                      lineHeight: 0,
                    }}
                    onClick={() => {
                      states.showMediaModal = {
                        mediaAttachments: avatarMediaAttachments,
                        mediaIndex: 0,
                      };
                    }}
                  >
                    <img src={avatar} alt="" />
                  </button>
                ) : (
                  <div className="edit-media"></div>
                )}
                {avatarPreview && (
                  <>
                    <Icon icon="arrow-right" />
                    <button
                      type="button"
                      className="edit-media plain"
                      style={{
                        padding: 0,
                        backgroundColor: 'transparent',
                        font: 'inherit',
                        lineHeight: 0,
                      }}
                      onClick={() => {
                        states.showMediaModal = {
                          mediaAttachments: avatarMediaAttachments,
                          mediaIndex: 1,
                        };
                      }}
                    >
                      <img src={avatarPreview} alt="" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <p>
              <label>
                <Trans>Name</Trans>{' '}
                <input
                  type="text"
                  name="display_name"
                  defaultValue={displayName}
                  maxLength={30}
                  disabled={isProfileLoading}
                  dir="auto"
                  enterKeyHint="done"
                />
              </label>
            </p>
            <p>
              <label>
                <Trans>Bio</Trans>
                <textarea
                  defaultValue={note}
                  name="note"
                  maxLength={500}
                  rows={5}
                  disabled={isProfileLoading}
                  dir="auto"
                />
              </label>
            </p>
            {/* Table for fields; name and values are in fields, min 4 rows */}
            <p>
              <Trans>Extra fields</Trans>
            </p>
            <EditProfileFieldsTable
              ref={fieldsAttributesRef}
              fields={profileFields}
              disabled={isProfileLoading}
            />
            <EditProfileActions
              disabled={isProfileLoading}
              onCancel={() => {
                onClose?.();
              }}
            />
          </form>
        )}
      </main>
    </div>
  );
}

export default EditProfileSheet;
