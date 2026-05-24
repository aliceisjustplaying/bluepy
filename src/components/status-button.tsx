import type { ButtonHTMLAttributes, Ref } from 'react';
import { useSnapshot } from 'valtio';

import shortenNumber from '../utils/shorten-number';
import states from '../utils/states';

import Icon from './icon';

interface StatusButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'title'
> {
  ref?: Ref<HTMLButtonElement>;
  checked?: boolean;
  count?: number;
  extraCount?: number;
  title: string | [string, string];
  alt: string | [string, string];
  size?: string;
  icon?: string;
  iconSize?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

function StatusButton(props: StatusButtonProps) {
  const snapStates = useSnapshot(states);
  let {
    ref,
    checked,
    count,
    extraCount,
    className,
    title,
    alt,
    size,
    icon,
    iconSize = 'l',
    onClick,
    type = 'button',
    ...otherProps
  } = props;
  if (typeof title === 'string') {
    title = [title, title];
  }
  if (typeof alt === 'string') {
    alt = [alt, alt];
  }

  const buttonTitle = checked ? title[1] || '' : title[0] || '';
  const iconAlt = checked ? alt[1] || '' : alt[0] || '';

  const buttonClassName = [
    'plain',
    size ? 'small' : '',
    className,
    checked ? 'checked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      {...otherProps}
      aria-hidden={
        snapStates.showCompose && buttonClassName.includes('reply-button')
          ? true
          : otherProps['aria-hidden']
      }
      type={type}
      title={buttonTitle}
      className={buttonClassName}
      onClick={(e) => {
        if (!onClick) return;
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
    >
      <Icon icon={icon} size={iconSize} alt={iconAlt} />
      {(!!count || !!extraCount) && (
        <>
          {' '}
          {!!count && (
            <small title={String(count)}>{shortenNumber(count)}</small>
          )}
          {!!count && !!extraCount && <small>+</small>}
          {!!extraCount && (
            <small title={String(extraCount)}>
              {shortenNumber(extraCount)}
            </small>
          )}
        </>
      )}
    </button>
  );
}

export default StatusButton;
