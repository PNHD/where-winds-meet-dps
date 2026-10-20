import { webcrypto } from "node:crypto"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { defaultInputs } from "../../src/engine/defaults"
import { activeRotationForInputs } from "../../src/engine/dps"
import { TrainingPanel } from "../../src/ui/features/tools/training-panel/TrainingPanel"
import { LibraryTab } from "../../src/ui/features/tools/library-tab/LibraryTab"
import {
  journalText,
  parseJournal,
  writeJournal,
  TOOLKIT_KEY,
  type JournalEntry,
  type JournalUpdate,
} from "../../src/ui/features/tools/toolkitJournal"
import { installTestLocks } from "./toolkitTestLocks"
import type { Result, GearPiece } from "../../src/engine/types"
import { SharedInventory } from "../../src/ui/features/tools/library-tab/SharedInventory"
import * as journal from "../../src/ui/features/tools/toolkitJournal"
import { makeBuff } from "../../src/engine/buff"

const observation: Extract<JournalEntry, { kind: "training" }> = {
  id: "measurement",
  kind: "training",
  name: "Controlled trial",
  date: "2026-10-20",
  classId: "silkbindJade",
  profileId: "private-profile",
  rotationId: "measured-rotation",
  fingerprint: "a".repeat(64),
  patch: "Global 2.3",
  target: "Boss Dummy, full window",
  damage: 12000,
  duration: 30,
  modeledDps: 450,
  modeledDuration: 30,
  source: "https://example.org/owner-evidence",
  note: "<literal> user supplied",
}
const modeled: Result = {
  dps: 450,
  rotationDuration: 30,
  castDuration: 30,
  totalDamage: 13500,
  graduationRate: null,
  perSkill: [],
  ranking: [],
  warnings: [],
}

beforeEach(() => {
  localStorage.clear()
  installTestLocks()
  vi.stubGlobal("crypto", webcrypto)
})
afterEach(() => vi.unstubAllGlobals())

it("preserves mixed old journal records and observations across backup, restore and stale writes", async () => {
  localStorage.setItem("wwm.profiles", "immutable private bytes")
  const records: JournalEntry[] = [
    { id: "old", kind: "pity", name: "Original", count: 7 },
    observation,
  ]
  const raw = await writeJournal(records, null)
  expect(parseJournal(raw)).toEqual(records)
  await expect(writeJournal([], null)).rejects.toThrow("tools.storageConflict")
  expect(localStorage.getItem(TOOLKIT_KEY)).toBe(raw)
  expect(localStorage.getItem("wwm.profiles")).toBe("immutable private bytes")
})

it("rejects invalid observations without coercing or publishing evidence", () => {
  for (const patch of [
    { duration: 0 },
    { damage: -1 },
    { modeledDuration: Infinity },
    { modeledDps: null },
    { date: "2026-02-30" },
    { fingerprint: "unknown" },
    { source: "javascript:alert(1)" },
    { source: "https://user:secret@example.org" },
    { target: " " },
    { patch: "x".repeat(101) },
  ])
    expect(() =>
      parseJournal(journalText([{ ...observation, ...patch } as JournalEntry])),
    ).toThrow()
})

