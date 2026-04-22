const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

const scriptPath = path.join(
  __dirname,
  "..",
  "..",
  "whisper-service",
  "transcribe.py",
);

let workerProcess = null;
let workerReady = null;
let nextRequestId = 0;
const pendingRequests = new Map();
let sttStatus = {
  ready: false,
  loading: false,
  error: null,
};

function ensureWorker() {
  if (workerReady) {
    return workerReady;
  }

  sttStatus = {
    ready: false,
    loading: true,
    error: null,
  };

  workerReady = new Promise((resolve, reject) => {
    const child = spawn("python", [scriptPath, "--worker"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HF_HUB_DISABLE_SYMLINKS_WARNING:
          process.env.HF_HUB_DISABLE_SYMLINKS_WARNING || "1",
      },
    });

    workerProcess = child;

    const stdout = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    let settled = false;

    const settleResolve = () => {
      if (!settled) {
        settled = true;
        sttStatus = {
          ready: true,
          loading: false,
          error: null,
        };
        resolve(child);
      }
    };

    const settleReject = (error) => {
      if (!settled) {
        settled = true;
        workerReady = null;
        sttStatus = {
          ready: false,
          loading: false,
          error: error.message,
        };
        reject(error);
      }
    };

    stdout.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      let payload;

      try {
        payload = JSON.parse(line);
      } catch (error) {
        console.error("Invalid Whisper worker output:", line);
        return;
      }

      if (payload.type === "ready") {
        settleResolve();
        return;
      }

      if (payload.type !== "result") {
        return;
      }

      const pending = pendingRequests.get(payload.id);

      if (!pending) {
        return;
      }

      pendingRequests.delete(payload.id);

      if (payload.error) {
        pending.reject(new Error(payload.error));
        return;
      }

      pending.resolve(String(payload.text || "").trim());
    });

    child.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();

      if (message) {
        console.error("Whisper worker:", message);
      }
    });

    child.once("error", (error) => {
      workerProcess = null;
      settleReject(error);
    });

    child.once("exit", (code, signal) => {
      const error = new Error(
        `Whisper worker exited unexpectedly (code=${code}, signal=${signal})`,
      );

      workerProcess = null;
      workerReady = null;
      sttStatus = {
        ready: false,
        loading: false,
        error: error.message,
      };

      for (const pending of pendingRequests.values()) {
        pending.reject(error);
      }

      pendingRequests.clear();
      settleReject(error);
    });
  });

  return workerReady;
}

async function initializeStt() {
  await ensureWorker();
  return getSttStatus();
}

function getSttStatus() {
  return { ...sttStatus };
}

async function transcribeAudio(filePath) {
  const worker = await ensureWorker();

  return new Promise((resolve, reject) => {
    const id = ++nextRequestId;

    pendingRequests.set(id, { resolve, reject });
    worker.stdin.write(`${JSON.stringify({ id, audioPath: filePath })}\n`);
  });
}

module.exports = {
  getSttStatus,
  initializeStt,
  transcribeAudio,
};
