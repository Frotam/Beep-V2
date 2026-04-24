function calculateRms(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);

  if (!sampleCount) {
    return 0;
  }

  let sumSquares = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = buffer.readInt16LE(index * 2) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}
module.exports={calculateRms}