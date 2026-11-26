import type { SpeakOptions, SpeechAudio, TTSProvider } from "@patotalk/core";

export { KokoroWebTTS, KOKORO_VOICES, type KokoroWebOptions } from "./kokoro.js";
export { SupertonicWebTTS, SUPERTONIC_LANGUAGES, type SupertonicWebOptions } from "./supertonic.js";
export { kanaToKokoro, toHiragana, hasKanji } from "./ja-kana.js";
export { cleanForSpeech, serial } from "./util.js";
export { VoiceRecorder, type RecordedVoice } from "./recorder.js";

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

/** Plays one clip at a time: starting a new clip stops the previous one. */
export class AudioPlayer {
  private ctx?: AudioContext;
  private current?: AudioBufferSourceNode;
  async play(a: SpeechAudio): Promise<void> {
    this.stop();
    if (!a.data && !a.samples?.length) return;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    const buf = a.data
      ? await this.ctx.decodeAudioData(a.data.slice().buffer)
      : (() => {
          const b = this.ctx!.createBuffer(1, a.samples!.length, a.sampleRate ?? 24000);
          b.copyToChannel(a.samples as Float32Array<ArrayBuffer>, 0);
          return b;
        })();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    this.current = src;
    return new Promise<void>((resolve) => {
      src.onended = () => {
        if (this.current === src) this.current = undefined;
        resolve();
      };
      src.start();
    });
  }
  stop() {
    try {
      this.current?.stop();
    } catch {}
    this.current = undefined;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
  close() {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = undefined;
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
