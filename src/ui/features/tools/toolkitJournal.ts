export const TOOLKIT_KEY = "pnhd.toolkit.v1"
export const JOURNAL_LIMIT = 200
export const JOURNAL_MAX_CHARS = 300_000
export const JOURNAL_MAX_BYTES = JOURNAL_MAX_CHARS * 4
export const MATCH_MODES = ["unknown", "arena1v1", "arena3v3", "gvg", "other"] as const

export function localCalendarDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export type JournalEntry =
  | {
      id: string
      kind: "training"
      name: string
      date: string
      classId: string
      profileId: string
      rotationId: string
      fingerprint: string
      patch: string
      target: string
      damage: number
      duration: number
      modeledDps: number
      modeledDuration: number
      source: string
      note: string
    }
  | { id: string; kind: "marker"; name: string; mapId: string; x: number; y: number; done: boolean }
  | { id: string; kind: "timer"; name: string; deadline: number }
  | { id: string; kind: "pity"; name: string; count: number }
  | {
      id: string
      kind: "match"
      name: string
      date: string
      result: "win" | "loss" | "draw"
      note: string
      mode?: (typeof MATCH_MODES)[number]
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
      row.kind === "training" &&
      ["date", "classId", "profileId", "rotationId", "patch", "target"].every(
        (key) =>
          typeof row[key] === "string" && row[key].trim().length > 0 && row[key].length <= 100,
      ) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(row.date)) &&
      Number.isFinite(Date.parse(String(row.date))) &&
      new Date(String(row.date)).toISOString().slice(0, 10) === row.date &&
      typeof row.fingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(row.fingerprint) &&
      ["damage", "modeledDps"].every(
        (key) =>
          typeof row[key] === "number" &&
          Number.isFinite(row[key]) &&
          row[key] >= 0 &&
          row[key] <= 1e12,
      ) &&
      ["duration", "modeledDuration"].every(
        (key) =>
          typeof row[key] === "number" &&
          Number.isFinite(row[key]) &&
          row[key] > 0 &&
          row[key] <= 86400,
      ) &&
      typeof row.source === "string" &&
      row.source.length <= 1000 &&
      typeof row.note === "string" &&
      row.note.length <= 500
    ) {
      const source = new URL(row.source)
      if (!["https:", "http:"].includes(source.protocol) || source.username || source.password)
        throw new Error("tools.invalidBackup")
      return {
        ...base,
        kind: "training",
        date: row.date as string,
        classId: row.classId as string,
        profileId: row.profileId as string,
        rotationId: row.rotationId as string,
        fingerprint: row.fingerprint,
        patch: row.patch as string,
        target: row.target as string,
        damage: row.damage as number,
        duration: row.duration as number,
        modeledDps: row.modeledDps as number,
        modeledDuration: row.modeledDuration as number,
        source: row.source,
        note: row.note,
      }
    }
    if (
      row.kind === "marker" &&
      typeof row.mapId === "string" &&
      /^[a-f0-9]{64}$/.test(row.mapId) &&
      typeof row.x === "number" &&
      Number.isFinite(row.x) &&
      row.x >= 0 &&
      row.x <= 1 &&
      typeof row.y === "number" &&
      Number.isFinite(row.y) &&
      row.y >= 0 &&
      row.y <= 1 &&
      typeof row.done === "boolean"
    ) {
      return { ...base, kind: "marker", mapId: row.mapId, x: row.x, y: row.y, done: row.done }
    }
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
      new Date(row.date).toISOString().slice(0, 10) === row.date &&
      ["win", "loss", "draw"].includes(String(row.result)) &&
      typeof row.note === "string" &&
      row.note.length <= 500 &&
      (row.mode === undefined || MATCH_MODES.includes(row.mode as (typeof MATCH_MODES)[number]))
    ) {
      return {
        ...base,
        kind: "match",
        date: row.date,
        result: row.result as "win" | "loss" | "draw",
        note: row.note,
        ...(row.mode === undefined ? {} : { mode: row.mode as (typeof MATCH_MODES)[number] }),
      }
    }
    throw new Error("tools.invalidBackup")
  })
}

export function journalText(entries: JournalEntry[]): string {
  return JSON.stringify({ v: 1, entries }, null, 2)
}

export async function writeJournal(
  entries: JournalEntry[],
  expectedRaw: string | null,
): Promise<string> {
  const next = journalText(entries)
  parseJournal(next)
  if (!navigator.locks) throw new Error("tools.lockUnavailable")
  return navigator.locks.request(TOOLKIT_KEY, () => {
    if (localStorage.getItem(TOOLKIT_KEY) !== expectedRaw) throw new Error("tools.storageConflict")
    localStorage.setItem(TOOLKIT_KEY, next)
    if (localStorage.getItem(TOOLKIT_KEY) !== next) throw new Error("tools.storageFailed")
    return next
  })
}

export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}
