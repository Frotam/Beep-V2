const fs = require("fs");
const path = require("path");

 

async function runPartialTranscription({

  session,
  createWavBuffer,
  transcribeAudio,
  audioDir,
  onPartial,

}) {

  try {

    if (!session.chunks.length) {
      return;
    }

    const pcm16le =
      Buffer.concat(session.chunks);


    const durationMs =
      Math.round(
        (pcm16le.length / 2 / session.sampleRate) * 1000
      );


    if (durationMs < 300) {
      return;
    }


    const tempFile =
      path.join(
        audioDir,
        `partial-${session.sessionId}.wav`
      );


    fs.writeFileSync(
      tempFile,
      createWavBuffer(
        pcm16le,
        session.sampleRate
      )
    );


    const transcript = await transcribeAudio(tempFile);


    fs.unlinkSync(tempFile);

    const cleanedTranscript =
      String(transcript || "")
        .replace(/\s+/g, " ")
        .trim();


    if (
      cleanedTranscript &&
      cleanedTranscript !== session.lastPartialText
    ) {

      console.log(
        "Partial:",
        cleanedTranscript
      );


      session.lastPartialText =
        cleanedTranscript;

      if (onPartial) {
        onPartial(cleanedTranscript);
      }

    }

  }
  catch (err) {

    console.error(
      "Partial STT error:",
      err
    );

  }

}


module.exports = {
  runPartialTranscription
};
