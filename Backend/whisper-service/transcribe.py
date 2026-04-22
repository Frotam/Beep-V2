from faster_whisper import WhisperModel
import json
import os
import sys
import traceback


MODEL_NAME = os.environ.get("WHISPER_MODEL", "small.en")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

model = WhisperModel(
    MODEL_NAME,
    device=DEVICE,
    compute_type=COMPUTE_TYPE,
)


def transcribe(audio_path):
    segments, _ = model.transcribe(
        audio_path,
        language="en",
        beam_size=3,
        best_of=3,
        temperature=0.0,
        condition_on_previous_text=False,
        without_timestamps=True,
        vad_filter=False,
    )

    return " ".join(segment.text.strip() for segment in segments).strip()


def run_once(audio_path):
    print(transcribe(audio_path))


def run_worker():
    print(json.dumps({"type": "ready"}), flush=True)

    for line in sys.stdin:
        line = line.strip()

        if not line:
            continue

        payload = None

        try:
            payload = json.loads(line)
            text = transcribe(payload["audioPath"])
            print(
                json.dumps(
                    {
                        "type": "result",
                        "id": payload["id"],
                        "text": text,
                    }
                ),
                flush=True,
            )
        except Exception as exc:
            print(
                json.dumps(
                    {
                        "type": "result",
                        "id": payload["id"] if payload else None,
                        "error": str(exc),
                    }
                ),
                flush=True,
            )
            print(traceback.format_exc(), file=sys.stderr, flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        run_worker()
    elif len(sys.argv) > 1:
        run_once(sys.argv[1])
    else:
        raise SystemExit("Usage: transcribe.py <audio_path> | --worker")