it("captures the selected model context and keeps observed numbers separate without modifying inputs", async () => {
  const inputs = structuredClone(defaultInputs)
  inputs.critRate += 0.01
  inputs.customBuffs = [makeBuff(inputs.classId, { name: "Private custom content" })]
  const original = structuredClone(inputs)
  const download = vi.spyOn(journal, "downloadJson").mockImplementation(() => {})
  let records: JournalEntry[] = []
  const save = vi.fn(async (update: JournalUpdate) => {
    records = typeof update === "function" ? await update() : update
    parseJournal(journalText(records))
    return true
  })
  render(
    <I18nProvider>
      <TrainingPanel
        inputs={inputs}
        profileId="active-profile"
        result={modeled}
        entries={[]}
        onSave={save}
        journalSaving={false}
      />
    </I18nProvider>,
  )
  for (const [label, value] of [
    ["Observation name", "Trial"],
    ["Game region and patch", "Global 2.3"],
    ["Target, mode and conditions", "Boss Dummy"],
    ["Observed total damage", "12000"],
    ["Observed duration (seconds)", "30"],
    ["Measurement evidence URL", "https://example.org/trial"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole("button", { name: "Record measurement" }))
  await screen.findByRole("button", { name: "Download last recorded model context" })
  expect(save).toHaveBeenCalledTimes(1)
  const captured = records[0]
  expect(captured).toMatchObject({
    kind: "training",
    classId: inputs.classId,
    profileId: "active-profile",
    rotationId: activeRotationForInputs(inputs)!.id,
    damage: 12000,
    duration: 30,
    modeledDps: 450,
  })
  expect(captured.kind === "training" && captured.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(inputs).toEqual(original)
  expect(localStorage.getItem(TOOLKIT_KEY)).toBeNull()
  expect(localStorage.getItem("wwm.profiles")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Download last recorded model context" }))
  const downloaded = JSON.parse(download.mock.calls[0][0])
  expect(downloaded.observation).toEqual(captured)
  expect(downloaded.inputsJson).toBe(JSON.stringify(original))
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(downloaded.inputsJson),
  )
  expect(Buffer.from(digest).toString("hex")).toBe(
    captured.kind === "training" && captured.fingerprint,
  )
  download.mockRestore()
})

it("filters references and retains the selected class, rotation and inventory", () => {
  const inputs = structuredClone(defaultInputs),
    original = structuredClone(inputs)
  render(
    <MemoryRouter>
      <I18nProvider>
        <LibraryTab inputs={inputs} profiles={[]} profileId="active" onChange={vi.fn()} />
      </I18nProvider>
    </MemoryRouter>,
  )
  expect(screen.getAllByText(/MODEL REFERENCE/).length).toBeGreaterThan(0)
  fireEvent.change(screen.getByLabelText("Search class or rotation"), {
    target: { value: "no matching rotation" },
  })
  expect(screen.queryAllByText(/MODEL REFERENCE/)).toHaveLength(0)
  expect(screen.getByRole("link", { name: "Preview a private profile import" })).toHaveAttribute(
    "href",
    "/profile",
  )
  expect(inputs).toEqual(original)
})

it("copies reviewed saved gear with a new identity and preserves source history, unknown fields and equipment", () => {
  const piece: GearPiece & { futureMetadata: unknown } = {
    id: "source-gear",
    slot: "helm",
    level: 96,
    rarity: "legendary",
    minPhys: 0,
    maxPhys: 0,
    hp: 20,
    physDef: 10,
    words: Array.from({ length: 5 }, () => ({
      word: "",
      value: 0,
      retuned: false,
    })) as GearPiece["words"],
    attunement: "",
    attunementValue: 0,
    relayed: false,
    retunedOutWords: [],
    futureMetadata: { preserved: true },
  }
  const inputs = structuredClone(defaultInputs),
    source = {
      id: "source",
      name: "Other build",
      inputs: { ...structuredClone(inputs), inventory: [piece] },
    }
  const originals = structuredClone({ inputs, source }),
    change = vi.fn()
  render(
    <I18nProvider>
      <SharedInventory profiles={[source]} profileId="active" inputs={inputs} onChange={change} />
    </I18nProvider>,
  )
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText("Other build", { exact: false }))
  fireEvent.click(screen.getByRole("button", { name: "Add copy to current draft" }))
  const next = change.mock.calls[0][0]
  expect(next.inventory).toHaveLength(1)
  expect(next.inventory[0].id).not.toBe(piece.id)
  expect({ ...next.inventory[0], id: piece.id }).toEqual(piece)
  expect(next.inventory[0].words).not.toBe(piece.words)
  expect(next.equipped).toEqual(inputs.equipped)
  expect({ inputs, source }).toEqual(originals)
})
