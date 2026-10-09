import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkerRequest, WorkerResponse } from "../../src/engine/dpsWorker"
import { defaultInputs } from "../../src/engine/defaults"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { StatLabPanel } from "../../src/ui/features/overview/stat-lab-panel/StatLabPanel"
import { ItemRankingTable } from "../../src/ui/features/overview/item-ranking-table/ItemRankingTable"
import type { Inputs } from "../../src/engine/types"
import { activeRotationForInputs, runEngine } from "../../src/engine/dps"
import { builtinSkillsForClass } from "../../src/engine/builtinLibrary"
import { computeStatLab } from "../../src/engine/statLab"
import { withDerivedStats } from "../../src/engine/derivedInputs"
import { applyArmorSet, applyBowSet } from "../../src/engine/panel"

const { workers, MockWorker } = vi.hoisted(() => {
  const workers: {
    posted: WorkerRequest[]
    onmessage: ((event: { data: WorkerResponse }) => void) | null
  }[] = []
  class MockWorker {
    posted: WorkerRequest[] = []
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null
    constructor() {
      workers.push(this)
    }
    postMessage(request: WorkerRequest) {
      this.posted.push(request)
    }
  }
  return { workers, MockWorker }
})
vi.mock("../../src/engine/dpsWorker?worker", () => ({ default: MockWorker }))

