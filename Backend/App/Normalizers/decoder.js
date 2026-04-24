function decodeMuLawBuffer(buffer) {
  const pcmBuffer = Buffer.alloc(buffer.length * 2);

  for (let index = 0; index < buffer.length; index += 1) {
    pcmBuffer.writeInt16LE(decodeMuLawSample(buffer[index]), index * 2);
  }

  return pcmBuffer;
}

function decodeMuLawSample(value) {
  const muLaw = (~value) & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  const magnitude = ((mantissa | 0x10) << (exponent + 3)) - 132;

  return sign ? -magnitude : magnitude;
}
module.exports={
    decodeMuLawBuffer,
    decodeMuLawSample
}