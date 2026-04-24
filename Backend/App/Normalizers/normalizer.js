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
module.exports={
    normalizeEncoding,
    normalizeSampleRate
}