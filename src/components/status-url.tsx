import { toUnicode } from 'punycode/';

export function nicePostURL(url: string | null | undefined) {
  if (!url) return null;
  const urlObj = URL.parse(url);
  if (!urlObj) return null;
  const { host, pathname } = urlObj;
  const path = pathname.replace(/\/$/, '');
  // split only first slash
  const [, username, restPath] = path.match(/\/(@[^/]+)\/(.*)/) || [];
  return (
    <>
      {toUnicode(host)}
      {username ? (
        <>
          /{username}
          <wbr />
          <span className="more-insignificant">/{restPath}</span>
        </>
      ) : (
        <span className="more-insignificant">{path}</span>
      )}
    </>
  );
}
