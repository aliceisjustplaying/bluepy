import './qr-scanner-modal.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'preact/hooks';

const hasBarcodeDetector = 'BarcodeDetector' in window;

if (!hasBarcodeDetector) {
  // Prefetch qr/dom.js for caching
  setTimeout(() => {
    import('qr/dom.js').catch(() => {});
  }, 1000);
}

import Icon from './icon';
import Loader from './loader';

// Minimal shape of qr/dom.js QRCanvas usage in this file. The module has no
// type declarations; we shim only the surface used here.
interface QrCanvasLike {
  drawImage: (
    player: HTMLVideoElement,
    height: number,
    width: number,
  ) => string | undefined | null;
  clear: () => void;
}

// Minimal shape of qr/dom.js as consumed here.
interface QrDomModule {
  QRCanvas: new (
    targets: { overlay?: HTMLCanvasElement },
    options: {
      cropToSquare: boolean;
      overlayMainColor: string;
      overlayFinderColor: string;
    },
  ) => QrCanvasLike;
  frameLoop: (cb: () => void) => () => void;
}

// Minimal shape of the experimental BarcodeDetector API (not in lib.dom).
interface BarcodeDetectorResult {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
}
interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

// Placeholder for the demo-style getSize helper from qr/dom.js. Retained to
// preserve original behavior: readFrame in non-fullSize mode calls it, which
// would have ReferenceError'd in JS too. Marked unused-safe via cast.
declare function getSize(player: HTMLVideoElement): {
  height: number;
  width: number;
};

// Copied from qr/dom.js because it's not exported
class QRCamera {
  stream: MediaStream;
  player: HTMLVideoElement;
  constructor(stream: MediaStream, player: HTMLVideoElement) {
    this.stream = stream;
    this.player = player;
    this.setStream(stream);
  }
  setStream(stream: MediaStream) {
    this.stream = stream;
    const { player } = this;
    player.setAttribute('autoplay', '');
    player.setAttribute('muted', '');
    player.setAttribute('playsinline', '');
    player.srcObject = stream;
  }
  async listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
      throw new Error('Media Devices not supported');
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((i) => ({
        deviceId: i.deviceId,
        label: i.label || `Camera ${i.deviceId}`,
      }));
  }
  async setDevice(deviceId: string) {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
    });
    this.setStream(stream);
  }
  readFrame(canvas: QrCanvasLike, fullSize = false) {
    const { player } = this;
    if (fullSize)
      return canvas.drawImage(player, player.videoHeight, player.videoWidth);
    const size = getSize(player);
    return canvas.drawImage(player, size.height, size.width);
  }
  stop() {
    for (const track of this.stream.getTracks()) track.stop();
  }
}

// Copy of frontalCamera from qr/dom.js, but with custom constraints
const createQRCamera = async (player: HTMLVideoElement) => {
  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({
        name: 'camera' as PermissionName,
      });
      console.log('Camera permission status:', permission.state);

      permission.addEventListener('change', () => {
        console.log('Camera permission changed to:', permission.state);
      });
    } catch (err) {
      console.warn('Permissions API camera query not supported:', err);
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      height: { ideal: 720 },
      width: { ideal: 1280 },
      facingMode: 'environment',
    },
  });
  return new QRCamera(stream, player);
};

interface QrScannerModalProps {
  onClose: (arg?: { text: string } | MouseEvent) => void;
  checkValidity?: (text: string) => boolean;
  actionableText?: string;
}

