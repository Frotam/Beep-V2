const fs = require("fs");
const path = require("path");
const { NonRealTimeVAD } = require("@ricky0123/vad-node");
const {
  getSttStatus,
  transcribeAudio,
} = require("./stt.service");
const { runPartialTranscription } = require("../utils/partialtranscription");
const {
  askAI,
  getLlmStatus,
} = require("./llm.service");
const {
  isMeaningfulTranscript,
  normalizeTranscript,
  isVague,
} = require("../utils/shouldSendToAI");
const {
  formatDigitsForSpeech,
  getPhoneNumberCandidate,
  looksLikePhoneRequest,
} = require("../utils/number-parser");
const { correctTranscript } = require("../utils/transcript-correction");
const { runControlLayer } = require("../utils/control-layer");

const sessions = new Map();

const SILENCE_THRESHOLD_MS = 700;
const SILENCE_CHECK_INTERVAL_MS = 100;
const PARTIAL_TRANSCRIBE_INTERVAL_MS = 800;
const MIN_UTTERANCE_MS = 250;
const MIN_RMS_FOR_SPEECH = 0.015;
const audioDir = path.join(__dirname, "..", "temp-audio");
const MAX_HISTORY_TURNS = 6;

let silenceMonitorStarted = false;
let vadPromise = null;

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

function createSession(sessionId, metadata = {}) {
  const existingSession = sessions.get(sessionId);

  if (existingSession) {
    updateSessionMetadata(sessionId, metadata);

    if (metadata.ws) {
      existingSession.ws = metadata.ws;
    }

    return existingSession;
  }

  const session = {
    sessionId,
    ws: metadata.ws || null,
    chunks: [],
    sampleRate: normalizeSampleRate(metadata.sampleRate, 8000),
    encoding: normalizeEncoding(metadata.encoding),
    source: metadata.source || "unknown",
    channels: 1,
    lastVoiceAt: Date.now(),
    lastChunkAt: Date.now(),
    hasSpeechSinceLastFlush: false,
    isProcessing: false,
    isPartialProcessing: false,
    segmentIndex: 0,
    ingestPromise: Promise.resolve(),
    lastPartialTranscriptAt: 0,
    lastPartialText: "",
    lastFinalTranscript: "",
    conversationHistory: [],
    responseCache: {},
    activeAiRequestId: 0,
    isAiResponding: false,
    currentAiText: "",
    currentAiTranscript: "",
    awaitingPhoneNumber: false,
    collectedPhoneNumber: "",
  };

  sessions.set(sessionId, session);
  return session;
}

function attachSocketToSession(sessionId, ws) {
  const session = sessions.get(sessionId);

  if (session) {
    session.ws = ws;
    sendModelStatus(session);
  }
}

function updateSessionMetadata(sessionId, metadata = {}) {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  if (metadata.sampleRate) {
    session.sampleRate = normalizeSampleRate(
      metadata.sampleRate,
      session.sampleRate,
    );
  }

  if (metadata.encoding) {
    session.encoding = normalizeEncoding(metadata.encoding);
  }

  if (metadata.source) {
    session.source = metadata.source;
  }

  if (metadata.ws) {
    session.ws = metadata.ws;
    sendModelStatus(session);
  }
}

async function addChunk(sessionId, chunk, metadata = {}) {
  const session = sessions.get(sessionId);

  if (!session || !chunk) {
    return;
  }

  session.ingestPromise = session.ingestPromise
    .then(async () => {
      updateSessionMetadata(sessionId, metadata);
      session.lastChunkAt = Date.now();

      const normalized = normalizeIncomingAudio(chunk, {
        encoding: session.encoding,
        sampleRate: session.sampleRate,
      });

      if (!normalized || !normalized.pcm16le.length) {
        return;
      }

      session.chunks.push(normalized.pcm16le);

      const hasSpeech = chunkContainsSpeech(normalized.pcm16le);

      if (hasSpeech) {
        session.lastVoiceAt = Date.now();
        session.hasSpeechSinceLastFlush = true;

        if (session.isAiResponding) {
          sendSessionEvent(session, "assistant_interrupted", {
            transcript: session.currentAiTranscript,
          });
        }
      }
    })
    .catch((error) => {
      console.error("Audio ingest error:", error);
    });

  return session.ingestPromise;
}

async function stopSession(sessionId) {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  await session.ingestPromise;
  cancelActiveAiResponse(session, { reason: "session_stopped" });

  if (session.chunks.length) {
    await flushSession(sessionId);
  }

  sessions.delete(sessionId);
}

