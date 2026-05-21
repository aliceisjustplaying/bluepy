import './qr-scanner-modal.css';

import type { MessageDescriptor } from '@lingui/core';
import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';

const hasBarcodeDetector = 'BarcodeDetector' in window;

if (!hasBarcodeDetector) {
  // Prefetch qr/dom.js for caching
  setTimeout(() => {
    void (async () => {
      try {
        await import('qr/dom.js');
      } catch {}
    })();
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
    const videoDevices: Array<{ deviceId: string; label: string }> = [];
    for (const device of devices) {
      if (device.kind !== 'videoinput') continue;
      videoDevices.push({
        deviceId: device.deviceId,
        label: device.label || `Camera ${device.deviceId}`,
      });
    }
    return videoDevices;
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
  actionableText?: string | MessageDescriptor;
}

function QrScannerModal({
  onClose,
  checkValidity,
  actionableText,
}: QrScannerModalProps) {
  const { t, i18n } = useLingui();
  const actionableLabel =
    actionableText &&
    (typeof actionableText === 'string'
      ? i18n._(actionableText)
      : i18n._(actionableText));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [decodedText, setDecodedText] = useState('');
  const isScanningRef = useRef(true);
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
    let video: HTMLVideoElement | undefined;
    let cancelled = false;

    const handleLoadedMetadata = () => {
      setUIState('default');
    };

    const handlePlay = () => {
      // We won't have correct size until video starts playing
      console.log('Video started playing, beginning scan loop');

      if (!video) return;
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
            if (!detector || !videoRef.current) return;
            const results = await detector.detect(videoRef.current);
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
        cancelMainLoop = () => {
          cancelAnimationFrame(animationId);
        };
      } else {
        const mainLoop = () => {
          try {
            if (!cam || !qrCanvas) return;
            const result = cam.readFrame(qrCanvas, true);
            if (result !== undefined && result !== null) {
              console.log('Scan result:', result);
              setDecodedText(result);
            }
          } catch (e) {
            console.error('Error in scan loop:', e);
          }
        };

        cancelMainLoop = qrDom?.frameLoop(mainLoop);
      }
    };

    const startCamera = async () => {
      try {
        const currentVideo = videoRef.current;
        if (!currentVideo) return;
        cam = await createQRCamera(currentVideo);
        if (cancelled) {
          cam.stop();
          return;
        }

        if (hasBarcodeDetector) {
          const BarcodeDetectorCtor = window.BarcodeDetector;
          if (!BarcodeDetectorCtor) {
            throw new Error('BarcodeDetector unavailable');
          }
          detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
        } else {
          const qrDomModule: QrDomModule = await import('qr/dom.js');
          if (cancelled) {
            cam.stop();
          } else {
            qrDom = qrDomModule;
            const targets = overlayRef.current
              ? { overlay: overlayRef.current }
              : {};
            qrCanvas = new qrDomModule.QRCanvas(targets, {
              cropToSquare: false,
              overlayMainColor: 'transparent',
              overlayFinderColor: 'rgba(255, 0, 255, 0.5)',
            });
          }
        }

        // Start scanning loop when video plays (following demo pattern)
        video = videoRef.current ?? undefined;
        if (!cancelled && video) {
          video.addEventListener('loadedmetadata', handleLoadedMetadata);
          video.addEventListener('play', handlePlay);
        }
      } catch (err) {
        console.error('Error accessing camera:', err);
        setUIState('error');
        isScanningRef.current = false;
      }
    };

    if (isScanningRef.current) {
      void startCamera();
    }

    return () => {
      cancelled = true;
      if (video) {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('play', handlePlay);
      }
      if (cancelMainLoop) cancelMainLoop();
      if (cam) {
        cam.stop();
      }
      if (qrCanvas) {
        qrCanvas.clear();
      }
    };
  }, []);

  const showActionableButton =
    typeof checkValidity === 'function'
      ? checkValidity(decodedText)
      : !!decodedText;

  return (
    <div className="qr-scanner-modal">
      <div className="qr-scanner-header">
        <Loader abrupt hidden={uiState !== 'loading'} />
        <button
          type="button"
          className="plain4"
          onClick={() => {
            onClose();
          }}
        >
          <Icon icon="x" alt={t`Close`} />
        </button>
      </div>
      {uiState === 'error' ? (
        <div className="ui-state">
          <p>
            <Trans>Unable to access camera. Please check permissions.</Trans>
          </p>
        </div>
      ) : (
        <>
          <div ref={containerRef} className="qr-scanner-video-container">
            <video
              ref={videoRef}
              playsInline
              muted
              disablePictureInPicture
              aria-hidden="true"
            />
            {!hasBarcodeDetector && (
              <canvas
                ref={overlayRef}
                className="qr-scanner-canvas"
                aria-hidden="true"
              />
            )}
            <svg
              className="qr-scanner-corner-hint"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
            >
              <path
                d="M 25 10 L 15 10 Q 10 10 10 15 L 10 25"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 75 10 L 85 10 Q 90 10 90 15 L 90 25"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 25 90 L 15 90 Q 10 90 10 85 L 10 75"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 75 90 L 85 90 Q 90 90 90 85 L 90 75"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="qr-scanner-result">
            {!!decodedText && (
              <>
                <p className="qr-scanner-text">{decodedText}</p>
                {showActionableButton && (
                  <button
                    type="button"
                    className="button plain6"
                    onClick={() => {
                      onClose({ text: decodedText });
                    }}
                  >
                    {actionableLabel ? (
                      actionableLabel
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
