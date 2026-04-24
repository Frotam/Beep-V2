const {
  updatePhoneCollectionState,
} = require("../Coversatiion-Utils/phonehandler");
const {
  sendSessionEvent,
} = require("../Coversatiion-Utils/sessioneventsender");

function sendAssistantResponse(session, transcript, response, options = {}) {
  session.isAiResponding = false;
  session.activeAiAbortController = null;
  session.currentAiText = response;
  session.currentAiTranscript = transcript;
  updatePhoneCollectionState(session, response);

  sendSessionEvent(session, "assistant_started", {
    transcript,
  });

  sendSessionEvent(session, "assistant_completed", {
    transcript,
    response,
    fromCache: Boolean(options.fromCache),
  });
}

module.exports = {
  sendAssistantResponse,
};
