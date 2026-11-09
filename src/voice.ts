import type { VoiceConfig, VoiceProvider } from './types.js';

function silenceWav(seconds = 1): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

export const stubVoice: VoiceProvider = {
  name: 'stub',
  async transcribe(): Promise<string> { return ''; },
  async synthesize(): Promise<Buffer> { return silenceWav(); },
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function kokoroVoice(cfg: VoiceConfig): VoiceProvider {
  const base = (cfg.url ?? process.env.KOKORO_URL ?? 'http://localhost:8880').replace(/\/$/, '');
  const voice = cfg.voice ?? process.env.KOKORO_VOICE ?? 'af_heart';
  return {
    name: 'kokoro',
    async transcribe(): Promise<string> {
      throw new Error('kokoro does not transcribe; pair it with a Whisper voice provider or Gemini audio input');
    },
    async synthesize(text: string, language: string): Promise<Buffer> {
      const res = await fetch(`${base}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'kokoro', input: text, voice, response_format: 'mp3', language }),
      });
      if (!res.ok) throw new Error(`Kokoro ${res.status}: ${await res.text()}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export function localVoice(cfg: VoiceConfig): VoiceProvider {
  const whisperUrl = (cfg.whisperUrl ?? process.env.WHISPER_URL ?? '').replace(/\/$/, '');
  const kokoro = kokoroVoice({ url: cfg.kokoroUrl ?? process.env.KOKORO_URL, voice: cfg.voice });
  return {
    name: 'local',
    async transcribe(audio: Buffer, mimeType: string, language: string): Promise<string> {
      if (!whisperUrl) return '';
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'audio.webm');
      form.append('language', language);
      const res = await fetch(`${whisperUrl}/transcribe`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { text?: string; transcription?: string };
      return json.text ?? json.transcription ?? '';
    },
    async synthesize(text: string, language: string): Promise<Buffer> {
      return kokoro.synthesize(text, language);
    },
  };
}

export function googleTtsVoice(cfg: VoiceConfig): VoiceProvider {
  const apiKey = cfg.apiKey ?? mustEnv('GOOGLE_TTS_API_KEY');
  const voiceName = cfg.voice ?? process.env.GOOGLE_TTS_VOICE ?? '';
  return {
    name: 'google-tts',
    async transcribe(): Promise<string> {
      throw new Error('google-tts does not transcribe; use Gemini audio input or a local Whisper');
    },
    async synthesize(text: string, language: string): Promise<Buffer> {
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: voiceName ? { name: voiceName } : { languageCode: language },
          audioConfig: { audioEncoding: 'MP3' },
        }),
      });
      if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { audioContent?: string };
      return Buffer.from(json.audioContent ?? '', 'base64');
    },
  };
}

export function elevenLabsVoice(cfg: VoiceConfig): VoiceProvider {
  const apiKey = cfg.apiKey ?? mustEnv('ELEVENLABS_API_KEY');
  const voiceId = cfg.voiceId ?? cfg.voice ?? process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';
  return {
    name: 'elevenlabs',
    async transcribe(): Promise<string> {
      throw new Error('elevenlabs does not transcribe; use Gemini audio input or a local Whisper');
    },
    async synthesize(text: string): Promise<Buffer> {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_turbo_v2_5' }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export function makeVoiceProvider(cfg: VoiceConfig = {}): VoiceProvider {
  switch (cfg.provider ?? 'stub') {
    case 'kokoro': return kokoroVoice(cfg);
    case 'local': return localVoice(cfg);
    case 'google':
    case 'google-tts': return googleTtsVoice(cfg);
    case 'elevenlabs': return elevenLabsVoice(cfg);
    case 'stub': return stubVoice;
    default: throw new Error(`Unknown voice provider: ${cfg.provider} (use kokoro|google|elevenlabs|local|stub)`);
  }
}
