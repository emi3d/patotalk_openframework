# Situ

Aprende lo que sea a través de situaciones simuladas. Situ es un framework open-source (MIT) y slim para practicar con IA en situaciones reales: idiomas, turismo, atención al cliente, ventas, entrevistas — lo que sea.

No es un clon de Duolingo. Duolingo te enseña con ejercicios cerrados; Situ te pone *dentro* de la situación: pides un café, haces check-in en un hotel, atiendes a un cliente molesto — hablas, la IA responde en personaje, y al final te evalúa con la rúbrica del propio módulo.

## Instalación y uso

```bash
npm install situ
```

```ts
import { Situ } from 'situ';

const situ = new Situ({
  ai: { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY },
  voice: { provider: 'kokoro', url: 'http://localhost:8880' }, // or { provider: 'google', apiKey } / { provider: 'elevenlabs', apiKey } / local
  progress: { databaseUrl: process.env.DATABASE_URL }, // Postgres/Supabase, optional
});

const session = await situ.newSession({ situationId: 'en-ordering-coffee', userId: 'emi' });
const reply = await situ.talk(session, audioBuffer); // { text, translation, suggestions, audio }
for await (const chunk of situ.talkStream(session, audioBuffer)) { /* streaming audio/text chunks */ }
const evaluation = await situ.evaluate(session);
const progress = await situ.progress('emi');
```

Sin llaves funciona igual con los stubs: `new Situ()` corre offline, la IA responde con un eco y la voz devuelve silencio, para probar el flujo completo.

`talk` también acepta texto, para testear sin audio:

```ts
const reply = await situ.talk(session, { text: "Hi, I'd like a medium latte please." });
// o: await situ.talkText(session, "Hi, I'd like a medium latte please.");
```

## API

| Método | Qué hace |
|---|---|
| `new Situ({ ai, voice, progress, situations?, situationsDir? })` | Configura proveedores y progreso. Sin `databaseUrl`, el progreso va a un JSON local. |
| `situ.listSituations()` / `situ.getSituation(id)` | Módulos incluidos + los tuyos (pasa `situations` o `situationsDir`). |
| `await situ.newSession({ situationId, userId })` | Crea una sesión en memoria. |
| `await situ.talk(session, audioBuffer \| { text } \| { audio, mimeType })` | Un turno: audio/texto in, `{ transcription, spokenResponse, suggestions, audio, audioBase64, audioMimeType, turnCount, maxTurns }` out. |
| `await situ.talkText(session, text)` | Atajo de `talk` con texto. |
| `for await (const c of situ.talkStream(session, input))` | Chunks `{ type: 'transcript' \| 'text' \| 'audio' \| 'reply' }`. Con texto y un proveedor LangChain, el texto se streamea token a token; el audio sale en chunks de 32 KB. |
| `await situ.evaluate(session)` | `{ evaluation, progress }`. La evaluación sale de la rúbrica del módulo. |
| `await situ.progress(userId)` | `{ streak, lastActiveDate, situations }` o `null`. |
| `await situ.migrate()` | Crea las tablas de progreso en Postgres (corre sola al primer uso). |
| `await situ.close()` | Cierra el pool de Postgres. |

## IA: LangChain por dentro

El texto pasa por LangChain (`@langchain/core`): chat model + `ChatPromptTemplate` con el `systemPrompt` del módulo + historial como mensajes, y salida JSON estructurada (`withStructuredOutput`, schema zod) con fallback a parseo.

| `ai.provider` | Modelo | Config |
|---|---|---|
| `gemini` | `gemini-2.5-flash-lite` (default) | `{ apiKey }`, `model?` — audio multimodal directo, sin transcribir antes |
| `openai` | `gpt-4o-mini` (default) | `{ apiKey, model?, baseUrl? }` — cualquier API compatible con OpenAI |
| `local` / `ollama` | `llama3.1` (default) | `{ url?, model? }` — Ollama en `http://localhost:11434` |
| `stub` | — | Sin llaves, eco determinista para tests |

## Voz: proveedores intercambiables

La voz no pasa por LangChain: es un `VoiceProvider` aparte (`transcribe` + `synthesize`), para poder mezclar, por ejemplo, Whisper local + Gemini, o Gemini + Kokoro.

| `voice.provider` | Config |
|---|---|
| `kokoro` | `{ url }` — TTS local por HTTP, lo más barato |
| `local` | `{ whisperUrl?, kokoroUrl? }` — Whisper local + Kokoro |
| `google` | `{ apiKey, voice? }` — Google Cloud TTS |
| `elevenlabs` | `{ apiKey, voiceId? }` — ElevenLabs TTS |
| `stub` | Sin llaves, 1s de silencio como WAV |

