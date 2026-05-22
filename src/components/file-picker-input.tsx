import { plural } from '@lingui/core/macro';
import type { SyntheticEvent } from 'react';

import { compressAtprotoImageIfNeeded } from '../utils/atproto-image-compression';
import { revokeAttachmentObjectUrls } from '../utils/compose-media';

interface FilePickerMediaAttachment {
  fileData: ArrayBuffer;
  fileName: string;
  type: string;
  size: number;
  url: string;
  ownedObjectUrl: boolean;
  id: string | null;
  description: string | null;
}

interface FilePickerInputAttachment extends Partial<FilePickerMediaAttachment> {
  file?: File;
  [key: string]: unknown;
}

interface FilePickerInputProps {
  id?: string;
  hidden?: boolean;
  supportedMimeTypes?: string[];
  maxMediaAttachments?: number;
  mediaAttachments: FilePickerInputAttachment[];
  disabled?: boolean;
  setMediaAttachments: (
    updater: (
      attachments: FilePickerInputAttachment[],
    ) => FilePickerInputAttachment[],
  ) => void;
}

function FilePickerInput({
  id,
  hidden,
  supportedMimeTypes,
  maxMediaAttachments,
  mediaAttachments,
  disabled = false,
  setMediaAttachments,
}: FilePickerInputProps) {
  return (
    <input
      id={id}
      type="file"
      className={hidden ? 'file-input-hidden' : undefined}
      accept={supportedMimeTypes?.join(',')}
      multiple={
        maxMediaAttachments === undefined ||
        maxMediaAttachments - mediaAttachments.length >= 2
      }
      disabled={disabled}
      onChange={(e: SyntheticEvent<HTMLInputElement>) => {
        const target = e.target as HTMLInputElement;
        const files = target.files;
        if (!files) return;

        void (async () => {
          let mediaFiles: FilePickerMediaAttachment[];
          try {
            mediaFiles = await Promise.all(
              Array.from(files).map(async (file) => {
                const uploadFile = await compressAtprotoImageIfNeeded(file);
                return {
                  fileData: await uploadFile.arrayBuffer(),
                  fileName: uploadFile.name,
                  type: uploadFile.type,
                  size: uploadFile.size,
                  url: URL.createObjectURL(uploadFile),
                  ownedObjectUrl: true,
                  id: null, // indicate uploaded state
                  description: null,
                };
              }),
            );
          } catch (err) {
            console.error('Failed to read file(s):', err);
            return;
          }
          console.log('MEDIA ATTACHMENTS', files, mediaFiles);

          // Validate max media attachments
          if (
            maxMediaAttachments !== undefined &&
            mediaAttachments.length + mediaFiles.length > maxMediaAttachments
          ) {
            alert(
              plural(maxMediaAttachments, {
                one: 'You can only attach up to 1 file.',
                other: 'You can only attach up to # files.',
              }),
            );
            revokeAttachmentObjectUrls(mediaFiles);
          } else {
            setMediaAttachments((attachments) => {
              return attachments.concat(
                mediaFiles as FilePickerInputAttachment[],
              );
            });
          }
          // Reset
          target.value = '';
        })();
      }}
    />
  );
}

export default FilePickerInput;
