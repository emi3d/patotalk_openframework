import type { SpeakOptions, SpeechAudio, TTSProvider } from "@patotalk/core";
import { hasKanji, kanaToKokoro } from "./ja-kana.js";

/** Kokoro voices per language (Kokoro-82M v1.0). */
export const KOKORO_VOICES: Record<string, { female: string; male: string }> = {
  en: { female: "af_heart", male: "am_michael" },
  "en-gb": { female: "bf_emma", male: "bm_george" },
  ja: { female: "jf_alpha", male: "jm_kumo" },
  fr: { female: "ff_siwis", male: "ff_siwis" },
  es: { female: "ef_dora", male: "em_alex" },
  it: { female: "if_sara", male: "im_nicola" },
  pt: { female: "pf_dora", male: "pm_alex" },
  hi: { female: "hf_alpha", male: "hm_omega" },
  zh: { female: "zf_xiaoxiao", male: "zm_yunxi" },
};

export interface KokoroWebOptions {
  modelId?: string;
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  device?: "webgpu" | "wasm";
  /** Japanese: kanji text -> pronunciation kana (dictionary or LLM). Without it, kanji are skipped. */
  reader?: (text: string) => Promise<string>;
  /** Non-English text -> IPA (eSpeak NG). Default: loads eSpeak NG (GPL-3.0) from a CDN on first use. */
  ipa?: (text: string, lang: string) => Promise<string>;
  onProgress?: (p: unknown) => void;
}

const KOKORO_JS = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
const ESPEAK = "https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/";

/**
 * Kokoro-82M in the browser (kokoro-js / transformers.js, WebGPU or WASM).
 * English uses kokoro-js's own G2P; Japanese uses kana -> Kokoro mora IPA; other languages use eSpeak NG IPA.
 */
export class KokoroWebTTS implements TTSProvider {
  readonly id = "kokoro-web";
  readonly languages = Object.keys(KOKORO_VOICES);
  private tts?: Promise<any>;
  private espeak?: Promise<any>;
  constructor(private opts: KokoroWebOptions = {}) {}

  load(): Promise<any> {
    this.tts ??= (async () => {
      const { KokoroTTS } = await import(/* @vite-ignore */ KOKORO_JS);
      return KokoroTTS.from_pretrained(this.opts.modelId ?? "onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: this.opts.dtype ?? (this.opts.device === "wasm" ? "q8" : "fp32"),
        device: this.opts.device ?? ((navigator as any).gpu ? "webgpu" : "wasm"),
        progress_callback: this.opts.onProgress,
      });
    })();
    return this.tts;
  }

  /** The phoneme string Kokoro is given (exposed for debugging and tests). */
  async phonemes(text: string, lang: string): Promise<string | null> {
    const l = lang.toLowerCase();
    if (l === "en" || l.startsWith("en-")) return null; // kokoro-js handles English itself
    if (l.startsWith("ja")) {
      const kana = hasKanji(text) && this.opts.reader ? await this.opts.reader(text) : text;
      return kanaToKokoro(kana);
    }
    const ipa = this.opts.ipa ?? ((t: string, lg: string) => this.espeakIpa(t, lg));
    return ipa(text, l.split("-")[0]);
  }

  async synthesize(text: string, opts: SpeakOptions): Promise<SpeechAudio> {
    const tts = await this.load();
    const lang = opts.lang.toLowerCase();
    const voices = KOKORO_VOICES[lang] ?? KOKORO_VOICES[lang.split("-")[0]];
    if (!voices) throw new Error(`Kokoro: no voice for language "${opts.lang}"`);
    const voice = opts.voice ?? (opts.gender === "male" ? voices.male : voices.female);
    const ph = await this.phonemes(text, lang);
    let audio: any;
    if (ph === null) audio = await tts.generate(text, { voice, speed: opts.speed ?? 1 });
    else {
      const { input_ids } = tts.tokenizer(ph, { truncation: true });
      audio = await tts.generate_from_ids(input_ids, { voice, speed: opts.speed ?? 1 });
    }
    return { samples: audio.audio as Float32Array, sampleRate: audio.sampling_rate as number };
  }

  /** eSpeak NG IPA per clause, keeping the punctuation Kokoro uses for pauses. */
  private async espeakIpa(text: string, lang: string): Promise<string> {
    this.espeak ??= (async () => {
      const mod = await import(/* @vite-ignore */ ESPEAK + "espeak-ng.js");
      const m = await mod.default({ locateFile: (f: string) => ESPEAK + f });
      return new m.eSpeakNGWorker();
    })();
    const w = await this.espeak;
    w.set_voice(lang);
    const parts = text.split(/([.,!?;:…]+)/);
    let out = "";
    for (const p of parts) {
      if (/^[.,!?;:…]+$/.test(p)) out += p + " ";
      else if (p.trim()) out += String(w.synthesize_ipa(p.trim()).ipa).replace(/_/g, "").replace(/\s*\n\s*/g, " ").trim();
    }
    return out.trim();
  }
}