function panel(inputs = defaultInputs, profileId = "profile") {
  return (
    <I18nProvider>
      <StatLabPanel inputs={inputs} profileId={profileId} />
    </I18nProvider>
  )
}
function pending() {
  const jobs = workers.flatMap((worker) =>
    worker.posted
      .filter(
        (request): request is Extract<WorkerRequest, { kind: "statLab" }> =>
          request.kind === "statLab",
      )
      .map((request) => ({ worker, request })),
  )
  return jobs.sort((first, second) => second.request.reqId - first.request.reqId)[0]
}
function answer(job = pending(), baselineDps = 100) {
  act(() =>
    job.worker.onmessage?.({
      data: {
        kind: "statLab",
        reqId: job.request.reqId,
        sourceKey: job.request.sourceKey,
        result: {
          status: "ok",
          level: 96,
          baselineDps,
          hypotheticalDps: baselineDps + 10,
          deltaDps: 10,
          deltaPercent: baselineDps > 0 ? 10 : null,
          rows: [],
        },
      },
    }),
  )
}
function flush() {
  act(() => vi.advanceTimersByTime(160))
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("Stat Lab worker ownership and preview", () => {
  it("renders one real Spear increment and selects it by keyboard without saved-state writes", async () => {
    vi.useRealTimers()
    localStorage.setItem("wwm.locale", "en")
    const config = { ...defaultInputs, classId: "bellstrikeUmbra", breakthrough: 20 }
    const rotation = activeRotationForInputs(config)!
    const skills = builtinSkillsForClass(config.classId)
    const inputs = applyBowSet(
      applyArmorSet(
        withDerivedStats({
          ...config,
          activeCustomRotation: {
            ...rotation,
            steps: rotation.steps.filter(
              (step) =>
                skills.find((skill) => skill.id === step.skillId)?.weaponOrAttribute === "Spear",
            ),
          },
        }),
      ),
    )
    const original = JSON.stringify(inputs)
    const storage = JSON.stringify(localStorage)
    const writes = vi.spyOn(Storage.prototype, "setItem")
    try {
      render(panel(inputs))
      async function evaluatePending() {
        const job = pending()
        const result = await computeStatLab(job.request.inputs, job.request.changes)
        act(() =>
          job.worker.onmessage?.({
            data: {
              kind: "statLab",
              reqId: job.request.reqId,
              sourceKey: job.request.sourceKey,
              result,
            },
          }),
        )
        return result
      }
      await waitFor(() => expect(pending()?.request.inputs).toBeTruthy())
      await evaluatePending()
      expect(writes.mock.calls.every(([key]) => key === "wwm.locale")).toBe(true)
      writes.mockClear()
      const priority = screen.getByRole("region", { name: "Stat Priority" })
      const spearRows = within(priority)
        .getAllByRole("row")
        .filter((row) => row.textContent?.includes("Art of Spear DMG Boost"))
      expect(spearRows).toHaveLength(1)
      fireEvent.click(screen.getByRole("button", { name: "Add stat change" }))
      const selector = screen.getByRole("combobox", { name: "Stat to change 1" })
      selector.focus()
      fireEvent.keyDown(selector, { key: "Enter" })
      const options = screen.getAllByRole("option")
      expect(
        options.filter((option) => option.getAttribute("data-value") === "tunement:spearBoost"),
      ).toHaveLength(1)
      const index = options.findIndex(
        (option) => option.getAttribute("data-value") === "tunement:spearBoost",
      )
      fireEvent.keyDown(selector, { key: "Home" })
      for (let step = 0; step < index; step++) fireEvent.keyDown(selector, { key: "ArrowDown" })
      fireEvent.keyDown(selector, { key: "Enter" })
      expect(selector.textContent).toContain("Art of Spear DMG Boost")
      expect(document.activeElement).toBe(selector)
      expect(screen.queryByRole("listbox")).toBeNull()
      const previous = pending().request.reqId
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "8.6" } })
      await waitFor(() => expect(pending().request.reqId).not.toBe(previous))
      const result = await evaluatePending()
      if (result.status !== "ok") throw new Error("missing result")
      expect(pending().request.changes).toEqual([
        { source: "tunement", statLineId: "spearBoost", amount: 0.086 },
      ])
      expect(result.hypotheticalDps).toBe(
        runEngine({ ...inputs, spearBoost: inputs.spearBoost + 0.086 }).dps,
      )
      expect(JSON.stringify(inputs)).toBe(original)
      expect(JSON.stringify(localStorage)).toBe(storage)
      expect(writes).not.toHaveBeenCalled()
      expect(screen.queryByRole("button", { name: /Equip|Apply|Save/ })).toBeNull()
    } finally {
      writes.mockRestore()
    }
  })

  it("preserves Lead and aligns the modeled-effect column", () => {
    localStorage.setItem("wwm.locale", "en")
    render(
      <I18nProvider>
        <ItemRankingTable
          baselineDps={100}
          rows={[
            {
              statLineId: "power",
              label: "Power",
              labelKey: "statLine.power",
              source: "tunement",
              amount: 10,
              unit: "raw",
              expectedDps: 110,
              dpsDelta: 10,
              liftPercent: 0.1,
              leadVsMin: 1.25,
            },
          ]}
        />
      </I18nProvider>,
    )
    expect(screen.getAllByRole("cell")).toHaveLength(screen.getAllByRole("columnheader").length)
    expect(
      screen
        .getAllByRole("cell")
        .map((cell) => cell.textContent)
        .slice(-2),
    ).toEqual(["1.25", "Modeled"])
  })

  it("adds multiple signed changes and displays a worker comparison without storage writes", () => {
    localStorage.setItem("wwm.locale", "en")
    const before = JSON.stringify(localStorage)
    const original = JSON.stringify(defaultInputs)
    render(panel())
    flush()
    answer()
    expect(screen.getByText("110")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Add stat change" }))
    fireEvent.click(screen.getByRole("button", { name: "Add stat change" }))
    const controls = screen.getAllByRole("spinbutton")
    fireEvent.change(controls[0], { target: { value: "10" } })
    fireEvent.change(controls[1], { target: { value: "-5" } })
    flush()
    expect(pending().request.changes.map((change) => change.amount)).toEqual([10, -5])
    answer()
    expect(JSON.stringify(defaultInputs)).toBe(original)
    expect(JSON.stringify(localStorage)).toBe(before)
    expect(screen.queryByRole("button", { name: /Equip|Apply|Save/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Reset changes" }))
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0)
  })

  it.each(["profile", "class", "rotation", "scenario", "inventory"])(
    "invalidates %s immediately and drops stale responses",
    (change) => {
      const view = render(panel())
      flush()
      const old = pending()
      answer(old)
      let inputs: Inputs = defaultInputs
      let profileId = "profile"
      if (change === "profile") profileId = "other"
      if (change === "class") inputs = { ...inputs, classId: "bellstrikeSplendor" }
      if (change === "rotation") inputs = { ...inputs, selectedBuiltinRotationId: "other" }
      if (change === "scenario") inputs = { ...inputs, dummyMode: !inputs.dummyMode }
      if (change === "inventory")
        inputs = {
          ...inputs,
          inventory: [
            {
              id: "new-piece",
              slot: "helm",
              label: "New helm",
              level: 96,
              rarity: "legendary",
              minPhys: 0,
              maxPhys: 0,
              hp: 0,
              physDef: 0,
              words: [
                { word: "", value: 0, retuned: false },
                { word: "", value: 0, retuned: false },
                { word: "", value: 0, retuned: false },
                { word: "", value: 0, retuned: false },
                { word: "", value: 0, retuned: false },
              ],
              attunement: "",
              attunementValue: 0,
              relayed: false,
            },
          ],
        }
      view.rerender(panel(inputs, profileId))
      expect(screen.queryByText("110")).toBeNull()
      flush()
      answer(old, 900)
      expect(screen.queryByText("910")).toBeNull()
      answer()
      expect(screen.getByText("110")).toBeTruthy()
    },
  )

  it("cancels in-flight and debounced requests, supports retry, and aborts on unmount", () => {
    const view = render(panel())
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    flush()
    expect(screen.getByText(/No current result/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }))
    flush()
    const old = pending()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(
      old.worker.posted.some(
        (request) => request.kind === "statLabCancel" && request.reqId === old.request.reqId,
      ),
    ).toBe(true)
    answer(old)
    expect(screen.queryByText("110")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }))
    flush()
    const next = pending()
    view.unmount()
    expect(
      next.worker.posted.some(
        (request) => request.kind === "statLabCancel" && request.reqId === next.request.reqId,
      ),
    ).toBe(true)
  })

  it("reports evaluator errors and unavailable percentage on a zero baseline", () => {
    render(panel())
    flush()
    const job = pending()
    act(() =>
      job.worker.onmessage?.({
        data: {
          kind: "statLab",
          reqId: job.request.reqId,
          sourceKey: job.request.sourceKey,
          result: { status: "error", reason: "invalid-change" },
        },
      }),
    )
    expect(screen.getByText(/Cannot evaluate/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }))
    flush()
    answer(pending(), 0)
    expect(screen.getByText(/Unavailable \(zero baseline\)/)).toBeTruthy()
  })
})
