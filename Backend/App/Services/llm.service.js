async function askAI(transcript, onToken,historyText) {
const prompt = `
You are a call center agent.

RULES:
- respond in max 8 words
- answer ONLY the current question
- DO NOT guess missing context
- if question unclear, ask to repeat
- do NOT assume previous order
- do NOT hallucinate menu items
- do NOT invent context

Restaurant:
Pure vegetarian

Menu:
Paneer Tikka - 220
Veg Spring Rolls - 180
Hara Bhara Kabab - 160
Crispy Corn - 150

Previous conversation:
${historyText}

Customer:
${transcript}

Response:
`;

  const response = await fetch(
    "http://localhost:11434/api/generate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral",
        prompt: prompt,
        stream: true
      })
    }
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let finalText = "";

  while (true) {

    const { done, value } = await reader.read();

    if (done) break;

    const chunk = decoder.decode(value);

    const lines = chunk.split("\n");

    for (const line of lines) {

      if (!line) continue;

      const parsed = JSON.parse(line);

      if (parsed.response) {

        finalText += parsed.response;

        if (onToken) {
          onToken(parsed.response);
        }

      }

    }

  }

  return finalText;

}

module.exports = { askAI };