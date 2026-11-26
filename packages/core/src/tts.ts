import { registerTTSProvider } from "./providers.js";

export interface SpeechAudio {
  samples?: Float32Array;
  sampleRate?: number;
  data?: Uint8Array;
  mimeType?: string;
}

export interface SpeakOptions {
  lang: string;
  voice?: string;
  gender?: "female" | "male" | "any";
  speed?: number;
}

export interface TTSProvider {
  readonly id: string;
  readonly languages?: string[];
  synthesize(text: string, opts: SpeakOptions): Promise<SpeechAudio>;
}

export class SilentTTS implements TTSProvider {
  readonly id = "silent";
  async synthesize(): Promise<SpeechAudio> {
    return { samples: new Float32Array(0), sampleRate: 24000 };
  }
}

export class OpenAISpeechTTS implements TTSProvider {
  readonly id = "openai-speech";
  constructor(private cfg: { baseUrl: string; apiKey?: string; model?: string; voice?: string; format?: "wav" | "mp3" }) {}
  async synthesize(text: string, opts: SpeakOptions): Promise<SpeechAudio> {
    const format = this.cfg.format ?? "wav";
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.cfg.model ?? "tts-1", voice: opts.voice ?? this.cfg.voice ?? "alloy", input: text, response_format: format, speed: opts.speed }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
    return { data: new Uint8Array(await res.arrayBuffer()), mimeType: format === "wav" ? "audio/wav" : "audio/mpeg" };
  }
}

export class GeminiTTS implements TTSProvider {
  readonly id = "gemini-tts";
  constructor(private cfg: { apiKey: string; model?: string; voice?: string }) {}
  async synthesize(text: string, opts: SpeakOptions): Promise<SpeechAudio> {
    const model = this.cfg.model ?? "gemini-2.5-flash-preview-tts";
    const voice = opts.voice ?? this.cfg.voice ?? (opts.gender === "male" ? "Charon" : "Kore");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.cfg.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    });
    if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string } }[] } }[] };
    const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
    if (!b64) throw new Error("Gemini TTS: no audio in response");
    const bytes = base64ToBytes(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    return { samples: Float32Array.from(pcm, (v) => v / 32768), sampleRate: 24000 };
  }
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}

export function toWavBytes(a: SpeechAudio): { data: Uint8Array; mimeType: string } {
  if (a.data) return { data: a.data, mimeType: a.mimeType ?? "audio/wav" };
  return { data: encodeWav(a.samples ?? new Float32Array(0), a.sampleRate ?? 24000), mimeType: "audio/wav" };
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array((globalThis as any).Buffer.from(b64, "base64"));
}

registerTTSProvider({
  id: "gemini-tts",
  label: "Gemini TTS (cloud)",
  fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "Blank = the Gemini language key" }],
  create: (o, ctx) => new GeminiTTS({ apiKey: o.apiKey || ctx.option?.("gemini", "apiKey") || "" }),
});

registerTTSProvider({
  id: "openai-speech",
  label: "OpenAI-compatible speech server (OpenAI or any /v1/audio/speech server)",
  fields: [
    { key: "baseUrl", label: "Speech server URL", required: true, placeholder: "http://localhost:8880" },
    { key: "apiKey", label: "API key", secret: true },
    { key: "model", label: "Model" },
    { key: "voice", label: "Voice" },
  ],
  create: (o) => new OpenAISpeechTTS({ baseUrl: o.baseUrl!, apiKey: o.apiKey || undefined, model: o.model || undefined, voice: o.voice || undefined }),
});
