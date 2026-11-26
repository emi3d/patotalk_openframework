import { useEffect, useMemo, useRef, useState } from "react";
import { llmProvider, llmProviders, parseExperience, toJSON, toMarkdown, ttsProvider, ttsProviders, type ProviderField, type ProviderOptions, type EvaluationResult, type Experience, type Session, type UserSummary } from "@patotalk/core";
import { AudioPlayer, EnergyDetector, HandsFreeMic, TenVadDetector, VoiceRecorder, WebSpeechTTS, type RecordedVoice, type VoiceDetector } from "@patotalk/tts-web";
import { Duck } from "./Duck";
import {
  builtInExperiences,
  deleteMyExperience,
  download,
  engineFor,
  llmMissing,
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
  const [view, setView] = useState<View>(llmMissing(settings).length ? { name: "settings" } : { name: "library" });
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
  voice?: { url: string; seconds: number };
}


function Play({ exp, settings, onExit }: { exp: Experience; settings: Settings; onExit: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [thinking, setThinking] = useState("Starting…");
  const [voiceStatus, setVoiceStatus] = useState("");
  const [input, setInput] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [err, setErr] = useState("");
  const [turn, setTurn] = useState(0);
  const eng = useRef<Awaited<ReturnType<typeof engineFor>> | undefined>(undefined);
  const sess = useRef<Session | undefined>(undefined);
  const player = useMemo(() => new AudioPlayer(), []);
  const fallback = useMemo(() => new WebSpeechTTS(), []);
  const speakId = useRef(0);
  const alive = useRef(true);
  const [talking, setTalking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, evaluation]);
  useEffect(
    () => () => {
      alive.current = false;
      speakId.current++;
      player.close();
    },
    [player],
  );

  const silence = () => {
    speakId.current++;
    player.stop();
    setTalking(false);
  };

  const speak = async (text: string) => {
    const tts = ttsFor(settings);
    if (!tts || !text || !alive.current) return;
    const id = ++speakId.current;
    player.stop();
    setTalking(true);
    const v = exp.characterB.voice;
    const opts = { lang: exp.meta.language, gender: v?.gender, voice: v?.id };
    setVoiceStatus("Preparing voice…");
    try {
      const a = await tts.synthesize(text, opts);
      if (id !== speakId.current) return;
      setVoiceStatus("");
      await player.play(a);
    } catch (x) {
      if (id !== speakId.current) return;
      setVoiceStatus(`Voice model failed (${(x as Error).message}). Using the browser voice for this line.`);
      try {
        if (alive.current) await fallback.synthesize(text, { lang: exp.meta.language });
      } catch {}
    } finally {
      if (id === speakId.current && alive.current) {
        setTalking(false);
        setVoiceStatus((s) => (s.startsWith("Voice model failed") ? s : ""));
      }
    }
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      const missing = llmMissing(settings);
      if (missing.length) {
        setErr(`Fill in ${missing.join(", ")} for the language provider in Settings first.`);
        setThinking("");
        return;
      }
      const tts = ttsFor(settings) as { load?: () => Promise<unknown> } | undefined;
      if (tts?.load) {
        setVoiceStatus("Loading voice model (first time downloads a few hundred MB)…");
        tts.load().then(
          () => !dead && setVoiceStatus(""),
          (x) => !dead && setVoiceStatus(`Voice model could not load: ${(x as Error).message}. Browser voice will be used.`),
        );
      }
      try {
        eng.current = await engineFor(settings);
        const { session, opening } = await eng.current.start(exp, { userId: settings.userId, speak: false });
        if (dead) return;
        sess.current = session;
        setLines([{ who: "char", text: opening.text }]);
        setThinking("");
        if (settings.autoplay) speak(opening.text);
      } catch (x) {
        if (!dead) setErr(friendly(x));
      } finally {
        if (!dead) setThinking("");
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const send = async (what: string | RecordedVoice) => {
    const voice = typeof what === "string" ? undefined : what;
    const text = typeof what === "string" ? what.trim() : "";
    if ((!voice && !text) || thinking || !sess.current || !eng.current) return;
    setErr("");
    if (!voice) setInput("");
    silence();
    setLines((l) => [...l, voice ? { who: "user", text: "", voice: { url: voice.url, seconds: voice.seconds } } : { who: "user", text }]);
    setThinking(`${exp.characterB.name} is listening…`);
    try {
      const t = await eng.current.say(sess.current, voice ? { audio: voice.audio, mimeType: voice.mimeType, seconds: voice.seconds } : text, { speak: false });
      if (!alive.current) return;
      setTurn(t.turn);
      setLines((l) => [...l, { who: "char", text: t.text }]);
      if (t.evaluation) setEvaluation(t.evaluation);
      setThinking("");
      if (settings.autoplay) speak(t.text);
    } catch (x) {
      setLines((l) => l.slice(0, -1));
      if (voice) setUnsent(voice);
      else setInput(text);
      setErr(friendly(x, !!voice));
    } finally {
      setThinking("");
    }
  };

  const end = async () => {
    if (!sess.current || !eng.current || thinking) return;
    setErr("");
    setThinking("Evaluating…");
    try {
      setEvaluation(await eng.current.end(sess.current));
    } catch (x) {
      setErr(`${friendly(x)} You can press "End & evaluate" again.`);
    } finally {
      setThinking("");
    }
  };

  const [unsent, setUnsent] = useState<RecordedVoice | null>(null);
  const ready = !!sess.current && !thinking;
  const sendRef = useRef(send);
  sendRef.current = send;
  const [handsFree, setHandsFree] = useState(settings.handsFree && HandsFreeMic.supported);
  const hidden = usePageHidden();
  const hf = useHandsFree(handsFree && !hidden && !evaluation, {
    paused: !ready || talking,
    onUtterance: (v) => {
      setUnsent(null);
      sendRef.current(v);
    },
    onError: (e) => {
      setErr(e);
      setHandsFree(false);
    },
  });
  useEffect(() => {
    if (hidden) silence();
  }, [hidden]);
  const duckState = hf.hearing ? "hearing" : thinking ? "thinking" : talking ? "talking" : hf.on ? "listening" : "idle";
  const mic = useMic((v) => {
    setUnsent(null);
    send(v);
  }, setErr);
  useEffect(() => () => mic.cancel(), []);

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
        <div className="stage">
          <Duck level={player.level.bind(player)} state={duckState} />
          <p className="muted">
            {hf.hearing
              ? "Listening to you…"
              : thinking
                ? thinking
                : talking
                  ? voiceStatus || `${exp.characterB.name} is talking…`
                  : hf.on
                  ? `Your turn: just talk${hf.detector ? ` (${hf.detector})` : ""}.`
                  : hf.starting
                    ? "Starting the microphone…"
                    : ""}
          </p>
        </div>
        <div className="lines">
          {lines.map((l, i) => (
            <div key={i} className={`bubble ${l.who}`}>
              {l.who === "char" && <small>{exp.characterB.name}</small>}
              {l.voice ? (
                <span className="voice">
                  🎤 {l.voice.seconds.toFixed(1)} s <audio src={l.voice.url} controls preload="none" />
                </span>
              ) : (
                <span>{l.text}</span>
              )}
              {l.who === "char" && ttsFor(settings) && (
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
        {thinking && !hf.on && <p className="muted">{thinking}</p>}
        {voiceStatus && <p className="muted">{voiceStatus}</p>}
        {!evaluation && (
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {HandsFreeMic.supported && (
              <button type="button" className={handsFree ? "rec" : ""} onClick={() => setHandsFree((x) => !x)} title="Always-on microphone">
                {handsFree ? "🎧 Hands-free on" : "🎧 Hands-free"}
              </button>
            )}
            {mic.supported && !handsFree && (
              <button
                type="button"
                className={mic.on ? "rec" : ""}
                onClick={mic.on ? mic.stop : mic.start}
                title={mic.on ? "Stop and send" : "Hold a thought, press, speak, press again to send"}
                disabled={!ready && !mic.on}
              >
                {mic.on ? `■ Send ${mic.elapsed}s` : "🎤 Speak"}
              </button>
            )}
            {mic.on && (
              <button type="button" onClick={mic.cancel}>
                Cancel
              </button>
            )}
            {unsent && !mic.on && (
              <button type="button" onClick={() => send(unsent)} disabled={!ready}>
                Resend voice
              </button>
            )}
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={mic.supported ? "…or type" : `Answer ${exp.characterB.name}…`} disabled={mic.on} />
            <button className="primary" disabled={!ready || !input.trim()}>
              Send
            </button>
            <button type="button" onClick={end} disabled={!ready || lines.length < 3}>
              End & evaluate
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function friendly(x: unknown, voice = false): string {
  const m = String((x as Error)?.message ?? x);
  if (voice && /audio|input_audio|modalit|mime|not supported|unsupported|INVALID_ARGUMENT|400/i.test(m))
    return "This model can't listen to audio. Pick a multimodal model in Settings (Gemini works), or type your answer.";
  if (/API key|401|403|PERMISSION|API_KEY/i.test(m)) return "The API key was rejected. Check it in Settings.";
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(m)) return "The model is rate-limited right now. Wait a few seconds and send again.";
  if (/503|overloaded|UNAVAILABLE/i.test(m)) return "The model is busy right now. Send again in a moment.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return `No connection to the model. Check your internet (or that the local server is running) and ${voice ? "press Resend voice" : "send again"}.`;
  return m;
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

function usePageHidden() {
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

function useHandsFree(
  enabled: boolean,
  o: { paused: boolean; onUtterance: (v: RecordedVoice) => void; onError: (e: string) => void },
) {
  const cb = useRef(o);
  cb.current = o;
  const mic = useRef<HandsFreeMic | undefined>(undefined);
  const [on, setOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [detector, setDetector] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    setStarting(true);
    (async () => {
      const det: VoiceDetector = await TenVadDetector.load().catch((e) => {
        console.warn("TEN VAD unavailable, using loudness detection", e);
        return new EnergyDetector();
      });
      if (dead) return det.destroy?.();
      const m = new HandsFreeMic({
        detector: det,
        onSpeechStart: () => setHearing(true),
        onUtterance: (v) => {
          setHearing(false);
          cb.current.onUtterance(v);
        },
        onDiscard: () => setHearing(false),
      });
      m.paused = cb.current.paused;
      try {
        await m.start();
      } catch (e) {
        m.destroy();
        const n = (e as Error).name;
        if (!dead)
          cb.current.onError(
            n === "NotAllowedError" ? "Microphone blocked. Allow it in the browser's site settings, or type instead." : `Microphone: ${(e as Error).message}`,
          );
        return;
      } finally {
        if (!dead) setStarting(false);
      }
      if (dead) return m.destroy();
      mic.current = m;
      setDetector(det.id === "ten-vad" ? "TEN VAD" : "loudness");
      setOn(true);
    })();
    return () => {
      dead = true;
      mic.current?.destroy();
      mic.current = undefined;
      setOn(false);
      setHearing(false);
      setStarting(false);
    };
  }, [enabled]);
  useEffect(() => {
    if (mic.current) mic.current.paused = o.paused;
    if (o.paused) setHearing(false);
  }, [o.paused]);
  return { on, starting, hearing, detector };
}

function useMic(onVoice: (v: RecordedVoice) => void, onError: (e: string) => void) {
  const [on, setOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval>>(undefined);
  const stopRef = useRef<() => void>(() => {});
  const rec = useMemo(() => new VoiceRecorder({ maxSeconds: 60, onAutoStop: () => stopRef.current() }), []);
  const reset = () => {
    clearInterval(tick.current);
    setOn(false);
    setElapsed(0);
  };
  const start = async () => {
    onError("");
    try {
      await rec.start();
      setOn(true);
      const t0 = Date.now();
      tick.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    } catch (e) {
      reset();
      const n = (e as Error).name;
      onError(
        n === "NotAllowedError"
          ? "Microphone blocked. Allow it in the browser's site settings, or type instead."
          : n === "NotFoundError"
            ? "No microphone found. Plug one in, or type instead."
            : `Microphone: ${(e as Error).message}`,
      );
    }
  };
  const stop = async () => {
    reset();
    try {
      const v = await rec.stop();
      if (v) onVoice(v);
      else onError("I didn't hear anything. Press Speak and talk a bit longer (check the mic isn't muted).");
    } catch (e) {
      onError(`Couldn't read the recording: ${(e as Error).message}`);
    }
  };
  stopRef.current = stop;
  const cancel = () => {
    rec.cancel();
    reset();
  };
  return { supported: VoiceRecorder.supported, on, elapsed, start, stop, cancel };
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
          <b>{Math.round(s.totalSpeakingSeconds / 6) / 10}</b>minutes spoken
        </div>
        <div>
          <b>{s.totalWords}</b>words typed
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

function ProviderFields({ fields, values, onChange }: { fields: ProviderField[]; values: ProviderOptions; onChange: (v: ProviderOptions) => void }) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.required ? "" : " (optional)"}
          <input
            type={f.secret ? "password" : "text"}
            value={values[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
          />
        </label>
      ))}
    </>
  );
}

function SettingsView({ s, onChange }: { s: Settings; onChange: (s: Settings) => void }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });
  const llm = llmProvider(s.llm);
  const tts = ttsProvider(s.tts);
  return (
    <section className="form">
      <h2>Settings</h2>
      <p className="muted">Saved in this browser only.</p>
      <label>
        Your name (stats user)
        <input value={s.userId} onChange={(e) => set("userId", e.target.value)} />
      </label>
      <h3>Language provider</h3>
      <p className="muted">
        The model listens to your voice directly, so it must accept audio input. Text-only models still work if you type. Apps can add any provider with
        registerLLMProvider().
      </p>
      <label>
        Provider
        <select value={s.llm} onChange={(e) => set("llm", e.target.value)}>
          {llmProviders().map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {llm && <ProviderFields fields={llm.fields} values={s.llmOptions[s.llm] ?? {}} onChange={(v) => set("llmOptions", { ...s.llmOptions, [s.llm]: v })} />}
      <h3>Voice provider</h3>
      <label>
        Voice
        <select value={s.tts} onChange={(e) => set("tts", e.target.value)}>
          {ttsProviders().map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="none">No voice</option>
        </select>
      </label>
      {tts && <ProviderFields fields={tts.fields} values={s.ttsOptions[s.tts] ?? {}} onChange={(v) => set("ttsOptions", { ...s.ttsOptions, [s.tts]: v })} />}
      <label className="check">
        <input type="checkbox" checked={s.autoplay} onChange={(e) => set("autoplay", e.target.checked)} /> Speak replies automatically
      </label>
      <label className="check">
        <input type="checkbox" checked={s.handsFree} onChange={(e) => set("handsFree", e.target.checked)} /> Hands-free: the mic listens on your turn, after the character
        finishes (TEN VAD, a ~280 KB voice detector)
      </label>
    </section>
  );
}
