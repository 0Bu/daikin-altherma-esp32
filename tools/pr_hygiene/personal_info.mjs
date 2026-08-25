// Heuristic personal-information shapes for CONTRIBUTOR-AUTHORED prose: a commit subject/body or a
// PR title/description. Deliberately narrow, for the same reason tools/redact/check_diag_coverage.py
// is narrow: this repository's firmware and test fixtures are dense with MACs, register bytes and
// bench IP addresses, and a value-shaped heuristic let loose on a diff would drown in them. That
// gate solves it by matching identifier NAMES instead of value shapes; prose has no identifier names
// to key on, so this instead requires enough punctuation/digit shape to stay high-confidence, and it
// is applied only to commit messages and the PR title/description — never to diff content.
//
// What it cannot see, stated rather than implied: a real name in running text, a street address
// spelled out in words, or a WiFi-password-shaped token with no distinguishing punctuation. None of
// those have a regex-detectable shape. Catching them is the $pr-hygiene-review skill's job.
//
// This module never returns the matched text itself, only a category — the caller fingerprints the
// surrounding line for the exceptions ledger. A category name is not personal data; the match is.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/gu;

// Bot/placeholder addresses that are structurally never a contributor's personal information.
const EMAIL_ALLOWED = [
  /@users\.noreply\.github\.com$/iu,
  /^noreply@github\.com$/iu,
  /@example\.(?:com|net|org)$/iu,
  /@(?:[a-z0-9-]+\.)+(?:example|test|invalid|localhost)$/iu,
];

// RFC 5322 local-part max is 64 octets and a bare `%40` etc. never decodes here, so this is safe to
// evaluate directly against raw text without a false-negative risk from encoding.
function isAllowedEmail(candidate) {
  return EMAIL_ALLOWED.some((pattern) => pattern.test(candidate));
}

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u;

// A small, high-confidence set of credential-token shapes. Not a secret-scanner replacement (see
// module comment above) — just the handful of shapes that cannot plausibly be anything else.
const CREDENTIAL_TOKEN = /\b(?:github_pat_[A-Za-z0-9_]{20,255}\b|ghp_[A-Za-z0-9]{36}\b|gh[oprsu]_[A-Za-z0-9]{36,251}\b|AKIA[0-9A-Z]{16}\b|xox[baprs]-[0-9A-Za-z-]{10,})/u;

const INTL_PHONE = /\+\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,5}/gu;
const NANP_PHONE = /\(\d{3}\)[ .-]?\d{3}[ .-]?\d{4}/gu;
// German-style local numbers: a trunk-prefixed area code, a separator, then the subscriber number.
const LOCAL_PHONE = /\b0\d{2,5}[ ./-]\d{3,}(?:[ ./-]\d{2,})*\b/gu;

function phoneDigitCount(candidate) {
  return (candidate.match(/\d/gu) ?? []).length;
}

// A plausible phone number is bounded by ITU E.164 (max 15 digits) and long enough not to be a
// version string or register offset (firmware commit subjects are full of both). Requiring an
// explicit separator or leading "+" — already enforced by both patterns above — keeps a bare long
// integer (a timestamp, a hash prefix) from ever reaching this stage.
function isPlausiblePhone(candidate) {
  const digits = phoneDigitCount(candidate);
  return digits >= 9 && digits <= 15;
}

// Decimal-degree coordinate pairs, e.g. "52.5200, 13.4050" — this project already treats
// weather_latitude/weather_longitude as sensitive (main/logic/redact.hpp) for exactly this reason:
// they are the coordinates of the reporter's house. Requiring three-plus decimal digits on both
// sides (typical GPS precision) and a plausible lat/long range keeps a version pair or a two-part
// firmware size number from matching.
const COORDINATE_PAIR = /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/gu;

function isPlausibleCoordinate(latText, lonText) {
  const lat = Number(latText);
  const lon = Number(lonText);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

export const PERSONAL_INFO_MESSAGES = {
  P001: "looks like an email address",
  P002: "looks like a phone number",
  P003: "looks like a private key or credential-shaped token",
  P004: "looks like a GPS coordinate pair",
};

// Returns at most one finding per category for the given text (a single line, or a title) — never
// one per occurrence, so a line with three suspect emails is one finding, not three.
export function findPersonalInfo(text) {
  const codes = new Set();

  for (const match of text.matchAll(EMAIL)) {
    if (!isAllowedEmail(match[0])) codes.add("P001");
  }
  if (PRIVATE_KEY.test(text) || CREDENTIAL_TOKEN.test(text)) codes.add("P003");
  for (const match of text.matchAll(INTL_PHONE)) {
    if (isPlausiblePhone(match[0])) codes.add("P002");
  }
  for (const match of text.matchAll(NANP_PHONE)) {
    if (isPlausiblePhone(match[0])) codes.add("P002");
  }
  for (const match of text.matchAll(LOCAL_PHONE)) {
    if (isPlausiblePhone(match[0])) codes.add("P002");
  }
  for (const match of text.matchAll(COORDINATE_PAIR)) {
    if (isPlausibleCoordinate(match[1], match[2])) codes.add("P004");
  }

  return [...codes].sort().map((code) => ({ code, message: PERSONAL_INFO_MESSAGES[code] }));
}
