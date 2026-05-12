import getDomain from '../utils/get-domain';
import { getCurrentAccountID } from '../utils/store-utils';

interface Role {
  name?: string;
}

interface RolesTagsProps {
  roles?: Role[] | null;
  accountId?: string;
  accountUrl?: string;
  hideSelf?: boolean;
}

function RolesTags({
  roles,
  accountId,
  accountUrl,
  hideSelf = false,
}: RolesTagsProps) {
  if (!roles?.length) return null;

  const isSelf = accountId && accountId === getCurrentAccountID();
  if (!accountId && hideSelf) {
    console.warn('accountId is required if hideSelf is true');
  }
  if (hideSelf && isSelf) return null;

  const parsedAccountInstance = accountUrl ? getDomain(accountUrl) : '';

  return roles?.map((role) => (
    <>
      {' '}
      <span class="tag collapsed tag-role">
        {role.name}
        {!!parsedAccountInstance && (
          <>
            {' '}
            <span class="more-insignificant">{parsedAccountInstance}</span>
          </>
        )}
      </span>
    </>
  ));
}

export default RolesTags;
