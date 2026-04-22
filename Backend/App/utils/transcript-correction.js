const INTENT_KEYWORDS = {
  reservation: [
    "book",
    "booking",
    "reserve",
    "reservation",
    "table",
    "seat",
    "seats",
    "party",
  ],
  menu: [
    "menu",
    "price",
    "cost",
    "have",
    "available",
    "paneer",
    "spring",
    "rolls",
    "kabab",
    "corn",
  ],
  complaint: [
    "complaint",
    "issue",
    "problem",
    "bad",
    "wrong",
    "refund",
  ],
  phone_number: [
    "phone",
    "number",
    "mobile",
    "contact",
    "digit",
    "digits",
  ],
};

const DOMAIN_KEYWORDS = [
  "book",
  "booking",
  "reserve",
  "reservation",
  "table",
  "party",
  "seat",
  "seats",
  "today",
  "tomorrow",
  "menu",
  "price",
  "cost",
  "available",
  "paneer",
  "tikka",
  "veg",
  "spring",
  "rolls",
  "hara",
  "bhara",
  "kabab",
  "crispy",
  "corn",
  "complaint",
  "phone",
  "number",
  "mobile",
  "contact",
];

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function classifyIntent({ transcript, currentAiText = "", conversationHistory = [] }) {
  const source = [
    String(transcript || ""),
    String(currentAiText || ""),
    ...conversationHistory
      .slice(-2)
      .flatMap((turn) => [turn?.user || "", turn?.ai || ""]),
  ]
    .join(" ")
    .toLowerCase();

  let bestIntent = "general";
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    const score = keywords.reduce(
      (total, keyword) => total + (source.includes(keyword) ? 1 : 0),
      0,
    );

    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  return {
    name: bestIntent,
    score: bestScore,
  };
}

function correctTranscript({
  transcript,
  currentAiText = "",
  conversationHistory = [],
}) {
  const original = normalizeWhitespace(transcript);

  if (!original) {
    return {
      originalTranscript: "",
      correctedTranscript: "",
      intent: "general",
      corrections: [],
    };
  }

  const intent = classifyIntent({
    transcript: original,
    currentAiText,
    conversationHistory,
  });

  let corrected = original.toLowerCase();
  const corrections = [];

  corrected = applyPhraseCorrections(corrected, intent.name, corrections);
  corrected = applyFuzzyKeywordCorrections(corrected, corrections);
  corrected = normalizeWhitespace(corrected);

  return {
    originalTranscript: original,
    correctedTranscript: corrected,
    intent: intent.name,
    corrections,
  };
}

function applyPhraseCorrections(text, intent, corrections) {
  let next = text;

  if (intent === "reservation") {
    next = replacePattern(
      next,
      /\bbook a table for you\b/g,
      "book a table for two",
      corrections,
      "reservation_homophone",
    );
    next = replacePattern(
      next,
      /\bfor you at\b/g,
      "for two at",
      corrections,
      "reservation_homophone",
    );
    next = replacePattern(
      next,
      /\bat heaven\b/g,
      "at seven",
      corrections,
      "time_homophone",
    );
    next = replacePattern(
      next,
      /\bat won\b/g,
      "at one",
      corrections,
      "time_homophone",
    );
    next = replacePattern(
      next,
      /\bat too\b/g,
      "at two",
      corrections,
      "time_homophone",
    );
    next = replacePattern(
      next,
      /\bat tree\b/g,
      "at three",
      corrections,
      "time_homophone",
    );
    next = replacePattern(
      next,
      /\bat for\b/g,
      "at four",
      corrections,
      "time_homophone",
    );
    next = replacePattern(
      next,
      /\bat ate\b/g,
      "at eight",
      corrections,
      "time_homophone",
    );
  }

  if (intent === "menu") {
    next = replacePattern(
      next,
      /\bspender rolls\b/g,
      "spring rolls",
      corrections,
      "menu_phrase",
    );
    next = replacePattern(
      next,
      /\bhara bara\b/g,
      "hara bhara",
      corrections,
      "menu_phrase",
    );
  }

  return next;
}

function applyFuzzyKeywordCorrections(text, corrections) {
  const tokens = text.split(" ");
  const correctedTokens = tokens.map((token) => {
    if (!token || /^\d+$/.test(token)) {
      return token;
    }

    if (DOMAIN_KEYWORDS.includes(token) || NUMBER_WORDS.includes(token)) {
      return token;
    }

    const candidate = findBestCandidate(token, [...DOMAIN_KEYWORDS, ...NUMBER_WORDS]);

    if (!candidate) {
      return token;
    }

    corrections.push({
      from: token,
      to: candidate,
      reason: "fuzzy_keyword",
    });

    return candidate;
  });

  return correctedTokens.join(" ");
}

function findBestCandidate(token, candidates) {
  let bestCandidate = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = levenshtein(token, candidate);
    const threshold = candidate.length <= 4 ? 1 : 2;

    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function replacePattern(text, pattern, replacement, corrections, reason) {
  return text.replace(pattern, (match) => {
    if (match !== replacement) {
      corrections.push({
        from: match,
        to: replacement,
        reason,
      });
    }

    return replacement;
  });
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    dp[i][0] = i;
  }

  for (let j = 0; j < cols; j += 1) {
    dp[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[a.length][b.length];
}

module.exports = {
  classifyIntent,
  correctTranscript,
};
