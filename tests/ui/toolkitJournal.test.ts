import { beforeEach, expect, it, vi } from "vitest"
import {
  TOOLKIT_KEY,
  JOURNAL_MAX_BYTES,
  localCalendarDate,
  journalText,
  parseJournal,
  remainingSeconds,
  writeJournal,
  type JournalEntry,
} from "../../src/ui/features/tools/toolkitJournal"
import { installTestLocks } from "./toolkitTestLocks"

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  installTestLocks()
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
it("round-trips manual data without touching calculator storage", async () => {
  localStorage.setItem("wwm.profiles", "protected")
  const raw = await writeJournal(entries, null)
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
it("refuses stale-tab writes and retains the newer bytes", async () => {
  await writeJournal(entries, null)
  await expect(writeJournal([], null)).rejects.toThrow("tools.storageConflict")
  expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)).toEqual(entries)
})
it("reports storage failure without removing the original value", async () => {
  const raw = await writeJournal(entries, null)
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("Quota")
  })
  await expect(writeJournal([], raw)).rejects.toThrow("Quota")
  expect(localStorage.getItem(TOOLKIT_KEY)).toBe(raw)
})

it("serializes overlapping writers and reports one conflict instead of losing a record", async () => {
  const outcomes = await Promise.allSettled([writeJournal(entries, null), writeJournal([], null)])
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected"])
  expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)).toEqual(entries)
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined })
  await expect(writeJournal([], localStorage.getItem(TOOLKIT_KEY))).rejects.toThrow(
    "tools.lockUnavailable",
  )
})

it("round-trips bounded Unicode exports within the file byte limit", () => {
  const unicode = Array.from(
    { length: 200 },
    (_, index) =>
      ({
        ...entries[2],
        id: String(index),
        name: "\u20ac".repeat(80),
        note: "\u20ac".repeat(500),
      }) as JournalEntry,
  )
  const text = journalText(unicode)
  expect(new TextEncoder().encode(text).length).toBeGreaterThan(300_000)
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(JOURNAL_MAX_BYTES)
  expect(parseJournal(text)).toEqual(unicode)
})

it("rejects impossible dates while accepting a real leap day", () => {
  for (const date of ["2026-02-29", "2026-02-30", "2026-04-31"])
    expect(() => parseJournal(journalText([{ ...entries[2], date } as JournalEntry]))).toThrow()
  expect(
    parseJournal(journalText([{ ...entries[2], date: "2028-02-29" } as JournalEntry])),
  ).toHaveLength(1)
})

it("uses the local calendar rather than the UTC date at midnight boundaries", () => {
  const date = new Date("2026-10-15T17:30:00Z")
  vi.spyOn(date, "getFullYear").mockReturnValue(2026)
  vi.spyOn(date, "getMonth").mockReturnValue(9)
  vi.spyOn(date, "getDate").mockReturnValue(16)
  expect(localCalendarDate(date)).toBe("2026-10-16")
})
it("uses absolute deadlines after suspension and clamps expiry at zero", () => {
  expect(remainingSeconds(10_000, 1001)).toBe(9)
  expect(remainingSeconds(10_000, 15_000)).toBe(0)
})
