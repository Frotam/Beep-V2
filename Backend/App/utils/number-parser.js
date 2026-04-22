const DIGIT_WORDS = new Map([
  ["zero", "0"],
  ["oh", "0"],
  ["o", "0"],
  ["owe", "0"],
  ["one", "1"],
  ["won", "1"],
  ["two", "2"],
  ["to", "2"],
  ["too", "2"],
  ["three", "3"],
  ["tree", "3"],
  ["four", "4"],
  ["for", "4"],
  ["five", "5"],
  ["six", "6"],
  ["sex", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["ate", "8"],
  ["nine", "9"],
]);

const PHONE_REQUEST_PATTERNS = [
  /\bphone number\b/i,
  /\bmobile number\b/i,
  /\bcontact number\b/i,
  /\byour number\b/i,
  /\b10 digits\b/i,
  /\bten digits\b/i,
  /\bshare your number\b/i,
  /\bwhat(?:'s| is) your number\b/i,
];

function tokenizeForDigits(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function extractDigitsFromSpeech(text) {
  const tokens = tokenizeForDigits(text);
  let digits = "";

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      digits += token;
      continue;
    }

    const mapped = DIGIT_WORDS.get(token);

    if (mapped) {
      digits += mapped;
    }
  }

  return digits;
}

function looksLikePhoneRequest(text) {
  return PHONE_REQUEST_PATTERNS.some((pattern) => pattern.test(String(text || "")));
}

function formatDigitsForSpeech(digits) {
  return String(digits || "")
    .split("")
    .join(" ");
}

function getPhoneNumberCandidate(text) {
  const digits = extractDigitsFromSpeech(text);

  if (!digits) {
    return {
      digits: "",
      isLikelyPhoneNumber: false,
      isValidPhoneNumber: false,
    };
  }

  return {
    digits,
    isLikelyPhoneNumber: digits.length >= 7,
    isValidPhoneNumber: digits.length === 10,
  };
}

module.exports = {
  extractDigitsFromSpeech,
  formatDigitsForSpeech,
  getPhoneNumberCandidate,
  looksLikePhoneRequest,
};
