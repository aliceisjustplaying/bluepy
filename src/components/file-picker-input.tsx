import { plural } from '@lingui/core/macro';
import type { JSX } from 'preact';

interface MediaAttachment {
  fileData: ArrayBuffer;
  fileName: string;
  type: string;
  size: number;
  url: string;
  id: string | null;
  description: string | null;
}

interface FilePickerInputProps {
  hidden?: boolean;
  supportedMimeTypes?: string[];
  maxMediaAttachments?: number;
  mediaAttachments: MediaAttachment[];
  disabled?: boolean;
  setMediaAttachments: (
    updater: (attachments: MediaAttachment[]) => MediaAttachment[],
  ) => void;
}

function FilePickerInput({
  hidden,
  supportedMimeTypes,
  maxMediaAttachments,
  mediaAttachments,
  disabled = false,
  setMediaAttachments,
}: FilePickerInputProps) {
  return (
    <input
      type="file"
      hidden={hidden}
      accept={supportedMimeTypes?.join(',')}
      multiple={
        maxMediaAttachments === undefined ||
        // Preserves JS runtime: original code subtracted the whole array,
        // which coerces via Number() to NaN (or 0 if empty). Pre-existing
        // bug; follow-up, not changed in this TS migration.
        maxMediaAttachments - Number(mediaAttachments) >= 2
      }
      disabled={disabled}
      onChange={async (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
        const target = e.target as HTMLInputElement;
        const files = target.files;
        if (!files) return;

        let mediaFiles: MediaAttachment[];
        try {
          mediaFiles = await Promise.all(
            Array.from(files).map(async (file) => ({
              fileData: await file.arrayBuffer(),
              fileName: file.name,
              type: file.type,
              size: file.size,
              url: URL.createObjectURL(file),
              id: null, // indicate uploaded state
              description: null,
            })),
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
        } else {
          setMediaAttachments((attachments) => {
            return attachments.concat(mediaFiles);
          });
        }
        // Reset
        target.value = '';
      }}
    />
  );
}

export default FilePickerInput;
