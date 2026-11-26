import type { SpeakOptions, SpeechAudio, TTSProvider } from "@patotalk/core";

export { KokoroWebTTS, KOKORO_VOICES, type KokoroWebOptions } from "./kokoro.js";
export { SupertonicWebTTS, SUPERTONIC_LANGUAGES, type SupertonicWebOptions } from "./supertonic.js";
export { kanaToKokoro, toHiragana, hasKanji } from "./ja-kana.js";
export { cleanForSpeech, serial } from "./util.js";
export { VoiceRecorder, type RecordedVoice } from "./recorder.js";
export { HandsFreeMic, EnergyDetector, TenVadDetector, TEN_VAD_URL, type VoiceDetector, type HandsFreeOptions } from "./handsfree.js";

/** The browser's built-in voices (Web Speech API). Speaks directly; returns no samples. */
export class WebSpeechTTS implements TTSProvider {
  readonly id = "web-speech";
  async synthesize(text: string, opts: SpeakOptions): Promise<SpeechAudio> {
    await new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang;
      u.rate = opts.speed ?? 1;
      const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(opts.lang.toLowerCase()));
      if (v) u.voice = v;
      const done = setTimeout(resolve, 5000 + text.length * 200); // some browsers never fire onend
      u.onend = () => (clearTimeout(done), resolve());
      u.onerror = (e) => (clearTimeout(done), e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error(e.error)));
      speechSynthesis.speak(u);
    });
    return { samples: new Float32Array(0), sampleRate: 24000 };
  }
}

/**
 * Plays one clip at a time: starting a new clip stops the previous one.
 * level() gives the output loudness (0..1) for lip-sync, progress() how much of the clip was heard (for interruptions).
 */
export class AudioPlayer {
  private ctx?: AudioContext;
  private current?: AudioBufferSourceNode;
  private analyser?: AnalyserNode;
  private buf = new Float32Array(1024);
  private startedAt = 0;
  private duration = 0;
  private closed = false;
  async play(a: SpeechAudio): Promise<void> {
    this.stop();
    if (this.closed || (!a.data && !a.samples?.length)) return; // a late clip after close() must stay silent
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.ctx.destination);
    }
    const buf = a.data
      ? await this.ctx.decodeAudioData(a.data.slice().buffer)
      : (() => {
          const b = this.ctx!.createBuffer(1, a.samples!.length, a.sampleRate ?? 24000);
          b.copyToChannel(a.samples as Float32Array<ArrayBuffer>, 0);
          return b;
        })();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    this.current = src;
    this.duration = buf.duration;
    return new Promise<void>((resolve) => {
      src.onended = () => {
        if (this.current === src) this.current = undefined;
        resolve();
      };
      this.startedAt = this.ctx!.currentTime;
      src.start();
    });
  }
  /** True while a clip is playing. */
  get playing() {
    return !!this.current;
  }
  /** Current output loudness, roughly 0..1. */
  level(): number {
    if (!this.current || !this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }
  /** Fraction (0..1) of the current clip played so far. */
  progress(): number {
    if (!this.current || !this.ctx || !this.duration) return 0;
    return Math.min(1, (this.ctx.currentTime - this.startedAt) / this.duration);
  }
  stop() {
    try {
      this.current?.stop();
    } catch {}
    this.current = undefined;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
  close() {
    this.closed = true;
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = undefined;
    this.analyser = undefined;
  }
}

/** Play a SpeechAudio in the browser. Resolves when playback ends. */
export async function playAudio(a: SpeechAudio, ctx = new AudioContext()): Promise<void> {
  if (a.data) {
    const buf = await ctx.decodeAudioData(a.data.slice().buffer);
    return playBuffer(ctx, buf);
  }
  if (!a.samples?.length) return;
  const buf = ctx.createBuffer(1, a.samples.length, a.sampleRate ?? 24000);
  buf.copyToChannel(a.samples as Float32Array<ArrayBuffer>, 0);
  return playBuffer(ctx, buf);
}

function playBuffer(ctx: AudioContext, buf: AudioBuffer) {
  return new Promise<void>((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => resolve();
    src.start();
  });
}
