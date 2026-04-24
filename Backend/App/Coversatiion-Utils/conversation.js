const { isMeaningfulTranscript } = require("../utils/shouldSendToAI");

const MAX_HISTORY_TURNS = 6;

function rememberConversationTurn(session, transcript, response) {
  if (!isMeaningfulTranscript(transcript)) {
    return;
  }

  session.conversationHistory.push({
    user: transcript,
    ai: response,
  });

  while (session.conversationHistory.length > MAX_HISTORY_TURNS) {
    session.conversationHistory.shift();
  }
}

module.exports = {
  rememberConversationTurn,
};
