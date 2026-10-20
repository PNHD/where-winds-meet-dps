import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { ConfirmProvider } from "../../src/ui/components/confirm-dialog/ConfirmDialog"
import { ToolsTab } from "../../src/ui/features/tools/tools-tab/ToolsTab"
import {
  TOOLKIT_KEY,
  parseJournal,
  journalText,
  type JournalEntry,
} from "../../src/ui/features/tools/toolkitJournal"
import { installTestLocks } from "./toolkitTestLocks"
import { defaultInputs } from "../../src/engine/defaults"

beforeEach(() => {
  localStorage.clear()
  installTestLocks()
})

it("disables the record form while a shared storage lock is pending", async () => {
  let release!: () => void
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, callback: () => string) =>
        new Promise<string>((resolve) => {
          release = () => resolve(callback())
        }),
    },
  })
  open()
  const input = screen.getByLabelText("Label, banner or opponent alias")
  fireEvent.change(input, { target: { value: "Queued record" } })
  fireEvent.click(screen.getByRole("button", { name: "Save personal record" }))
  expect(input).toBeDisabled()
  expect(screen.getByLabelText("Observation name")).toBeDisabled()
  await act(async () => release())
  expect(input).not.toBeDisabled()
  expect(screen.getByLabelText("Observation name")).not.toBeDisabled()
  expect(screen.getByText("Queued record")).toBeTruthy()
})

it("reserves the shared journal before hashing a measurement and refuses a reverse competing submit", async () => {
  let release!: (value: ArrayBuffer) => void
  const originalCrypto = globalThis.crypto
  const digest = vi.fn(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        release = resolve
      }),
  )
  vi.stubGlobal("crypto", { subtle: { digest }, randomUUID: () => originalCrypto.randomUUID() })
  try {
    open()
    const journalName = screen.getByLabelText("Label, banner or opponent alias")
    fireEvent.change(journalName, { target: { value: "Competing record" } })
    for (const [label, value] of [
      ["Observation name", "Delayed hash observation"],
      ["Game region and patch", "Global 2.3"],
      ["Target, mode and conditions", "Controlled dummy"],
      ["Observed total damage", "12000"],
      ["Observed duration (seconds)", "30"],
      ["Measurement evidence URL", "https://example.org/measurement"],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "Record measurement" }))
    await waitFor(() => expect(digest).toHaveBeenCalledTimes(1))
    expect(journalName).toBeDisabled()
    expect(screen.getByLabelText("Observation name")).toBeDisabled()
    fireEvent.submit(journalName.closest("form")!)
    expect(localStorage.getItem(TOOLKIT_KEY)).toBeNull()
    await act(async () => release(new ArrayBuffer(32)))
    await screen.findByText("Delayed hash observation")
    expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)).toMatchObject([
      { kind: "training", name: "Delayed hash observation" },
    ])
    expect(journalName).not.toBeDisabled()
    expect(screen.getByLabelText("Observation name")).not.toBeDisabled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it("previews a supported Unicode journal file above 300 KB without writing before confirmation", async () => {
  const rows: JournalEntry[] = Array.from({ length: 200 }, (_, index) => ({
    id: String(index),
    kind: "match",
    name: "\u20ac".repeat(80),
    date: "2026-10-16",
    result: "win",
    note: "\u20ac".repeat(500),
  }))
  const text = journalText(rows),
    size = new TextEncoder().encode(text).length
  expect(size).toBeGreaterThan(300_000)
  const { container } = open()
  fireEvent.change(container.querySelector('input[aria-label="Import journal backup"]')!, {
    target: { files: [{ size, text: async () => text }] },
  })
  const preview = await screen.findByRole("region", { name: "Journal import preview" })
  expect(localStorage.getItem(TOOLKIT_KEY)).toBeNull()
  fireEvent.click(within(preview).getByRole("button", { name: "Cancel" }))
  expect(localStorage.getItem(TOOLKIT_KEY)).toBeNull()
})
function open() {
  return render(
    <I18nProvider>
      <ConfirmProvider>
        <ToolsTab
          context={{
            inputs: defaultInputs,
            profileId: "existing",
            result: {
              dps: 100,
              rotationDuration: 30,
              castDuration: 30,
              totalDamage: 3000,
              graduationRate: null,
              perSkill: [],
              ranking: [],
              warnings: [],
            },
          }}
        />
      </ConfirmProvider>
    </I18nProvider>,
  )
}

it("shows eleven paths while leaving calculator storage and the active profile alone", () => {
  localStorage.setItem("wwm.profiles", "private sentinel")
  open()
  expect(
    screen.getByRole("region", { name: "Eleven-path coverage" }).querySelectorAll("li"),
  ).toHaveLength(11)
  expect(screen.getAllByText("DATA_NEEDED · DPS_UNAVAILABLE")).toHaveLength(6)
  expect(localStorage.getItem("wwm.profiles")).toBe("private sentinel")
  expect(localStorage.getItem(TOOLKIT_KEY)).toBeNull()
})

it("saves a personal deadline and keeps it across remounts", async () => {
  const view = open()
  fireEvent.change(screen.getByLabelText("Label, banner or opponent alias"), {
    target: { value: "GvG warmup" },
  })
  fireEvent.change(screen.getByLabelText("Minutes from now"), { target: { value: "1" } })
  fireEvent.click(screen.getByRole("button", { name: "Save personal record" }))
  await screen.findByText("GvG warmup")
  const entries = parseJournal(localStorage.getItem(TOOLKIT_KEY)!)
  expect(entries).toHaveLength(1)
  expect(entries[0].kind).toBe("timer")
  view.unmount()
  open()
  expect(screen.getByText("GvG warmup")).toBeTruthy()
})

it("keeps corrupt journal bytes instead of overwriting them", () => {
  localStorage.setItem(TOOLKIT_KEY, "{broken")
  open()
  expect(screen.getByRole("alert").textContent).toMatch(/not been overwritten/)
  expect(screen.getByRole("button", { name: "Save personal record" })).toBeDisabled()
  expect(localStorage.getItem(TOOLKIT_KEY)).toBe("{broken")
})

it("counts manual pulls without implying odds or touching equipment", async () => {
  open()
  fireEvent.click(screen.getByRole("combobox", { name: "Record type" }))
  fireEvent.mouseDown(screen.getByRole("option", { name: /Manual pull counter/ }))
  fireEvent.change(screen.getByLabelText("Label, banner or opponent alias"), {
    target: { value: "Personal banner" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save personal record" }))
  fireEvent.click(await screen.findByRole("button", { name: "Record one pull" }))
  await waitFor(() =>
    expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)[0]).toMatchObject({ count: 1 }),
  )
  expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)[0]).toMatchObject({
    kind: "pity",
    count: 1,
  })
  fireEvent.click(screen.getByRole("button", { name: "Undo one pull" }))
  await waitFor(() =>
    expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)[0]).toMatchObject({ count: 0 }),
  )
  expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)[0]).toMatchObject({ count: 0 })
  expect(screen.getByRole("button", { name: "Undo one pull" })).toBeDisabled()
})
