const {
  formatDigitsForSpeech,
  getPhoneNumberCandidate,
  looksLikePhoneRequest,
} = require("../utils/number-parser");

function handlePhoneNumberCapture(session, transcript) {
  if (
    !session.awaitingPhoneNumber &&
    !looksLikePhoneRequest(session.currentAiText)
  ) {
    return {
      handled: false,
      transcript,
    };
  }

  const candidate = getPhoneNumberCandidate(transcript);

  if (!candidate.digits) {
    return {
      handled: false,
      transcript,
    };
  }

  if (!candidate.isValidPhoneNumber) {
    session.awaitingPhoneNumber = true;

    return {
      handled: true,
      transcript: `Phone number: ${candidate.digits}`,
      reply: "Invalid number, please repeat your 10 digit number.",
    };
  }

  session.awaitingPhoneNumber = false;
  session.collectedPhoneNumber = candidate.digits;

  return {
    handled: true,
    transcript: `Phone number: ${candidate.digits}`,
    reply: `I heard ${formatDigitsForSpeech(candidate.digits)}. Please confirm.`,
  };
}

function updatePhoneCollectionState(session, response) {
  if (!response) {
    return;
  }

  if (looksLikePhoneRequest(response)) {
    session.awaitingPhoneNumber = true;
    return;
  }

  if (session.collectedPhoneNumber && !looksLikePhoneRequest(response)) {
    session.awaitingPhoneNumber = false;
  }
}

module.exports = {
  handlePhoneNumberCapture,
  updatePhoneCollectionState,
};
