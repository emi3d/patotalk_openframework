import { registerTTSProvider } from "@patotalk/core";
import { WebSpeechTTS } from "./engines.js";
import { SupertonicWebTTS } from "./supertonic.js";

registerTTSProvider({
  id: "supertonic",
  label: "Supertonic 3 (local, in browser, 31 languages)",
  fields: [{ key: "steps", label: "Quality steps", placeholder: "8" }],
  create: (o) => new SupertonicWebTTS({ steps: o.steps ? Number(o.steps) : undefined }),
});

registerTTSProvider({
  id: "web-speech",
  label: "Browser voices (Web Speech)",
  fields: [],
  create: () => new WebSpeechTTS(),
});
