import type { SpeakOptions, SpeechAudio, TTSProvider } from "@patotalk/core";

/** Supertonic 3 languages (31). It reads characters directly: no phonemizer needed, kanji included. */
export const SUPERTONIC_LANGUAGES = [
  "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu",
  "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
];

export interface SupertonicWebOptions {
  /** Folder laid out like the Hugging Face repo (onnx/..., voice_styles/...). */
  baseUrl?: string;
  /** "webgpu" is faster where available; "wasm" works everywhere. */
  executionProviders?: string[];
  /** Denoising steps (quality vs speed). Default 8. */
  steps?: number;
  onProgress?: (file: string) => void;
}

const HF = "https://huggingface.co/Supertone/supertonic-3/resolve/main/";
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const ENGINE = "https://cdn.jsdelivr.net/npm/@yomiscript/supertonic@0.1.0/+esm";

/**
 * Supertonic 3 in the browser (onnxruntime-web). Inference follows the official SDK
 * through @yomiscript/supertonic's engine (Apache-2.0). Voices: F1-F5, M1-M5.
 */
export class SupertonicWebTTS implements TTSProvider {
  readonly id = "supertonic-web";
  readonly languages = SUPERTONIC_LANGUAGES;
  private engine?: Promise<any>;
  constructor(private opts: SupertonicWebOptions = {}) {}

  load(): Promise<any> {
    this.engine ??= (async () => {
      const ort = await import(/* @vite-ignore */ ORT + "ort.webgpu.bundle.min.mjs");
      ort.env.wasm.wasmPaths = ORT;
      const { SupertonicEngine } = await import(/* @vite-ignore */ ENGINE);
      const base = this.opts.baseUrl ?? HF;
      const load = async (path: string) => {
        this.opts.onProgress?.(path);
        const r = await fetch(base + path);
        if (!r.ok) throw new Error(`Supertonic: ${path} ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      };
      const eps = this.opts.executionProviders ?? ((navigator as any).gpu ? ["webgpu", "wasm"] : ["wasm"]);
      return new SupertonicEngine(ort, load).init({ executionProviders: eps });
    })();
    return this.engine;
  }

  async synthesize(text: string, opts: SpeakOptions): Promise<SpeechAudio> {
    const engine = await this.load();
    const lang = opts.lang.toLowerCase().split("-")[0];
    const voice = opts.voice ?? (opts.gender === "male" ? "M1" : "F1");
    const r = await engine.synthesize(text, {
      voice,
      lang: SUPERTONIC_LANGUAGES.includes(lang) ? lang : "na",
      steps: this.opts.steps ?? 8,
      speed: opts.speed ?? 1.05,
    });
    return { samples: r.samples as Float32Array, sampleRate: r.sampleRate as number };
  }
}
