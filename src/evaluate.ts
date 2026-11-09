import type { AIProvider } from './types.js';
import type { EvaluationResult, Rubric, Situation, Turn } from './types.js';

export function scoreRubric(
  rubric: Rubric,
  scores: Record<string, number>,
): { weightedScore: number; breakdown: { criterionId: string; score: number; feedback: string }[] } {
  const scale = rubric.scale ?? 5;
  let weighted = 0;
  const breakdown = rubric.criteria.map((c) => {
    const raw = Math.max(0, Math.min(scale, scores[c.id] ?? 0));
    weighted += (raw / scale) * c.weight;
    return { criterionId: c.id, score: raw, feedback: '' };
  });
  return { weightedScore: Math.round(weighted * 1000) / 1000, breakdown };
}

function heuristicObjectivesMet(situation: Situation, transcript: string): string[] {
  const text = transcript.toLowerCase();
  return situation.objectives
    .filter((o) => (o.keywords ?? []).some((k) => text.includes(k.toLowerCase())))
    .map((o) => o.id);
}

export async function evaluateSession(
  situation: Situation,
  turns: Turn[],
  ai: AIProvider,
): Promise<EvaluationResult> {
  const transcript = turns.map((t) => `${t.role === 'user' ? 'Learner' : 'AI'}: ${t.text}`).join('\n');
  let scores: Record<string, number> = {};
  let feedback = '';

  if (ai.name === 'stub') {
    const learnerText = turns.filter((t) => t.role === 'user').map((t) => t.text).join(' ').toLowerCase();
    for (const c of situation.rubric.criteria) {
      const hit = situation.objectives.some(
        (o) => (o.keywords ?? []).some((k) => learnerText.includes(k.toLowerCase())),
      );
      scores[c.id] = hit ? 4 : 2;
    }
    feedback = 'Evaluated with the stub provider (keyword heuristic). Plug in a real AI provider for LLM scoring.';
  } else {
    const criteriaText = situation.rubric.criteria.map((c) => `- ${c.id}: ${c.description}`).join('\n');
    const prompt = `Score this practice session 0-${situation.rubric.scale ?? 5} per criterion. Reply ONLY with JSON: {"scores": {"<criterionId>": <number>}, "feedback": "<one short paragraph>"}\n\nCriteria:\n${criteriaText}\n\nTranscript:\n${transcript}`;
    const out = await ai.generate({
      systemPrompt: 'You are a strict but fair language/practice evaluator. Reply only with the requested JSON.',
      history: [],
      text: prompt,
      responseJsonSchema: {
        type: 'object',
        properties: {
          scores: { type: 'object' },
          feedback: { type: 'string' },
        },
        required: ['scores', 'feedback'],
      },
    });
    try {
      const parsed = JSON.parse(out.text) as { scores?: Record<string, number>; feedback?: string };
      scores = parsed.scores ?? {};
      feedback = parsed.feedback ?? '';
    } catch {
      throw new Error(`Evaluator returned unparsable JSON: ${out.text.slice(0, 200)}`);
    }
  }

  const { weightedScore, breakdown } = scoreRubric(situation.rubric, scores);
  const objectivesMet = heuristicObjectivesMet(situation, transcript);
  const requiredMet = situation.objectives.filter((o) => o.required).every((o) => objectivesMet.includes(o.id));
  const completed = weightedScore >= situation.rubric.passThreshold && requiredMet;
  return {
    scores: breakdown.map((b) => ({ ...b, feedback: b.feedback })),
    weightedScore,
    objectivesMet,
    completed,
    feedback,
    evaluatedAt: new Date().toISOString(),
  };
}
