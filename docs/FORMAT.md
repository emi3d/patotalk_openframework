# Experience format · `patotalk.experience/v1`

An experience is one JSON object, or a Markdown file that holds one ```` ```json ```` block (the format `toMarkdown()` writes). The schema lives in `packages/core/src/experience.ts` (zod), and `parseExperience()` validates a file.

| Field | Required | Meaning |
|---|---|---|
| `format` | – | `"patotalk.experience/v1"` |
| `id` | ✓ | lowercase slug |
| `version` | – | semver, default `1.0.0` |
| `meta.title` | ✓ | shown to the user |
| `meta.language` | ✓ | language of the conversation (`en`, `ja`, `fr`…) |
| `meta.userLanguage` | – | learner's language, used for feedback |
| `meta.level`, `description`, `tags`, `vocabulary[{term,meaning,example?}]`, `tips[]`, `estimatedMinutes`, `author` | – | extra metadata to show the user |
| `characterA.role`, `characterA.brief` | ✓ brief | the user: their role, situation and goal (shown to them) |
| `characterB.name`, `role`, `context` | ✓ | the persona the LLM plays on top of its base persona |
| `characterB.personality`, `emotionalState`, `rules[]`, `hiddenMotivation`, `opening`, `voice{gender,id}` | – | behaviour, language rules, secret condition (never shown), first line, voice |
| `evaluation.criteria[{id,description,weight}]` | ✓ | the rubric |
| `evaluation.scale` (5), `passThreshold` (0.6), `successCondition` | – | scoring |
| `maxTurns` | – | the scene auto-evaluates when it's reached (default 10) |

Scoring: each criterion is scored from 1 to `scale`. The total is the weighted mean of `(score-1)/(scale-1)`, so it runs from 0 to 1, and `passed = score ≥ passThreshold`.

## Example

The "ask for a raise" scene, saved in this format, is `experiences/ask-for-a-raise.json`.
