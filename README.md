# Pato Talk

Practice a language by talking your way through a situation: asking your boss for a raise, ordering ramen in Tokyo, buying bread in Paris. A character plays the other side, and when you're done you get a score and corrections.

You talk, it listens. Your voice goes straight to a multimodal model, which hears how you actually said it (pronunciation and hesitations included) and answers in text. Nothing transcribes your voice first. Only the character's reply is turned into speech.

Each situation is a small file called an *experience*. Write one, share it, and run it in any app built on this framework.

## Run it

You need Node 22 or newer.

```bash
npm install
npm run web
```

Open http://localhost:5173, go to **Settings**, and paste a Gemini API key. You can get a free one at aistudio.google.com/apikey. In a scene, just talk: when Pato the duck finishes its line, the mic listens (hands-free) and sends what you say once you pause. Turn hands-free off to use push-to-talk instead, or type.

To have two AIs play a whole scene against each other in the terminal, first copy `.env.example` to `.env` and put your key in it. Then run:

```bash
npm run selftest                          # ask-for-a-raise
npm run selftest -- ja-ramen-order --turns 3
npm run selftest -- --voice               # the simulated learner speaks; the model hears audio
```

## How it fits together

- **LLM**: must accept audio input. Gemini does out of the box; OpenAI-compatible audio models (like gpt-4o-mini-audio-preview) and any LangChain chat model that takes audio work too. A text-only model still runs if the learner types.
- **Your voice in**: the app records a 16 kHz WAV and sends it as a LangChain audio block. No speech recognition anywhere. In hands-free mode a tiny voice detector ([TEN VAD](https://github.com/TEN-framework/ten-vad), about 280 KB of WASM using under 1% of a CPU core) decides when you start and stop. The core also accepts an `interrupted: { heard }` flag on a voice turn, for apps whose voice is fast enough to allow talking over the character. It is loaded at runtime from TEN's repository and its license has extra conditions from Agora, so check it before shipping a product. Swap it for any `VoiceDetector`; a loudness detector is the built-in fallback.
- **Loop**: a small LangGraph graph. Each message is one turn, and the scene is evaluated when you end it or run out of turns.
- **Providers are plugins**: `registerLLMProvider()` and `registerTTSProvider()` add a provider with its settings fields; the app lists whatever is registered.
- **Voice out**: Supertonic 3 by default, running in the browser. The browser's own voices, Gemini TTS, or any `/v1/audio/speech` server also work.
- **Evaluation**: the evaluator hears your recordings too, so it can comment on pronunciation and fluency.
- **Stats**: SQLite (in the browser, in Node, or with expo-sqlite) or Postgres. Only scores, counts and seconds spoken are saved, never the conversation or the audio.

```ts
const pt = new PatoTalk({ llm: { provider: "gemini", apiKey }, tts, stats });
const { session, opening } = await pt.start(experience, { userId: "emi" });
const reply = await pt.say(session, { audio: wavBase64, mimeType: "audio/wav", seconds: 4.2 });
// or, typed: await pt.say(session, "I increased sales by 25%.");
const result = await pt.end(session); // score, passed, feedback, corrections
```

## Writing an experience

Use **Create** in the app, or write the JSON by hand. An experience has four parts:

- **meta**: what the learner sees (title, language, level, vocabulary, tips)
- **characterA**: the learner's role and goal
- **characterB**: who the AI plays, its rules, and a hidden motivation the learner has to work out
- **evaluation**: the criteria it gets scored on

`experiences/ask-for-a-raise.json` is a full example, and `docs/FORMAT.md` lists every field.

## Voices

Supertonic 3 runs in the browser and handles Japanese well, kanji included. The first load downloads about 400 MB (around 25 s); after that it speaks 4 to 10 times faster than real time.

## Layout

```
packages/core      the framework (runs in Node, the browser, and React Native)
packages/tts-web   browser audio: mic recorder and voices
apps/web           the web app
experiences/       example scenes
scripts/selftest   AI-vs-AI test run
```

MIT license.
