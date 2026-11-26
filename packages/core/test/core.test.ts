import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { PatoTalk, parseExperience, toMarkdown, characterPrompt, memoryDriver, streak, countWords, encodeWav, StatsStore } from "../src/index.js";
import { nodeSqliteDriver } from "../src/node.js";

const raise = JSON.parse(readFileSync(new URL("../../../experiences/ask-for-a-raise.json", import.meta.url), "utf8"));
const evalJson = JSON.stringify({
  criteria: [
    { id: "evidence", score: 5, comment: "numbers" },
    { id: "clarity", score: 4, comment: "" },
    { id: "language", score: 3, comment: "" },
    { id: "confidence", score: 4, comment: "" },
  ],
  goalReached: true,
  feedback: "Good",
  corrections: [],
});

test("experience files validate and round-trip through Markdown", () => {
  for (const f of ["ask-for-a-raise", "ja-ramen-order", "fr-boulangerie"]) {
    const e = parseExperience(readFileSync(new URL(`../../../experiences/${f}.json`, import.meta.url), "utf8"));
    assert.deepEqual(parseExperience(toMarkdown(e)), e);
  }
  assert.throws(() => parseExperience({ id: "Bad Id" }), /Invalid Pato Talk experience/);
});

test("character prompt carries persona, rules and hidden motivation", () => {
  const p = characterPrompt(parseExperience(raise));
  assert.match(p, /Mr\. Sterling/);
  assert.match(p, /Max 3 sentences/);
  assert.match(p, /Hidden motivation/);
});

test("loop: opening, turns, evaluation, stats (no conversation text stored)", async () => {
  const llm = new FakeListChatModel({ responses: ["Sit down. Why are you here?", "Numbers, please.", "OK, 5% raise.", evalJson] });
  const driver = memoryDriver();
  const pt = new PatoTalk({ llm, stats: driver });
  const { session, opening } = await pt.start(raise, { userId: "emi" });
  assert.equal(opening.text, "Sit down. Why are you here?");
  assert.equal(opening.turn, 0);
  const t1 = await pt.say(session, "I want a raise.");
  assert.equal(t1.text, "Numbers, please.");
  assert.equal(t1.turn, 1);
  await pt.say(session, "I increased sales by 20% and saved 10,000 dollars.");
  const ev = await pt.end(session);
  assert.equal(ev.passed, true);
  assert.equal(ev.criteria.length, 4);
  assert.ok(ev.score > 0.6 && ev.score <= 1);
  const rows = await driver.all("", ["emi"]);
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes("sales by 20%"), "conversation text must not be stored");
  const s = await pt.summary("emi");
  assert.equal(s?.completed, 1);
  assert.equal(s?.totalTurns, 2);
  assert.equal((await pt.history(session)).length, 5);
});

test("auto-evaluates when maxTurns is reached", async () => {
  const exp = { ...raise, maxTurns: 1 };
  const llm = new FakeListChatModel({ responses: ["Hello.", "Hmm.", evalJson] });
  const pt = new PatoTalk({ llm });
  const { session } = await pt.start(exp, { userId: "u" });
  const t = await pt.say(session, "Raise please");
  assert.equal(t.finished, true);
  assert.ok(t.evaluation);
});

test("node:sqlite driver stores and summarises stats", async () => {
  const db = await nodeSqliteDriver(":memory:");
  const store = new StatsStore(db);
  const today = new Date("2026-11-26T12:00:00Z");
  await store.save({ id: "a", userId: "emi", experienceId: "x", language: "ja", startedAt: "2026-11-25T10:00:00Z", turns: 3, userWords: 12, score: 0.8, passed: true });
  await store.save({ id: "b", userId: "emi", experienceId: "x", language: "ja", startedAt: "2026-11-26T10:00:00Z", turns: 2, userWords: 5, score: 0.4, passed: false });
  const s = await store.summary("emi", today);
  assert.equal(s.attempts, 2);
  assert.equal(s.streakDays, 2);
  assert.equal(s.byExperience.x.bestScore, 0.8);
  assert.ok(Math.abs((s.averageScore ?? 0) - 0.6) < 1e-9);
  db.close();
});

test("helpers", () => {
  assert.equal(streak([], new Date()), 0);
  assert.equal(countWords("ラーメンをください"), 9);
  assert.equal(countWords("I want a raise."), 4);
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 24000);
  assert.equal(wav.length, 44 + 6);
});

test("a failed turn leaves no trace and can be retried; double sends are refused", async () => {
  let calls = 0;
  const replies = ["Hello.", "FAIL", "Numbers?"];
  const llm = {
    async invoke() {
      const r = replies[calls++];
      if (r === "FAIL") throw new Error("503 overloaded");
      return { content: r };
    },
  } as any;
  const pt = new PatoTalk({ llm, stats: memoryDriver() });
  const { session } = await pt.start(raise, { userId: "u" });
  await assert.rejects(pt.say(session, "I want a raise."), /503/);
  assert.equal(session.userWords, 0);
  assert.equal((await pt.history(session)).length, 1, "failed turn must not be stored");
  const t = await pt.say(session, "I want a raise.");
  assert.equal(t.text, "Numbers?");
  assert.equal((await pt.history(session)).length, 3);
  const slow = pt.say(session, "one");
  await assert.rejects(pt.say(session, "two"), /previous message/);
  await slow.catch(() => {});
});

test("audio turns go to the model as audio (no transcription), stats count seconds", async () => {
  class Listening extends FakeListChatModel {
    seen: any[][] = [];
    async _generate(messages: any[], o?: any, r?: any) {
      this.seen.push(messages);
      return super._generate(messages, o, r);
    }
  }
  const llm = new Listening({ responses: ["Sit down.", "Numbers, please.", evalJson] });
  const driver = memoryDriver();
  const pt = new PatoTalk({ llm, stats: driver });
  const { session } = await pt.start(raise, { userId: "emi" });
  const wav = Buffer.from(encodeWav(new Float32Array(1600), 16000)).toString("base64");
  const t = await pt.say(session, { audio: wav, mimeType: "audio/wav", seconds: 2.5 });
  assert.equal(t.text, "Numbers, please.");
  const human = llm.seen[1].find((m: any) => m.getType() === "human");
  assert.ok(Array.isArray(human.content) && human.content.some((p: any) => p.type === "audio" && p.data === wav), "model must receive the audio");
  await assert.rejects(pt.say(session, { audio: "", mimeType: "audio/wav" }), /Say something/);
  await pt.end(session);
  const evalCall = llm.seen.at(-1)!;
  assert.ok(JSON.stringify(evalCall.map((m: any) => m.content)).includes(wav), "evaluator hears the audio too");
  const h = await pt.history(session);
  assert.equal(h[1].text, "(voice)");
  const s = await pt.summary("emi");
  assert.equal(s?.totalSpeakingSeconds, 2.5);
  assert.equal(s?.totalWords, 0);
});
