import { Annotation, END, MemorySaver, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph/web";
import type { BaseCheckpointSaver } from "@langchain/langgraph/web";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { characterPrompt, type Experience } from "./experience.js";
import { messageText } from "./llm.js";

/** What the learner says in a turn: their recorded voice (preferred) or typed text. */
export type UserInput = string | UserAudio;
export interface UserAudio {
  /** Base64 audio. WAV or MP3 work with every multimodal provider. */
  audio: string;
  mimeType: string;
  /** Length in seconds, for stats. */
  seconds?: number;
}
export const isAudio = (x: unknown): x is UserAudio => !!x && typeof x === "object" && "audio" in x;

/** The learner's turn as a LangChain message. Audio goes to the model as is: it listens, nothing is transcribed. */
export function learnerMessage(input: UserInput): HumanMessage {
  if (!isAudio(input)) return new HumanMessage(input);
  return new HumanMessage({
    content: [{ type: "audio", source_type: "base64", mime_type: input.mimeType, data: input.audio }] as any,
    additional_kwargs: { patotalkAudioSeconds: input.seconds ?? 0 },
  });
}
const hasAudio = (m: BaseMessage) => Array.isArray(m.content) && m.content.some((p: any) => p?.type === "audio");

export interface CriterionResult {
  id: string;
  score: number;
  comment: string;
}

export interface EvaluationResult {
  criteria: CriterionResult[];
  /** 0..1, weighted by the experience's criteria weights. */
  score: number;
  passed: boolean;
  goalReached: boolean;
  feedback: string;
  corrections: { original: string; better: string }[];
}

export const ConversationState = Annotation.Root({
  ...MessagesAnnotation.spec,
  /** "start" asks B for an opening line, "evaluate" ends the scene. Otherwise a user turn. */
  action: Annotation<"start" | "talk" | "evaluate">({ reducer: (_, b) => b, default: () => "talk" }),
  /** The learner's line for this turn. Added to history together with B's reply, so a failed turn leaves no trace. */
  input: Annotation<UserInput | null>({ reducer: (_, b) => b, default: () => null }),
  turns: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  evaluation: Annotation<EvaluationResult | null>({ reducer: (_, b) => b, default: () => null }),
});
export type ConversationStateType = typeof ConversationState.State;

const EvalSchema = z.object({
  criteria: z.array(z.object({ id: z.string(), score: z.number(), comment: z.string() })),
  goalReached: z.boolean(),
  feedback: z.string(),
  corrections: z.array(z.object({ original: z.string(), better: z.string() })),
});

/**
 * The Pato Talk loop as a LangGraph graph:
 *
 *   START ─▶ route ─┬─▶ character ─┬─▶ END            (one turn per invoke)
 *                   │              └─▶ evaluate ─▶ END (turn limit reached)
 *                   └─▶ evaluate ─▶ END               (user ends the scene)
 *
 * Conversation memory lives in the checkpointer (thread_id = session id), not in a database.
 */
export function buildConversationGraph(opts: {
  experience: Experience;
  llm: BaseChatModel;
  evaluator?: BaseChatModel;
  checkpointer?: BaseCheckpointSaver;
}) {
  const { experience: exp, llm } = opts;
  const evaluator = opts.evaluator ?? llm;
  const system = new SystemMessage(characterPrompt(exp));

  const character = async (s: ConversationStateType) => {
    const start = s.action === "start";
    if (start && exp.characterB.opening) return { messages: [new AIMessage(exp.characterB.opening)] };
    const user = start || s.input == null ? null : learnerMessage(s.input);
    const history: BaseMessage[] = [system, ...s.messages, user ?? new HumanMessage("(The scene starts now. Say your first line to the learner, in character.)")];
    let text = "";
    for (let i = 0; i < 2 && !text; i++) text = messageText(await llm.invoke(history)).trim(); // empty replies happen; retry once
    if (!text) throw new Error("The language model returned an empty reply. Try again.");
    return { messages: user ? [user, new AIMessage(text)] : [new AIMessage(text)], turns: start ? s.turns : s.turns + 1, input: null };
  };

  const evaluate = async (s: ConversationStateType) => ({ evaluation: await evaluateConversation(exp, s.messages, evaluator) });

  return new StateGraph(ConversationState)
    .addNode("character", character)
    .addNode("evaluate", evaluate)
    .addConditionalEdges(START, (s) => (s.action === "evaluate" ? "evaluate" : "character"), ["character", "evaluate"])
    .addConditionalEdges("character", (s) => (s.turns >= exp.maxTurns ? "evaluate" : END), ["evaluate", END])
    .addEdge("evaluate", END)
    .compile({ checkpointer: opts.checkpointer ?? new MemorySaver() });
}

const speaker = (exp: Experience, m: BaseMessage) => (m.getType() === "human" ? `Learner (${exp.characterA.role})` : exp.characterB.name);

/** Text-only transcript; the learner's voice turns appear as "(spoke)". */
export function transcript(exp: Experience, messages: BaseMessage[]): string {
  return messages.map((m) => `${speaker(exp, m)}: ${hasAudio(m) ? "(spoke)" : messageText(m)}`).join("\n");
}

/** The transcript as message content parts, with the learner's audio in place so the evaluator can hear it. */
function transcriptParts(exp: Experience, messages: BaseMessage[]): any[] {
  const parts: any[] = [];
  for (const m of messages) {
    if (hasAudio(m)) {
      parts.push({ type: "text", text: `${speaker(exp, m)} (audio):` });
      for (const p of m.content as any[]) if (p?.type === "audio") parts.push(p);
    } else parts.push({ type: "text", text: `${speaker(exp, m)}: ${messageText(m)}` });
  }
  return parts;
}

export async function evaluateConversation(exp: Experience, messages: BaseMessage[], llm: BaseChatModel): Promise<EvaluationResult> {
  const ev = exp.evaluation;
  const prompt = [
    `You are a strict but kind evaluator of a language-learning role-play. Evaluate ONLY the learner's lines.`,
    `Scene: ${exp.meta.title}. Language: ${exp.meta.language}${exp.meta.level ? `, level ${exp.meta.level}` : ""}.`,
    `Learner's task: ${exp.characterA.brief}`,
    ev.successCondition ? `Goal reached when: ${ev.successCondition}` : "",
    exp.characterB.hiddenMotivation ? `The other character's hidden condition: ${exp.characterB.hiddenMotivation}` : "",
    `Score each criterion from 1 to ${ev.scale}:`,
    ...ev.criteria.map((c) => `- ${c.id}: ${c.description}`),
    `Write feedback (2-3 sentences) and corrections in ${exp.meta.userLanguage ?? "the learner's target language"}.`,
    `corrections: up to 3 of the learner's actual sentences (write what you heard) with a better version.`,
    `Where the learner spoke in audio, also judge pronunciation and fluency inside the relevant criteria.`,
    `Reply as JSON: {"criteria":[{"id","score","comment"}],"goalReached":bool,"feedback":string,"corrections":[{"original","better"}]}`,
    ``,
    `Conversation:`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  const input = [new HumanMessage({ content: [{ type: "text", text: prompt }, ...transcriptParts(exp, messages)] as any })];

  let raw: z.infer<typeof EvalSchema>;
  try {
    raw = (await llm.withStructuredOutput(EvalSchema).invoke(input)) as z.infer<typeof EvalSchema>;
  } catch {
    const text = messageText(await llm.invoke(input));
    const m = text.match(/\{[\s\S]*\}/);
    raw = EvalSchema.parse(JSON.parse(m ? m[0] : text));
  }
  return scoreEvaluation(exp, raw);
}

/** Weighted 0..1 score from per-criterion scores. Unknown ids are ignored, missing ones count as 1. */
export function scoreEvaluation(exp: Experience, raw: z.infer<typeof EvalSchema>): EvaluationResult {
  const { criteria: defs, scale, passThreshold } = exp.evaluation;
  const byId = new Map(raw.criteria.map((c) => [c.id, c]));
  const criteria = defs.map((d) => {
    const c = byId.get(d.id);
    return { id: d.id, score: Math.max(1, Math.min(scale, Math.round(c?.score ?? 1))), comment: c?.comment ?? "" };
  });
  const totalW = defs.reduce((s, d) => s + d.weight, 0);
  const score = defs.reduce((s, d, i) => s + (d.weight * (criteria[i].score - 1)) / (scale - 1), 0) / totalW;
  return {
    criteria,
    score: Math.round(score * 100) / 100,
    passed: score >= passThreshold,
    goalReached: raw.goalReached,
    feedback: raw.feedback,
    corrections: raw.corrections ?? [],
  };
}
