const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:3000/audio-stream");

ws.on("open", () => {

  console.log("fake call started");

  ws.send(JSON.stringify({
    event: "start",
    streamSid: "local-test-call"
  }));

  let count = 0;

  const interval = setInterval(() => {

    ws.send(JSON.stringify({
      event: "media",
      streamSid: "local-test-call",
      media: {
        payload: Buffer.from("hello audio").toString("base64")
      }
    }));

    count++;

    if(count > 20){

      clearInterval(interval);

      ws.send(JSON.stringify({
        event: "stop",
        streamSid: "local-test-call"
      }));

      ws.close();

    }

  }, 200);

});