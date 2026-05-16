import './loader.css';

import type { ReactNode } from 'react';

interface LoaderProps {
  abrupt?: boolean;
  hidden?: boolean;
  id?: string;
}

const Loader = (props: Readonly<LoaderProps>): ReactNode => {
  const { abrupt, hidden, id } = props;
  const classNames = ['loader-container'];

  if (abrupt === true) {
    classNames.push('abrupt');
  }

  if (hidden === true) {
    classNames.push('hidden');
  }

  return (
    <span id={id} className={classNames.join(' ')}>
      <span className="loader" />
    </span>
  );
};

export default Loader;