function startSilenceMonitor() {
  if (silenceMonitorStarted) {
    return;
  }

  silenceMonitorStarted = true;

  setInterval(async () => {
    for (const [sessionId, session] of sessions.entries()) {
      const now = Date.now();
      const silenceDuration = now - session.lastVoiceAt;
      const partialDuration = now - session.lastPartialTranscriptAt;

      if (
        session.hasSpeechSinceLastFlush &&
        session.chunks.length &&
        silenceDuration >= SILENCE_THRESHOLD_MS &&
        !session.isProcessing
      ) {
        await flushSession(sessionId);
        session.lastPartialText = "";
        session.lastPartialTranscriptAt = 0;
        continue;
      }

      if (
        session.hasSpeechSinceLastFlush &&
        session.chunks.length &&
        !session.isProcessing &&
        !session.isPartialProcessing &&
        partialDuration >= PARTIAL_TRANSCRIBE_INTERVAL_MS &&
        silenceDuration < SILENCE_THRESHOLD_MS
      ) {
        session.lastPartialTranscriptAt = now;
        session.isPartialProcessing = true;

        runPartialTranscription({
          session,
          extractSpeechSegments,
          createWavBuffer,
          transcribeAudio,
          audioDir,
          onPartial: (transcript) => {
            sendSessionEvent(session, "partial_transcript", {
              transcript,
            });
          },
        }).finally(() => {
          session.isPartialProcessing = false;
        });
      }
    }
  }, SILENCE_CHECK_INTERVAL_MS);
}

async function flushSession(sessionId) {
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

    const correction = correctTranscript({
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

    sendSessionEvent(session, "final_transcript", { transcript });
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
      cancelActiveAiResponse(session, { reason: "user_interrupt" });
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

function formatConversationHistory(history) {
  if (!Array.isArray(history) || !history.length) {
    return "No prior conversation.";
  }

  return history
    .map(
      (turn, index) =>
        `Turn ${index + 1}\nUser: ${turn.user}\nAssistant: ${turn.ai}`,
    )
    .join("\n\n");
}

function sendSessionEvent(session, type, payload = {}) {
  if (!session?.ws || session.ws.readyState !== 1) {
    return;
  }

  try {
    session.ws.send(
      JSON.stringify({
        type,
        sessionId: session.sessionId,
        ...payload,
      }),
    );
  } catch (error) {
    console.error("WebSocket send error:", error.message);
  }
}

function sendModelStatus(session) {
  const stt = getSttStatus();
  const llm = getLlmStatus();

  sendSessionEvent(session, "model_status", {
    ready: stt.ready && llm.ready,
    stt,
    llm,
  });
}

function handlePhoneNumberCapture(session, transcript) {
  if (!session.awaitingPhoneNumber && !looksLikePhoneRequest(session.currentAiText)) {
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

async function extractSpeechSegments(pcm16le, sampleRate) {
  const vad = await getVad();
  const audioFloat32 = pcm16ToFloat32(pcm16le);
  const segments = [];

  for await (const result of vad.run(audioFloat32, sampleRate)) {
    const pcmSegment = float32ToPcm16Buffer(result.audio);

    if (pcmSegment.length) {
      segments.push(pcmSegment);
    }
  }

  return segments;
}

function chunkContainsSpeech(pcm16le) {
  return calculateRms(pcm16le) >= MIN_RMS_FOR_SPEECH;
}

async function getVad() {
  if (!vadPromise) {
    vadPromise = NonRealTimeVAD.new({
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionFrames: 8,
      preSpeechPadFrames: 1,
      minSpeechFrames: 3,
      frameSamples: 1536,
    });
  }

  return vadPromise;
}

function normalizeIncomingAudio(base64Payload, metadata) {
  const audioBuffer = Buffer.from(base64Payload, "base64");
  const encoding = normalizeEncoding(metadata.encoding);
  const sampleRate = normalizeSampleRate(metadata.sampleRate, 8000);

  if (!audioBuffer.length) {
    return null;
  }

  if (encoding === "mulaw") {
    return {
      pcm16le: decodeMuLawBuffer(audioBuffer),
      sampleRate,
    };
  }

  return {
    pcm16le: audioBuffer,
    sampleRate,
  };
}

function normalizeEncoding(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (
    normalized === "audio/x-mulaw" ||
    normalized === "mulaw" ||
    normalized === "mu-law" ||
    normalized === "mulaw/8000"
  ) {
    return "mulaw";
  }

  return "pcm_s16le";
}

function normalizeSampleRate(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function decodeMuLawBuffer(buffer) {
  const pcmBuffer = Buffer.alloc(buffer.length * 2);

  for (let index = 0; index < buffer.length; index += 1) {
    pcmBuffer.writeInt16LE(decodeMuLawSample(buffer[index]), index * 2);
  }

  return pcmBuffer;
}

function decodeMuLawSample(value) {
  const muLaw = (~value) & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  const magnitude = ((mantissa | 0x10) << (exponent + 3)) - 132;

  return sign ? -magnitude : magnitude;
}

function pcm16ToFloat32(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  const output = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    output[index] = buffer.readInt16LE(index * 2) / 32768;
  }

  return output;
}

function calculateRms(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);

  if (!sampleCount) {
    return 0;
  }

  let sumSquares = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = buffer.readInt16LE(index * 2) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}

function float32ToPcm16Buffer(float32Array) {
  const buffer = Buffer.alloc(float32Array.length * 2);

  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index]));
    const int16 =
      sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);

    buffer.writeInt16LE(int16, index * 2);
  }

  return buffer;
}

function createWavBuffer(pcmBuffer, sampleRate) {
  const header = Buffer.alloc(44);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

module.exports = {
  addChunk,
  attachSocketToSession,
  createSession,
  startSilenceMonitor,
  stopSession,
  updateSessionMetadata,
};
