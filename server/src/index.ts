import { Situ, type AIConfig, type VoiceConfig } from 'situ';
import { createApp, attachLive } from './server.js';

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function situFromEnv(): Situ {
  const aiProvider = (env('AI_PROVIDER') ?? 'stub') as AIConfig['provider'];
  const voiceProvider = (env('VOICE_PROVIDER') ?? 'stub') as VoiceConfig['provider'];
  return new Situ({
    ai: {
      provider: aiProvider,
      apiKey: env('GEMINI_API_KEY') ?? env('OPENAI_API_KEY'),
      model: env('GEMINI_MODEL') ?? env('OPENAI_MODEL') ?? env('LOCAL_LLM_MODEL'),
      baseUrl: env('OPENAI_BASE_URL') ?? env('LOCAL_LLM_URL'),
      url: env('LOCAL_LLM_URL'),
    },
    voice: {
      provider: voiceProvider,
      apiKey: env('GOOGLE_TTS_API_KEY') ?? env('ELEVENLABS_API_KEY'),
      url: env('KOKORO_URL'),
      voice: env('KOKORO_VOICE') ?? env('GOOGLE_TTS_VOICE'),
      voiceId: env('ELEVENLABS_VOICE_ID'),
      whisperUrl: env('WHISPER_URL'),
      kokoroUrl: env('KOKORO_URL'),
    },
    progress: env('DATABASE_URL')
      ? { databaseUrl: env('DATABASE_URL') }
      : { file: env('PROGRESS_FILE') },
  });
}

function main(): void {
  const port = Number(process.env.PORT ?? 3000);
  const situ = situFromEnv();
  const app = createApp(situ);
  const server = attachLive(app, situ);
  server.listen(port, () => {
    console.log(`situ server on http://localhost:${port} (ai=${situ.ai.name}, voice=${situ.voice.name}, situations=${situ.listSituations().length})`);
  });
}

if (process.argv[1]?.endsWith('/index.js') || process.argv[1]?.endsWith('index.ts')) main();
