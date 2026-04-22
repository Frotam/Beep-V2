function normalizeTranscript(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForComparison(text) {
  return normalizeTranscript(text).toLowerCase();
}

function shouldSendToAI(text, session = {}) {
  const cleaned = normalizeForComparison(text);

  if (!cleaned.length) {
    return {
      shouldSend: false,
      reason: "empty",
      normalized: cleaned,
      allowCurrentResponseToContinue: true,
    };
  }

  if (cleaned.length === 1) {
    return {
      shouldSend: false,
      reason: "single_character_noise",
      normalized: cleaned,
      allowCurrentResponseToContinue: true,
    };
  }

  const ignoreList = new Set([
    "uh",
    "um",
    "hmm",
    "huh",
    "ah",
    "mmm",
    "aaa",
    "eh",
    "mm",
    "hm",
    "you you",
    "ha ha",
  ]);

  if (ignoreList.has(cleaned)) {
    return {
      shouldSend: false,
      reason: "filler_noise",
      normalized: cleaned,
      allowCurrentResponseToContinue: true,
    };
  }

  if (/^[hmauoe\s]+$/.test(cleaned) && cleaned.length <= 6) {
    return {
      shouldSend: false,
      reason: "phonetic_noise",
      normalized: cleaned,
      allowCurrentResponseToContinue: true,
    };
  }

  if (cleaned.split(" ").length <= 2 && cleaned.length <= 3) {
    return {
      shouldSend: false,
      reason: "too_short",
      normalized: cleaned,
      allowCurrentResponseToContinue: true,
    };
  }

  if (cleaned === session.lastFinalTranscript) {
    return {
      shouldSend: false,
      reason: "duplicate_transcript",
      normalized: cleaned,
      allowCurrentResponseToContinue: true,
    };
  }

  session.lastFinalTranscript = cleaned;

  return {
    shouldSend: true,
    reason: "valid",
    normalized: cleaned,
    allowCurrentResponseToContinue: false,
  };
}

function isMeaningfulTranscript(text) {
  const cleaned = normalizeForComparison(text);

  if (!cleaned) {
    return false;
  }

  const nonMeaningfulGreetings = new Set([
    "hi",
    "hello",
    "hey",
    "thanks",
    "thank you",
  ]);

  if (nonMeaningfulGreetings.has(cleaned)) {
    return false;
  }

  return cleaned.split(" ").length > 1 || cleaned.length > 6;
}

function isVague(text) {
  const t = normalizeForComparison(text);
  const vaguePatterns = [
    "earlier",
    "previous",
    "that",
    "same",
    "repeat",
    "again",
    "what i said",
  ];

  return vaguePatterns.some((pattern) => t.includes(pattern));
}

module.exports = {
  isMeaningfulTranscript,
  isVague,
  normalizeTranscript,
  shouldSendToAI,
};
