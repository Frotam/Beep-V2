const WebSocket = require("ws");

const {
  createSession,
  addChunk,
  stopSession,
  attachSocketToSession,
} = require("../Services/call-session.service");

function registerAudioStream(server) {
  const wss = new WebSocket.Server({
    server,
    path: "/audio-stream",
  });

  wss.on("connection", (ws) => {
    console.log("WebSocket connected");
    let activeSessionId = null;

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message.toString());
        const sessionId = getSessionId(data);
        
        if (!sessionId) {
          return;
        }
        // console.log(data);
        // console.log(sessionId);

        if (data.event === "start") {
          activeSessionId = sessionId;
          createSession(sessionId, {
            ...getStreamMetadata(data),
            ws,
          });
          attachSocketToSession(sessionId, ws);
          console.log("call started:", sessionId);
          console.log("call started:", getStreamMetadata(data));
          return;
        }

        if (data.event === "media" && data.media?.payload) {
          if (!activeSessionId) {
            activeSessionId = sessionId;
            attachSocketToSession(sessionId, ws);
          }

          await addChunk(
            sessionId,
            data.media.payload,
            {
              ...getStreamMetadata(data),
              ws,
            }
          );
          return;
        }

        if (data.event === "stop") {
          await stopSession(sessionId);
          activeSessionId = null;
        }
      } catch (err) {
        console.error("WS error:", err.message);
      }
    });

    ws.on("close", async () => {
      if (activeSessionId) {
        await stopSession(activeSessionId);
      }
    });
  });
}

function getSessionId(data) {
  return (
    data.streamSid ||
    data.start?.streamSid ||
    data.stop?.streamSid ||
    data.media?.streamSid ||
    data.callSid
  );
}

function getStreamMetadata(data) {
  return {
    source:
      data.source ||
      data.start?.customParameters?.source ||
      inferSource(data),
    encoding:
      data.encoding ||
      data.media?.encoding ||
      data.start?.mediaFormat?.encoding,
    sampleRate:
      data.sampleRate ||
      data.media?.sampleRate ||
      data.start?.mediaFormat?.sampleRate,
  };
}

function inferSource(data) {
  if (data.start?.mediaFormat?.encoding) {
    return "twilio";
  }

  return "browser";
}

module.exports = { registerAudioStream };
