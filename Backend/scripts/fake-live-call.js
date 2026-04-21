const WebSocket = require("ws");
const mic = require("mic");

const ws = new WebSocket("ws://localhost:3000/audio-stream");

ws.on("open", () => {

 console.log("📞 Fake call started — speak now...");

 ws.send(JSON.stringify({
  event: "start",
  streamSid: "live-call-001"
 }));

 const micInstance = mic({

  rate: "8000",
  channels: "1",
  debug: false,
  encoding: "signed-integer"

 });

 const micInputStream =
  micInstance.getAudioStream();

 micInputStream.on("data", chunk => {

  ws.send(JSON.stringify({

   event: "media",

   streamSid: "live-call-001",

   media: {
    payload: chunk.toString("base64")
   }

  }));

 });

 micInputStream.on("error", err => {

  console.log("mic error", err);

 });

 micInstance.start();

 // stop after 10 seconds
 setTimeout(() => {

  micInstance.stop();

  ws.send(JSON.stringify({

   event: "stop",

   streamSid: "live-call-001"

  }));

  ws.close();

  console.log("📞 Fake call ended");

 }, 10000);

});