import { z } from "zod";

export const EXPERIENCE_FORMAT = "patotalk.experience/v1";

export const VocabSchema = z.object({
  term: z.string(),
  meaning: z.string(),
  example: z.string().optional(),
});

export const CharacterASchema = z.object({
  role: z.string().default("You"),
  brief: z.string().describe("Instructions shown to the user: situation and goal."),
});

export const CharacterBSchema = z.object({
  name: z.string(),
  role: z.string(),
  context: z.string().describe("The scene, from B's point of view."),
  personality: z.string().optional(),
  emotionalState: z.string().optional(),
  rules: z.array(z.string()).default([]).describe("Behavioural and language rules."),
  hiddenMotivation: z.string().optional().describe("Never revealed to the user."),
  opening: z.string().optional().describe("B's first line. If missing, the LLM writes one."),
  voice: z
    .object({ gender: z.enum(["female", "male", "any"]).default("any"), id: z.string().optional() })
    .partial()
    .optional(),
});

export const CriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  weight: z.number().positive().default(1),
});

export const EvaluationSchema = z.object({
  criteria: z.array(CriterionSchema).min(1),
  scale: z.number().int().min(2).default(5),
  passThreshold: z.number().min(0).max(1).default(0.6),
  successCondition: z.string().optional().describe("When B considers the goal reached."),
});

export const MetaSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  language: z.string().describe("BCP-47 code the conversation happens in, e.g. en, ja, fr."),
  userLanguage: z.string().optional().describe("Learner's own language, for hints."),
  level: z.string().optional().describe("CEFR / JLPT / free text."),
  tags: z.array(z.string()).default([]),
  vocabulary: z.array(VocabSchema).default([]),
  tips: z.array(z.string()).default([]),
  estimatedMinutes: z.number().optional(),
  author: z.string().optional(),
});

export const ExperienceSchema = z.object({
  format: z.literal(EXPERIENCE_FORMAT).default(EXPERIENCE_FORMAT),
  id: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/, "id: lowercase letters, digits, - and _"),
  version: z.string().default("1.0.0"),
  meta: MetaSchema,
  characterA: CharacterASchema,
  characterB: CharacterBSchema,
  evaluation: EvaluationSchema,
  maxTurns: z.number().int().positive().default(10),
});

export type Experience = z.infer<typeof ExperienceSchema>;
export type ExperienceInput = z.input<typeof ExperienceSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;

export function parseExperience(input: unknown): Experience {
  const raw = typeof input === "string" ? parseText(input) : input;
  const r = ExperienceSchema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`Invalid Pato Talk experience: ${msg}`);
  }
  return r.data;
}

function parseText(text: string): unknown {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  const m = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (!m) throw new Error("Invalid Pato Talk experience: no JSON object or ```json block found");
  return JSON.parse(m[1]);
}

export function toJSON(exp: Experience): string {
  return JSON.stringify(exp, null, 2);
}

export function toMarkdown(exp: Experience): string {
  const b = exp.characterB;
  const lines = [
    `# ${exp.meta.title}`,
    "",
    exp.meta.description ?? "",
    "",
    `**Language:** ${exp.meta.language}${exp.meta.level ? ` · **Level:** ${exp.meta.level}` : ""}`,
    "",
    `## You (${exp.characterA.role})`,
    exp.characterA.brief,
    "",
    `## ${b.name} (${b.role})`,
    b.context,
    ...(b.personality ? [`- Personality: ${b.personality}`] : []),
    ...(b.emotionalState ? [`- Emotional state: ${b.emotionalState}`] : []),
    ...b.rules.map((r) => `- Rule: ${r}`),
    "",
    "## Evaluation",
    ...exp.evaluation.criteria.map((c) => `- ${c.id} (×${c.weight}): ${c.description}`),
    "",
    ...(exp.meta.vocabulary.length
      ? ["## Vocabulary", ...exp.meta.vocabulary.map((v) => `- **${v.term}**: ${v.meaning}`), ""]
      : []),
    "<!-- machine-readable source of truth -->",
    "```json",
    toJSON(exp),
    "```",
    "",
  ];
  return lines.join("\n");
}

export function characterPrompt(exp: Experience): string {
  const b = exp.characterB;
  const parts = [
    `You are playing a character in a spoken role-play used for learning. Stay in character at all times.`,
    `Character: ${b.name}. Role: ${b.role}.`,
    `Context: ${b.context}`,
    b.personality && `Personality: ${b.personality}`,
    b.emotionalState && `Emotional state: ${b.emotionalState}`,
    `The other person (the learner) is: ${exp.characterA.role}. Their situation: ${exp.characterA.brief}`,
    `Speak only in language "${exp.meta.language}"${exp.meta.level ? ` at level ${exp.meta.level}` : ""}.`,
    b.rules.length ? `Rules:\n${b.rules.map((r) => `- ${r}`).join("\n")}` : "",
    b.hiddenMotivation && `Hidden motivation (never state it directly): ${b.hiddenMotivation}`,
    exp.evaluation.successCondition && `The scene succeeds when: ${exp.evaluation.successCondition}`,
    `The learner speaks to you with their voice (you receive their audio). Answer what they actually said; if it was unclear, ask them to repeat, as a real person would.`,
    `If a message starts with USER INTERRUPTED, they talked over you: react naturally to what they said, and only repeat the part they missed if it still matters.`,
    `Your replies are converted to speech: plain spoken text only, no markdown, no emojis, no stage directions.`,
  ];
  return parts.filter(Boolean).join("\n");
}
