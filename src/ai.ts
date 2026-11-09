import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from '@langchain/core/prompts';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import type { AIConfig, AIProvider, GenerateInput, GenerateOutput } from './types.js';

export const ChatReplySchema = z.object({
  userTranscription: z.string().optional(),
  spokenResponse: z.string(),
  suggestedUserResponses: z.array(z.string()).optional(),
});

export const stubAI: AIProvider = {
  name: 'stub',
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const userText = input.text ?? (input.audioBase64 ? '[audio received]' : '');
    const text = JSON.stringify({
      userTranscription: userText,
      spokenResponse: userText
        ? `I heard you say: ${userText}. Please continue.`
        : 'Hello! Please say something to start the situation.',
      suggestedUserResponses: ['Please continue.', 'Can you repeat that?', 'Thank you.'],
    });
    return { text, transcription: userText };
  },
};

export function makeChatModel(cfg: AIConfig): BaseChatModel {
  switch (cfg.provider ?? 'stub') {
    case 'gemini':
      return new ChatGoogleGenerativeAI({
        apiKey: cfg.apiKey ?? process.env.GEMINI_API_KEY,
        model: cfg.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
        temperature: 0.7,
        maxOutputTokens: 600,
      });
    case 'openai': {
      const baseUrl = cfg.baseUrl ?? cfg.url ?? process.env.OPENAI_BASE_URL;
      return new ChatOpenAI({
        apiKey: cfg.apiKey ?? process.env.OPENAI_API_KEY,
        model: cfg.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 600,
        ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
      });
    }
    case 'local':
    case 'ollama':
      return new ChatOllama({
        baseUrl: cfg.url ?? cfg.baseUrl ?? process.env.LOCAL_LLM_URL ?? 'http://localhost:11434',
        model: cfg.model ?? process.env.LOCAL_LLM_MODEL ?? 'llama3.1',
        temperature: 0.7,
      });
    default:
      throw new Error(`Unknown AI provider: ${cfg.provider} (use gemini|openai|local|stub)`);
  }
}

function historyMessages(history: GenerateInput['history']): BaseMessage[] {
  return history.map((t) => (t.role === 'ai' ? new AIMessage(t.text) : new HumanMessage(t.text)));
}

function chatTemplate(): ChatPromptTemplate {
  return ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate(
      '{systemPrompt}\nRespond ONLY with JSON: {"userTranscription": "...", "spokenResponse": "...", "suggestedUserResponses": ["...", "..."]}',
    ),
    new MessagesPlaceholder('history'),
    HumanMessagePromptTemplate.fromTemplate('{input}'),
  ]);
}

export function langChainAI(model: BaseChatModel, name: string): AIProvider {
  async function rawText(input: GenerateInput): Promise<string> {
    if (input.audioBase64 && name === 'gemini') {
      const messages: BaseMessage[] = [
        new SystemMessage(input.systemPrompt),
        ...historyMessages(input.history),
        new HumanMessage({
          content: [
            { type: 'media', mimeType: input.audioMimeType ?? 'audio/webm', data: input.audioBase64 },
            { type: 'text', text: input.text ?? '(spoken audio above)' },
          ],
        }),
      ];
      const out = await model.invoke(messages);
      return out.content as string;
    }
    const prompt = chatTemplate();
    const messages = await prompt.formatMessages({
      systemPrompt: input.systemPrompt,
      history: historyMessages(input.history),
      input: input.text ?? '(the user said nothing)',
    });
    const out = await model.invoke(messages);
    return out.content as string;
  }

  return {
    name,
    async generate(input: GenerateInput): Promise<GenerateOutput> {
      const schema = input.responseJsonSchema ?? ChatReplySchema;
      try {
        const structured = model.withStructuredOutput(schema as never);
        const messages = input.audioBase64 && name === 'gemini'
          ? [
              new SystemMessage(input.systemPrompt),
              ...historyMessages(input.history),
              new HumanMessage({
                content: [
                  { type: 'media', mimeType: input.audioMimeType ?? 'audio/webm', data: input.audioBase64 },
                  { type: 'text', text: input.text ?? '(spoken audio above)' },
                ],
              }),
            ]
          : await chatTemplate().formatMessages({
              systemPrompt: input.systemPrompt,
              history: historyMessages(input.history),
              input: input.text ?? '(the user said nothing)',
            });
        const result = (await structured.invoke(messages)) as Record<string, unknown>;
        const text = JSON.stringify(result);
        let transcription: string | undefined;
        if (typeof result.userTranscription === 'string') transcription = result.userTranscription;
        return { text, transcription, raw: result };
      } catch {
        const text = await rawText(input);
        let transcription: string | undefined;
        try {
          const parsed = JSON.parse(text) as { userTranscription?: string };
          transcription = parsed.userTranscription;
        } catch { /* plain text reply */ }
        return { text, transcription };
      }
    },
    async *streamText(input: GenerateInput): AsyncGenerator<string> {
      const messages = await chatTemplate().formatMessages({
        systemPrompt: input.systemPrompt,
        history: historyMessages(input.history),
        input: input.text ?? '(the user said nothing)',
      });
      for await (const chunk of await model.stream(messages)) {
        const piece = chunk.content;
        if (typeof piece === 'string' && piece) yield piece;
      }
    },
  };
}

export function makeAIProvider(cfg: AIConfig = {}): AIProvider {
  if ((cfg.provider ?? 'stub') === 'stub') return stubAI;
  if (cfg.provider === 'gemini' && !cfg.apiKey && !process.env.GEMINI_API_KEY) {
    throw new Error('gemini provider needs apiKey or GEMINI_API_KEY');
  }
  if (cfg.provider === 'openai' && !cfg.apiKey && !process.env.OPENAI_API_KEY) {
    throw new Error('openai provider needs apiKey or OPENAI_API_KEY');
  }
  return langChainAI(makeChatModel(cfg), cfg.provider as string);
}
