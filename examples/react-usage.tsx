import { useEffect, useRef, useState } from 'react';
import { Situ, type Session, type TalkReply } from 'situ';

const situ = new Situ({
  ai: { provider: 'gemini', apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY },
  voice: { provider: 'kokoro', url: process.env.NEXT_PUBLIC_KOKORO_URL ?? 'http://localhost:8880' },
  progress: { databaseUrl: process.env.DATABASE_URL },
});

export function CoffeePractice({ userId }: { userId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [log, setLog] = useState<TalkReply[]>([]);
  const [input, setInput] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    situ.newSession({ situationId: 'en-ordering-coffee', userId }).then((s) => {
      sessionRef.current = s;
      setSession(s);
    });
  }, [userId]);

  async function send() {
    if (!sessionRef.current || !input.trim()) return;
    const reply = await situ.talk(sessionRef.current, { text: input });
    setLog((l) => [...l, reply]);
    if (reply.audio) {
      const url = URL.createObjectURL(new Blob([reply.audio], { type: reply.audioMimeType }));
      await new Audio(url).play();
    }
    setInput('');
  }

  async function finish() {
    if (!sessionRef.current) return;
    const { evaluation } = await situ.evaluate(sessionRef.current);
    setScore(evaluation.weightedScore);
  }

  return (
    <div>
      <h1>Ordering Coffee</h1>
      {log.map((r, i) => <p key={i}>{r.spokenResponse}</p>)}
      <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
      <button onClick={send} disabled={!session}>Send</button>
      <button onClick={finish} disabled={!session}>Evaluate</button>
      {score !== null && <p>Score: {Math.round(score * 100)}%</p>}
    </div>
  );
}
