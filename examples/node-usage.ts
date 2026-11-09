import { Situ } from '../src/index.js';

const situ = new Situ({
  ai: process.env.GEMINI_API_KEY
    ? { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY }
    : { provider: 'stub' },
  voice: process.env.KOKORO_URL
    ? { provider: 'kokoro', url: process.env.KOKORO_URL }
    : { provider: 'stub' },
  progress: process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {},
});

const session = await situ.newSession({ situationId: 'en-ordering-coffee', userId: 'emi' });
console.log('situations:', situ.listSituations().map((s) => s.id).join(', '));

const reply = await situ.talk(session, { text: "Hi, I'd like a medium latte please. Thank you!" });
console.log('AI:', reply.spokenResponse);
console.log('audio bytes:', reply.audio?.length ?? 0);

console.log('stream:');
for await (const chunk of situ.talkStream(session, { text: 'To go, please.' })) {
  console.log(' ', chunk.type, chunk.type === 'text' ? chunk.text.slice(0, 60) : '');
}

const { evaluation, progress } = await situ.evaluate(session);
console.log('score:', evaluation.weightedScore, 'completed:', evaluation.completed);
console.log('progress:', JSON.stringify(await situ.progress('emi')));
await situ.close();
