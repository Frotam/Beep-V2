from faster_whisper import WhisperModel
import sys

model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8"
)

audio = sys.argv[1]

segments, info = model.transcribe(
    audio,
    language="en",
    beam_size=5
)

text = ""

for segment in segments:
    text += segment.text + " "

print(text.strip())