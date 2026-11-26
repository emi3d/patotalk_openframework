import { messageText, registerTTSProvider } from "@patotalk/core";
import { WebSpeechTTS } from "./engines.js";
import { KokoroWebTTS } from "./kokoro.js";
import { SupertonicWebTTS } from "./supertonic.js";

registerTTSProvider({
  id: "supertonic",
  label: "Supertonic 3 (local, in browser, 31 languages)",
  fields: [{ key: "steps", label: "Quality steps", placeholder: "8" }],
  create: (o) => new SupertonicWebTTS({ steps: o.steps ? Number(o.steps) : undefined }),
});

registerTTSProvider({
  id: "kokoro",
  label: "Kokoro-82M (local, in browser)",
  fields: [],
  create: (_o, ctx) =>
    new KokoroWebTTS({
      device: "wasm",
      reader: ctx.llm
        ? async (text) => {
            const llm = await ctx.llm!();
            const r = await llm.invoke(
              `Rewrite this Japanese text in hiragana only, exactly as it is pronounced (particle は as わ, へ as え, を as お; long vowels with ー for katakana words). Keep punctuation. Output only the reading.\n\n${text}`,
            );
            return messageText(r).trim();
          }
        : undefined,
    }),
});

registerTTSProvider({
  id: "web-speech",
  label: "Browser voices (Web Speech)",
  fields: [],
  create: () => new WebSpeechTTS(),
});
