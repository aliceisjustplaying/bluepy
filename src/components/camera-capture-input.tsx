import type { TargetedEvent } from 'preact';

const isMobileSafari =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

export interface CameraCaptureMediaAttachment {
  fileData: ArrayBuffer;
  fileName: string;
  type: string;
  size: number;
  url: string;
  id: string | null;
  description: string | null;
}

export interface CameraCaptureInputAttachment
  extends Partial<CameraCaptureMediaAttachment> {
  file?: File;
  [key: string]: unknown;
}

export interface CameraCaptureInputProps {
  hidden?: boolean;
  disabled?: boolean;
  supportedMimeTypes?: string[];
  mediaAttachments?: CameraCaptureInputAttachment[];
  setMediaAttachments: (
    updater: (
      attachments: CameraCaptureInputAttachment[],
    ) => CameraCaptureInputAttachment[],
  ) => void;
}

function CameraCaptureInput({
  hidden,
  disabled = false,
  supportedMimeTypes,
  setMediaAttachments,
}: CameraCaptureInputProps) {
  // If not Mobile Safari, only apply image/*
  // Chrome Android doesn't show the camera if image and video combined
  // It also can't switch between photo and video mode like iOS/Safari
  const filteredSupportedMimeTypes = isMobileSafari
    ? supportedMimeTypes
    : supportedMimeTypes?.filter((mimeType) => !/^image\//i.test(mimeType));

  return (
    <input
      type="file"
      hidden={hidden}
      accept={filteredSupportedMimeTypes?.join(',')}
      capture="environment"
      disabled={disabled}
      onChange={(e: TargetedEvent<HTMLInputElement>) => {
        const target = e.currentTarget;
        const files = target.files;
        if (!files) return;
        const mediaFile = Array.from(files)[0];
        if (!mediaFile) return;
        void (async () => {
          let fileData;
          try {
            fileData = await mediaFile.arrayBuffer();
          } catch (err) {
            console.error('Failed to read file:', err);
            return;
          }
          const attachment: CameraCaptureMediaAttachment = {
            fileData,
            fileName: mediaFile.name,
            type: mediaFile.type,
            size: mediaFile.size,
            url: URL.createObjectURL(mediaFile),
            id: null, // indicate uploaded state
            description: null,
          };
          setMediaAttachments((attachments) => [
            ...attachments,
            attachment as CameraCaptureInputAttachment,
          ]);
          target.value = '';
        })();
      }}
    />
  );
}

export const supportsCameraCapture = (() => {
  const input = document.createElement('input');
  return 'capture' in input;
})();

export default CameraCaptureInput;
