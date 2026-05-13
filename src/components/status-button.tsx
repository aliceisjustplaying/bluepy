import type { JSX, Ref } from 'preact';
import { forwardRef } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';

import shortenNumber from '../utils/shorten-number';

import Icon from './icon';

interface StatusButtonProps extends Omit<
  JSX.HTMLAttributes<HTMLButtonElement>,
  'title' | 'class'
> {
  checked?: boolean;
  count?: number;
  extraCount?: number;
  class?: string;
  title: string | [string, string];
  alt: string | [string, string];
  size?: string;
  icon?: string;
  iconSize?: string;
  onClick?: (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
}

const StatusButton = forwardRef<HTMLButtonElement, StatusButtonProps>(
  (props: StatusButtonProps, ref: Ref<HTMLButtonElement>) => {
    let {
      checked,
      count,
      extraCount,
      class: className,
      title,
      alt,
      size,
      icon,
      iconSize = 'l',
      onClick,
      ...otherProps
    } = props;
    if (typeof title === 'string') {
      title = [title, title];
    }
    if (typeof alt === 'string') {
      alt = [alt, alt];
    }

    const [buttonTitle, setButtonTitle] = useState(title[0] || '');
    const [iconAlt, setIconAlt] = useState(alt[0] || '');

    useEffect(() => {
      if (checked) {
        setButtonTitle(title[1] || '');
        setIconAlt(alt[1] || '');
      } else {
        setButtonTitle(title[0] || '');
        setIconAlt(alt[0] || '');
      }
    }, [checked, title, alt]);

    return (
      <button
        ref={ref}
        type="button"
        title={buttonTitle}
        class={`plain ${size ? 'small' : ''} ${className} ${
          checked ? 'checked' : ''
        }`}
        onClick={(e) => {
          if (!onClick) return;
          e.preventDefault();
          e.stopPropagation();
          onClick(e);
        }}
        {...otherProps}
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
  },
);

export default StatusButton;
