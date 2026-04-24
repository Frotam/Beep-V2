const OLLAMA_URL = "http://localhost:11434";

let llmStatus = {
  ready: false,
  loading: false,
  error: null,
};

async function initializeLlm() {
  if (llmStatus.loading || llmStatus.ready) {
    return getLlmStatus();
  }

  llmStatus = {
    ready: false,
    loading: true,
    error: null,
  };

  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);

    if (!response.ok) {
      throw new Error(`Ollama warmup failed with status ${response.status}`);
    }

    llmStatus = {
      ready: true,
      loading: false,
      error: null,
    };
  } catch (error) {
    llmStatus = {
      ready: false,
      loading: false,
      error: error.message,
    };
    throw error;
  }

  return getLlmStatus();
}

function getLlmStatus() {
  return { ...llmStatus };
}

async function askAI({
  transcript,
  detectedIntent = "general",
  onToken,
  historyText,
  signal,
}) {
  const prompt = `
You are a restaurant call assistant named shri annapurna restraunt.

STRICT RULES:
- reply in ONE short sentence (max 10 words)
- ask ONE thing at a time
- do NOT skip steps
- do NOT assume information
- always validate user details
STRICT OUTPUT FILTER:

- If question is about identity (who/which restaurant):
  → reply ONLY with restaurant name
  → nothing else

- If question is about menu:
  → share only menu items

- If unrelated:
  → ask next required step (name/phone/etc.)

CUSTOMER DATA RULES:

1. NAME COLLECTION
- ask user's name
- repeat the name clearly
- confirm spelling if needed

2. PHONE NUMBER COLLECTION
- backend validates phone digits before they reach you
- if transcript contains "Phone number: 9876543210", trust exactly those digits
- after a confirmed valid phone number, ask the next required question

3. NEVER PROCEED without valid phone number

4. If complaint:
- collect name
- collect phone number
- then ask complaint details

MENU:
Paneer Tikka 220
Veg Spring Rolls 180
Hara Bhara Kabab 160
Crispy Corn 150

IMPORTANT:
No beverages available.

Detected intent:
${detectedIntent}

History:
${historyText}

Customer: ${transcript}

Assistant:
`;

  llmStatus = {
    ready: true,
    loading: false,
    error: null,
  };

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "mistral",
      prompt,
      stream: true,
      keep_alive: "30m",
      options: {
        num_predict: 40,
        temperature: 0.2,
        top_p: 0.9,
        num_ctx: 1024,
      },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let finalText = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const parsed = JSON.parse(line);

      if (parsed.response) {
        finalText += parsed.response;

        if (onToken) {
          onToken(parsed.response);
        }
      }
    }
  }

  if (pending.trim()) {
    const parsed = JSON.parse(pending);

    if (parsed.response) {
      finalText += parsed.response;

      if (onToken) {
        onToken(parsed.response);
      }
    }
  }

  return finalText;
}

module.exports = {
  askAI,
  getLlmStatus,
  initializeLlm,
};
