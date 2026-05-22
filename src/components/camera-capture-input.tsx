import type { SyntheticEvent } from 'react';

import { compressAtprotoImageIfNeeded } from '../utils/atproto-image-compression';

const isMobileSafari =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

interface CameraCaptureMediaAttachment {
  fileData: ArrayBuffer;
  fileName: string;
  type: string;
  size: number;
  url: string;
  ownedObjectUrl: boolean;
  id: string | null;
  description: string | null;
}

interface CameraCaptureInputAttachment extends Partial<CameraCaptureMediaAttachment> {
  file?: File;
  [key: string]: unknown;
}

interface CameraCaptureInputProps {
  id?: string;
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
  id,
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
    : supportedMimeTypes?.filter((mimeType) => /^image\//i.test(mimeType));

  return (
    <input
      id={id}
      type="file"
      className={hidden ? 'file-input-hidden' : undefined}
      accept={filteredSupportedMimeTypes?.join(',')}
      capture="environment"
      disabled={disabled}
      onChange={(e: SyntheticEvent<HTMLInputElement>) => {
        const target = e.currentTarget;
        const files = target.files;
        if (!files) return;
        const mediaFile = Array.from(files)[0];
        if (!mediaFile) return;
        void (async () => {
          let fileData;
          let uploadFile: File;
          try {
            uploadFile = await compressAtprotoImageIfNeeded(mediaFile);
            fileData = await uploadFile.arrayBuffer();
          } catch (err) {
            console.error('Failed to read file:', err);
            return;
          }
          const attachment: CameraCaptureMediaAttachment = {
            fileData,
            fileName: uploadFile.name,
            type: uploadFile.type,
            size: uploadFile.size,
            url: URL.createObjectURL(uploadFile),
            ownedObjectUrl: true,
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
