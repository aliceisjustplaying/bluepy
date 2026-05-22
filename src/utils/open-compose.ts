import { t } from '@lingui/core/macro';

interface ComposeOpts {
  uid?: string | number;
  [key: string]: unknown;
}

export default function openCompose(opts?: ComposeOpts): Window | null {
  const url = URL.parse('./compose/', window.location.href);
  const { width: screenWidth, height: screenHeight } = window.screen;
  const left = Math.max(0, (screenWidth - 600) / 2);
  const top = Math.max(0, (screenHeight - 450) / 2);
  const width = Math.min(screenWidth, 600);
  const height = Math.min(screenHeight, 450);
  const winUID = opts?.uid || Math.random();
  const newWin = window.open(
    url as URL,
    'compose' + winUID,
    `width=${width},height=${height},left=${left},top=${top}`,
  );

  if (newWin) {
    (newWin as Window & { __COMPOSE__?: ComposeOpts }).__COMPOSE__ = opts;
  } else {
    alert(t`Looks like your browser is blocking popups.`);
  }

  return newWin;
}
