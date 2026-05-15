// https://stackoverflow.com/a/23522755
const isSafari = /^((?!chrome|android).)*safari/iu.test(navigator.userAgent);

export default function openOSK(): void {
  if (isSafari) {
    const fauxEl = document.createElement('input');
    fauxEl.style.position = 'absolute';
    fauxEl.style.top = '0';
    fauxEl.style.left = '0';
    fauxEl.style.opacity = '0';
    document.body.append(fauxEl);
    fauxEl.focus();
    setTimeout(() => {
      fauxEl.remove();
    }, 500);
  }
}
