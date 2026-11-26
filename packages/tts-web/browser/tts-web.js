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
function gaussian(n) {
  const u = new Uint32Array(n + n % 2);
  for (let i = 0; i < u.length; i += 16384) crypto.getRandomValues(u.subarray(i, i + 16384));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log((u[i] + 0.5) / 2 ** 32));
    const t = 2 * Math.PI * (u[i + 1] + 0.5) / 2 ** 32;
    out[i] = r * Math.cos(t);
    if (i + 1 < n) out[i + 1] = r * Math.sin(t);
  }
  return out;
}
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
      speed: opts.speed ?? 1.05,
      noise: gaussian
    });
    return { samples: r.samples, sampleRate: r.sampleRate };
  }
};

// ../core/src/providers.ts
var voices = /* @__PURE__ */ new Map();
var registerTTSProvider = (def) => void voices.set(def.id, def);

// ../core/src/tts.ts
var OpenAISpeechTTS = class {
  constructor(cfg) {
    this.cfg = cfg;
  }
  cfg;
  id = "openai-speech";
  async synthesize(text, opts) {
    const format = this.cfg.format ?? "wav";
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {} },
      body: JSON.stringify({ model: this.cfg.model ?? "tts-1", voice: opts.voice ?? this.cfg.voice ?? "alloy", input: text, response_format: format, speed: opts.speed })
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
    return { data: new Uint8Array(await res.arrayBuffer()), mimeType: format === "wav" ? "audio/wav" : "audio/mpeg" };
  }
};
var GeminiTTS = class {
  constructor(cfg) {
    this.cfg = cfg;
  }
  cfg;
  id = "gemini-tts";
  async synthesize(text, opts) {
    const model = this.cfg.model ?? "gemini-2.5-flash-preview-tts";
    const voice = opts.voice ?? this.cfg.voice ?? (opts.gender === "male" ? "Charon" : "Kore");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.cfg.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      })
    });
    if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
    if (!b64) throw new Error("Gemini TTS: no audio in response");
    const bytes = base64ToBytes(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    return { samples: Float32Array.from(pcm, (v) => v / 32768), sampleRate: 24e3 };
  }
};
function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
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
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Uint8Array(buf);
}
function base64ToBytes(b64) {
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array(globalThis.Buffer.from(b64, "base64"));
}
registerTTSProvider({
  id: "gemini-tts",
  label: "Gemini TTS (cloud)",
  fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "Blank = the Gemini language key" }],
  create: (o, ctx) => new GeminiTTS({ apiKey: o.apiKey || ctx.option?.("gemini", "apiKey") || "" })
});
registerTTSProvider({
  id: "openai-speech",
  label: "OpenAI-compatible speech server (OpenAI or any /v1/audio/speech server)",
  fields: [
    { key: "baseUrl", label: "Speech server URL", required: true, placeholder: "http://localhost:8880" },
    { key: "apiKey", label: "API key", secret: true },
    { key: "model", label: "Model" },
    { key: "voice", label: "Voice" }
  ],
  create: (o) => new OpenAISpeechTTS({ baseUrl: o.baseUrl, apiKey: o.apiKey || void 0, model: o.model || void 0, voice: o.voice || void 0 })
});

// src/recorder.ts
var TARGET_RATE = 16e3;
var VoiceRecorder = class {
  constructor(opts = {}) {
    this.opts = opts;
  }
  opts;
  rec;
  stream;
  chunks = [];
  startedAt = 0;
  timer;
  done;
  static get supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }
  get recording() {
    return this.rec?.state === "recording";
  }
  async start() {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.chunks = [];
    const rec = new MediaRecorder(this.stream);
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => {
      this.release();
      this.done?.(this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType }) : null);
      this.done = void 0;
    };
    this.rec = rec;
    rec.start();
    this.startedAt = performance.now();
    const max = this.opts.maxSeconds ?? 60;
    this.timer = setTimeout(() => this.opts.onAutoStop?.(), max * 1e3);
  }
  async stop(minSeconds = 0.4) {
    const rec = this.rec;
    if (!rec || rec.state === "inactive") return null;
    const blob = await new Promise((res) => {
      this.done = res;
      rec.stop();
    });
    this.rec = void 0;
    if (!blob || (performance.now() - this.startedAt) / 1e3 < minSeconds) return null;
    const samples = await decodeMono16k(await blob.arrayBuffer());
    const seconds = samples.length / TARGET_RATE;
    if (seconds < minSeconds || isSilent(samples)) return null;
    const wav = encodeWav(samples, TARGET_RATE);
    return { audio: toBase64(wav), mimeType: "audio/wav", seconds: Math.round(seconds * 10) / 10, url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })) };
  }
  cancel() {
    this.done = void 0;
    if (this.rec && this.rec.state !== "inactive") {
      this.rec.onstop = () => this.release();
      this.rec.stop();
    }
    this.rec = void 0;
    this.release();
  }
  release() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = void 0;
  }
};
async function decodeMono16k(buf) {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    const len = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const off = new OfflineAudioContext(1, len, TARGET_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  } finally {
    ctx.close();
  }
}
function isSilent(s, threshold = 0.01) {
  for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > threshold) return false;
  return true;
}
function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(bin);
}

