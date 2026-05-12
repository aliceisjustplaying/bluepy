// Ambient module declarations for untyped peer deps used by leaf utilities.
// These shims keep the converted .ts files free of inline ts-ignore.

type ColorConverter = (...args: unknown[]) => number[];

declare module 'chroma-js/src/io/oklab/oklab2rgb.js' {
  const oklab2rgb: ColorConverter;
  export default oklab2rgb;
}
declare module 'chroma-js/src/io/oklab/rgb2oklab.js' {
  const rgb2oklab: ColorConverter;
  export default rgb2oklab;
}
declare module 'chroma-js/src/io/oklch/oklch2rgb.js' {
  const oklch2rgb: ColorConverter;
  export default oklch2rgb;
}
declare module 'chroma-js/src/io/oklch/rgb2oklch.js' {
  const rgb2oklch: ColorConverter;
  export default rgb2oklch;
}

declare module 'toastify-js' {
  const Toastify: (options: Record<string, unknown>) => {
    showToast(): void;
    hideToast(): void;
  };
  export default Toastify;
}

declare module 'exifreader/dist/exif-reader.js' {
  interface ExifTag {
    description?: string;
  }
  interface ExifReader {
    load(file: File | Blob): Promise<Record<string, ExifTag | undefined>>;
  }
  const ExifReader: ExifReader;
  export default ExifReader;
}
