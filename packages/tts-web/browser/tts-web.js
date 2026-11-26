// src/ja-kana.ts
var V = { a: "a", i: "i", u: "\u026F", e: "e", o: "o" };
var ROWS = [
  ["\u3042\u3044\u3046\u3048\u304A", ""],
  ["\u304B\u304D\u304F\u3051\u3053", "k"],
  ["\u304C\u304E\u3050\u3052\u3054", "\u0261"],
  ["\u3055\u3057\u3059\u305B\u305D", "s"],
  ["\u3056\u3058\u305A\u305C\u305E", "z"],
  ["\u305F\u3061\u3064\u3066\u3068", "t"],
  ["\u3060\u3062\u3065\u3067\u3069", "d"],
  ["\u306A\u306B\u306C\u306D\u306E", "n"],
  ["\u306F\u3072\u3075\u3078\u307B", "h"],
  ["\u3070\u3073\u3076\u3079\u307C", "b"],
  ["\u3071\u3074\u3077\u307A\u307D", "p"],
  ["\u307E\u307F\u3080\u3081\u3082", "m"],
  ["\u3089\u308A\u308B\u308C\u308D", "\u027E"]
];
var VOWEL_ORDER = ["a", "i", "u", "e", "o"];
var MORA = /* @__PURE__ */ new Map();
for (const [kana, c] of ROWS) [...kana].forEach((k, i) => MORA.set(k, [c, VOWEL_ORDER[i]]));
Object.entries({
  \u3057: ["\u0255", "i"],
  \u3061: ["\u02A8", "i"],
  \u3064: ["\u02A6", "u"],
  \u3075: ["\u0278", "u"],
  \u3072: ["\xE7", "i"],
  \u3058: ["\u02A5", "i"],
  \u3062: ["\u02A5", "i"],
  \u3065: ["z", "u"],
  \u306B: ["\u0272", "i"],
  \u3084: ["j", "a"],
  \u3086: ["j", "u"],
  \u3088: ["j", "o"],
  \u308F: ["\u03B2", "a"],
  \u3092: ["", "o"],
  \u3094: ["v", "u"]
}).forEach(([k, v]) => MORA.set(k, v));
var PAL = { \u304D: "k\u02B2", \u304E: "\u0261\u02B2", \u3057: "\u0255", \u3058: "\u02A5", \u3061: "\u02A8", \u3062: "\u02A5", \u306B: "\u0272", \u3072: "\xE7", \u3073: "b\u02B2", \u3074: "p\u02B2", \u307F: "m\u02B2", \u308A: "\u027E\u02B2" };
for (const [k, c] of Object.entries(PAL)) {
  MORA.set(k + "\u3083", [c, "a"]);
  MORA.set(k + "\u3085", [c, "u"]);
  MORA.set(k + "\u3087", [c, "o"]);
  MORA.set(k + "\u3047", [c, "e"]);
}
Object.entries({
  \u3066\u3043: ["t", "i"],
  \u3067\u3043: ["d", "i"],
  \u3068\u3045: ["t", "u"],
  \u3069\u3045: ["d", "u"],
  \u3075\u3041: ["\u0278", "a"],
  \u3075\u3043: ["\u0278", "i"],
  \u3075\u3047: ["\u0278", "e"],
  \u3075\u3049: ["\u0278", "o"],
  \u3046\u3043: ["\u03B2", "i"],
  \u3046\u3047: ["\u03B2", "e"],
  \u3046\u3049: ["\u03B2", "o"],
  \u3064\u3041: ["\u02A6", "a"],
  \u3064\u3047: ["\u02A6", "e"],
  \u3094\u3041: ["v", "a"],
  \u3094\u3043: ["v", "i"],
  \u3094\u3047: ["v", "e"],
  \u3094\u3049: ["v", "o"],
  \u3044\u3047: ["j", "e"],
  \u3057\u3047: ["\u0255", "e"],
  \u3058\u3047: ["\u02A5", "e"],
  \u3061\u3047: ["\u02A8", "e"]
}).forEach(([k, v]) => MORA.set(k, v));
Object.entries({ \u3041: ["", "a"], \u3043: ["", "i"], \u3045: ["", "u"], \u3047: ["", "e"], \u3049: ["", "o"], \u3083: ["j", "a"], \u3085: ["j", "u"], \u3087: ["j", "o"] }).forEach(
  ([k, v]) => MORA.set(k, v)
);
var PUNCT = { "\u3002": ".", "\u3001": ",", "\uFF01": "!", "\uFF1F": "?", "!": "!", "?": "?", ".": ".", ",": ",", "\u2026": "\u2026", "\u300C": "\u201C", "\u300D": "\u201D", "\u3000": " ", " ": " " };
var toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 96));
function kokoroMora(on, vowel) {
  let v = V[vowel];
  if (v === "i" && /^[kɡbpmɾvɸtdʦ]$/.test(on)) on += "\u02B2";
  if (v === "\u026F" && (/ʲ$/.test(on) || /^[ɕʥʨçsʦɲz]$/.test(on))) v = "\u0268";
  return on + v;
}
function kanaToKokoro(text) {
  const s = toHiragana(text.normalize("NFKC"));
  let out = "";
  let geminate = false;
  let lastVowel = "";
  for (let i = 0; i < s.length; ) {
    const two = s.slice(i, i + 2);
    const c = s[i];
    if (c === "\u3063") {
      geminate = true;
      i++;
      continue;
    }
    if (c === "\u3093") {
      out += "\u0274";
      lastVowel = "";
      i++;
      continue;
    }
    if (c === "\u30FC") {
      if (lastVowel) out += "\u02D0";
      i++;
      continue;
    }
    if (c in PUNCT) {
      if (geminate) out += "\u0294";
      geminate = false;
      out += PUNCT[c] + (/[.,!?…]/.test(PUNCT[c]) ? " " : "");
      lastVowel = "";
      i++;
      continue;
    }
    const m2 = MORA.get(two);
    const m = m2 ?? MORA.get(c);
    if (!m) {
      i++;
      continue;
    }
    const [on, vowel] = m;
    if (geminate) out += on ? on[0] === "\u02A8" ? "t" : on[0] === "\u02A6" ? "t" : on[0] : "\u0294";
    geminate = false;
    if (!on && lastVowel && (vowel === lastVowel || vowel === "u" && lastVowel === "o" || vowel === "i" && lastVowel === "e")) {
      out += "\u02D0";
      lastVowel = "";
    } else {
      out += kokoroMora(on, vowel);
      lastVowel = vowel;
    }
    i += m2 ? 2 : 1;
  }
  if (geminate) out += "\u0294";
  return out.replace(/\s+/g, " ").trim();
}
var hasKanji = (s) => /\p{Script=Han}/u.test(s);

