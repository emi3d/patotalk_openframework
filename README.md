# Pato Talk

Practice a language by talking your way through a situation: asking your boss for a raise, ordering ramen in Tokyo, buying bread in Paris. A character plays the other side, and when you're done you get a score and corrections.

Each situation is a small file called an *experience*. Write one, share it, and run it in any app built on this framework.

## Run it

You need Node 22 or newer.

```bash
npm install
npm run web
```

Open http://localhost:5173, go to **Settings**, and paste a Gemini API key. You can get a free one at aistudio.google.com/apikey.

To have two AIs play a whole scene against each other in the terminal, first copy `.env.example` to `.env` and put your key in it. Then run:

```bash
npm run selftest                          # ask-for-a-raise
npm run selftest -- ja-ramen-order --turns 3
```

## How it fits together

- **LLM**: Gemini, anything OpenAI-compatible, Ollama, or any LangChain chat model.
- **Loop**: a small LangGraph graph. Each message is one turn, and the scene is evaluated when you end it or run out of turns.
- **Voice**: Supertonic 3 by default, running in the browser. Kokoro, the browser's own voices, Gemini TTS, or any `/v1/audio/speech` server also work.
- **Stats**: SQLite (in the browser, in Node, or with expo-sqlite) or Postgres. Only scores and counts are saved, never the conversation.

```ts
const pt = new PatoTalk({ llm: { provider: "gemini", apiKey }, tts, stats });
const { session, opening } = await pt.start(experience, { userId: "emi" });
const reply = await pt.say(session, "I increased sales by 25%.");
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

I tested both models in the browser on Windows:

- **Supertonic 3** handles Japanese well and reads kanji directly. The first load downloads about 400 MB, which takes around 25 s. After that it speaks 4 to 10 times faster than real time.
- **Kokoro-82M** also handles Japanese well, but it needs kana and only works on WASM, because WebGPU distorts its audio. It runs at about real-time speed.

## Layout

```
packages/core      the framework (runs in Node, the browser, and React Native)
packages/tts-web   browser voices
apps/web           the web app
experiences/       example scenes
scripts/selftest   AI-vs-AI test run
```

MIT license.
