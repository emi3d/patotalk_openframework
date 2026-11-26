import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  PatoTalk,
  StatsStore,
  createLLM,
  llmProvider,
  missingFields,
  parseExperience,
  sqlJsDriver,
  ttsProvider,
  type Experience,
  type LLMConfig,
  type ProviderOptions,
  type TTSProvider,
} from "@patotalk/core";
import "@patotalk/tts-web";

export interface Settings {
  userId: string;
  llm: string;
  tts: string;
  llmOptions: Record<string, ProviderOptions>;
  ttsOptions: Record<string, ProviderOptions>;
  autoplay: boolean;
  handsFree: boolean;
}

const KEY = "patotalk.settings";
export const defaultSettings: Settings = {
  userId: "me",
  llm: "gemini",
  tts: "supertonic",
  llmOptions: {},
  ttsOptions: {},
  autoplay: true,
  handsFree: true,
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const s: Settings = { ...defaultSettings, ...raw };
    if (raw.apiKey || raw.model || raw.baseUrl)
      s.llmOptions = { ...s.llmOptions, [s.llm]: { apiKey: raw.apiKey, model: raw.model, baseUrl: raw.baseUrl, ...s.llmOptions[s.llm] } };
    if (raw.ttsUrl && !s.ttsOptions["openai-speech"]) s.ttsOptions = { ...s.ttsOptions, "openai-speech": { baseUrl: raw.ttsUrl } };
    if (s.tts !== "none" && !ttsProvider(s.tts)) s.tts = defaultSettings.tts;
    for (const k of ["apiKey", "model", "baseUrl", "ttsUrl"]) delete (s as unknown as Record<string, unknown>)[k];
    return s;
  } catch {
    return defaultSettings;
  }
}
export const saveSettings = (s: Settings) => localStorage.setItem(KEY, JSON.stringify(s));

export const llmOptions = (s: Settings): ProviderOptions => s.llmOptions[s.llm] ?? {};
export const ttsOptions = (s: Settings): ProviderOptions => s.ttsOptions[s.tts] ?? {};
export const llmConfig = (s: Settings): LLMConfig => ({ provider: s.llm, ...llmOptions(s) });
export const llmMissing = (s: Settings) => missingFields(llmProvider(s.llm), llmOptions(s));

const ttsCache = new Map<string, TTSProvider>();
export function ttsFor(s: Settings): TTSProvider | undefined {
  const def = ttsProvider(s.tts);
  if (!def) return undefined;
  const id = JSON.stringify([s.tts, ttsOptions(s), s.llm, llmOptions(s)]);
  if (!ttsCache.has(id)) ttsCache.set(id, def.create(ttsOptions(s), { llm: () => createLLM(llmConfig(s)), option: (p, k) => s.llmOptions[p]?.[k] }));
  return ttsCache.get(id);
}

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
