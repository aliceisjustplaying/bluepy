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

// Vite aliases 'react' to 'preact/compat' at bundle time. Provide a minimal
// ambient module for the .ts files that import directly from 'react'.
// We intentionally do NOT re-export preact/compat's full namespace here:
// transitive third-party .d.ts files (e.g. @szhsin/react-menu) reference
// `React.*` types whose preact/compat equivalents are not 1:1, and surfacing
// those mismatches in unrelated files is outside this batch's scope.
declare module 'react' {
  export const useEffect: (cb: () => void, deps: readonly unknown[]) => void;
}
