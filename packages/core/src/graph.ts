import { Annotation, END, MemorySaver, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph/web";
import type { BaseCheckpointSaver } from "@langchain/langgraph/web";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { characterPrompt, type Experience } from "./experience.js";
import { messageText } from "./llm.js";

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
  input: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
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
    const user = start ? null : new HumanMessage(s.input);
    const history: BaseMessage[] = [system, ...s.messages, user ?? new HumanMessage("(The scene starts now. Say your first line to the learner, in character.)")];
    let text = "";
    for (let i = 0; i < 2 && !text; i++) text = messageText(await llm.invoke(history)).trim(); // empty replies happen; retry once
    if (!text) throw new Error("The language model returned an empty reply. Try again.");
    return { messages: user ? [user, new AIMessage(text)] : [new AIMessage(text)], turns: start ? s.turns : s.turns + 1, input: "" };
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

export function transcript(exp: Experience, messages: BaseMessage[]): string {
  return messages
    .map((m) => `${m instanceof HumanMessage || m.getType() === "human" ? `Learner (${exp.characterA.role})` : exp.characterB.name}: ${messageText(m)}`)
    .join("\n");
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
    `corrections: up to 3 of the learner's actual sentences with a better version.`,
    `Reply as JSON: {"criteria":[{"id","score","comment"}],"goalReached":bool,"feedback":string,"corrections":[{"original","better"}]}`,
    ``,
    `Transcript:`,
    transcript(exp, messages),
  ]
    .filter((l) => l !== "")
    .join("\n");

  let raw: z.infer<typeof EvalSchema>;
  try {
    raw = (await llm.withStructuredOutput(EvalSchema).invoke(prompt)) as z.infer<typeof EvalSchema>;
  } catch {
    const text = messageText(await llm.invoke(prompt));
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
