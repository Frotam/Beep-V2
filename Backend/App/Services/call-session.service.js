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
const { createWavBuffer } = require("../utils/Buffercreator");
const { calculateRms } = require("../utils/calculateRms");
const { sendAssistantResponse } = require("../utils/sendAssistantResponse");
const { pcm16ToFloat32, float32ToPcm16Buffer } = require("../Audio-conveters/psm16cov");
const { rememberConversationTurn } = require("../Coversatiion-Utils/conversation");
const { formatConversationHistory } = require("../Coversatiion-Utils/convoformatter");
const { getVad } = require("../Vad/Vad");
const { normalizeIncomingAudio } = require("../Normalizers/incomingaudio");
const { flushSession } = require("../Flusher/Flusher");
const { normalizeEncoding,normalizeSampleRate } = require("../Normalizers/normalizer");
const { sendSessionEvent } = require("../Coversatiion-Utils/sessioneventsender");
const { cancelActiveAiResponse } = require("../Coversatiion-Utils/airescanceler");

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
    await flushSession(sessionId,sessions);
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
        await flushSession(sessionId,sessions);
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

function sendModelStatus(session) {
  const stt = getSttStatus();
  const llm = getLlmStatus();

  sendSessionEvent(session, "model_status", {
    ready: stt.ready && llm.ready,
    stt,
    llm,
  });
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

module.exports = {
  addChunk,
  attachSocketToSession,
  createSession,
  startSilenceMonitor,
  stopSession,
  updateSessionMetadata,
};