Si la IA no toma audio directo (OpenAI, local), Situ transcribe el audio con el voice provider antes de mandarle el texto al LLM.

## Progreso: Postgres / Supabase primero

```ts
progress: { databaseUrl: process.env.DATABASE_URL }
```

Es un connection string de Postgres estándar. En Supabase, usa la URL de Postgres del proyecto (Settings → Database → Connection string, modo Session o Transaction). `pg` es suficiente: no hace falta el cliente de supabase-js para esto, aunque puedes escribir un adaptador `ProgressStore` propio si lo prefieres.

Tablas en `migrations/schema.sql` (también se exportan con el paquete): `situ_users` (racha, última fecha activa), `situ_attempts` (un row por intento: score, completado, objetivos) y la vista `situ_progress_summary` (intentos, mejor score, completado por usuario y situación). `situ.migrate()` las crea; también corre sola al primer uso. Sin `databaseUrl`, el progreso se guarda en un JSON local (`data/progress.json`).

Semántica, igual en Postgres y en JSON: intentos, mejor score, `completed` con latch (una vez completado, no se des-completa), objetivos acumulados, historial de los últimos 50 intentos, racha por días consecutivos.

## Módulos de situación

Un módulo es un JSON validado contra `situations/schema.json`. Campos: `id`, `version`, `title`, `domain`, `language`, `level`, `description`, `roles.user` / `roles.ai`, `systemPrompt`, `objectives[]` (id, descripción, `weight`, `required`, `keywords` opcionales), `rubric` (criterios con `weight`, `passThreshold`, `scale`), `vocab`, `hints`, `maxTurns`, `successCriteria`. Los pesos de objetivos y de rúbrica deben sumar 1.

Biblioteca incluida (3 módulos): `en-ordering-coffee` (inglés A1, pedir café), `es-hotel-checkin` (turismo, check-in de hotel), `en-customer-complaint` (atención al cliente). Para usar los tuyos: `new Situ({ situations: [miModulo] })` o `new Situ({ situationsDir: './mis-situaciones' })`.

## Servidor (thin wrapper)

`server/` es solo una envoltura REST + WebSocket semi-live sobre la clase `Situ`. No duplica la lógica de turnos: cada ruta llama a `situ.talk` / `situ.evaluate` / `situ.progress`.

```bash
cd server
npm install
npm test
npm start   # http://localhost:3000
curl localhost:3000/situations
```

Config por env (ver `server/.env.example`): `AI_PROVIDER`, `VOICE_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `KOKORO_URL`, `DATABASE_URL`, `PORT`. El WebSocket `/live` es semi-live a propósito: el cliente manda chunks de audio, el servidor decide el fin de turno y responde con transcripción primero y audio en chunks después, con *barge-in*. Gemini Live es una sesión de un solo proveedor: si se cae, pierdes el turno, la transcripción y el contexto de evaluación. Semi-live te da control y un fallback REST que se comporta igual.

## React / Expo

Cualquier app React puede hacer `npm install situ` y usar la API de arriba directamente — ver `examples/react-usage.tsx` (web) y `examples/node-usage.ts` (corre con stubs: `npm run example`).

La app Expo (`apps/expo/`) **no** importa el paquete Node: `situ` depende de `pg`, LangChain y `fs`, que no corren en React Native. Expo habla con el servidor por REST + WebSocket (`apps/expo/src/api.ts`). Si tu app React es web (Next.js, Vite), usa el paquete directo; si es Expo/React Native, usa el servidor.

## Probar la API (curl)

```bash
curl localhost:3000/situations
curl -X POST localhost:3000/sessions -H 'Content-Type: application/json' \
  -d '{"situationId":"en-ordering-coffee","userId":"demo-user"}'
curl -X POST localhost:3000/sessions/<ID>/turn -H 'Content-Type: application/json' \
  -d '{"text":"Hi, I would like a medium latte please. Thank you!"}'
curl -X POST localhost:3000/sessions/<ID>/turn -F audio=@voice.m4a
curl -X POST localhost:3000/sessions/<ID>/evaluate
curl localhost:3000/progress/demo-user
```

## Open core gratis vs Pro hospedado ($500 MXN/mes)

Todo el framework es MIT y gratis: el paquete, el schema, los módulos, la app Expo, los providers. Lo puedes correr en tu compu, en tu nube, con tus llaves.

La idea de **Pro hospedado — $500 MXN/mes** — no es cobrar por el código, es cobrar por no tener que operarlo: servidor ya corriendo, TTS local ya montado, módulos curados, progreso sincronizado entre dispositivos, analítica y soporte.

## Licencia

MIT — ver `LICENSE`.
