const { sendSessionEvent } = require("./sessioneventsender");

function cancelActiveAiResponse(session, details = {}) {
  if (!session?.isAiResponding) {
    return;
  }

  session.activeAiRequestId += 1;
  session.isAiResponding = false;

  if (session.activeAiAbortController) {
    session.activeAiAbortController.abort();
    session.activeAiAbortController = null;
  }

  sendSessionEvent(session, "assistant_cancelled", {
    reason: details.reason || "cancelled",
    transcript: session.currentAiTranscript,
    partialResponse: session.currentAiText,
  });
}

module.exports = {
  cancelActiveAiResponse,
};
