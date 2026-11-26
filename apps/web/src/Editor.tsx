import { useState } from "react";
import { parseExperience, toJSON, type Experience } from "@patotalk/core";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `exp-${Date.now()}`;

/** Create or edit an experience with a form; the JSON tab shows the portable file. */
export function Editor({ initial, onSave, onCancel }: { initial?: Experience; onSave: (e: Experience) => void; onCancel: () => void }) {
  const i = initial;
  const [f, setF] = useState({
    title: i?.meta.title ?? "",
    description: i?.meta.description ?? "",
    language: i?.meta.language ?? "en",
    userLanguage: i?.meta.userLanguage ?? "es",
    level: i?.meta.level ?? "",
    aRole: i?.characterA.role ?? "You",
    aBrief: i?.characterA.brief ?? "",
    bName: i?.characterB.name ?? "",
    bRole: i?.characterB.role ?? "",
    bContext: i?.characterB.context ?? "",
    bPersonality: i?.characterB.personality ?? "",
    bEmotion: i?.characterB.emotionalState ?? "",
    bRules: (i?.characterB.rules ?? ["Max 3 sentences.", "Implicit correction."]).join("\n"),
    bHidden: i?.characterB.hiddenMotivation ?? "",
    bOpening: i?.characterB.opening ?? "",
    bGender: i?.characterB.voice?.gender ?? "any",
    criteria: (i?.evaluation.criteria ?? [{ id: "task", description: "Completed the task.", weight: 1 }]).map((c) => `${c.description}`).join("\n"),
    success: i?.evaluation.successCondition ?? "",
    vocab: (i?.meta.vocabulary ?? []).map((v) => `${v.term} = ${v.meaning}`).join("\n"),
    tips: (i?.meta.tips ?? []).join("\n"),
    maxTurns: String(i?.maxTurns ?? 10),
  });
  const [tab, setTab] = useState<"form" | "json">("form");
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const build = (): Experience =>
    parseExperience({
      id: i?.id ?? slug(f.title),
      version: i?.version ?? "1.0.0",
      meta: {
        title: f.title,
        description: f.description || undefined,
        language: f.language,
        userLanguage: f.userLanguage || undefined,
        level: f.level || undefined,
        tags: i?.meta.tags ?? [],
        vocabulary: lines(f.vocab).map((l) => {
          const [term, ...rest] = l.split("=");
          return { term: term.trim(), meaning: rest.join("=").trim() };
        }),
        tips: lines(f.tips),
      },
      characterA: { role: f.aRole, brief: f.aBrief },
      characterB: {
        name: f.bName,
        role: f.bRole,
        context: f.bContext,
        personality: f.bPersonality || undefined,
        emotionalState: f.bEmotion || undefined,
        rules: lines(f.bRules),
        hiddenMotivation: f.bHidden || undefined,
        opening: f.bOpening || undefined,
        voice: { gender: f.bGender as "female" | "male" | "any" },
      },
      evaluation: {
        criteria: lines(f.criteria).map((d, n) => ({ id: i?.evaluation.criteria[n]?.id ?? `c${n + 1}`, description: d, weight: i?.evaluation.criteria[n]?.weight ?? 1 })),
        scale: i?.evaluation.scale ?? 5,
        passThreshold: i?.evaluation.passThreshold ?? 0.6,
        successCondition: f.success || undefined,
      },
      maxTurns: Number(f.maxTurns) || 10,
    });

  let preview = "";
  try {
    preview = toJSON(build());
  } catch (x) {
    preview = (x as Error).message;
  }

  const field = (k: keyof typeof f, label: string, opts: { area?: boolean; hint?: string } = {}) => (
    <label>
      {label}
      {opts.area ? <textarea rows={3} value={f[k]} onChange={set(k)} placeholder={opts.hint} /> : <input value={f[k]} onChange={set(k)} placeholder={opts.hint} />}
    </label>
  );

  return (
    <section className="form wide">
      <div className="row between">
        <h2>{i ? "Edit experience" : "Create an experience"}</h2>
        <div className="row">
          <button className={tab === "form" ? "on" : ""} onClick={() => setTab("form")}>
            Form
          </button>
          <button className={tab === "json" ? "on" : ""} onClick={() => setTab("json")}>
            File (JSON)
          </button>
        </div>
      </div>
      {tab === "json" ? (
        <pre className="json">{preview}</pre>
      ) : (
        <div className="cols">
          <fieldset>
            <legend>Shown to the user</legend>
            {field("title", "Title", { hint: "Ask for a raise" })}
            {field("description", "Short description")}
            <div className="row">
              {field("language", "Language (en, ja, fr…)")}
              {field("userLanguage", "Learner's language")}
              {field("level", "Level", { hint: "B1, N5…" })}
            </div>
            {field("aRole", "Character A: the user's role")}
            {field("aBrief", "Character A: situation and goal", { area: true, hint: "You feel you deserve a raise. Explain your achievements…" })}
            {field("vocab", "Vocabulary (one per line: term = meaning)", { area: true })}
            {field("tips", "Tips (one per line)", { area: true })}
          </fieldset>
          <fieldset>
            <legend>Character B (the AI)</legend>
            <div className="row">
              {field("bName", "Name", { hint: "Mr. Sterling" })}
              {field("bRole", "Role", { hint: "Strict boss" })}
            </div>
            {field("bContext", "Context", { area: true })}
            {field("bPersonality", "Personality")}
            {field("bEmotion", "Emotional state")}
            {field("bRules", "Behaviour & language rules (one per line)", { area: true })}
            {field("bHidden", "Hidden motivation (never shown)", { area: true })}
            {field("bOpening", "Opening line (optional)")}
            <label>
              Voice
              <select value={f.bGender} onChange={set("bGender")}>
                <option value="any">any</option>
                <option value="female">female</option>
                <option value="male">male</option>
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>Evaluation</legend>
            {field("criteria", "Criteria (one per line)", { area: true })}
            {field("success", "Success condition")}
            {field("maxTurns", "Max turns")}
          </fieldset>
        </div>
      )}
      {err && <p className="error">{err}</p>}
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            try {
              onSave(build());
            } catch (x) {
              setErr((x as Error).message);
            }
          }}
        >
          Save
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
