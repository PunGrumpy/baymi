const THAI_LETTER = /[ก-ฺเ-๎]/gu;
const LATIN_LETTER = /[A-Za-z]/gu;

/**
 * What keeps its own language in any reply, in the order it is stripped:
 * code blocks and spans, text in quotation marks or a blockquote (an error
 * message quoted as it was), links, `#123`, anything joined by a slash
 * (`owner/repo`, `eng-lead/branch`), a name joined by hyphens, dots or
 * underscores (`cursor-action`), and a run of three or more bare names
 * separated by commas.
 */
const KEEPS_ITS_LANGUAGE: readonly RegExp[] = [
  /```[\s\S]*?```/gu,
  /`[^`]*`/gu,
  /"[^"]*"|“[^”]*”/gu,
  /^>.*$/gmu,
  /https?:\/\/\S+/gu,
  /#\d+/gu,
  /[\w.-]+(?:\/[\w.-]+)+/gu,
  /\b[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+\b/gu,
  /\b[A-Za-z]\w*(?:\s*,\s*[A-Za-z]\w*){2,}/gu,
];

/** A leading Thai greeting, which says nothing about the language that follows. */
const GREETING = /^\s*(?:สวัสดี|หวัดดี)\S*[\s!,.]*/u;

/**
 * The reply's own words: what is left once links, code, quoted text and
 * names are stripped. The orders say to leave those as they are, so they
 * count for neither language.
 */
export const proseOf = (message: string): string => {
  let text = message;
  for (const pattern of KEEPS_ITS_LANGUAGE) {
    text = text.replace(pattern, " ");
  }
  return text.replace(GREETING, "");
};

const share = (text: string): number => {
  const thai = text.match(THAI_LETTER)?.length ?? 0;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  return thai + latin === 0 ? 0 : thai / (thai + latin);
};

/**
 * The share of a reply's letters that are Thai, over its prose only.
 *
 * @remarks
 * A Thai reply still carries English terms (`triage`, `CI`), so a Thai
 * reply is a share well above zero and an English one is a share of nearly
 * zero, not a clean 1 and 0. Counting only prose is what lets a Thai reply
 * list thirteen repositories, and keeps an English reply from passing on a
 * Thai greeting.
 */
export const thaiShare = (message: string): number => share(proseOf(message));

/** The first sentence of the prose: up to a full stop, `!`, `?` or a new line. */
export const firstSentence = (message: string): string =>
  proseOf(message)
    .split(/[.!?\n]\s*/u)
    .find((sentence) => /[A-Za-z]|[ก-ฺเ-๎]/u.test(sentence)) ?? "";

/** The share at or above which a reply counts as written in Thai. */
export const THAI_REPLY_SHARE = 0.25;

/** The share at or below which a reply counts as written in English. */
export const ENGLISH_REPLY_SHARE = 0.05;

/**
 * Whether a reply is written in Thai: the first sentence and the whole
 * reply are both mostly Thai. A greeting does not count as a first
 * sentence, so an English reply that opens `สวัสดีครับ!` is not Thai.
 */
export const isThaiReply = (message: string): boolean =>
  share(firstSentence(message)) >= THAI_REPLY_SHARE &&
  thaiShare(message) >= THAI_REPLY_SHARE;
