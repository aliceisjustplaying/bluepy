export const ATPROTO_IMAGE_MAX_BYTES = 2_000_000;
export const ATPROTO_IMAGE_MAX_LONG_EDGE = 4_000;

const MIN_QUALITY = 0.25;
const QUALITY_STEPS = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.28];
const DIMENSION_REDUCTION_FACTOR = 0.8;
const MAX_DIMENSION_ATTEMPTS = 5;

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface PreparedAtprotoImageUpload {
  file: File;
  dimensions?: ImageDimensions;
}

interface LoadedImage extends ImageDimensions {
  source: CanvasImageSource;
  close: () => void;
}

export function getContainedDimensions(
  width: number,
  height: number,
  maxLongEdge = ATPROTO_IMAGE_MAX_LONG_EDGE,
): ImageDimensions {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function shouldCompressAtprotoImage(
  fileSize: number,
  { width, height }: ImageDimensions,
): boolean {
  return (
    fileSize > ATPROTO_IMAGE_MAX_BYTES ||
    Math.max(width, height) > ATPROTO_IMAGE_MAX_LONG_EDGE
  );
}

export async function compressAtprotoImageIfNeeded(file: File): Promise<File> {
  return (await prepareAtprotoImageUpload(file)).file;
}

export async function prepareAtprotoImageUpload(
  file: File,
): Promise<PreparedAtprotoImageUpload> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return { file };
  }

  const source = await loadImage(file);
  try {
    if (
      !shouldCompressAtprotoImage(file.size, {
        width: source.width,
        height: source.height,
      })
    ) {
      return {
        file,
        dimensions: {
          width: source.width,
          height: source.height,
        },
      };
    }

    const compressed = await findCompressedImage(
      source.source,
      getContainedDimensions(source.width, source.height),
    );
    if (compressed) {
      return {
        file: new File([compressed.blob], toJpegFilename(file.name), {
          type: 'image/jpeg',
          lastModified: file.lastModified,
        }),
        dimensions: compressed.dimensions,
      };
    }
  } finally {
    source.close();
  }

  throw new Error('Unable to compress image under the Bluesky upload limit');
}

async function findCompressedImage(
  image: CanvasImageSource,
  dimensions: ImageDimensions,
  attempt = 0,
): Promise<PreparedCompressedImage | null> {
  if (attempt >= MAX_DIMENSION_ATTEMPTS) return null;

  const blob = await findCompressedAtQuality(image, dimensions);
  if (blob) return { blob, dimensions };

  return await findCompressedImage(
    image,
    {
      width: Math.max(
        1,
        Math.round(dimensions.width * DIMENSION_REDUCTION_FACTOR),
      ),
      height: Math.max(
        1,
        Math.round(dimensions.height * DIMENSION_REDUCTION_FACTOR),
      ),
    },
    attempt + 1,
  );
}

interface PreparedCompressedImage {
  blob: Blob;
  dimensions: ImageDimensions;
}

async function findCompressedAtQuality(
  image: CanvasImageSource,
  dimensions: ImageDimensions,
  qualityIndex = 0,
): Promise<Blob | null> {
  const quality = QUALITY_STEPS[qualityIndex];
  if (quality === undefined) return null;
  if (quality < MIN_QUALITY) {
    return await findCompressedAtQuality(image, dimensions, qualityIndex + 1);
  }

  const blob = await drawImageToJpeg(image, dimensions, quality);
  if (blob.size <= ATPROTO_IMAGE_MAX_BYTES) return blob;
  return await findCompressedAtQuality(image, dimensions, qualityIndex + 1);
}

function toJpegFilename(name: string): string {
  const base = name.trim() || 'image';
  return /\.[^.]+$/.test(base)
    ? base.replace(/\.[^.]+$/, '.jpg')
    : `${base}.jpg`;
}

async function loadImage(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => {
      resolve();
    });
    image.addEventListener('error', () => {
      reject(new Error('Unable to decode image'));
    });
  });
  image.src = url;
  await loaded;
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    close: () => {
      URL.revokeObjectURL(url);
    },
  };
}

function drawImageToJpeg(
  image: CanvasImageSource,
  dimensions: ImageDimensions,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Unable to create image compression canvas'));
      return;
    }

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);
    ctx.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Unable to encode compressed image'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}
