import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { llmProvider, registerLLMProvider, type ProviderOptions } from "./providers.js";

export type LLMConfig =
  | { provider: "custom"; model: BaseChatModel }
  | ({ provider: string; temperature?: number; replies?: string[] } & ProviderOptions);

export const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-3.5-flash-lite",
  openai: "gpt-4o-mini-audio-preview",
  ollama: "llama3.1",
};

const opt = (o: ProviderOptions, k: string) => o[k]?.trim() || undefined;

registerLLMProvider({
  id: "gemini",
  label: "Gemini (cloud)",
  audioInput: true,
  fields: [
    { key: "apiKey", label: "API key", required: true, secret: true, placeholder: "From aistudio.google.com/apikey" },
    { key: "model", label: "Model", placeholder: DEFAULT_MODELS.gemini },
  ],
  async create(o) {
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
    return new ChatGoogleGenerativeAI({
      apiKey: opt(o, "apiKey"),
      model: opt(o, "model") ?? DEFAULT_MODELS.gemini,
      temperature: o.temperature ?? 0.8,
      maxRetries: 2, // fail fast enough for a live chat; the UI lets the learner resend
    }) as unknown as BaseChatModel;
  },
});

registerLLMProvider({
  id: "openai",
  label: "OpenAI-compatible (OpenAI, OpenRouter, LM Studio, vLLM, llama.cpp…)",
  audioInput: true,
  fields: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "model", label: "Model", placeholder: DEFAULT_MODELS.openai },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.openai.com/v1" },
  ],
  async create(o) {
    const { ChatOpenAI } = await import("@langchain/openai");
    const baseURL = opt(o, "baseUrl");
    return new ChatOpenAI({
      apiKey: opt(o, "apiKey") ?? "not-needed",
      model: opt(o, "model") ?? DEFAULT_MODELS.openai,
      temperature: o.temperature ?? 0.8,
      maxRetries: 2, // fail fast enough for a live chat; the UI lets the learner resend
      configuration: baseURL ? { baseURL, dangerouslyAllowBrowser: true } : { dangerouslyAllowBrowser: true },
    }) as unknown as BaseChatModel;
  },
});

registerLLMProvider({
  id: "ollama",
  label: "Ollama (local)",
  fields: [
    { key: "model", label: "Model", placeholder: "an audio-capable model" },
    { key: "baseUrl", label: "Base URL", placeholder: "http://localhost:11434" },
  ],
  async create(o) {
    const { ChatOllama } = await import("@langchain/ollama");
    return new ChatOllama({
      model: opt(o, "model") ?? DEFAULT_MODELS.ollama,
      baseUrl: opt(o, "baseUrl") ?? "http://localhost:11434",
      temperature: o.temperature ?? 0.8,
      maxRetries: 2, // fail fast enough for a live chat; the UI lets the learner resend
    }) as unknown as BaseChatModel;
  },
});

export async function createLLM(cfg: LLMConfig): Promise<BaseChatModel> {
  if (cfg.provider === "custom") return (cfg as { model: BaseChatModel }).model;
  if (cfg.provider === "stub") {
    const replies = (cfg as { replies?: string[] }).replies;
    return new FakeListChatModel({
      responses: replies ?? ["Hello! (stub reply)", "Tell me more. (stub reply)", "Interesting. (stub reply)"],
    }) as unknown as BaseChatModel;
  }
  const def = llmProvider(cfg.provider);
  if (!def) throw new Error(`Unknown language provider "${cfg.provider}". Register it with registerLLMProvider().`);
  return def.create(cfg as ProviderOptions & { temperature?: number });
}

export function messageText(m: BaseMessage | AIMessage): string {
  const c = m.content as unknown;
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((p) => (typeof p === "string" ? p : p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
      .join("");
  return "";
}
