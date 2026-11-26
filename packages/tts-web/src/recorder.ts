import { encodeWav } from "@patotalk/core";

export interface RecordedVoice {
  audio: string;
  mimeType: "audio/wav";
  seconds: number;
  url: string;
}

const TARGET_RATE = 16000;

export class VoiceRecorder {
  private rec?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private done?: (b: Blob | null) => void;

  constructor(private opts: { maxSeconds?: number; onAutoStop?: () => void } = {}) {}

  static get supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  get recording() {
    return this.rec?.state === "recording";
  }

  async start(): Promise<void> {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.chunks = [];
    const rec = new MediaRecorder(this.stream);
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => {
      this.release();
      this.done?.(this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType }) : null);
      this.done = undefined;
    };
    this.rec = rec;
    rec.start();
    this.startedAt = performance.now();
    const max = this.opts.maxSeconds ?? 60;
    this.timer = setTimeout(() => this.opts.onAutoStop?.(), max * 1000);
  }

  async stop(minSeconds = 0.4): Promise<RecordedVoice | null> {
    const rec = this.rec;
    if (!rec || rec.state === "inactive") return null;
    const blob = await new Promise<Blob | null>((res) => {
      this.done = res;
      rec.stop();
    });
    this.rec = undefined;
    if (!blob || (performance.now() - this.startedAt) / 1000 < minSeconds) return null;
    const samples = await decodeMono16k(await blob.arrayBuffer());
    const seconds = samples.length / TARGET_RATE;
    if (seconds < minSeconds || isSilent(samples)) return null;
    const wav = encodeWav(samples, TARGET_RATE);
    return { audio: toBase64(wav), mimeType: "audio/wav", seconds: Math.round(seconds * 10) / 10, url: URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" })) };
  }

  cancel() {
    this.done = undefined;
    if (this.rec && this.rec.state !== "inactive") {
      this.rec.onstop = () => this.release();
      this.rec.stop();
    }
    this.rec = undefined;
    this.release();
  }

  private release() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }
}

async function decodeMono16k(buf: ArrayBuffer): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    const len = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const off = new OfflineAudioContext(1, len, TARGET_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded; // multi-channel input is down-mixed to mono by the 1-channel destination
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  } finally {
    ctx.close();
  }
}

function isSilent(s: Float32Array, threshold = 0.01) {
  for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > threshold) return false;
  return true;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
