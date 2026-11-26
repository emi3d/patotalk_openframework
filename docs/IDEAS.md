# Pato Talk Open Framework — Ideas

## What
Learn through simulated audio experiences.
Modular. Any LLM provider. Any voice provider. Local or cloud.

## Core principle
- The LLM is multimodal: it listens to the learner's audio directly. No speech-to-text step.
- LLM answers in text. TTS is used only for output.

## Experience (portable file: JSON / MD)
- `evaluation` — rubric, criteria, pass rules.
- `characterA` — the user: role, goal, context.
- `characterB` — the LLM: persona over base model (name, role, personality, emotional state, language rules, hidden motivation).
- `meta` — shown to user: title, level, language, vocabulary, tags.
- Users create → save in framework format → run in Pato Talk or any implementation.

## Example: "Ask for a raise" (B1 English)
- A (user): You deserve a raise. Meeting with your boss. Explain achievements (logros), ask for better pay (aumento de sueldo). Don't be shy.
- B (LLM): Mr. Sterling, strict boss. Serious, numbers-focused, hard to impress. Impatient but listening.
- Rules: B1 English, max 3 sentences, implicit correction.
- Hidden motivation: no raise unless user gives specific numbers/results (profit, sales, savings). Skeptical until then.

## Framework
- LangChain + LangGraph (open-source JS).
- Pieces: mic audio → multimodal language provider → loop (graph) → text-to-voice. Nothing else.
- Providers: local or cloud. LLM must accept audio (Gemini, OpenAI audio models…). TTS: Kokoro, Supertonic, cloud TTS…
- SQL DB (local or cloud, e.g. SQLite / Postgres): user stats only. No conversations or audio stored.

## Targets
1. Web MVP.
2. Expo React Native (final).

## TTS to test (in browser/device)
- Kokoro-82M — hexgrad/Kokoro-82M
- Supertonic-3 — Supertone/supertonic-3
- Language: Japanese. Fallback: French (not EN/ES).

## Test LLM
- Gemini (test key).
