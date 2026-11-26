import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { TTSProvider } from "./tts.js";

export interface ProviderField {
  key: string;
  label: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
}

export type ProviderOptions = Record<string, string | undefined>;

export interface ProviderContext {
  llm?: () => Promise<BaseChatModel>;
  option?: (provider: string, key: string) => string | undefined;
}

export interface LLMProviderDef {
  id: string;
  label: string;
  audioInput?: boolean;
  fields: ProviderField[];
  create(options: ProviderOptions & { temperature?: number }): Promise<BaseChatModel>;
}

export interface TTSProviderDef {
  id: string;
  label: string;
  fields: ProviderField[];
  create(options: ProviderOptions, ctx: ProviderContext): TTSProvider;
}

const llms = new Map<string, LLMProviderDef>();
const voices = new Map<string, TTSProviderDef>();

export const registerLLMProvider = (def: LLMProviderDef) => void llms.set(def.id, def);
export const registerTTSProvider = (def: TTSProviderDef) => void voices.set(def.id, def);
export const llmProviders = () => [...llms.values()];
export const ttsProviders = () => [...voices.values()];
export const llmProvider = (id: string) => llms.get(id);
export const ttsProvider = (id: string) => voices.get(id);

export const missingFields = (def: { fields: ProviderField[] } | undefined, o: ProviderOptions) =>
  def ? def.fields.filter((f) => f.required && !o[f.key]?.trim()).map((f) => f.label) : [];
