import { encodeWav } from "@patotalk/core";
import { toBase64, type RecordedVoice } from "./recorder.js";

/**
 * Hands-free mic: always listening, a tiny voice-activity detector (VAD) decides when the learner
 * starts and stops talking. No speech recognition: each utterance is handed over as WAV audio
 * for the multimodal LLM. Starting to talk while the character speaks counts as an interruption.
 */

const RATE = 16000;
const HOP = 256; // 16 ms at 16 kHz (TEN VAD's optimized hop)

/** Speech probability (0..1) for one 256-sample, 16 kHz frame. Swap in any VAD (TEN, Silero, native on mobile...). */
export interface VoiceDetector {
  readonly id: string;
  process(frame: Int16Array): number;
  destroy?(): void;
}

/** Zero-dependency fallback: loudness above an adaptive noise floor. Works anywhere, but coughs and music count as speech. */
export class EnergyDetector implements VoiceDetector {
  readonly id = "energy";
  private floor = 0.004;
  process(frame: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += (frame[i] / 32768) ** 2;
    const rms = Math.sqrt(sum / frame.length);
    // the floor follows quiet passages quickly and loud ones slowly
    this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.999 + rms * 0.001;
    return Math.max(0, Math.min(1, (rms / Math.max(this.floor, 0.002) - 2) / 4));
  }
}

/**
 * TEN VAD (about 280 KB of WASM, roughly 1% of one CPU core). Loaded at runtime from TEN's own repository,
 * so it is not bundled with this MIT code. Its license is Apache 2.0 with extra conditions from Agora:
 * read it before shipping it in a product (https://github.com/TEN-framework/ten-vad/blob/main/LICENSE).
 */
export const TEN_VAD_URL = "https://cdn.jsdelivr.net/gh/TEN-framework/ten-vad@b425116336f400f1181a46ba2d58b913cc19d3e5/lib/Web/ten_vad.js";

export class TenVadDetector implements VoiceDetector {
  readonly id = "ten-vad";
  private constructor(
    private m: any,
    private handlePtr: number,
    private handle: number,
    private audioPtr: number,
    private probPtr: number,
    private flagPtr: number,
  ) {}

  static async load(url = TEN_VAD_URL): Promise<TenVadDetector> {
    const mod = await import(/* @vite-ignore */ url);
    const m = await mod.default();
    const handlePtr = m._malloc(4);
    if (m._ten_vad_create(handlePtr, HOP, 0.5) !== 0) throw new Error("TEN VAD could not start");
    const handle = m.HEAP32[handlePtr >> 2];
    return new TenVadDetector(m, handlePtr, handle, m._malloc(HOP * 2), m._malloc(4), m._malloc(4));
  }

  process(frame: Int16Array): number {
    this.m.HEAP16.set(frame, this.audioPtr >> 1);
    if (this.m._ten_vad_process(this.handle, this.audioPtr, HOP, this.probPtr, this.flagPtr) !== 0) return 0;
    return this.m.HEAPF32[this.probPtr >> 2];
  }

  destroy() {
    this.m._ten_vad_destroy(this.handlePtr);
    for (const p of [this.handlePtr, this.audioPtr, this.probPtr, this.flagPtr]) this.m._free(p);
  }
}

export interface HandsFreeOptions {
  detector: VoiceDetector;
  /** The learner started talking (stop the character's voice here). */
  onSpeechStart?: () => void;
  /** The learner finished an utterance. */
  onUtterance: (v: RecordedVoice) => void;
  /** Speech started but was too short to send (a cough, a click). */
  onDiscard?: () => void;
  /** Return true while the character is talking: starting then needs a clearer, longer voice, so its own echo doesn't trigger. */
  isCharacterSpeaking?: () => boolean;
  /** Speech probability needed to count as voice. Default 0.5 (0.7 while the character speaks). */
  threshold?: number;
  /** Silence that ends an utterance. Default 800 ms. */
  endSilenceMs?: number;
  /** Shorter utterances are dropped. Default 350 ms. */
  minSpeechMs?: number;
  /** Utterances are cut and sent at this length. Default 30 s. */
  maxSeconds?: number;
}

const WORKLET = `class C extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}
process(i){const x=i[0]&&i[0][0];if(x){for(let k=0;k<x.length;k++){this.b[this.n++]=x[k];if(this.n===2048){this.port.postMessage(this.b.slice());this.n=0}}}return true}}
registerProcessor("pt-capture",C)`;

