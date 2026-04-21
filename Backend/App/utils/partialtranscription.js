const fs = require("fs");
const path = require("path");

 

async function runPartialTranscription({

  session,
  extractSpeechSegments,
  createWavBuffer,
  transcribeAudio,
  audioDir
  

}) {

  try {

    if (!session.chunks.length) {
      return;
    }

    const pcm16le =
      Buffer.concat(session.chunks);


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


    const tempFile =
      path.join(
        audioDir,
        `partial-${session.sessionId}.wav`
      );


    fs.writeFileSync(
      tempFile,
      createWavBuffer(
        mergedSegment,
        16000
      )
    );


    const transcript =
      await transcribeAudio(
        tempFile
      );


    fs.unlinkSync(tempFile);


    if (
      transcript &&
      transcript !== session.lastPartialText
    ) {

      console.log(
        "Partial:",
        transcript
      );


      session.lastPartialText =
        transcript;

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