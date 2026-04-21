const fs = require("fs");
const path = require("path");
const { NonRealTimeVAD } = require("@ricky0123/vad-node");
const { transcribeAudio } = require("./stt.service");
const { runPartialTranscription } = require("../utils/partialtranscription");
const { askAI } = require("./llm.service");
const { log } = require("console");
const { shouldSendToAI, isVague } = require("../utils/shouldSendToAI");

const sessions = new Map();

const SILENCE_THRESHOLD_MS = 2000;
const SILENCE_CHECK_INTERVAL_MS = 300;
const PARTIAL_TRANSCRIBE_INTERVAL_MS = 1500;
const audioDir = path.join(__dirname, "..", "temp-audio");

let silenceMonitorStarted = false;
let vadPromise = null;

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

function createSession(sessionId, metadata = {}) {
  sessions.set(sessionId, {
    sessionId,
    chunks: [],
    probeBuffer: Buffer.alloc(0),
    sampleRate: normalizeSampleRate(metadata.sampleRate, 8000),
    encoding: normalizeEncoding(metadata.encoding),
    source: metadata.source || "unknown",
    channels: 1,
    lastVoiceAt: Date.now(),
    lastChunkAt: Date.now(),
    hasSpeechSinceLastFlush: false,
    isProcessing: false,
    segmentIndex: 0,
    ingestPromise: Promise.resolve(),
    lastPartialTranscriptAt: 0,
    lastPartialText: "",
    conversationHistory: [],
    responseCache: {},
  });
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

      session.probeBuffer = appendToRollingProbeBuffer(
        session.probeBuffer,
        normalized.pcm16le,
        normalized.sampleRate,
      );

      const hasSpeech = await chunkContainsSpeech(
        session.probeBuffer,
        normalized.sampleRate,
      );

      if (hasSpeech) {
        session.lastVoiceAt = Date.now();
        session.hasSpeechSinceLastFlush = true;
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

      // =============================
      // FINAL transcript (after silence)
      // =============================

      if (
        session.hasSpeechSinceLastFlush &&
        session.chunks.length &&
        silenceDuration >= SILENCE_THRESHOLD_MS &&
        !session.isProcessing
      ) {
        await flushSession(sessionId);

        // reset partial tracking
        session.lastPartialText = "";
        session.lastPartialTranscriptAt = 0;

        continue;
      }

      // =============================
      // PARTIAL transcript (while speaking)
      // =============================

      if (
        session.hasSpeechSinceLastFlush &&
        session.chunks.length &&
        !session.isProcessing &&
        !session.isPartialProcessing &&
        partialDuration >= PARTIAL_TRANSCRIBE_INTERVAL_MS &&
        silenceDuration < SILENCE_THRESHOLD_MS
      ) {
        const audioDir = path.join(process.cwd(), "temp-audio");

        session.lastPartialTranscriptAt = now;
        session.isPartialProcessing = true;

        runPartialTranscription({
          session,
          extractSpeechSegments,
          createWavBuffer,
          transcribeAudio,
          audioDir,
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
  session.probeBuffer = Buffer.alloc(0);
  session.hasSpeechSinceLastFlush = false;

  let tempFile;

  try {

    const segments =
      await extractSpeechSegments(
        pcm16le,
        session.sampleRate
      );

    if (!segments.length) {
      return;
    }


    const mergedSegment =
      Buffer.concat(segments);


    tempFile =
      path.join(
        audioDir,
        `temp-${Date.now()}.wav`
      );


    fs.writeFileSync(
      tempFile,
      createWavBuffer(
        mergedSegment,
        16000
      )
    );


    // speech → text
    let transcript =
      await transcribeAudio(
        tempFile
      );


    // remove extra spaces
    transcript =
      transcript
        .replace(/\s+/g, " ")
        .trim();


    console.log(
      "Transcript:",
      transcript
    );


    // filter noise
    if (  !shouldSendToAI(
          transcript,
          session
        )) {

      console.log(
        "Ignored:",
        transcript
      );

      return;
    }


    const normalized =
      transcript.toLowerCase();


    // check cache
    if (
      session.responseCache[
        normalized
      ]
    ) {

      console.log(
        "Cache hit:",
        normalized
      );

      console.log(
        "AI:",
        session.responseCache[
          normalized
        ]
      );

      return;
    }
    if (
  isVague(transcript) &&
  session.conversationHistory.length === 0
) {

  return "Could you repeat your question?";
}



    // call AI with history
    const aiResponse =
      await askAI(

        transcript,

        (token) => {

          process.stdout.write(
            token
          );

        },

        session.conversationHistory

      );


    const cleanedResponse =
      aiResponse
        .replace(/\s+/g, " ")
        .trim();


    console.log(
      "\nAI:",
      cleanedResponse
    );


    // save in cache
    session.responseCache[
      normalized
    ] = cleanedResponse;


    // update history
 if (transcript.split(" ").length > 1) {
  session.conversationHistory.push({
    user: transcript,
    ai: cleanedResponse
  });

}


    // keep last 6 turns only
    if (
      session.conversationHistory
        .length > 6
    ) {

      session
        .conversationHistory
        .shift();

    }


    session.segmentIndex += 1;


  }
  catch (error) {

    console.error(
      "VAD processing error:",
      error
    );

  }
  finally {

    if (
      tempFile &&
      fs.existsSync(tempFile)
    ) {

      fs.unlinkSync(
        tempFile
      );

    }

    session.isProcessing = false;

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

async function chunkContainsSpeech(pcm16le, sampleRate) {
  const segments = await extractSpeechSegments(pcm16le, sampleRate);
  return segments.length > 0;
}

function appendToRollingProbeBuffer(
  existingBuffer,
  incomingBuffer,
  sampleRate,
) {
  const maxProbeBytes = Math.max(sampleRate * 2 * 2, incomingBuffer.length);

  const combined = Buffer.concat([existingBuffer, incomingBuffer]);

  if (combined.length <= maxProbeBytes) {
    return combined;
  }

  return combined.subarray(combined.length - maxProbeBytes);
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
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

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
  // decodes the mulaw to pcm
  const MULAW_BIAS = 0x84;
  let sample = ~value;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  const mantissa = sample & 0x0f;

  sample = ((mantissa << 4) + 0x08) << exponent;
  sample -= MULAW_BIAS;

  return sign ? -sample : sample;
}

function pcm16ToFloat32(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  const output = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    output[index] = buffer.readInt16LE(index * 2) / 32768;
  }

  return output;
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
  createSession,
  startSilenceMonitor,
  stopSession,
  updateSessionMetadata,
};
