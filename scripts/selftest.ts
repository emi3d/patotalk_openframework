import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GeminiTTS, PatoTalk, createLLM, encodeWav, messageText, parseExperience } from "../packages/core/src/index.js";
import { nodeSqliteDriver } from "../packages/core/src/node.js";

const id = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "ask-for-a-raise";
const turnsArg = process.argv.indexOf("--turns");
const maxUserTurns = turnsArg > 0 ? Number(process.argv[turnsArg + 1]) : 4;
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("Set GEMINI_API_KEY");
const model = process.env.GEMINI_MODEL;
const voice = process.argv.includes("--voice");
const learnerVoice = new GeminiTTS({ apiKey });

const exp = parseExperience(readFileSync(new URL(`../experiences/${id}.json`, import.meta.url), "utf8"));
mkdirSync("out", { recursive: true });
const db = await nodeSqliteDriver("out/selftest.sqlite");
const pt = new PatoTalk({ llm: { provider: "gemini", apiKey, model }, stats: db });
const learner = await createLLM({ provider: "gemini", apiKey, model, temperature: 1 });

const learnerSystem = new SystemMessage(
  [
    `You simulate a language learner (${exp.meta.userLanguage ?? "Spanish"} speaker) in a role-play practice.`,
    `Speak only ${exp.meta.language}, level ${exp.meta.level ?? "intermediate"}, with one or two small natural mistakes.`,
    `Your role: ${exp.characterA.role}. Your task: ${exp.characterA.brief}`,
    `Start a bit vague; by your third line give concrete details${id === "ask-for-a-raise" ? " (e.g. sales numbers, savings)" : ""}.`,
    `Reply with one or two sentences of dialogue only.`,
  ].join("\n"),
);

const log: string[] = [`# Self-test: ${exp.meta.title} (${exp.meta.language})${voice ? ", voice input" : ""}`, ""];
const print = (who: string, text: string) => {
  const line = `**${who}:** ${text}`;
  console.log(`${who}: ${text}`);
  log.push(line, "");
};

const t0 = Date.now();
const { session, opening } = await pt.start(exp, { userId: "selftest" });
print(exp.characterB.name, opening.text);
const history: { role: "a" | "b"; text: string }[] = [{ role: "b", text: opening.text }];

let finished = false;
for (let i = 0; i < maxUserTurns && !finished; i++) {
  const learnerMsgs = [learnerSystem, new HumanMessage(history.map((h) => `${h.role === "a" ? "You" : exp.characterB.name}: ${h.text}`).join("\n") + "\nYou:")];
  const userText = messageText(await learner.invoke(learnerMsgs)).replace(/^You:\s*/i, "").trim();
  print(`Learner (${exp.characterA.role})`, userText);
  history.push({ role: "a", text: userText });
  let reply;
  if (voice) {
    const a = await learnerVoice.synthesize(userText, { lang: exp.meta.language, gender: "female" });
    const wav = encodeWav(a.samples!, a.sampleRate!);
    const seconds = a.samples!.length / a.sampleRate!;
    writeFileSync(`out/learner-${id}-${i + 1}.wav`, wav);
    console.log(`  (sent as ${seconds.toFixed(1)} s of audio)`);
    log.push(`_(sent as ${seconds.toFixed(1)} s of audio, out/learner-${id}-${i + 1}.wav)_`, "");
    reply = await pt.say(session, { audio: Buffer.from(wav).toString("base64"), mimeType: "audio/wav", seconds });
  } else reply = await pt.say(session, userText);
  print(exp.characterB.name, reply.text);
  history.push({ role: "b", text: reply.text });
  finished = reply.finished;
}

const ev = await pt.end(session);
log.push("## Evaluation", "", "```json", JSON.stringify(ev, null, 2), "```", "");
console.log("\nEvaluation:", JSON.stringify(ev, null, 2));
const summary = await pt.summary("selftest");
log.push("## Stats (SQLite)", "", "```json", JSON.stringify(summary, null, 2), "```", "", `Took ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
console.log("\nStats:", JSON.stringify(summary, null, 2));
writeFileSync(`out/selftest-${id}${voice ? "-voice" : ""}.md`, log.join("\n"));
db.close();
