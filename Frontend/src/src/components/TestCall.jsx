import { useRef, useState } from "react";

export default function TestCall() {
  const wsRef = useRef(null);
  const mediaRef = useRef(null);
  const [isCalling, setIsCalling] = useState(false);
  const streamSid = "react-call-001";

  const startCall = async () => {
    wsRef.current = new WebSocket("ws://localhost:3000/audio-stream");

    wsRef.current.onopen = async () => {
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

        for (let index = 0; index < input.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, input[index]));
          pcmData[index] =
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
      {!isCalling ? (
        <button onClick={startCall}>Start Call</button>
      ) : (
        <button onClick={stopCall}>End Call</button>
      )}
    </div>
  );
}
