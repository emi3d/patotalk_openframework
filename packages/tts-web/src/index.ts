import type { SpeakOptions, SpeechAudio, TTSProvider } from "@patotalk/core";

export { KokoroWebTTS, KOKORO_VOICES, type KokoroWebOptions } from "./kokoro.js";
export { SupertonicWebTTS, SUPERTONIC_LANGUAGES, type SupertonicWebOptions } from "./supertonic.js";
export { kanaToKokoro, toHiragana, hasKanji } from "./ja-kana.js";

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
      u.onend = () => resolve();
      u.onerror = (e) => reject(new Error(e.error));
      speechSynthesis.speak(u);
    });
    return { samples: new Float32Array(0), sampleRate: 24000 };
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
