const { askAI } = require("../Services/llm.service");
const {
  sendSessionEvent,
} = require("../Coversatiion-Utils/sessioneventsender");
const {
  formatConversationHistory,
} = require("../Coversatiion-Utils/convoformatter");
const { normalizeTranscript } = require("../utils/shouldSendToAI");
const {
  rememberConversationTurn,
} = require("../Coversatiion-Utils/conversation");
const {
  updatePhoneCollectionState,
} = require("../Coversatiion-Utils/phonehandler");

async function generateAiResponse(
  session,
  transcript,
  normalizedTranscript,
  detectedIntent = "general",
) {
  const requestId = session.activeAiRequestId + 1;
  const abortController = new AbortController();

  session.activeAiRequestId = requestId;
  session.isAiResponding = true;
  session.currentAiText = "";
  session.currentAiTranscript = transcript;
  session.activeAiAbortController = abortController;

  sendSessionEvent(session, "assistant_started", {
    transcript,
  });

  try {
    const aiResponse = await askAI({
      transcript,
      detectedIntent,
      historyText: formatConversationHistory(session.conversationHistory),
      signal: abortController.signal,
      onToken: (token) => {
        if (session.activeAiRequestId !== requestId) {
          return;
        }

        session.currentAiText += token;
        sendSessionEvent(session, "assistant_token", {
          token,
          text: session.currentAiText,
        });
      },
    });

    if (session.activeAiRequestId !== requestId) {
      return;
    }

    const cleanedResponse = normalizeTranscript(aiResponse);

    if (!cleanedResponse) {
      sendSessionEvent(session, "assistant_error", {
        message: "Assistant returned an empty response.",
      });
      return;
    }

    session.responseCache[normalizedTranscript] = cleanedResponse;
    session.currentAiText = cleanedResponse;
    updatePhoneCollectionState(session, cleanedResponse);

    sendSessionEvent(session, "assistant_completed", {
      transcript,
      response: cleanedResponse,
      fromCache: false,
    });

    rememberConversationTurn(session, transcript, cleanedResponse);
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    console.error("AI response error:", error);
    sendSessionEvent(session, "assistant_error", {
      message: error.message || "Assistant response failed.",
    });
  } finally {
    if (session.activeAiRequestId === requestId) {
      session.isAiResponding = false;
      session.activeAiAbortController = null;
    }
  }
}

module.exports = {
  generateAiResponse,
};
