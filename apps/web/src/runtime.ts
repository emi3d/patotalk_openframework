import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  GeminiTTS,
  OpenAISpeechTTS,
  PatoTalk,
  StatsStore,
  createLLM,
  messageText,
  parseExperience,
  sqlJsDriver,
  type Experience,
  type LLMConfig,
  type TTSProvider,
} from "@patotalk/core";
import { KokoroWebTTS, SupertonicWebTTS, WebSpeechTTS } from "@patotalk/tts-web";

export type TTSChoice = "none" | "web-speech" | "supertonic" | "kokoro" | "gemini-tts" | "openai-speech";

export interface Settings {
  userId: string;
  llm: "gemini" | "openai" | "ollama";
  apiKey: string;
  model: string;
  baseUrl: string;
  tts: TTSChoice;
  ttsUrl: string;
  autoplay: boolean;
}

const KEY = "patotalk.settings";
export const defaultSettings: Settings = {
  userId: "me",
  llm: "gemini",
  apiKey: "",
  model: "",
  baseUrl: "",
  tts: "supertonic",
  ttsUrl: "http://localhost:8880",
  autoplay: true,
};

export function loadSettings(): Settings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return defaultSettings;
  }
}
export const saveSettings = (s: Settings) => localStorage.setItem(KEY, JSON.stringify(s));

export function llmConfig(s: Settings): LLMConfig {
  const model = s.model || undefined;
  if (s.llm === "gemini") return { provider: "gemini", apiKey: s.apiKey, model };
  if (s.llm === "openai") return { provider: "openai", apiKey: s.apiKey || undefined, model, baseUrl: s.baseUrl || undefined };
  return { provider: "ollama", model, baseUrl: s.baseUrl || undefined };
}

// --- voice providers (cached: models are big) ---
const ttsCache = new Map<string, TTSProvider>();
export function ttsFor(s: Settings): TTSProvider | undefined {
  const id = `${s.tts}|${s.ttsUrl}|${s.apiKey}`;
  if (ttsCache.has(id)) return ttsCache.get(id);
  let t: TTSProvider | undefined;
  switch (s.tts) {
    case "web-speech":
      t = new WebSpeechTTS();
      break;
    case "supertonic":
      t = new SupertonicWebTTS();
      break;
    case "kokoro":
      t = new KokoroWebTTS({ device: "wasm", reader: (text) => japaneseReading(s, text) });
      break;
    case "gemini-tts":
      t = new GeminiTTS({ apiKey: s.apiKey });
      break;
    case "openai-speech":
      t = new OpenAISpeechTTS({ baseUrl: s.ttsUrl });
      break;
  }
  if (t) ttsCache.set(id, t);
  return t;
}

/** Kokoro needs kana for Japanese: ask the configured LLM for the pronunciation reading. */
async function japaneseReading(s: Settings, text: string): Promise<string> {
  const llm = await createLLM(llmConfig(s));
  const r = await llm.invoke(
    `Rewrite this Japanese text in hiragana only, exactly as it is pronounced (particle は as わ, へ as え, を as お; long vowels with ー for katakana words). Keep punctuation. Output only the reading.\n\n${text}`,
  );
  return messageText(r).trim();
}

// --- SQLite stats in the browser (sql.js), persisted to localStorage ---
const DB_KEY = "patotalk.sqlite";
let storePromise: Promise<StatsStore> | null = null;
export function statsStore(): Promise<StatsStore> {
  storePromise ??= (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const saved = localStorage.getItem(DB_KEY);
    const db = new SQL.Database(saved ? Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)) : undefined);
    const persist = (bytes: Uint8Array) => {
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(DB_KEY, btoa(bin));
    };
    return new StatsStore(sqlJsDriver(db, persist));
  })();
  return storePromise;
}

export async function engineFor(s: Settings): Promise<PatoTalk> {
  return new PatoTalk({ llm: llmConfig(s), tts: ttsFor(s), stats: await statsStore() });
}

// --- experiences: bundled examples + the user's own (localStorage) ---
const bundled = import.meta.glob("../../../experiences/*.json", { eager: true, import: "default" });
export const builtInExperiences: Experience[] = Object.values(bundled).map((e) => parseExperience(e));

const MINE = "patotalk.experiences";
export function myExperiences(): Experience[] {
  try {
    return (JSON.parse(localStorage.getItem(MINE) ?? "[]") as unknown[]).map((e) => parseExperience(e));
  } catch {
    return [];
  }
}
export function saveMyExperience(e: Experience) {
  const list = myExperiences().filter((x) => x.id !== e.id);
  localStorage.setItem(MINE, JSON.stringify([e, ...list]));
}
export function deleteMyExperience(id: string) {
  localStorage.setItem(MINE, JSON.stringify(myExperiences().filter((x) => x.id !== id)));
}

export function download(name: string, text: string, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
