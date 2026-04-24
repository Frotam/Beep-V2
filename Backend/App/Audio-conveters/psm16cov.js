function pcm16ToFloat32(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  const output = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    output[index] = buffer.readInt16LE(index * 2) / 32768;
  }

  return output;
}



function float32ToPcm16Buffer(float32Array) {
  const buffer = Buffer.alloc(float32Array.length * 2);

  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index]));
    const int16 =
      sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);

    buffer.writeInt16LE(int16, index * 2);
  }

  return buffer;
}
module.exports={
    pcm16ToFloat32,
    float32ToPcm16Buffer

}