export class HandsFreeMic {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  // resampler state
  private pos = 0;
  private last = 0;
  private pending: number[] = [];
  // VAD state
  private voiced = 0;
  private silent = 0;
  private speaking = false;
  private pre: Int16Array[] = [];
  private utter: Int16Array[] = [];
  /** While paused (e.g. the model is answering) nothing is recorded. */
  paused = false;
  /** Last speech probability, for a UI meter. */
  probability = 0;

  constructor(private o: HandsFreeOptions) {}

  static get supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
  }

  get listening() {
    return !!this.node;
  }
  /** True while the learner is mid-utterance. */
  get hearing() {
    return this.speaking;
  }

  async start() {
    if (this.node) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    try {
      this.ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const src = this.ctx.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(this.ctx, "pt-capture");
      node.port.onmessage = (e) => this.feed(e.data as Float32Array);
      src.connect(node); // not connected to the speakers
      this.node = node;
    } catch (e) {
      this.stop();
      throw e;
    }
  }

  stop() {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.ctx?.close().catch(() => {});
    this.ctx = undefined;
    this.reset();
  }

  destroy() {
    this.stop();
    this.o.detector.destroy?.();
  }

  private reset() {
    this.voiced = this.silent = 0;
    this.speaking = false;
    this.utter = [];
    this.pre = [];
  }

  /** Linear resample to 16 kHz, then cut into 256-sample frames. */
  private feed(chunk: Float32Array) {
    const step = this.ctx!.sampleRate / RATE;
    let pos = this.pos;
    const get = (i: number) => (i < 0 ? this.last : chunk[i]);
    while (pos < chunk.length - 1) {
      const i = Math.floor(pos);
      const f = pos - i;
      this.pending.push(get(i) * (1 - f) + chunk[i + 1] * f);
      pos += step;
    }
    this.pos = pos - chunk.length;
    this.last = chunk[chunk.length - 1];
    while (this.pending.length >= HOP) {
      const frame = Int16Array.from(this.pending.splice(0, HOP), (v) => Math.max(-32768, Math.min(32767, v * 32768)));
      this.frame(frame);
    }
  }

  private frame(f: Int16Array) {
    if (this.paused) {
      if (this.speaking || this.utter.length) this.reset();
      return;
    }
    const o = this.o;
    const p = (this.probability = o.detector.process(f));
    const ms = (frames: number) => (frames * HOP * 1000) / RATE;
    const echoGuard = !this.speaking && !!o.isCharacterSpeaking?.();
    const isVoice = p >= (echoGuard ? Math.max(0.7, o.threshold ?? 0.5) : (o.threshold ?? 0.5));

    if (!this.speaking) {
      this.pre.push(f);
      if (this.pre.length > 20) this.pre.shift(); // keep ~320 ms before the start
      this.voiced = isVoice ? this.voiced + 1 : 0;
      if (ms(this.voiced) >= (echoGuard ? 190 : 80)) {
        this.speaking = true;
        this.silent = 0;
        this.utter = this.pre;
        this.pre = [];
        o.onSpeechStart?.();
      }
      return;
    }

    this.utter.push(f);
    this.silent = isVoice ? 0 : this.silent + 1;
    const total = ms(this.utter.length);
    if (ms(this.silent) >= (o.endSilenceMs ?? 800) || total >= (o.maxSeconds ?? 30) * 1000) {
      const frames = this.utter.slice(0, this.utter.length - Math.max(0, this.silent - 12)); // keep ~200 ms of tail
      const speechMs = total - ms(this.silent);
      this.reset();
      if (speechMs < (o.minSpeechMs ?? 350)) return o.onDiscard?.();
      o.onUtterance(toVoice(frames));
    }
  }
}

function toVoice(frames: Int16Array[]): RecordedVoice {
  const samples = new Float32Array(frames.length * HOP);
  frames.forEach((f, k) => {
    for (let i = 0; i < HOP; i++) samples[k * HOP + i] = f[i] / 32768;
  });
  const wav = encodeWav(samples, RATE);
  return {
    audio: toBase64(wav),
    mimeType: "audio/wav",
    seconds: Math.round((samples.length / RATE) * 10) / 10,
    url: URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" })),
  };
}
