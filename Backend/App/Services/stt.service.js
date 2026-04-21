const { exec } = require("child_process");

function transcribeAudio(filePath) {

  return new Promise((resolve, reject) => {

    const scriptPath =
      "C:\\Users\\sidsh\\Desktop\\Beep V2\\Backend\\whisper-service\\transcribe.py";

    exec(
      `python "${scriptPath}" "${filePath}"`,
      (error, stdout, stderr) => {

        if (error) {
          console.error("Whisper error:", stderr);
          reject(error);
          return;
        }

        resolve(stdout.trim());

      }
    );

  });

}

module.exports = {
  transcribeAudio
};