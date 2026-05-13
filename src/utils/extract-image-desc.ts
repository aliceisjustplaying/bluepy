// Custom-built version of exifreader, config is in package.json
import ExifReader from 'exifreader/dist/exif-reader.js';

// Tags from IPTC, XMP, EXIF
const TAG_NAMES = ['Caption/Abstract', 'Description', 'ImageDescription'];

export default async function extractImageDescription(
  file: File | Blob | null | undefined,
): Promise<string | null> {
  if (!file || !file.type?.startsWith?.('image/')) return null;

  try {
    const tags = await ExifReader.load(file);
    for (const name of TAG_NAMES) {
      const description = tags[name]?.description;
      if (description) {
        return description.trim();
      }
    }
    return null;
  } catch (error) {
    console.debug('Failed to extract image description:', error);
    return null;
  }
}
