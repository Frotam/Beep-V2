import { useRef, useState } from "react";

export default function TestCall() {
  const wsRef = useRef(null);
  const mediaRef = useRef(null);
  const [isCalling, setIsCalling] = useState(false);
  const streamSid = "react-call-001";
  const [isConnecting, setIsConnecting] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [status, setStatus] = useState("Idle");
  const [events, setEvents] = useState([]);
  const [controlState, setControlState] = useState({
    intent: "general",
    confidence: null,
    action: null,
    reason: null,
  });
  const [modelStatus, setModelStatus] = useState({
    ready: false,
    stt: { ready: false, loading: false, error: null },
    llm: { ready: false, loading: false, error: null },
  });

  const pushEvent = (label) => {
    setEvents((current) => [label, ...current].slice(0, 12));
  };

  const startCall = async () => {
    setIsConnecting(true);
    setStatus("Connecting");
    setPartialTranscript("");
    setFinalTranscript("");
    setAssistantText("");
    setEvents([]);

    wsRef.current = new WebSocket("ws://localhost:3000/audio-stream");

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "partial_transcript") {
        setPartialTranscript(data.transcript || "");
        setStatus("Listening");
        return;
      }

      if (data.type === "control_decision") {
        setControlState({
          intent: data.intent || "general",
          confidence: data.confidence ?? null,
          action: data.action || null,
          reason: data.reason || null,
        });
        pushEvent(
          `Control: ${data.intent || "general"} / ${data.action || "unknown"} / ${data.confidence ?? "-"}`
        );
        return;
      }

      if (data.type === "model_status") {
        setModelStatus(
          data || {
            ready: false,
            stt: { ready: false, loading: false, error: null },
            llm: { ready: false, loading: false, error: null },
          }
        );

        if (data.ready) {
          setStatus("Ready");
        } else if (data.stt?.loading || data.llm?.loading) {
          setStatus("Loading models");
        } else if (data.stt?.error || data.llm?.error) {
          setStatus("Model initialization failed");
        }

        return;
      }

      if (data.type === "final_transcript") {
        setFinalTranscript(data.transcript || "");
        setPartialTranscript("");
        setAssistantText("");
        setStatus("Thinking");
        pushEvent(`User: ${data.transcript}`);
        return;
      }

      if (data.type === "assistant_started") {
        setAssistantText("");
        setStatus("Assistant speaking");
        return;
      }

      if (data.type === "assistant_token") {
        setAssistantText(data.text || "");
        return;
      }

      if (data.type === "assistant_completed") {
        setAssistantText(data.response || "");
        setStatus(data.fromCache ? "Answered from cache" : "Completed");
        pushEvent(`AI: ${data.response}`);
        return;
      }

      if (data.type === "assistant_cancelled") {
        setStatus("Interrupted");
        pushEvent("Assistant paused for user interruption");
        return;
      }

      if (data.type === "assistant_resumed") {
        setStatus("Continuing previous response");
        pushEvent("Noise ignored, assistant continued");
        return;
      }

      if (data.type === "cache_hit") {
        setStatus("Cache hit");
        pushEvent(`Cache: ${data.response}`);
        return;
      }

      if (data.type === "ignored_transcript") {
        setStatus(`Ignored: ${data.reason}`);
        pushEvent(`Ignored transcript (${data.reason})`);
        return;
      }

      if (data.type === "assistant_error") {
        setStatus(data.message || "Assistant error");
        pushEvent(`Error: ${data.message || "Assistant error"}`);
      }
    };

    wsRef.current.onopen = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        mediaRef.current = {
          audioContext,
          processor,
          source,
          stream,
        };

        wsRef.current.send(
          JSON.stringify({
            event: "start",
            streamSid,
            source: "browser",
            encoding: "pcm_s16le",
            sampleRate: audioContext.sampleRate,
          })
        );

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (audioEvent) => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) {
            return;
          }

          const input = audioEvent.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(input.length);

          for (let i = 0; i < input.length; i++) {
            const sample = Math.max(-1, Math.min(1, input[i]));
            pcmData[i] =
              sample < 0
                ? Math.round(sample * 32768)
                : Math.round(sample * 32767);
          }

          wsRef.current.send(
            JSON.stringify({
              event: "media",
              streamSid,
              source: "browser",
              media: {
                payload: arrayBufferToBase64(pcmData.buffer),
                encoding: "pcm_s16le",
                sampleRate: audioContext.sampleRate,
              },
            })
          );
        };

        setStatus("Connected");
        setIsCalling(true);
      } catch (error) {
        console.error("Mic permission error:", error);
        setStatus("Microphone permission denied");
      } finally {
        setIsConnecting(false);
      }
    };

    wsRef.current.onerror = () => {
      setIsConnecting(false);
      setStatus("Connection failed");
      alert("Connection failed");
    };

    wsRef.current.onclose = () => {
      setIsCalling(false);
      setIsConnecting(false);
      setStatus("Disconnected");
    };
  };

  const stopCall = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "stop",
          streamSid,
          source: "browser",
        })
      );
    }

    if (mediaRef.current) {
      mediaRef.current.processor?.disconnect();
      mediaRef.current.source?.disconnect();
      mediaRef.current.stream?.getTracks().forEach((track) => track.stop());
      mediaRef.current.audioContext?.close();
    }

    wsRef.current?.close();
    mediaRef.current = null;
    wsRef.current = null;
    setPartialTranscript("");
    setIsCalling(false);
    setStatus("Call ended");
  };

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);

    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    return btoa(binary);
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h2>Mic Test</h2>
      <p>Status: {status}</p>
      <p>
        Control: {controlState.intent}
        {controlState.confidence !== null
          ? ` (${Math.round(controlState.confidence * 100)}%)`
          : ""}
      </p>

      {!modelStatus.ready && (
        <div style={{ padding: 12, border: "1px solid #ccc", marginBottom: 16 }}>
          <div className="loader" />
          <p>
            {modelStatus.stt.loading || modelStatus.llm.loading
              ? "Loading speech and AI models..."
              : "Waiting for models to become ready..."}
          </p>
          <p>
            STT:{" "}
            {modelStatus.stt.ready
              ? "Ready"
              : modelStatus.stt.loading
              ? "Loading"
              : modelStatus.stt.error || "Pending"}
          </p>
          <p>
            LLM:{" "}
            {modelStatus.llm.ready
              ? "Ready"
              : modelStatus.llm.loading
              ? "Loading"
              : modelStatus.llm.error || "Pending"}
          </p>
        </div>
      )}

      {isConnecting && (
        <div>
          <div className="loader" />
          <p>Connecting...</p>
        </div>
      )}

      {!isCalling && !isConnecting && (
        <button onClick={startCall}>Start Call</button>
      )}

      {isCalling && <button onClick={stopCall}>End Call</button>}

      <div style={{ marginTop: 24 }}>
        <h3>Live Partial</h3>
        <p>{partialTranscript || "Waiting for speech..."}</p>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>Final Transcript</h3>
        <p>{finalTranscript || "No finalized segment yet."}</p>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>Assistant</h3>
        <p>{assistantText || "No response yet."}</p>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>Recent Events</h3>
        {events.length ? (
          <ul>
            {events.map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ul>
        ) : (
          <p>No events yet.</p>
        )}
      </div>
    </div>
  );
}
