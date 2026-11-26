import { useEffect, useMemo, useRef, useState } from "react";
import { parseExperience, toJSON, toMarkdown, type EvaluationResult, type Experience, type Session, type UserSummary } from "@patotalk/core";
import { playAudio } from "@patotalk/tts-web";
import {
  builtInExperiences,
  deleteMyExperience,
  download,
  engineFor,
  loadSettings,
  myExperiences,
  saveMyExperience,
  saveSettings,
  statsStore,
  ttsFor,
  type Settings,
} from "./runtime";
import { Editor } from "./Editor";
import { VoiceLab } from "./VoiceLab";

type View = { name: "library" } | { name: "play"; exp: Experience } | { name: "edit"; exp?: Experience } | { name: "stats" } | { name: "settings" } | { name: "voices" };

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>(settings.apiKey || settings.llm === "ollama" ? { name: "library" } : { name: "settings" });
  const update = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };
  const tabs: [View["name"], string][] = [
    ["library", "Experiences"],
    ["stats", "Stats"],
    ["voices", "Voice lab"],
    ["settings", "Settings"],
  ];
  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => setView({ name: "library" })}>
          🦆 Pato Talk
        </button>
        <nav>
          {tabs.map(([n, label]) => (
            <button key={n} className={view.name === n ? "on" : ""} onClick={() => setView({ name: n } as View)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {view.name === "library" && <Library onPlay={(exp) => setView({ name: "play", exp })} onEdit={(exp) => setView({ name: "edit", exp })} />}
        {view.name === "play" && <Play exp={view.exp} settings={settings} onExit={() => setView({ name: "library" })} />}
        {view.name === "edit" && (
          <Editor
            initial={view.exp}
            onSave={(e) => {
              saveMyExperience(e);
              setView({ name: "library" });
            }}
            onCancel={() => setView({ name: "library" })}
          />
        )}
        {view.name === "stats" && <Stats userId={settings.userId} />}
        {view.name === "settings" && <SettingsView s={settings} onChange={update} />}
        {view.name === "voices" && <VoiceLab />}
      </main>
    </div>
  );
}

function Library({ onPlay, onEdit }: { onPlay: (e: Experience) => void; onEdit: (e?: Experience) => void }) {
  const [mine, setMine] = useState(myExperiences);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const importFile = async (f: File) => {
    try {
      const e = parseExperience(await f.text());
      saveMyExperience(e);
      setMine(myExperiences());
      setErr("");
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  const card = (e: Experience, own: boolean) => (
    <article key={(own ? "m-" : "b-") + e.id} className="card">
      <div className="tags">
        <span className="lang">{e.meta.language}</span>
        {e.meta.level && <span>{e.meta.level}</span>}
        {own && <span>mine</span>}
      </div>
      <h3>{e.meta.title}</h3>
      <p>{e.meta.description ?? e.characterA.brief}</p>
      <p className="muted">
        with {e.characterB.name} · {e.characterB.role}
      </p>
      <div className="row">
        <button className="primary" onClick={() => onPlay(e)}>
          Start
        </button>
        <button onClick={() => onEdit(e)}>{own ? "Edit" : "Remix"}</button>
        <button onClick={() => download(`${e.id}.json`, toJSON(e))}>JSON</button>
        <button onClick={() => download(`${e.id}.md`, toMarkdown(e), "text/markdown")}>MD</button>
        {own && (
          <button
            onClick={() => {
              deleteMyExperience(e.id);
              setMine(myExperiences());
            }}
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
  return (
    <section>
      <div className="row between">
        <h2>Experiences</h2>
        <div className="row">
          <button className="primary" onClick={() => onEdit()}>
            + Create
          </button>
          <button onClick={() => fileRef.current?.click()}>Import .json / .md</button>
          <input ref={fileRef} type="file" accept=".json,.md" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="grid">
        {mine.map((e) => card(e, true))}
        {builtInExperiences.map((e) => card(e, false))}
      </div>
    </section>
  );
}

interface Line {
  who: "user" | "char";
  text: string;
}

function Play({ exp, settings, onExit }: { exp: Experience; settings: Settings; onExit: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState("Starting…");
  const [input, setInput] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [err, setErr] = useState("");
  const [turn, setTurn] = useState(0);
  const eng = useRef<Awaited<ReturnType<typeof engineFor>> | undefined>(undefined);
  const sess = useRef<Session | undefined>(undefined);
  const ctx = useMemo(() => new AudioContext(), []);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, evaluation]);

  const speak = async (text: string) => {
    const tts = ttsFor(settings);
    if (!tts || !settings.autoplay) return;
    setBusy("Speaking…");
    try {
      const v = exp.characterB.voice;
      const a = await tts.synthesize(text, { lang: exp.meta.language, gender: v?.gender, voice: v?.id });
      await playAudio(a, ctx);
    } catch (x) {
      setErr(`Voice: ${(x as Error).message}`);
    }
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        eng.current = await engineFor(settings);
        const { session, opening } = await eng.current.start(exp, { userId: settings.userId, speak: false });
        if (dead) return;
        sess.current = session;
        setLines([{ who: "char", text: opening.text }]);
        setBusy("");
        await speak(opening.text);
      } catch (x) {
        setErr((x as Error).message);
      } finally {
        if (!dead) setBusy("");
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const send = async (text: string) => {
    if (!text.trim() || !sess.current || !eng.current) return;
    setInput("");
    setLines((l) => [...l, { who: "user", text }]);
    setBusy(`${exp.characterB.name} is thinking…`);
    try {
      const t = await eng.current.say(sess.current, text, { speak: false });
      setTurn(t.turn);
      setLines((l) => [...l, { who: "char", text: t.text }]);
      if (t.evaluation) setEvaluation(t.evaluation);
      setBusy("");
      await speak(t.text);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy("");
    }
  };

  const end = async () => {
    if (!sess.current || !eng.current) return;
    setBusy("Evaluating…");
    try {
      setEvaluation(await eng.current.end(sess.current));
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy("");
    }
  };

  const mic = useMic(exp.meta.language, (t) => setInput(t));

  return (
    <section className="play">
      <aside>
        <button onClick={onExit}>← Back</button>
        <h2>{exp.meta.title}</h2>
        <p className="muted">
          {exp.meta.language} {exp.meta.level && `· ${exp.meta.level}`} · turn {turn}/{exp.maxTurns}
        </p>
        <h4>Your role: {exp.characterA.role}</h4>
        <p>{exp.characterA.brief}</p>
        <h4>
          {exp.characterB.name} · {exp.characterB.role}
        </h4>
        {exp.characterB.personality && <p className="muted">{exp.characterB.personality}</p>}
        {exp.meta.vocabulary.length > 0 && (
          <>
            <h4>Vocabulary</h4>
            <ul className="vocab">
              {exp.meta.vocabulary.map((v) => (
                <li key={v.term}>
                  <b>{v.term}</b> {v.meaning}
                </li>
              ))}
            </ul>
          </>
        )}
        {exp.meta.tips.length > 0 && (
          <>
            <h4>Tips</h4>
            <ul>
              {exp.meta.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        )}
      </aside>
      <div className="chat">
        <div className="lines">
          {lines.map((l, i) => (
            <div key={i} className={`bubble ${l.who}`}>
              {l.who === "char" && <small>{exp.characterB.name}</small>}
              <span>{l.text}</span>
              {l.who === "char" && (
                <button className="replay" title="Play again" onClick={() => speak(l.text)}>
                  🔊
                </button>
              )}
            </div>
          ))}
          {evaluation && <EvaluationCard ev={evaluation} exp={exp} />}
          <div ref={endRef} />
        </div>
        {err && <p className="error">{err}</p>}
        {busy && <p className="muted">{busy}</p>}
        {!evaluation && (
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {mic.supported && (
              <button type="button" className={mic.on ? "rec" : ""} onClick={mic.toggle} title="Speak">
                🎤
              </button>
            )}
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Answer ${exp.characterB.name}…`} disabled={!!busy && !busy.startsWith("Speaking")} />
            <button className="primary" disabled={!input.trim()}>
              Send
            </button>
            <button type="button" onClick={end} disabled={lines.length < 3}>
              End & evaluate
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function EvaluationCard({ ev, exp }: { ev: EvaluationResult; exp: Experience }) {
  return (
    <div className="eval">
      <h3>
        {ev.passed ? "Passed" : "Not yet"} · {Math.round(ev.score * 100)}%{ev.goalReached ? " · goal reached" : ""}
      </h3>
      <p>{ev.feedback}</p>
      <table>
        <tbody>
          {ev.criteria.map((c) => (
            <tr key={c.id}>
              <td>{exp.evaluation.criteria.find((d) => d.id === c.id)?.description ?? c.id}</td>
              <td className="num">
                {c.score}/{exp.evaluation.scale}
              </td>
              <td className="muted">{c.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ev.corrections.length > 0 && (
        <>
          <h4>Corrections</h4>
          <ul>
            {ev.corrections.map((c, i) => (
              <li key={i}>
                <s>{c.original}</s> → <b>{c.better}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function useMic(lang: string, onText: (t: string) => void) {
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  const [on, setOn] = useState(false);
  const rec = useRef<any>(null);
  const toggle = () => {
    if (on) return rec.current?.stop();
    const r = new SR();
    r.lang = lang;
    r.interimResults = true;
    r.onresult = (e: any) => onText(Array.from(e.results as ArrayLike<any>).map((x) => x[0].transcript).join(""));
    r.onend = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };
  return { supported: !!SR, on, toggle };
}

function Stats({ userId }: { userId: string }) {
  const [s, setS] = useState<UserSummary | null>(null);
  useEffect(() => {
    statsStore().then((st) => st.summary(userId).then(setS));
  }, [userId]);
  if (!s) return <p className="muted">Loading…</p>;
  const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
  return (
    <section>
      <h2>Stats for {userId}</h2>
      <p className="muted">Stored in SQLite in this browser. Only numbers are saved, never the conversations.</p>
      <div className="kpis">
        <div>
          <b>{s.attempts}</b>attempts
        </div>
        <div>
          <b>{s.passed}</b>passed
        </div>
        <div>
          <b>{pct(s.averageScore)}</b>average score
        </div>
        <div>
          <b>{s.streakDays}</b>day streak
        </div>
        <div>
          <b>{s.totalWords}</b>words spoken
        </div>
      </div>
      <h3>By experience</h3>
      <table>
        <thead>
          <tr>
            <th>Experience</th>
            <th className="num">Attempts</th>
            <th className="num">Best</th>
            <th>Passed</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(s.byExperience).map(([id, x]) => (
            <tr key={id}>
              <td>{id}</td>
              <td className="num">{x.attempts}</td>
              <td className="num">{pct(x.bestScore)}</td>
              <td>{x.passed ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SettingsView({ s, onChange }: { s: Settings; onChange: (s: Settings) => void }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  return (
    <section className="form">
      <h2>Settings</h2>
      <p className="muted">Saved in this browser only.</p>
      <label>
        Your name (stats user)
        <input value={s.userId} onChange={(e) => set("userId", e.target.value)} />
      </label>
      <h3>Language provider</h3>
      <label>
        Provider
        <select value={s.llm} onChange={(e) => set("llm", e.target.value as Settings["llm"])}>
          <option value="gemini">Gemini (cloud)</option>
          <option value="openai">OpenAI-compatible (cloud or local: LM Studio, vLLM, llama.cpp…)</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </label>
      {s.llm !== "ollama" && (
        <label>
          API key
          <input type="password" value={s.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder={s.llm === "gemini" ? "From aistudio.google.com/apikey" : ""} />
        </label>
      )}
      <label>
        Model (blank = default)
        <input value={s.model} onChange={(e) => set("model", e.target.value)} placeholder={s.llm === "gemini" ? "gemini-3.5-flash-lite" : s.llm === "openai" ? "gpt-4o-mini" : "llama3.1"} />
      </label>
      {s.llm !== "gemini" && (
        <label>
          Base URL
          <input value={s.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder={s.llm === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"} />
        </label>
      )}
      <h3>Voice provider</h3>
      <label>
        Voice
        <select value={s.tts} onChange={(e) => set("tts", e.target.value as Settings["tts"])}>
          <option value="supertonic">Supertonic 3 (local, in browser, 31 languages)</option>
          <option value="kokoro">Kokoro-82M (local, in browser)</option>
          <option value="web-speech">Browser voices (Web Speech)</option>
          <option value="gemini-tts">Gemini TTS (cloud, uses the Gemini key)</option>
          <option value="openai-speech">OpenAI-compatible speech server (e.g. Kokoro-FastAPI)</option>
          <option value="none">No voice</option>
        </select>
      </label>
      {s.tts === "openai-speech" && (
        <label>
          Speech server URL
          <input value={s.ttsUrl} onChange={(e) => set("ttsUrl", e.target.value)} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={s.autoplay} onChange={(e) => set("autoplay", e.target.checked)} /> Speak replies automatically
      </label>
    </section>
  );
}
