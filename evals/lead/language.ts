const THAI_LETTER = /[ก-ฺเ-๎]/gu;
const LATIN_LETTER = /[A-Za-z]/gu;
const LINK = /https?:\/\/\S+/gu;
const CODE_SPAN = /`[^`]*`/gu;

/**
 * The share of a reply's letters that are Thai.
 *
 * @remarks
 * Links and code spans are dropped first because they keep their own
 * language in any reply: the lead's orders say to leave links, repository
 * names, check names and code as they are. A Thai reply still carries
 * English terms (`triage`, `CI`), so a Thai reply is a share well above zero
 * and an English one is a share of nearly zero, not a clean 1 and 0.
 */
export const thaiShare = (message: string): number => {
  const prose = message.replace(LINK, " ").replace(CODE_SPAN, " ");
  const thai = prose.match(THAI_LETTER)?.length ?? 0;
  const latin = prose.match(LATIN_LETTER)?.length ?? 0;
  return thai + latin === 0 ? 0 : thai / (thai + latin);
};

/** The share at or above which a reply counts as written in Thai. */
export const THAI_REPLY_SHARE = 0.25;

/** The share at or below which a reply counts as written in English. */
export const ENGLISH_REPLY_SHARE = 0.05;
