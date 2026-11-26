import type { SpeakOptions, SpeechAudio, TTSProvider } from "@patotalk/core";
import { cleanForSpeech, serial } from "./util.js";

export const SUPERTONIC_LANGUAGES = [
  "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu",
  "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
];

export interface SupertonicWebOptions {
  baseUrl?: string;
  executionProviders?: string[];
  steps?: number;
  onProgress?: (file: string) => void;
}

const HF = "https://huggingface.co/Supertone/supertonic-3/resolve/main/";
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const ENGINE = "https://cdn.jsdelivr.net/npm/@yomiscript/supertonic@0.1.0/+esm";

function gaussian(n: number): Float32Array {
  const u = new Uint32Array(n + (n % 2));
  for (let i = 0; i < u.length; i += 16384) crypto.getRandomValues(u.subarray(i, i + 16384));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log((u[i] + 0.5) / 2 ** 32));
    const t = (2 * Math.PI * (u[i + 1] + 0.5)) / 2 ** 32;
    out[i] = r * Math.cos(t);
    if (i + 1 < n) out[i + 1] = r * Math.sin(t);
  }
  return out;
}

export class SupertonicWebTTS implements TTSProvider {
  readonly id = "supertonic-web";
  readonly languages = SUPERTONIC_LANGUAGES;
  private engine?: Promise<any>;
  private queue = serial();
  private wasmOnly = false;
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
      const eps = this.wasmOnly ? ["wasm"] : this.opts.executionProviders ?? ((navigator as any).gpu ? ["webgpu", "wasm"] : ["wasm"]);
      return new SupertonicEngine(ort, load).init({ executionProviders: eps });
    })();
    this.engine.catch(() => (this.engine = undefined)); // a failed download can be retried
    return this.engine;
  }

  synthesize(text: string, opts: SpeakOptions): Promise<SpeechAudio> {
    return this.queue(async () => {
      try {
        return await this.run(text, opts);
      } catch {
        this.engine = undefined; // broken session (e.g. WebGPU device lost): start fresh on WASM
        this.wasmOnly = true;
        return this.run(text, opts);
      }
    });
  }

  private async run(text: string, opts: SpeakOptions): Promise<SpeechAudio> {
    const engine = await this.load();
    const lang = opts.lang.toLowerCase().split("-")[0];
    let clean = cleanForSpeech(text);
    const bad: string[] = engine.unsupported(clean);
    if (bad.length) clean = [...clean].filter((c) => !bad.includes(c)).join("");
    if (!clean.trim()) return { samples: new Float32Array(0), sampleRate: 44100 };
    const r = await engine.synthesize(clean, {
      voice: opts.voice ?? (opts.gender === "male" ? "M1" : "F1"),
      lang: SUPERTONIC_LANGUAGES.includes(lang) ? lang : "na",
      steps: this.opts.steps ?? 8,
      speed: opts.speed ?? 1.05,
      noise: gaussian,
    });
    return { samples: r.samples as Float32Array, sampleRate: r.sampleRate as number };
  }
}
