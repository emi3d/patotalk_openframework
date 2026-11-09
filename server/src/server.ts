import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import type { Situ } from 'situ';

export function createApp(situ: Situ): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
  const param = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

  app.get('/health', (_req, res) => res.json({ ok: true, ai: situ.ai.name, voice: situ.voice.name, situations: situ.listSituations().length }));
  app.get('/', (_req, res) => res.json({
    name: 'situ', version: '0.2.0',
    routes: ['GET /situations', 'GET /situations/:id', 'POST /sessions', 'POST /sessions/:id/turn', 'POST /sessions/:id/evaluate', 'GET /progress', 'GET /progress/:userId', 'WS /live'],
  }));

  app.get('/situations', (_req, res) => res.json({ situations: situ.listSituations() }));
  app.get('/situations/:id', (req, res) => {
    try { res.json({ situation: situ.getSituation(param(req.params.id)) }); }
    catch { res.status(404).json({ error: `unknown situation: ${param(req.params.id)}` }); }
  });

  app.post('/sessions', async (req, res) => {
    try {
      const session = await situ.newSession(req.body as { situationId: string; userId: string });
      res.status(201).json({ session });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/sessions/:id/turn', upload.single('audio'), async (req, res) => {
    try {
      const text = typeof req.body?.text === 'string' ? req.body.text : undefined;
      const audio = req.file ? req.file.buffer : undefined;
      if (!audio && !text) return res.status(400).json({ error: 'send audio (multipart) or text' });
      const reply = await situ.talk(param(req.params.id), audio ?? { text });
      res.json(reply);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/sessions/:id/evaluate', async (req, res) => {
    try {
      res.json(await situ.evaluate(param(req.params.id)));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/sessions/:id', (req, res) => {
    try { res.json({ session: situ.getSession(param(req.params.id)) }); }
    catch { res.status(404).json({ error: `unknown session: ${param(req.params.id)}` }); }
  });

  app.get('/progress', async (_req, res) => res.json(await situ.progressStore.getAll()));
  app.get('/progress/:userId', async (req, res) => {
    const user = await situ.progress(param(req.params.userId));
    if (!user) return res.status(404).json({ error: `no progress for user: ${param(req.params.userId)}` });
    res.json({ userId: param(req.params.userId), progress: user });
  });

  return app;
}

export function attachLive(app: express.Express, situ: Situ): ReturnType<typeof createHttpServer> {
  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: '/live' });
  wss.on('connection', (ws) => {
    let sessionId: string | null = null;
    let chunks: Buffer[] = [];
    let mimeType = 'audio/webm';
    let cancelled = false;
    const send = (obj: Record<string, unknown>) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }
      if (msg.type === 'start') {
        try {
          const session = await situ.newSession({ situationId: msg.situationId as string, userId: (msg.userId as string) ?? 'anonymous' });
          sessionId = session.id;
          chunks = [];
          send({ type: 'started', sessionId, situationId: msg.situationId });
        } catch (e) { send({ type: 'error', error: (e as Error).message }); }
      } else if (msg.type === 'audio') {
        chunks.push(Buffer.from((msg.data as string) ?? '', 'base64'));
        if (typeof msg.mimeType === 'string') mimeType = msg.mimeType;
      } else if (msg.type === 'barge-in') {
        cancelled = true;
        chunks = [];
        send({ type: 'cancelled' });
      } else if (msg.type === 'end-turn' || msg.type === 'text') {
        if (!sessionId) return send({ type: 'error', error: 'send {type:"start"} first' });
        cancelled = false;
        const audio = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
        chunks = [];
        const text = typeof msg.text === 'string' ? msg.text : undefined;
        try {
          const reply = await situ.talk(sessionId, audio ? { audio, mimeType } : { text });
          if (cancelled) return;
          send({ type: 'transcript', transcription: reply.transcription, spokenResponse: reply.spokenResponse, suggestions: reply.suggestions });
          if (reply.audio) {
            const CHUNK = 32 * 1024;
            const total = Math.ceil(reply.audio.length / CHUNK);
            for (let i = 0; i < total; i++) {
              send({ type: 'audio', data: reply.audio.subarray(i * CHUNK, (i + 1) * CHUNK).toString('base64'), chunkIndex: i, totalChunks: total, mimeType: reply.audioMimeType });
            }
          }
          send({ type: 'done', turnCount: reply.turnCount, maxTurns: reply.maxTurns });
        } catch (e) {
          send({ type: 'error', error: (e as Error).message });
        }
      }
    });
  });
  return server;
}