// src/util.ts
function serial() {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job, job);
    tail = run.catch(() => {
    });
    return run;
  };
}
function cleanForSpeech(text) {
  return text.replace(/https?:\/\/\S+/g, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*[^*\n]{1,80}\*/g, "").replace(/[*_`#>~|]+/g, "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
}

// src/kokoro.ts
var KOKORO_VOICES = {
  en: { female: "af_heart", male: "am_michael" },
  "en-gb": { female: "bf_emma", male: "bm_george" },
  ja: { female: "jf_alpha", male: "jm_kumo" },
  fr: { female: "ff_siwis", male: "ff_siwis" },
  es: { female: "ef_dora", male: "em_alex" },
  it: { female: "if_sara", male: "im_nicola" },
  pt: { female: "pf_dora", male: "pm_alex" },
  hi: { female: "hf_alpha", male: "hm_omega" },
  zh: { female: "zf_xiaoxiao", male: "zm_yunxi" }
};
var KOKORO_JS = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
var ESPEAK = "https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/";
var KokoroWebTTS = class {
  constructor(opts = {}) {
    this.opts = opts;
  }
  opts;
  id = "kokoro-web";
  languages = Object.keys(KOKORO_VOICES);
  tts;
  espeak;
  queue = serial();
  load() {
    this.tts ??= (async () => {
      const { KokoroTTS } = await import(
        /* @vite-ignore */
        KOKORO_JS
      );
      return KokoroTTS.from_pretrained(this.opts.modelId ?? "onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: this.opts.dtype ?? "fp32",
        // WASM by default: in our tests WebGPU produced clipped/garbled audio for Japanese and French.
        device: this.opts.device ?? "wasm",
        progress_callback: this.opts.onProgress
      });
    })();
    this.tts.catch(() => this.tts = void 0);
    return this.tts;
  }
  /** The phoneme string Kokoro is given (exposed for debugging and tests). */
  async phonemes(text, lang) {
    const l = lang.toLowerCase();
    if (l === "en" || l.startsWith("en-")) return null;
    if (l.startsWith("ja")) {
      let kana = text;
      if (hasKanji(text) && this.opts.reader) {
        try {
          kana = await this.opts.reader(text);
        } catch {
          kana = text;
        }
      }
      return kanaToKokoro(kana);
    }
    const ipa = this.opts.ipa ?? ((t, lg) => this.espeakIpa(t, lg));
    return ipa(text, l.split("-")[0]);
  }
  synthesize(text, opts) {
    return this.queue(() => this.run(cleanForSpeech(text), opts));
  }
  async run(text, opts) {
    if (!text) return { samples: new Float32Array(0), sampleRate: 24e3 };
    const tts = await this.load();
    const lang = opts.lang.toLowerCase();
    const voices = KOKORO_VOICES[lang] ?? KOKORO_VOICES[lang.split("-")[0]];
    if (!voices) throw new Error(`Kokoro: no voice for language "${opts.lang}"`);
    const voice = opts.voice ?? (opts.gender === "male" ? voices.male : voices.female);
    const ph = await this.phonemes(text, lang);
    if (ph !== null && !ph.trim()) return { samples: new Float32Array(0), sampleRate: 24e3 };
    let audio;
    if (ph === null) audio = await tts.generate(text, { voice, speed: opts.speed ?? 1 });
    else {
      const { input_ids } = tts.tokenizer(ph, { truncation: true });
      audio = await tts.generate_from_ids(input_ids, { voice, speed: opts.speed ?? 1 });
    }
    return { samples: audio.audio, sampleRate: audio.sampling_rate };
  }
  /** eSpeak NG IPA per clause, keeping the punctuation Kokoro uses for pauses. */
  async espeakIpa(text, lang) {
    this.espeak ??= (async () => {
      const mod = await import(
        /* @vite-ignore */
        ESPEAK + "espeak-ng.js"
      );
      const m = await mod.default({ locateFile: (f) => ESPEAK + f });
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
};

// src/supertonic.ts
var SUPERTONIC_LANGUAGES = [
  "en",
  "ko",
  "ja",
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "lt",
  "lv",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi"
];
var HF = "https://huggingface.co/Supertone/supertonic-3/resolve/main/";
var ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
var ENGINE = "https://cdn.jsdelivr.net/npm/@yomiscript/supertonic@0.1.0/+esm";
var SupertonicWebTTS = class {
  constructor(opts = {}) {
    this.opts = opts;
  }
  opts;
  id = "supertonic-web";
  languages = SUPERTONIC_LANGUAGES;
  engine;
  queue = serial();
  wasmOnly = false;
  load() {
    this.engine ??= (async () => {
      const ort = await import(
        /* @vite-ignore */
        ORT + "ort.webgpu.bundle.min.mjs"
      );
      ort.env.wasm.wasmPaths = ORT;
      const { SupertonicEngine } = await import(
        /* @vite-ignore */
        ENGINE
      );
      const base = this.opts.baseUrl ?? HF;
      const load = async (path) => {
        this.opts.onProgress?.(path);
        const r = await fetch(base + path);
        if (!r.ok) throw new Error(`Supertonic: ${path} ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      };
      const eps = this.wasmOnly ? ["wasm"] : this.opts.executionProviders ?? (navigator.gpu ? ["webgpu", "wasm"] : ["wasm"]);
      return new SupertonicEngine(ort, load).init({ executionProviders: eps });
    })();
    this.engine.catch(() => this.engine = void 0);
    return this.engine;
  }
  /** One synthesis at a time; on an engine error the engine is rebuilt and the text tried once more. */
  synthesize(text, opts) {
    return this.queue(async () => {
      try {
        return await this.run(text, opts);
      } catch {
        this.engine = void 0;
        this.wasmOnly = true;
        return this.run(text, opts);
      }
    });
  }
  async run(text, opts) {
    const engine = await this.load();
    const lang = opts.lang.toLowerCase().split("-")[0];
    let clean = cleanForSpeech(text);
    const bad = engine.unsupported(clean);
    if (bad.length) clean = [...clean].filter((c) => !bad.includes(c)).join("");
    if (!clean.trim()) return { samples: new Float32Array(0), sampleRate: 44100 };
    const r = await engine.synthesize(clean, {
      voice: opts.voice ?? (opts.gender === "male" ? "M1" : "F1"),
      lang: SUPERTONIC_LANGUAGES.includes(lang) ? lang : "na",
      steps: this.opts.steps ?? 8,
      speed: opts.speed ?? 1.05
    });
    return { samples: r.samples, sampleRate: r.sampleRate };
  }
};

