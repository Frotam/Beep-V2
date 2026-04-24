const path = require("path");
const fs = require("fs");
const { cancelActiveAiResponse } = require("../Coversatiion-Utils/airescanceler");
const { rememberConversationTurn } = require("../Coversatiion-Utils/conversation");
const { handlePhoneNumberCapture } = require("../Coversatiion-Utils/phonehandler");
const { sendSessionEvent } = require("../Coversatiion-Utils/sessioneventsender");
const { transcribeAudio } = require("../Services/stt.service");
const { runControlLayer } = require("../utils/control-layer");
const { sendAssistantResponse } = require("../utils/sendAssistantResponse");
const { normalizeTranscript, isVague } = require("../utils/shouldSendToAI");
const { correctTranscript } = require("../utils/transcript-correction");
const { generateAiResponse } = require("./Aires");
const { createWavBuffer } = require("../utils/Buffercreator");
const MIN_UTTERANCE_MS = 250;
const audioDir = path.join(__dirname, "..", "temp-audio");
async function flushSession(sessionId,sessions) {
  const session = sessions.get(sessionId);

  if (!session || session.isProcessing || !session.chunks.length) {
    return;
  }

  await session.ingestPromise;
  session.isProcessing = true;

  const pcm16le = Buffer.concat(session.chunks);
  session.chunks = [];
  session.hasSpeechSinceLastFlush = false;

  let tempFile;

  try {
    const speechDurationMs = Math.round(
      (pcm16le.length / 2 / session.sampleRate) * 1000,
    );

    if (speechDurationMs < MIN_UTTERANCE_MS) {
      return;
    }

    tempFile = path.join(audioDir, `temp-${Date.now()}.wav`);

    fs.writeFileSync(
      tempFile,
      createWavBuffer(pcm16le, session.sampleRate),
    );

    let transcript = await transcribeAudio(tempFile);
    transcript = normalizeTranscript(transcript);

    if (!transcript) {
      return;
    }

    const correction = correctTranscript({ // 
      transcript,
      currentAiText: session.currentAiText,
      conversationHistory: session.conversationHistory,
    });

    if (
      correction.correctedTranscript &&
      correction.correctedTranscript !== transcript
    ) {
      sendSessionEvent(session, "transcript_corrected", {
        originalTranscript: transcript,
        correctedTranscript: correction.correctedTranscript,
        intent: correction.intent,
        corrections: correction.corrections,
      });
    }

    transcript = correction.correctedTranscript || transcript;
    const controlDecision = runControlLayer({
      transcript: correction.originalTranscript || transcript,
      correctedTranscript: transcript,
      session,
    });

    const phoneCapture = handlePhoneNumberCapture(session, transcript);  
    if (phoneCapture.handled) {
      sendSessionEvent(session, "final_transcript", {
        transcript: phoneCapture.transcript,
      });
      console.log("Transcript:", phoneCapture.transcript);
      sendAssistantResponse(session, phoneCapture.transcript, phoneCapture.reply, {
        fromCache: false,
      });
      rememberConversationTurn(
        session,
        phoneCapture.transcript,
        phoneCapture.reply,
      );
      return;
    }

    sendSessionEvent(session, "final_transcript", { transcript });//
    console.log("Transcript:", transcript);
    sendSessionEvent(session, "control_decision", {
      transcript,
      intent: controlDecision.intent,
      confidence: controlDecision.confidence,
      action: controlDecision.action,
      reason: controlDecision.reason,
    });

    if (controlDecision.action === "ignore") {
      sendSessionEvent(session, "ignored_transcript", {
        transcript,
        reason: controlDecision.reason,
      });

      if (
        controlDecision.allowCurrentResponseToContinue &&
        session.isAiResponding
      ) {
        sendSessionEvent(session, "assistant_resumed", {
          transcript: session.currentAiTranscript,
        });
      }

      return;
    }

    if (controlDecision.action === "respond") {
      sendSessionEvent(session, "ignored_transcript", {
        transcript,
        reason: controlDecision.reason,
      });
      sendAssistantResponse(session, transcript, controlDecision.reply, {
        fromCache: false,
      });
      rememberConversationTurn(session, transcript, controlDecision.reply);
      return;
    }

    if (session.isAiResponding) {
      cancelActiveAiResponse(session, { reason: "user_interrupt" }); // 
    }

    const normalizedTranscript = controlDecision.normalized;
    const cachedResponse = session.responseCache[normalizedTranscript];

    if (cachedResponse) {
      session.currentAiTranscript = transcript;
      session.currentAiText = cachedResponse;

      sendSessionEvent(session, "cache_hit", {
        transcript,
        response: cachedResponse,
      });

      sendAssistantResponse(session, transcript, cachedResponse, {
        fromCache: true,
      });
      rememberConversationTurn(session, transcript, cachedResponse);
      return;
    }

    if (isVague(transcript) && session.conversationHistory.length === 0) {
      const clarification = "Could you repeat your question?";
      sendAssistantResponse(session, transcript, clarification, {
        fromCache: false,
      });
      rememberConversationTurn(session, transcript, clarification);
      return;
    }

    await generateAiResponse(
      session,
      transcript,
      normalizedTranscript,
      controlDecision.intent,
    );
  } catch (error) {
    console.error("VAD processing error:", error);
    sendSessionEvent(session, "assistant_error", {
      message: error.message || "Unable to process audio.",
    });
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    session.isProcessing = false;
  }
}
module.exports={
    flushSession
}
