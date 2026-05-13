import { decompressFrames, parseGIF } from 'gifuct-js';

export async function getGifFirstFrame(gifUrl: string): Promise<string | null> {
  try {
    const response = await fetch(gifUrl);
    const buffer = await response.arrayBuffer();

    const gif = parseGIF(buffer);
    const frames = decompressFrames(gif, true);

    if (!frames?.length) return null;

    const { dims, patch } = frames[0];
    const { width, height } = dims;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imageData = new ImageData(
      patch as unknown as Uint8ClampedArray<ArrayBuffer>,
      width,
      height,
    );
    ctx.putImageData(imageData, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });

    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
