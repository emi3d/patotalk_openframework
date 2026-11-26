import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";

export type LLMConfig =
  | { provider: "gemini"; apiKey: string; model?: string; temperature?: number }
  | { provider: "openai"; apiKey?: string; model?: string; baseUrl?: string; temperature?: number }
  | { provider: "ollama"; model?: string; baseUrl?: string; temperature?: number }
  | { provider: "stub"; replies?: string[] }
  | { provider: "custom"; model: BaseChatModel };

export const DEFAULT_MODELS = {
  gemini: "gemini-3.5-flash-lite",
  openai: "gpt-4o-mini-audio-preview",
  ollama: "llama3.1",
} as const;

export async function createLLM(cfg: LLMConfig): Promise<BaseChatModel> {
  switch (cfg.provider) {
    case "gemini": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({
        apiKey: cfg.apiKey,
        model: cfg.model ?? DEFAULT_MODELS.gemini,
        temperature: cfg.temperature ?? 0.8,
        maxRetries: 2,
      }) as unknown as BaseChatModel;
    }
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({
        apiKey: cfg.apiKey ?? "not-needed",
        model: cfg.model ?? DEFAULT_MODELS.openai,
        temperature: cfg.temperature ?? 0.8,
        maxRetries: 2,
        configuration: cfg.baseUrl ? { baseURL: cfg.baseUrl, dangerouslyAllowBrowser: true } : { dangerouslyAllowBrowser: true },
      }) as unknown as BaseChatModel;
    }
    case "ollama": {
      const { ChatOllama } = await import("@langchain/ollama");
      return new ChatOllama({
        model: cfg.model ?? DEFAULT_MODELS.ollama,
        baseUrl: cfg.baseUrl ?? "http://localhost:11434",
        temperature: cfg.temperature ?? 0.8,
        maxRetries: 2,
      }) as unknown as BaseChatModel;
    }
    case "stub":
      return new FakeListChatModel({
        responses: cfg.replies ?? ["Hello! (stub reply)", "Tell me more. (stub reply)", "Interesting. (stub reply)"],
      }) as unknown as BaseChatModel;
    case "custom":
      return cfg.model;
  }
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