// src/index.ts
var WebSpeechTTS = class {
  id = "web-speech";
  async synthesize(text, opts) {
    await new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang;
      u.rate = opts.speed ?? 1;
      const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(opts.lang.toLowerCase()));
      if (v) u.voice = v;
      const done = setTimeout(resolve, 5e3 + text.length * 200);
      u.onend = () => (clearTimeout(done), resolve());
      u.onerror = (e) => (clearTimeout(done), e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error(e.error)));
      speechSynthesis.speak(u);
    });
    return { samples: new Float32Array(0), sampleRate: 24e3 };
  }
};
var AudioPlayer = class {
  ctx;
  current;
  async play(a) {
    this.stop();
    if (!a.data && !a.samples?.length) return;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {
    });
    const buf = a.data ? await this.ctx.decodeAudioData(a.data.slice().buffer) : (() => {
      const b = this.ctx.createBuffer(1, a.samples.length, a.sampleRate ?? 24e3);
      b.copyToChannel(a.samples, 0);
      return b;
    })();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    this.current = src;
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.current === src) this.current = void 0;
        resolve();
      };
      src.start();
    });
  }
  stop() {
    try {
      this.current?.stop();
    } catch {
    }
    this.current = void 0;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }
  close() {
    this.stop();
    this.ctx?.close().catch(() => {
    });
    this.ctx = void 0;
  }
};
async function playAudio(a, ctx = new AudioContext()) {
  if (a.data) {
    const buf2 = await ctx.decodeAudioData(a.data.slice().buffer);
    return playBuffer(ctx, buf2);
  }
  if (!a.samples?.length) return;
  const buf = ctx.createBuffer(1, a.samples.length, a.sampleRate ?? 24e3);
  buf.copyToChannel(a.samples, 0);
  return playBuffer(ctx, buf);
}
function playBuffer(ctx, buf) {
  return new Promise((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => resolve();
    src.start();
  });
}
export {
  AudioPlayer,
  KOKORO_VOICES,
  KokoroWebTTS,
  SUPERTONIC_LANGUAGES,
  SupertonicWebTTS,
  WebSpeechTTS,
  cleanForSpeech,
  hasKanji,
  kanaToKokoro,
  playAudio,
  serial,
  toHiragana
};