function QrScannerModal({
  onClose,
  checkValidity,
  actionableText,
}: QrScannerModalProps) {
  const { t, i18n } = useLingui();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [decodedText, setDecodedText] = useState('');
  const [isScanning, setIsScanning] = useState(true);
  const [uiState, setUIState] = useState('loading');

  // Based on screen, not viewport or window
  useEffect(() => {
    // portrait as default
    let handleScreenOrientationChange: (() => void) | undefined;
    if (screen?.orientation?.type && containerRef.current) {
      handleScreenOrientationChange = () => {
        const screenOrientation = /landscape/.test(
          window.screen.orientation.type,
        )
          ? 'landscape'
          : 'portrait';
        containerRef.current?.classList.toggle(
          'landscape',
          screenOrientation === 'landscape',
        );
      };

      screen.orientation.addEventListener(
        'change',
        handleScreenOrientationChange,
      );
      handleScreenOrientationChange();
    }
    return () => {
      if (
        handleScreenOrientationChange &&
        screen?.orientation?.removeEventListener
      ) {
        screen.orientation.removeEventListener(
          'change',
          handleScreenOrientationChange,
        );
      }
    };
  }, []);

  useEffect(() => {
    let cancelMainLoop: (() => void) | undefined;
    let cam: QRCamera | undefined;
    let qrCanvas: QrCanvasLike | undefined;
    let detector: BarcodeDetectorLike | undefined;
    let qrDom: QrDomModule | undefined;

    const startCamera = async () => {
      try {
        cam = await createQRCamera(videoRef.current as HTMLVideoElement);

        if (hasBarcodeDetector) {
          const BarcodeDetectorCtor = window.BarcodeDetector as BarcodeDetectorCtor;
          detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
        } else {
          const qrDomModule: QrDomModule = await import('qr/dom.js');
          qrDom = qrDomModule;
          qrCanvas = new qrDomModule.QRCanvas(
            { overlay: overlayRef.current } as { overlay?: HTMLCanvasElement },
            {
              cropToSquare: false,
              overlayMainColor: 'transparent',
              overlayFinderColor: 'rgba(255, 0, 255, 0.5)',
            },
          );
        }

        // Start scanning loop when video plays (following demo pattern)
        const video = videoRef.current;
        if (video) {
          video.addEventListener('loadedmetadata', () => {
            setUIState('default');
          });
          video.addEventListener('play', () => {
            // We won't have correct size until video starts playing
            console.log('Video started playing, beginning scan loop');

            // Get width, height from video
            const { videoWidth: width, videoHeight: height } = video;

            console.log('📹', { cam, video });

            if (width && height) {
              containerRef.current?.style.setProperty(
                '--long-dimension',
                String(Math.max(width, height)),
              );
              containerRef.current?.style.setProperty(
                '--short-dimension',
                String(Math.min(width, height)),
              );
            }

            if (hasBarcodeDetector) {
              const mainLoop = async () => {
                try {
                  const results = await detector!.detect(
                    videoRef.current as HTMLVideoElement,
                  );
                  if (results.length > 0) {
                    console.log('Scan result:', results[0].rawValue);
                    setDecodedText(results[0].rawValue);
                  }
                } catch (e) {
                  console.error('Error in barcode detection:', e);
                }
              };

              let animationId: number;
              const rafLoop = () => {
                void mainLoop();
                animationId = requestAnimationFrame(rafLoop);
              };
              rafLoop();
              cancelMainLoop = () => cancelAnimationFrame(animationId);
            } else {
              const mainLoop = () => {
                try {
                  const result = cam!.readFrame(qrCanvas!, true);
                  if (result !== undefined && result !== null) {
                    console.log('Scan result:', result);
                    setDecodedText(result);
                  }
                } catch (e) {
                  console.error('Error in scan loop:', e);
                }
              };

              cancelMainLoop = qrDom!.frameLoop(mainLoop);
            }
          });
        }
      } catch (err) {
        console.error('Error accessing camera:', err);
        setUIState('error');
        setIsScanning(false);
      }
    };

    if (isScanning) {
      void startCamera();
    }

    return () => {
      if (cancelMainLoop) cancelMainLoop();
      if (cam) {
        cam.stop();
      }
      if (qrCanvas) {
        qrCanvas.clear();
      }
    };
  }, [isScanning]);

  const showActionableButton =
    typeof checkValidity === 'function'
      ? checkValidity(decodedText)
      : !!decodedText;

  return (
    <div class="qr-scanner-modal">
      <div class="qr-scanner-header">
        <Loader abrupt hidden={uiState !== 'loading'} />
        <button type="button" class="plain4" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      </div>
      {uiState === 'error' ? (
        <div class="ui-state">
          <p>
            <Trans>Unable to access camera. Please check permissions.</Trans>
          </p>
        </div>
      ) : (
        <>
          <div ref={containerRef} class="qr-scanner-video-container">
            <video ref={videoRef} playsInline muted disablePictureInPicture />
            {!hasBarcodeDetector && (
              <canvas ref={overlayRef} class="qr-scanner-canvas" />
            )}
            <svg
              class="qr-scanner-corner-hint"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
            >
              <path
                d="M 25 10 L 15 10 Q 10 10 10 15 L 10 25"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
              />
              <path
                d="M 75 10 L 85 10 Q 90 10 90 15 L 90 25"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
              />
              <path
                d="M 25 90 L 15 90 Q 10 90 10 85 L 10 75"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
              />
              <path
                d="M 75 90 L 85 90 Q 90 90 90 85 L 90 75"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
              />
            </svg>
          </div>
          <div class="qr-scanner-result">
            {!!decodedText && (
              <>
                <p class="qr-scanner-text">{decodedText}</p>
                {showActionableButton && (
                  <button
                    type="button"
                    class="button plain6"
                    onClick={() => {
                      onClose({ text: decodedText });
                    }}
                  >
                    {actionableText ? (
                      i18n._(actionableText)
                    ) : (
                      <Icon icon="arrow-right" />
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default QrScannerModal;
