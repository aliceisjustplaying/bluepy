// Minimal shims for the experimental Chrome AI APIs used here.
// https://developer.chrome.com/docs/ai/language-detection
// https://developer.chrome.com/docs/ai/translator-api
type AIAvailability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

interface AIMonitorEvent {
  loaded: number;
}

interface AIMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: AIMonitorEvent) => void,
  ): void;
}

interface LanguageDetectorInstance {
  ready: Promise<void>;
  detect(
    text: string,
  ): Promise<Array<{ detectedLanguage: string; confidence?: number }>>;
}

interface LanguageDetectorStatic {
  availability(): Promise<AIAvailability>;
  create(options?: {
    monitor?: (m: AIMonitor) => void;
  }): Promise<LanguageDetectorInstance>;
}

interface TranslatorInstance {
  ready: Promise<void>;
  translate(text: string): Promise<string>;
}

interface TranslatorStatic {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<AIAvailability>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: AIMonitor) => void;
  }): Promise<TranslatorInstance>;
}

declare const LanguageDetector: LanguageDetectorStatic;
declare const Translator: TranslatorStatic;

const supportsLanguageDetector = 'LanguageDetector' in self;
export const supportsBrowserTranslator =
  supportsLanguageDetector && 'Translator' in self;

// https://developer.chrome.com/docs/ai/language-detection
export let langDetector: LanguageDetectorInstance | undefined;
let langDetectorPromise: Promise<LanguageDetectorInstance | undefined> | null =
  null;

async function getLanguageDetector(): Promise<
  LanguageDetectorInstance | undefined
> {
  if (langDetector) return langDetector;
  if (!supportsLanguageDetector) return undefined;
  langDetectorPromise ??= (async () => {
    try {
      const availability = await LanguageDetector.availability();
      if (availability !== 'available') return undefined;
      langDetector = await LanguageDetector.create();
      return langDetector;
    } catch (e) {
      console.warn(e);
      return undefined;
    }
  })();
  return langDetectorPromise;
}

export interface TranslateResult {
  content?: string;
  detectedSourceLanguage?: string;
  provider?: string;
  error?: unknown;
}

// console.groupEnd() takes no arguments per the spec; the original JS passed a
// label as a harmless no-op. The call-site cast preserves both runtime call
// shape (method on `console`) and the original argument.
type ConsoleGroupEnd = (label?: string) => void;

// https://developer.chrome.com/docs/ai/translator-api
export const translate = async (
  text: string,
  source: string,
  target: string,
): Promise<TranslateResult> => {
  let detectedSourceLanguage: string | undefined;
  const originalSource = source;
  if (source === 'auto') {
    const detector = await getLanguageDetector();
    if (!detector?.detect) {
      return {
        error: 'No language detector',
      };
    }
    try {
      const results = await detector.detect(text);
      source = results[0].detectedLanguage;
      detectedSourceLanguage = source;
    } catch (e) {
      console.warn(e);
      return {
        error: e,
      };
    }
  }
  const groupLabel = `💬 BROWSER TRANSLATE ${text}`;
  console.groupCollapsed(groupLabel);
  console.log(originalSource, detectedSourceLanguage, target);
  try {
    const translatorCapabilities = await Translator.availability({
      sourceLanguage: source,
      targetLanguage: target,
    });
    // Note: Translator.availability() returns 'unavailable', 'downloadable', 'downloading', or 'available'.
    if (translatorCapabilities === 'unavailable') {
      (console.groupEnd as ConsoleGroupEnd)(groupLabel);
      return {
        error: `Unsupported language pair: ${source} -> ${target}`,
      };
    }
    let translator: TranslatorInstance;
    if (translatorCapabilities === 'available') {
      translator = await Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
      });
    } else {
      translator = await Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            console.log(
              `Translate ${source} -> ${target}: Downloaded ${e.loaded * 100}%`,
            );
          });
        },
      });
      await translator.ready;
    }

    const content = await translator.translate(text);
    console.log(content);
    (console.groupEnd as ConsoleGroupEnd)(groupLabel);

    return {
      content,
      detectedSourceLanguage,
      provider: 'browser',
    };
  } catch (e) {
    (console.groupEnd as ConsoleGroupEnd)(groupLabel);
    console.error(e);
    return {
      error: e,
    };
  }
};
