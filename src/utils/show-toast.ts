import Toastify from 'toastify-js';

interface ToastInstance {
  showToast(): void;
  hideToast(): void;
}

interface ToastProps {
  text?: string;
  destination?: string;
  duration?: number;
  className?: string;
  gravity?: string;
  position?: string;
  close?: boolean;
  stopOnFocus?: boolean;
  offset?: { x?: number; y?: number };
  onClick?: (toast: ToastInstance) => void;
  delay?: number;
  [key: string]: unknown;
}

// Debug window global so devs can trigger toasts from the console. Keep the
// underscore-prefixed name for back-compat with existing dev tooling and also
// expose the unprefixed name to satisfy the no-underscore-dangle linter
// without breaking callers of `_showToast(...)`.
Object.assign(window, {
  _showToast: showToast,
  showToast,
});

function showToast(props: string | ToastProps): ToastInstance {
  if (typeof props === 'string') {
    props = { text: props };
  }
  const { onClick, delay, ...rest } = props;
  const toast: ToastInstance = Toastify({
    className: onClick || props.destination ? 'shiny-pill' : '',
    gravity: 'bottom',
    position: 'center',
    ...rest,
    onClick: () => {
      onClick?.(toast); // Pass in the object itself!
    },
  });
  if (delay) {
    setTimeout(() => {
      toast.showToast();
    }, delay);
  } else {
    toast.showToast();
  }
  return toast;
}

export default showToast;
