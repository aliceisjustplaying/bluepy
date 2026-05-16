import { expect, test } from '@playwright/test';

import {
  ATPROTO_IMAGE_MAX_BYTES,
  ATPROTO_IMAGE_MAX_LONG_EDGE,
  getContainedDimensions,
  shouldCompressAtprotoImage,
} from '../src/utils/atproto-image-compression.js';

/**
 * @param {unknown} value
 */
function parseCompressionResult(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Missing compression result');
  }
  const result = value;
  const { sourceSize, size, type, name, width, height } = result;
  if (
    typeof sourceSize !== 'number' ||
    typeof size !== 'number' ||
    typeof type !== 'string' ||
    typeof name !== 'string' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    throw new Error('Invalid compression result');
  }
  return { sourceSize, size, type, name, width, height };
}

test.describe('ATProto image compression helpers', () => {
  test('keeps images within the Bluesky long-edge limit', () => {
    expect(getContainedDimensions(8000, 4000)).toEqual({
      width: 4000,
      height: 2000,
    });
    expect(getContainedDimensions(2000, 5000)).toEqual({
      width: 1600,
      height: 4000,
    });
    expect(getContainedDimensions(640, 480)).toEqual({
      width: 640,
      height: 480,
    });
  });

  test('requires compression for oversized files or dimensions', () => {
    expect(
      shouldCompressAtprotoImage(ATPROTO_IMAGE_MAX_BYTES + 1, {
        width: 640,
        height: 480,
      }),
    ).toBe(true);
    expect(
      shouldCompressAtprotoImage(1000, {
        width: ATPROTO_IMAGE_MAX_LONG_EDGE + 1,
        height: 1000,
      }),
    ).toBe(true);
    expect(
      shouldCompressAtprotoImage(1000, {
        width: 640,
        height: 480,
      }),
    ).toBe(false);
  });

  test('compresses oversized browser image files', async ({ page }) => {
    await page.goto('/');

    const result = parseCompressionResult(await page.evaluate(`(async () => {
      const { compressAtprotoImageIfNeeded } = await import(
        '/src/utils/atproto-image-compression.ts'
      );
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = 2500;
      sourceCanvas.height = 2500;
      const ctx = sourceCanvas.getContext('2d');
      if (!ctx) throw new Error('missing canvas context');

      const image = ctx.createImageData(sourceCanvas.width, sourceCanvas.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const pixel = i / 4;
        image.data[i] = pixel % 251;
        image.data[i + 1] = (pixel * 13) % 251;
        image.data[i + 2] = (pixel * 29) % 251;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);

      const blob = await new Promise((resolve, reject) => {
        sourceCanvas.toBlob((value) => {
          if (!value) {
            reject(new Error('missing png blob'));
            return;
          }
          resolve(value);
        }, 'image/png');
      });

      const sourceFile = new File([blob], 'oversized.png', {
        type: 'image/png',
      });
      const compressed = await compressAtprotoImageIfNeeded(sourceFile);
      const compressedBitmap = await createImageBitmap(compressed);
      const compressedResult = {
        sourceSize: sourceFile.size,
        size: compressed.size,
        type: compressed.type,
        name: compressed.name,
        width: compressedBitmap.width,
        height: compressedBitmap.height,
      };
      compressedBitmap.close();
      return compressedResult;
    })()`));

    expect(result.sourceSize).toBeGreaterThan(ATPROTO_IMAGE_MAX_BYTES);
    expect(result.size).toBeLessThanOrEqual(ATPROTO_IMAGE_MAX_BYTES);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('oversized.jpg');
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
      ATPROTO_IMAGE_MAX_LONG_EDGE,
    );
  });

  test('does not require createImageBitmap for compression', async ({ page }) => {
    await page.goto('/');

    const result = parseCompressionResult(await page.evaluate(`(async () => {
      const { compressAtprotoImageIfNeeded } = await import(
        '/src/utils/atproto-image-compression.ts'
      );
      window.createImageBitmap = async () => {
        throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
      };

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = 5000;
      sourceCanvas.height = 2500;
      const ctx = sourceCanvas.getContext('2d');
      if (!ctx) throw new Error('missing canvas context');
      ctx.fillStyle = '#d33';
      ctx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);

      const blob = await new Promise((resolve, reject) => {
        sourceCanvas.toBlob((value) => {
          if (!value) {
            reject(new Error('missing png blob'));
            return;
          }
          resolve(value);
        }, 'image/png');
      });

      const sourceFile = new File([blob], 'large.png', {
        type: 'image/png',
      });
      const compressed = await compressAtprotoImageIfNeeded(sourceFile);
      const imageUrl = URL.createObjectURL(compressed);
      const image = new Image();
      const loaded = new Promise((resolve, reject) => {
        image.addEventListener('load', resolve);
        image.addEventListener('error', reject);
      });
      image.src = imageUrl;
      await loaded;
      const compressedResult = {
        sourceSize: sourceFile.size,
        size: compressed.size,
        type: compressed.type,
        name: compressed.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      URL.revokeObjectURL(imageUrl);
      return compressedResult;
    })()`));

    expect(result.size).toBeLessThanOrEqual(ATPROTO_IMAGE_MAX_BYTES);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('large.jpg');
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
      ATPROTO_IMAGE_MAX_LONG_EDGE,
    );
  });
});
