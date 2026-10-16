export const TOOLKIT_KEY = "pnhd.toolkit.v1"
export const JOURNAL_LIMIT = 200
export const JOURNAL_MAX_CHARS = 300_000

export type JournalEntry =
  | { id: string; kind: "timer"; name: string; deadline: number }
  | { id: string; kind: "pity"; name: string; count: number }
  | {
      id: string
      kind: "match"
      name: string
      date: string
      result: "win" | "loss" | "draw"
      note: string
    }

export function parseJournal(text: string): JournalEntry[] {
  if (text.length > JOURNAL_MAX_CHARS) throw new Error("tools.invalidBackup")
  const parsed: unknown = JSON.parse(text, (key, value: unknown) => {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("tools.invalidBackup")
    return value
  })
  if (!parsed || typeof parsed !== "object") throw new Error("tools.invalidBackup")
  const { v, entries } = parsed as { v?: unknown; entries?: unknown }
  if (v !== 1 || !Array.isArray(entries) || entries.length > JOURNAL_LIMIT)
    throw new Error("tools.invalidBackup")
  const ids = new Set<string>()
  return entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("tools.invalidBackup")
    const row = entry as Record<string, unknown>
    if (
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 100 ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.length > 80
    )
      throw new Error("tools.invalidBackup")
    ids.add(row.id)
    const base = { id: row.id, name: row.name }
    if (
      row.kind === "timer" &&
      typeof row.deadline === "number" &&
      Number.isSafeInteger(row.deadline) &&
      row.deadline >= 0 &&
      row.deadline <= 8.64e15
    ) {
      return { ...base, kind: "timer", deadline: row.deadline }
    }
    if (
      row.kind === "pity" &&
      typeof row.count === "number" &&
      Number.isSafeInteger(row.count) &&
      row.count >= 0 &&
      row.count <= 1_000_000
    ) {
      return { ...base, kind: "pity", count: row.count }
    }
    if (
      row.kind === "match" &&
      typeof row.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
      Number.isFinite(Date.parse(row.date)) &&
      ["win", "loss", "draw"].includes(String(row.result)) &&
      typeof row.note === "string" &&
      row.note.length <= 500
    ) {
      return {
        ...base,
        kind: "match",
        date: row.date,
        result: row.result as "win" | "loss" | "draw",
        note: row.note,
      }
    }
    throw new Error("tools.invalidBackup")
  })
}

export function journalText(entries: JournalEntry[]): string {
  return JSON.stringify({ v: 1, entries }, null, 2)
}

export function writeJournal(entries: JournalEntry[], expectedRaw: string | null): string {
  const next = journalText(entries)
  parseJournal(next)
  if (localStorage.getItem(TOOLKIT_KEY) !== expectedRaw) throw new Error("tools.storageConflict")
  localStorage.setItem(TOOLKIT_KEY, next)
  if (localStorage.getItem(TOOLKIT_KEY) !== next) throw new Error("tools.storageFailed")
  return next
}

export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}
