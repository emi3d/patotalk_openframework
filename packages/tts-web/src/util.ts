/** Run async jobs one at a time. ONNX Runtime sessions (especially on WebGPU) break when two runs overlap. */
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => {});
    return run;
  };
}

/** Text as it should be spoken: no markdown, emojis, URLs or *stage directions*. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/\*[^*\n]{1,80}\*/g, "") // *smiles* → removed
    .replace(/[*_`#>~|]+/g, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
