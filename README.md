# Pato Talk Open Framework

Learn through simulated audio experiences. You talk with a character in a situation (asking your boss for a raise, ordering ramen in Tokyo), and at the end you get scored against the experience's own rubric.

It's modular. It works with any LLM and any voice, local or cloud. Experiences are plain files that run in Pato Talk or in any other implementation of the framework.

```
 experience file ──▶ ┌──────────────── @patotalk/core ────────────────┐
 (JSON / MD)         │ language provider ─▶ LangGraph loop ─▶ voice    │──▶ audio
                     │ (any LangChain model)   (turns, evaluation)     │
                     └──────────────────────┬──────────────────────────┘
                                            ▼
                                 SQL stats (numbers only)
```

## What's here

| Path | What it is |
|---|---|
| `packages/core` | The framework: experience format, LangGraph loop, LLM factory, TTS interface, SQL stats. No Node or DOM imports, so it runs in Node, the browser and React Native. |
| `packages/tts-web` | In-browser voices: **Supertonic 3**, **Kokoro-82M**, and the browser's built-in voices. |
| `apps/web` | Web MVP: library, experience creator, voice chat, evaluation, stats, and a voice lab. |
| `experiences/` | Example experiences: `ask-for-a-raise` (EN B1), `ja-ramen-order` (JA N5), `fr-boulangerie` (FR A2). |
| `scripts/selftest.ts` | Runs a whole conversation with a real LLM, where a second LLM plays the learner. |
| `docs/FORMAT.md` | The experience file spec. |
| `docs/IDEAS.md` | The design notes. |

## Quick start

```bash
npm install
npm test                                   # core tests (stub LLM, SQLite)
npm run web                                # http://localhost:5173 → Settings → paste a Gemini key
GEMINI_API_KEY=... npm run selftest        # full AI-vs-AI conversation + evaluation + SQLite stats
GEMINI_API_KEY=... npx tsx scripts/selftest.ts ja-ramen-order --turns 3
```

## Use the framework

```ts
import { PatoTalk } from "@patotalk/core";
import { nodeSqliteDriver } from "@patotalk/core/node";
import experience from "./experiences/ask-for-a-raise.json";

const pt = new PatoTalk({
  llm: { provider: "gemini", apiKey: process.env.GEMINI_API_KEY! }, // or openai / ollama / any LangChain chat model
  tts: myVoice,                                                     // any TTSProvider (optional)
  stats: await nodeSqliteDriver("stats.sqlite"),                    // any SqlDriver (optional)
});

const { session, opening } = await pt.start(experience, { userId: "emi" });
const turn = await pt.say(session, "I increased sales by 25%.");   // { text, audio, turn, finished, evaluation? }
const result = await pt.end(session);                              // { score, passed, criteria[], feedback, corrections[] }
const stats = await pt.summary("emi");                             // attempts, average, streak, by language/experience
```

### Providers

| Piece | Built in | Plug your own |
|---|---|---|
| Language | `gemini`, `openai` (any OpenAI-compatible server: LM Studio, vLLM, llama.cpp, OpenRouter), `ollama`, `stub` | `{ provider: "custom", model }` with any LangChain `BaseChatModel` |
| Voice | `SupertonicWebTTS`, `KokoroWebTTS`, `WebSpeechTTS` (browser), `GeminiTTS` (cloud), `OpenAISpeechTTS` (any `/v1/audio/speech` server, e.g. Kokoro-FastAPI), `SilentTTS` | implement `TTSProvider.synthesize(text, { lang, gender, voice })` |
| Stats DB | `nodeSqliteDriver` (Node), `sqlJsDriver` (browser), `expoSqliteDriver` (React Native), `postgresDriver` (cloud) | implement `SqlDriver { run, all }` |

Stats store **numbers only**: turns, words, score, pass/fail and per-criterion scores. Conversations live in memory (the LangGraph checkpointer) and are never written to the database.

### The loop (LangGraph)

```
START ─▶ route ─┬─▶ character ─┬─▶ END              one turn per invoke
                │              └─▶ evaluate ─▶ END   turn limit reached
                └─▶ evaluate ─▶ END                  learner ends the scene
```

## Voice test results (in-browser, Windows, Claude desktop browser)

| Model | Japanese | French | Speed after load | First load |
|---|---|---|---|---|
| Supertonic 3 (WebGPU) | ✅ reads kanji directly | ✅ | ~4–10× real time | ~25 s (≈400 MB) |
| Kokoro-82M (WASM) | ✅ with kana input (`kanaToKokoro`, plus an LLM reading for kanji) | ✅ via eSpeak NG IPA | ~0.7× real time | ~1 s once cached |
| Kokoro-82M (WebGPU) | ❌ clipped/garbled output | ⚠️ buzzy | fast | — |

eSpeak NG (used only for Kokoro's non-English, non-Japanese text) is GPL-3.0 and loads from a CDN at runtime. It isn't bundled.

## Expo React Native (next step)

`@patotalk/core` has no Node or DOM imports, and stats already have an `expoSqliteDriver`. The plan for the Expo app:

1. Import `@patotalk/core` in an Expo app and use `expo-sqlite` with `expoSqliteDriver`.
2. Voice: start with a cloud provider (`GeminiTTS`) or `OpenAISpeechTTS` against a local server. For on-device voice, use Supertonic 3 through sherpa-onnx (there are React Native wrappers), or Kokoro through `expo-kokoro` / onnxruntime-react-native.
3. Input: `expo-speech-recognition`, or send audio to a multimodal LLM.

## License

MIT. Model weights keep their own licenses (Supertonic 3: OpenRAIL-M; Kokoro-82M: Apache-2.0).
