// NOTE: UNUSED

import type { ComponentChildren, ComponentType } from 'preact';

import LinkUntyped from '../components/link';

interface LinkProps {
  to: string;
  children?: ComponentChildren;
}
function Link(props: LinkProps) {
  const Inner = LinkUntyped as unknown as ComponentType<LinkProps>;
  return <Inner {...props} />;
}

export default function NotFound() {
  return (
    <div id="not-found-page" className="deck-container" tabIndex={-1}>
      <div>
        <h1>404</h1>
        <p>Page not found.</p>
        <p>
          <Link to="/">Go home</Link>.
        </p>
      </div>
    </div>
  );
}
