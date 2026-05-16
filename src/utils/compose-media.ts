export interface ComposeMediaAttachment {
  id?: string | null;
  fileData?: ArrayBuffer;
  fileName?: string;
  file?: File;
  type?: string;
  url?: string;
  ownedObjectUrl?: boolean;
  description?: string | null;
  [key: string]: unknown;
}

interface MediaCreateParams {
  file: File | undefined;
  description?: string | null;
}

interface MediaCreateResult {
  id?: string | null;
  [key: string]: unknown;
}

type CreateMedia = (params: MediaCreateParams) => Promise<MediaCreateResult>;

function fileFromAttachment(
  attachment: ComposeMediaAttachment,
): File | undefined {
  const { fileData, fileName, file, type } = attachment;
  if (fileData) {
    return new File([fileData], fileName || 'upload', { type });
  }
  return file;
}

export async function uploadComposeMediaAttachments(
  attachments: ComposeMediaAttachment[],
  createMedia: CreateMedia,
): Promise<ComposeMediaAttachment[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.id) return attachment;

      const res = await createMedia({
        file: fileFromAttachment(attachment),
        description: attachment.description,
      });

      return {
        ...attachment,
        id: res.id ?? null,
      };
    }),
  );
}

export function revokeAttachmentObjectUrl(
  attachment: Pick<ComposeMediaAttachment, 'ownedObjectUrl' | 'url'>,
): void {
  if (
    attachment.ownedObjectUrl &&
    attachment.url &&
    attachment.url.startsWith('blob:')
  ) {
    URL.revokeObjectURL(attachment.url);
  }
}

export function revokeAttachmentObjectUrls(
  attachments: Pick<ComposeMediaAttachment, 'ownedObjectUrl' | 'url'>[],
): void {
  attachments.forEach(revokeAttachmentObjectUrl);
}
