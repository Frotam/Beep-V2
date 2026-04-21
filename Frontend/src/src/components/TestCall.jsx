import { useRef, useState } from "react";

export default function TestCall() {
  const wsRef = useRef(null);
  const mediaRef = useRef(null);
  const [isCalling, setIsCalling] = useState(false);
  const streamSid = "react-call-001";
const [isConnecting, setIsConnecting] = useState(false);
  const startCall = async () => {
  setIsConnecting(true);

  wsRef.current = new WebSocket("ws://localhost:3000/audio-stream");

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

      processor.onaudioprocess = (event) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
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

      setIsCalling(true);
    } catch (error) {
      console.error("Mic permission error:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  wsRef.current.onerror = () => {
    setIsConnecting(false);
    alert("Connection failed");
  };
};
  const stopCall = () => {
    wsRef.current?.send(
      JSON.stringify({
        event: "stop",
        streamSid,
        source: "browser",
      })
    );

    mediaRef.current?.processor?.disconnect();
    mediaRef.current?.source?.disconnect();
    mediaRef.current?.stream?.getTracks().forEach((track) => track.stop());
    mediaRef.current?.audioContext?.close();

    wsRef.current?.close();
    mediaRef.current = null;
    setIsCalling(false);
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
  <div>
    <h2>Mic Test</h2>

    {isConnecting && (
  <div>
    <div className="loader" />
    <p>Connecting...</p>
  </div>
)}
    {!isCalling && !isConnecting && (
      <button onClick={startCall}>Start Call</button>
    )}

    {isCalling && (
      <button onClick={stopCall}>End Call</button>
    )}
  </div>
);
}
