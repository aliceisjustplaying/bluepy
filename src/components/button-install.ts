// https://adactio.com/journal/22278
// https://gist.github.com/adactio/a445544723363d37b9c31a74a03ef928

interface NavigatorWithInstall extends Navigator {
  install?: () => Promise<void>;
}

class ButtonInstall extends HTMLElement {
  button: HTMLButtonElement | null = null;

  connectedCallback() {
    this.button = this.querySelector<HTMLButtonElement>('button');
    if (window.matchMedia('(display-mode: standalone)').matches) {
      this.button!.remove();
      return;
    }
    const nav = navigator as NavigatorWithInstall;
    if (!nav.install) {
      this.button!.remove();
      return;
    }
    this.button!.addEventListener('click', () => {
      nav.install!().catch((err: unknown) => {
        console.error(err);
      });
    });
  }
}

customElements.define('button-install', ButtonInstall);
