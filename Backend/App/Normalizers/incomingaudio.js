const { decodeMuLawBuffer } = require("./decoder");
const { normalizeEncoding, normalizeSampleRate } = require("./normalizer");

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
module.exports={
    normalizeIncomingAudio
}