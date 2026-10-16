import { expect, it } from "vitest"
import { pngMapDimensions } from "../../src/ui/features/tools/map-lab/pngMap"
import {
  journalText,
  parseJournal,
  type JournalEntry,
} from "../../src/ui/features/tools/toolkitJournal"

function header(width: number, height: number) {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}
it("admits bounded PNG dimensions before invoking an image decoder", () => {
  expect(pngMapDimensions(header(240, 120))).toEqual({ width: 240, height: 120 })
  expect(pngMapDimensions(header(8192, 8192))).toBeNull()
  expect(pngMapDimensions(header(0, 120))).toBeNull()
  expect(pngMapDimensions(new ArrayBuffer(12))).toBeNull()
  const bytes = new Uint8Array(header(240, 120))
  bytes[0] = 0
  expect(pngMapDimensions(bytes.buffer)).toBeNull()
})
it("round-trips normalized markers bound to an exact image without persisting the image", () => {
  const marker: JournalEntry = {
    id: "marker",
    kind: "marker",
    name: "Own point",
    mapId: "a".repeat(64),
    x: 0.2,
    y: 1,
    done: true,
  }
  expect(parseJournal(journalText([marker]))).toEqual([marker])
  for (const invalid of [
    { ...marker, mapId: "foreign-url" },
    { ...marker, x: 1.1 },
    { ...marker, y: -1 },
    { ...marker, done: "yes" },
  ])
    expect(() => parseJournal(journalText([invalid as JournalEntry]))).toThrow()
})
