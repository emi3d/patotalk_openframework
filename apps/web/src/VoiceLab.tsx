import { useEffect, useMemo, useState } from "react";
import { encodeWav, type TTSProvider } from "@patotalk/core";
import { AudioPlayer, KokoroWebTTS, SupertonicWebTTS } from "@patotalk/tts-web";

const SAMPLES = [
  { lang: "ja", text: "味噌ラーメンが一番おいしいですよ。大盛りにしますか？", kana: "みそらーめんが いちばん おいしいですよ。おおもりに しますか？" },
  { lang: "fr", text: "Bonjour madame ! Je voudrais une baguette et deux croissants, s'il vous plaît." },
  { lang: "en", text: "Tell me exact numbers, like sales or money saved." },
];

interface Row {
  key: string;
  ms: number;
  sec: number;
  url: string;
  err?: string;
}

/** Try the in-browser voice models side by side, with timings and downloadable WAVs. */
export function VoiceLab() {
  const engines = useMemo<Record<string, TTSProvider>>(
    () => ({
      "Supertonic 3": new SupertonicWebTTS(),
      "Kokoro (WASM)": new KokoroWebTTS({ device: "wasm" }),
      "Kokoro (WebGPU)": new KokoroWebTTS({ device: "webgpu" }),
    }),
    [],
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState("");
  const [text, setText] = useState(SAMPLES[0].kana!);
  const [lang, setLang] = useState("ja");
  const player = useMemo(() => new AudioPlayer(), []);
  useEffect(() => () => player.close(), [player]);

  const run = async (name: string, t: string, l: string, gender: "female" | "male") => {
    const key = `${name} · ${l} · ${gender}`;
    setBusy(`${key}: loading model and generating (first run downloads it)…`);
    const s = performance.now();
    try {
      const a = await engines[name].synthesize(t, { lang: l, gender });
      const ms = performance.now() - s;
      const wav = encodeWav(a.samples!, a.sampleRate!);
      const url = URL.createObjectURL(new Blob([wav.slice().buffer], { type: "audio/wav" }));
      setRows((r) => [{ key, ms, sec: a.samples!.length / a.sampleRate!, url }, ...r]);
      await player.play(a);
    } catch (x) {
      setRows((r) => [{ key, ms: 0, sec: 0, url: "", err: (x as Error).message }, ...r]);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="form wide">
      <h2>Voice lab</h2>
      <p className="muted">
        Runs the voice models inside this browser. The first run downloads the model (Supertonic about 400 MB, Kokoro about 90–330 MB) and caches it. For
        Japanese, Kokoro needs kana; Supertonic reads kanji directly.
      </p>
      <div className="row">
        {SAMPLES.map((s) => (
          <button
            key={s.lang}
            onClick={() => {
              setLang(s.lang);
              setText(s.kana ?? s.text);
            }}
          >
            Sample {s.lang}
          </button>
        ))}
      </div>
      <label>
        Text
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        Language
        <input value={lang} onChange={(e) => setLang(e.target.value)} />
      </label>
      <div className="row">
        {Object.keys(engines).map((n) =>
          (["female", "male"] as const).map((g) => (
            <button key={n + g} disabled={!!busy} onClick={() => run(n, text, lang, g)}>
              {n} {g}
            </button>
          )),
        )}
      </div>
      {busy && <p className="muted">{busy}</p>}
      <table>
        <thead>
          <tr>
            <th>Voice</th>
            <th className="num">Audio</th>
            <th className="num">Took</th>
            <th className="num">Speed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.key}</td>
              {r.err ? (
                <td colSpan={4} className="error">
                  {r.err}
                </td>
              ) : (
                <>
                  <td className="num">{r.sec.toFixed(1)} s</td>
                  <td className="num">{(r.ms / 1000).toFixed(1)} s</td>
                  <td className="num">{(r.sec / (r.ms / 1000)).toFixed(1)}× real time</td>
                  <td>
                    <audio controls src={r.url} /> <a href={r.url} download={`${r.key.replace(/[^a-z0-9]+/gi, "-")}.wav`}>WAV</a>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
