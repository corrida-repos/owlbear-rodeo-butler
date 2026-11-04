/** Reads width/height/mime from PNG, JPEG or WebP bytes (no dependencies). */
export function imageSize(buf: Uint8Array): { width: number; height: number; mime: string } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: dv.getUint32(16), height: dv.getUint32(20), mime: "image/png" };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]!;
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7), mime: "image/jpeg" };
      }
      i += 2 + len;
    }
  }
  // WebP
  const tag = (o: number) => String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
  if (tag(0) === "RIFF" && tag(8) === "WEBP") {
    const chunk = tag(12);
    if (chunk === "VP8X") return { width: 1 + (dv.getUint32(24, true) & 0xffffff), height: 1 + (dv.getUint32(27, true) & 0xffffff), mime: "image/webp" };
    if (chunk === "VP8L") {
      const b = dv.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, mime: "image/webp" };
    }
    if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff, mime: "image/webp" };
  }
  throw new Error("Unsupported image format (need PNG, JPEG or WebP)");
}