// src/handsfree.ts
var RATE = 16e3;
var HOP = 256;
var EnergyDetector = class {
  id = "energy";
  floor = 4e-3;
  process(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += (frame[i] / 32768) ** 2;
    const rms = Math.sqrt(sum / frame.length);
    this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.999 + rms * 1e-3;
    return Math.max(0, Math.min(1, (rms / Math.max(this.floor, 2e-3) - 2) / 4));
  }
};
var TEN_VAD_URL = "https://cdn.jsdelivr.net/gh/TEN-framework/ten-vad@b425116336f400f1181a46ba2d58b913cc19d3e5/lib/Web/ten_vad.js";
var TenVadDetector = class _TenVadDetector {
  constructor(m, handlePtr, handle, audioPtr, probPtr, flagPtr) {
    this.m = m;
    this.handlePtr = handlePtr;
    this.handle = handle;
    this.audioPtr = audioPtr;
    this.probPtr = probPtr;
    this.flagPtr = flagPtr;
  }
  m;
  handlePtr;
  handle;
  audioPtr;
  probPtr;
  flagPtr;
  id = "ten-vad";
  static async load(url = TEN_VAD_URL) {
    const mod = await import(
      /* @vite-ignore */
      url
    );
    const m = await mod.default();
    const handlePtr = m._malloc(4);
    if (m._ten_vad_create(handlePtr, HOP, 0.5) !== 0) throw new Error("TEN VAD could not start");
    const handle = m.HEAP32[handlePtr >> 2];
    return new _TenVadDetector(m, handlePtr, handle, m._malloc(HOP * 2), m._malloc(4), m._malloc(4));
  }
  process(frame) {
    this.m.HEAP16.set(frame, this.audioPtr >> 1);
    if (this.m._ten_vad_process(this.handle, this.audioPtr, HOP, this.probPtr, this.flagPtr) !== 0) return 0;
    return this.m.HEAPF32[this.probPtr >> 2];
  }
  destroy() {
    this.m._ten_vad_destroy(this.handlePtr);
    for (const p of [this.handlePtr, this.audioPtr, this.probPtr, this.flagPtr]) this.m._free(p);
  }
};
var WORKLET = `class C extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}
process(i){const x=i[0]&&i[0][0];if(x){for(let k=0;k<x.length;k++){this.b[this.n++]=x[k];if(this.n===2048){this.port.postMessage(this.b.slice());this.n=0}}}return true}}
registerProcessor("pt-capture",C)`;
var HandsFreeMic = class {
  constructor(o) {
    this.o = o;
  }
  o;
  ctx;
  stream;
  node;
  pos = 0;
  last = 0;
  pending = [];
  voiced = 0;
  silent = 0;
  speaking = false;
  pre = [];
  utter = [];
  paused = false;
  probability = 0;
  static get supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
  }
  get listening() {
    return !!this.node;
  }
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
      node.port.onmessage = (e) => this.feed(e.data);
      src.connect(node);
      this.node = node;
    } catch (e) {
      this.stop();
      throw e;
    }
  }
  stop() {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = void 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = void 0;
    this.ctx?.close().catch(() => {
    });
    this.ctx = void 0;
    this.reset();
  }
  destroy() {
    this.stop();
    this.o.detector.destroy?.();
  }
  reset() {
    this.voiced = this.silent = 0;
    this.speaking = false;
    this.utter = [];
    this.pre = [];
  }
  feed(chunk) {
    const step = this.ctx.sampleRate / RATE;
    let pos = this.pos;
    const get = (i) => i < 0 ? this.last : chunk[i];
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
  frame(f) {
    if (this.paused) {
      if (this.speaking || this.utter.length) this.reset();
      return;
    }
    const o = this.o;
    const p = this.probability = o.detector.process(f);
    const ms = (frames) => frames * HOP * 1e3 / RATE;
    const isVoice = p >= (o.threshold ?? 0.5);
    if (!this.speaking) {
      this.pre.push(f);
      if (this.pre.length > 20) this.pre.shift();
      this.voiced = isVoice ? this.voiced + 1 : 0;
      if (ms(this.voiced) >= 80) {
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
    if (ms(this.silent) >= (o.endSilenceMs ?? 800) || total >= (o.maxSeconds ?? 30) * 1e3) {
      const frames = this.utter.slice(0, this.utter.length - Math.max(0, this.silent - 12));
      const speechMs = total - ms(this.silent);
      this.reset();
      if (speechMs < (o.minSpeechMs ?? 350)) return o.onDiscard?.();
      o.onUtterance(toVoice(frames));
    }
  }
};
function toVoice(frames) {
  const samples = new Float32Array(frames.length * HOP);
  frames.forEach((f, k) => {
    for (let i = 0; i < HOP; i++) samples[k * HOP + i] = f[i] / 32768;
  });
  const wav = encodeWav(samples, RATE);
  return {
    audio: toBase64(wav),
    mimeType: "audio/wav",
    seconds: Math.round(samples.length / RATE * 10) / 10,
    url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" }))
  };
}

// src/engines.ts
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
  analyser;
  buf = new Float32Array(1024);
  closed = false;
  async play(a) {
    this.stop();
    if (this.closed || !a.data && !a.samples?.length) return;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {
    });
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.ctx.destination);
    }
    const buf = a.data ? await this.ctx.decodeAudioData(a.data.slice().buffer) : (() => {
      const b = this.ctx.createBuffer(1, a.samples.length, a.sampleRate ?? 24e3);
      b.copyToChannel(a.samples, 0);
      return b;
    })();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    this.current = src;
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.current === src) this.current = void 0;
        resolve();
      };
      src.start();
    });
  }
  get playing() {
    return !!this.current;
  }
  level() {
    if (!this.current || !this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
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
    this.closed = true;
    this.stop();
    this.ctx?.close().catch(() => {
    });
    this.ctx = void 0;
    this.analyser = void 0;
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
  EnergyDetector,
  HandsFreeMic,
  SUPERTONIC_LANGUAGES,
  SupertonicWebTTS,
  TEN_VAD_URL,
  TenVadDetector,
  VoiceRecorder,
  WebSpeechTTS,
  cleanForSpeech,
  playAudio,
  serial
};
