const V: Record<string, string> = { a: "a", i: "i", u: "ɯ", e: "e", o: "o" };

const ROWS: [string, string][] = [
  ["あいうえお", ""],
  ["かきくけこ", "k"],
  ["がぎぐげご", "ɡ"],
  ["さしすせそ", "s"],
  ["ざじずぜぞ", "z"],
  ["たちつてと", "t"],
  ["だぢづでど", "d"],
  ["なにぬねの", "n"],
  ["はひふへほ", "h"],
  ["ばびぶべぼ", "b"],
  ["ぱぴぷぺぽ", "p"],
  ["まみむめも", "m"],
  ["らりるれろ", "ɾ"],
];
const VOWEL_ORDER = ["a", "i", "u", "e", "o"];

const MORA = new Map<string, [string, string]>();
for (const [kana, c] of ROWS) [...kana].forEach((k, i) => MORA.set(k, [c, VOWEL_ORDER[i]]));
Object.entries({
  し: ["ɕ", "i"], ち: ["ʨ", "i"], つ: ["ʦ", "u"], ふ: ["ɸ", "u"], ひ: ["ç", "i"], じ: ["ʥ", "i"], ぢ: ["ʥ", "i"],
  づ: ["z", "u"], に: ["ɲ", "i"], や: ["j", "a"], ゆ: ["j", "u"], よ: ["j", "o"], わ: ["β", "a"], を: ["", "o"],
  ゔ: ["v", "u"],
} as Record<string, [string, string]>).forEach(([k, v]) => MORA.set(k, v));
const PAL: Record<string, string> = { き: "kʲ", ぎ: "ɡʲ", し: "ɕ", じ: "ʥ", ち: "ʨ", ぢ: "ʥ", に: "ɲ", ひ: "ç", び: "bʲ", ぴ: "pʲ", み: "mʲ", り: "ɾʲ" };
for (const [k, c] of Object.entries(PAL)) {
  MORA.set(k + "ゃ", [c, "a"]);
  MORA.set(k + "ゅ", [c, "u"]);
  MORA.set(k + "ょ", [c, "o"]);
  MORA.set(k + "ぇ", [c, "e"]);
}
Object.entries({
  てぃ: ["t", "i"], でぃ: ["d", "i"], とぅ: ["t", "u"], どぅ: ["d", "u"], ふぁ: ["ɸ", "a"], ふぃ: ["ɸ", "i"], ふぇ: ["ɸ", "e"],
  ふぉ: ["ɸ", "o"], うぃ: ["β", "i"], うぇ: ["β", "e"], うぉ: ["β", "o"], つぁ: ["ʦ", "a"], つぇ: ["ʦ", "e"], ゔぁ: ["v", "a"],
  ゔぃ: ["v", "i"], ゔぇ: ["v", "e"], ゔぉ: ["v", "o"], いぇ: ["j", "e"], しぇ: ["ɕ", "e"], じぇ: ["ʥ", "e"], ちぇ: ["ʨ", "e"],
} as Record<string, [string, string]>).forEach(([k, v]) => MORA.set(k, v));
Object.entries({ ぁ: ["", "a"], ぃ: ["", "i"], ぅ: ["", "u"], ぇ: ["", "e"], ぉ: ["", "o"], ゃ: ["j", "a"], ゅ: ["j", "u"], ょ: ["j", "o"] } as Record<string, [string, string]>).forEach(([k, v]) =>
  MORA.set(k, v),
);

const PUNCT: Record<string, string> = { "。": ".", "、": ",", "！": "!", "？": "?", "!": "!", "?": "?", ".": ".", ",": ",", "…": "…", "「": "“", "」": "”", "　": " ", " ": " " };

export const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

function kokoroMora(on: string, vowel: string): string {
  let v = V[vowel];
  if (v === "i" && /^[kɡbpmɾvɸtdʦ]$/.test(on)) on += "ʲ";
  if (v === "ɯ" && (/ʲ$/.test(on) || /^[ɕʥʨçsʦɲz]$/.test(on))) v = "ɨ";
  return on + v;
}

export function kanaToKokoro(text: string): string {
  const s = toHiragana(text.normalize("NFKC"));
  let out = "";
  let geminate = false;
  let lastVowel = "";
  for (let i = 0; i < s.length; ) {
    const two = s.slice(i, i + 2);
    const c = s[i];
    if (c === "っ") {
      geminate = true;
      i++;
      continue;
    }
    if (c === "ん") {
      out += "ɴ";
      lastVowel = "";
      i++;
      continue;
    }
    if (c === "ー") {
      if (lastVowel) out += "ː";
      i++;
      continue;
    }
    if (c in PUNCT) {
      if (geminate) out += "ʔ";
      geminate = false;
      out += PUNCT[c] + (/[.,!?…]/.test(PUNCT[c]) ? " " : "");
      lastVowel = "";
      i++;
      continue;
    }
    const m2 = MORA.get(two);
    const m = m2 ?? MORA.get(c);
    if (!m) {
      i++;
      continue;
    }
    const [on, vowel] = m;
    if (geminate) out += on ? on[0] === "ʨ" ? "t" : on[0] === "ʦ" ? "t" : on[0] : "ʔ";
    geminate = false;
    if (!on && lastVowel && (vowel === lastVowel || (vowel === "u" && lastVowel === "o") || (vowel === "i" && lastVowel === "e"))) {
      out += "ː";
      lastVowel = "";
    } else {
      out += kokoroMora(on, vowel);
      lastVowel = vowel;
    }
    i += m2 ? 2 : 1;
  }
  if (geminate) out += "ʔ";
  return out.replace(/\s+/g, " ").trim();
}

export const hasKanji = (s: string) => /\p{Script=Han}/u.test(s);
