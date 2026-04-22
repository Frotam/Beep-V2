const { normalizeTranscript } = require("./shouldSendToAI");
const { classifyIntent } = require("./transcript-correction");

const SAFE_RESPONSES = {
  empty: "I didn't catch that clearly.",
  too_short: "Can you provide more details?",
  noise: "I didn't catch that clearly.",
  repetition: "Could you please repeat that?",
  filler: "I didn't catch that clearly.",
  greeting: "Hello, how can I help you?",
  weak_phrase: "No problem. Let me know what you'd like to order when you're ready.",
  fake_words: "I didn't catch that clearly. Could you say it again?",
  non_food_intent: "I'm here to help with food orders. What would you like to have?",
  duplicate_transcript: null,
};

const FILLER_WORDS = new Set([
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
]);

const GREETING_PATTERNS = [
  /^(hi|hello|hey|heya|hiya)\b/,
  /\bgood (morning|afternoon|evening)\b/,
  /\bhello there\b/,
  /\bhey there\b/,
];

const WEAK_PHRASES = [
  "i can't",
  "i cant",
  "i dont",
  "i don't",
  "i don't know",
  "i dont know",
  "not sure",
  "maybe",
];

const FOOD_WORDS = [
  "order",
  "menu",
  "paneer",
  "food",
  "eat",
  "table",
  "book",
  "booking",
  "reserve",
  "reservation",
  "price",
  "complaint",
  "restaurant",
  "rolls",
  "kabab",
  "corn",
  "tikka",
];

function runControlLayer({
  transcript,
  correctedTranscript,
  session = {},
}) {
  const original = normalizeInput(transcript);
  const corrected = normalizeInput(correctedTranscript || transcript);
  const normalized = corrected.toLowerCase();
  const filter = classifyFilterOutcome(corrected, session);
  const intent = classifyIntent({
    transcript: corrected,
    currentAiText: session.currentAiText,
    conversationHistory: session.conversationHistory || [],
  });
  const confidence = simulateConfidence({
    original,
    corrected,
    filterReason: filter.reason,
    intentScore: intent.score,
  });

  if (!filter.shouldSend) {
    return {
      action: filter.reason === "duplicate_transcript" ? "ignore" : "respond",
      reason: filter.reason,
      normalized,
      transcript: corrected,
      intent: intent.name,
      confidence,
      reply: SAFE_RESPONSES[filter.reason] || "Could you please repeat that?",
      allowCurrentResponseToContinue: filter.reason === "duplicate_transcript",
    };
  }

  return {
    action: "ai",
    reason: "valid",
    normalized,
    transcript: corrected,
    intent: intent.name,
    confidence,
    reply: null,
    allowCurrentResponseToContinue: false,
  };
}

function classifyFilterOutcome(text, session = {}) {
  const cleaned = normalizeInput(text).toLowerCase();
  const tokens = tokenize(cleaned);

  if (!cleaned.length) {
    return { shouldSend: false, reason: "empty" };
  }

  if (isTooShort(cleaned, tokens)) {
    return { shouldSend: false, reason: "too_short" };
  }

  if (isNoise(cleaned, tokens)) {
    return { shouldSend: false, reason: "noise" };
  }

  if (isRepetition(cleaned, tokens, session)) {
    return {
      shouldSend: false,
      reason:
        cleaned === session.lastFinalTranscript ? "duplicate_transcript" : "repetition",
    };
  }

  if (isFiller(tokens)) {
    return { shouldSend: false, reason: "filler" };
  }

  if (isGreeting(cleaned, tokens)) {
    return { shouldSend: false, reason: "greeting" };
  }

  if (isWeakPhrase(cleaned)) {
    return { shouldSend: false, reason: "weak_phrase" };
  }

  if (hasFakeWords(cleaned)) {
    return { shouldSend: false, reason: "fake_words" };
  }

  if (!isFoodIntent(cleaned)) {
    return { shouldSend: false, reason: "non_food_intent" };
  }

  session.lastFinalTranscript = cleaned;

  return { shouldSend: true, reason: "valid" };
}

function normalizeInput(text) {
  return normalizeTranscript(
    String(text || "")
      .replace(/[^\w\s]/g, " ")
  );
}

function tokenize(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean);
}

function isTooShort(cleaned, tokens) {
  if (cleaned.length <= 1) {
    return true;
  }

  if (tokens.length === 1 && cleaned.length <= 3) {
    return true;
  }

  return tokens.length === 0;
}

function isNoise(cleaned, tokens) {
  if (!tokens.length) {
    return true;
  }

  if (/^[hmauoe\s]+$/.test(cleaned) && cleaned.length <= 6) {
    return true;
  }

  return tokens.every((token) => /^([a-z])\1{1,}$/.test(token));
}

function isRepetition(cleaned, tokens, session) {
  if (cleaned === session.lastFinalTranscript) {
    return true;
  }

  if (tokens.length < 2) {
    return false;
  }

  const unique = new Set(tokens);

  if (unique.size === 1) {
    return true;
  }

  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === tokens[index - 1]) {
      return true;
    }
  }

  return false;
}

function isFiller(tokens) {
  if (!tokens.length) {
    return false;
  }

  return tokens.every((token) => FILLER_WORDS.has(token));
}

function isGreeting(cleaned, tokens) {
  if (!tokens.length || tokens.length > 4) {
    return false;
  }

  return GREETING_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function isWeakPhrase(text) {
  return WEAK_PHRASES.some((phrase) => text.includes(phrase));
}

function hasFakeWords(text) {
  return /(bla\s*){2,}/.test(text);
}

function isFoodIntent(text) {
  return FOOD_WORDS.some((word) => text.includes(word));
}

function simulateConfidence({
  original,
  corrected,
  filterReason,
  intentScore,
}) {
  let confidence = 0.92;

  if (filterReason !== "valid") {
    confidence -= 0.45;
  }

  if (original && corrected && original.toLowerCase() !== corrected.toLowerCase()) {
    confidence -= 0.18;
  }

  if (intentScore === 0) {
    confidence -= 0.14;
  } else if (intentScore === 1) {
    confidence -= 0.06;
  }

  if (corrected.split(" ").length <= 2) {
    confidence -= 0.12;
  }

  return Math.max(0.1, Math.min(0.99, Number(confidence.toFixed(2))));
}

module.exports = {
  runControlLayer,
};
