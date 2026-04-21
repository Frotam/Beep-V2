const OpenAI = require("openai");

const client = new OpenAI();

async function transcribe(audioBuffer) {

  const response =
    await client.audio.transcriptions.create({

      file: audioBuffer,
      model: "whisper-1"

    });

  return response.text;

}

module.exports = { transcribe };