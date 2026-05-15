declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

function updateViewportForPWA(): void {
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (!viewportMeta) return;

  // Check if running as PWA (standalone mode)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true || // iOS Safari
    window.matchMedia('(display-mode: window-controls-overlay)').matches;

  if (isStandalone) {
    const currentContent = viewportMeta.getAttribute('content');
    // Faithful to JS: original threw TypeError on null content. Asserting
    // non-null preserves that runtime behavior; viewport meta always has a
    // content attribute in this app's index.html.
    if (!currentContent!.includes('user-scalable=no')) {
      viewportMeta.setAttribute(
        'content',
        currentContent + ', user-scalable=no',
      );
    }
  }
}

export function initPWAViewport(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateViewportForPWA);
  } else {
    updateViewportForPWA();
  }
}
