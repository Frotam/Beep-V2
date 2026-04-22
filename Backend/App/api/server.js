const express = require("express");
const http = require("http");
const cors = require("cors");

const twilioRoutes = require("../routes/twillio.routes");
const { registerAudioStream } = require("../wss/audio-stream.server");
const {
  startSilenceMonitor,
} = require("../Services/call-session.service");
const {
  getSttStatus,
  initializeStt,
} = require("../Services/stt.service");
const {
  getLlmStatus,
  initializeLlm,
} = require("../Services/llm.service");

const app = express();

app.use(cors());
app.use(
  express.urlencoded({
    extended: true,
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ hello: "hi" });
});

app.get("/health/models", (req, res) => {
  const stt = getSttStatus();
  const llm = getLlmStatus();

  res.json({
    ready: stt.ready && llm.ready,
    stt,
    llm,
  });
});

app.use("/twilio", twilioRoutes);

const server = http.createServer(app);

registerAudioStream(server);
startSilenceMonitor();

server.listen(3000, () => {
  console.log("API running on port 3000");

  Promise.allSettled([initializeStt(), initializeLlm()]).then((results) => {
    const sttResult = results[0];
    const llmResult = results[1];

    if (sttResult.status === "fulfilled") {
      console.log("STT model ready");
    } else {
      console.error("STT model failed to initialize:", sttResult.reason);
    }

    if (llmResult.status === "fulfilled") {
      console.log("LLM ready");
    } else {
      console.error("LLM failed to initialize:", llmResult.reason);
    }
  });
});
