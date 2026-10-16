import { beforeEach, expect, it, vi } from "vitest"
import {
  TOOLKIT_KEY,
  journalText,
  parseJournal,
  remainingSeconds,
  writeJournal,
  type JournalEntry,
} from "../../src/ui/features/tools/toolkitJournal"

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})
const entries: JournalEntry[] = [
  { id: "timer", kind: "timer", name: "GvG preparation", deadline: 10_000 },
  { id: "pity", kind: "pity", name: "My banner", count: 12 },
  {
    id: "match",
    kind: "match",
    name: "Opponent alias",
    date: "2026-10-16",
    result: "draw",
    note: "<script>literal</script>",
  },
]
it("round-trips manual data without touching calculator storage", () => {
  localStorage.setItem("wwm.profiles", "protected")
  const raw = writeJournal(entries, null)
  expect(parseJournal(raw)).toEqual(entries)
  expect(localStorage.getItem("wwm.profiles")).toBe("protected")
})
it("rejects future schemas, duplicates, unsafe keys and invalid values", () => {
  for (const raw of [
    '{"v":2,"entries":[]}',
    '{"v":1,"entries":[],"__proto__":{}}',
    journalText([entries[0], entries[0]]),
    journalText([{ ...entries[1], count: -1 } as JournalEntry]),
    journalText([{ ...entries[0], deadline: 1e30 } as JournalEntry]),
    " ".repeat(300_001),
  ])
    expect(() => parseJournal(raw)).toThrow()
})
it("refuses stale-tab writes and retains the newer bytes", () => {
  writeJournal(entries, null)
  expect(() => writeJournal([], null)).toThrow("tools.storageConflict")
  expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)).toEqual(entries)
})
it("reports storage failure without removing the original value", () => {
  const raw = writeJournal(entries, null)
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("Quota")
  })
  expect(() => writeJournal([], raw)).toThrow("Quota")
  expect(localStorage.getItem(TOOLKIT_KEY)).toBe(raw)
})
it("uses absolute deadlines after suspension and clamps expiry at zero", () => {
  expect(remainingSeconds(10_000, 1001)).toBe(9)
  expect(remainingSeconds(10_000, 15_000)).toBe(0)
})
