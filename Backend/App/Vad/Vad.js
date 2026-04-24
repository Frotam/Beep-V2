const { NonRealTimeVAD } = require("@ricky0123/vad-node");

let vadPromise = null;

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

module.exports = {
  getVad,
};
