const express = require("express");
const http = require("http");
const cors = require("cors");

const twilioRoutes = require("../routes/twillio.routes");
const { registerAudioStream } = require("../wss/audio-stream.server");
const {
  startSilenceMonitor,
} = require("../services/call-session.service");

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

app.use("/twilio", twilioRoutes);

const server = http.createServer(app);

registerAudioStream(server);
startSilenceMonitor();

server.listen(3000, () => {
  console.log("API running on port 3000");
});
