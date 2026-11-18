/** Plain RIFF/WAVE, mono 16-bit PCM, a 44-byte header and no other chunks. */

export function encodeWav(samples: Int16Array, rate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++)
    buf.writeInt16LE(samples[i] as number, 44 + i * 2);
  return buf;
}

export function decodeWav(buf: Uint8Array): {
  rate: number;
  channels: number;
  bits: number;
  samples: Int16Array;
} {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('not a WAV file');
  const n = b.readUInt32LE(40) / 2;
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(44 + i * 2);
  return {
    rate: b.readUInt32LE(24),
    channels: b.readUInt16LE(22),
    bits: b.readUInt16LE(34),
    samples,
  };
}
