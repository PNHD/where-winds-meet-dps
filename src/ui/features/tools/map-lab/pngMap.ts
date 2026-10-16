export const MAP_MAX_BYTES = 8_000_000

export function pngMapDimensions(buffer: ArrayBuffer): { width: number; height: number } | null {
  if (buffer.byteLength < 33 || buffer.byteLength > MAP_MAX_BYTES) return null
  const bytes = new Uint8Array(buffer)
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return null
  const view = new DataView(buffer)
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR")
    return null
  const width = view.getUint32(16),
    height = view.getUint32(20)
  return width && height && width <= 8192 && height <= 8192 && width * height <= 16_000_000
    ? { width, height }
    : null
}
