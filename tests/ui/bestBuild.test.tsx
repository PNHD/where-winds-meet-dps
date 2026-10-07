import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { defaultInputs } from "../../src/engine/defaults"
import { EMPTY_EQUIPPED, GEAR_SLOTS } from "../../src/engine/types"
import type { GearPiece, Inputs } from "../../src/engine/types"
import type { WorkerRequest, WorkerResponse } from "../../src/engine/dpsWorker"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { BestBuildPanel } from "../../src/ui/features/gear/gear-tab/BestBuildPanel"
import { retainedResponse } from "../../src/ui/hooks/dpsWorkerClient"

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

function fixture(): Inputs {
  const inventory: GearPiece[] = GEAR_SLOTS.map((slot) => ({
    id: slot,
    slot,
    label: `${slot} candidate`,
    level: 91,
    rarity: "legendary",
    minPhys: 0,
    maxPhys: 0,
    hp: 0,
    physDef: 0,
    words: Array.from({ length: 5 }, () => ({
      word: "",
      value: 0,
      retuned: false,
    })) as GearPiece["words"],
    attunement: "",
    attunementValue: 0,
    relayed: false,
  }))
  return { ...defaultInputs, inventory, equipped: { ...EMPTY_EQUIPPED } }
}
function pending() {
  const posts = workers.flatMap((worker) =>
    worker.posted
      .filter(
        (request): request is Extract<WorkerRequest, { kind: "bestBuild" }> =>
          request.kind === "bestBuild",
      )
      .map((request) => ({ worker, request })),
  )
  return posts.sort((a, b) => b.request.reqId - a.request.reqId)[0]
}
function answer(job = pending()) {
  const equipped = { ...EMPTY_EQUIPPED }
  for (const slot of GEAR_SLOTS) equipped[slot] = slot
  act(() =>
    job.worker.onmessage?.({
      data: {
        kind: "bestBuild",
        reqId: job.request.reqId,
        sourceKey: job.request.sourceKey,
        result: {
          status: "ok",
          equipped,
          currentDps: 100,
          bestDps: 120,
          approximate: false,
          combinations: 1,
          evaluated: 1,
          excludedCandidates: 0,
        },
      },
    }),
  )
}
function panel(inputs: Inputs, onChange: (next: Inputs) => void, profileId = "active") {
  return (
    <I18nProvider>
      <BestBuildPanel
        inputs={inputs}
        optimizerInputs={inputs}
        profileId={profileId}
        onChange={onChange}
      />
    </I18nProvider>
  )
}

describe("Best Build explicit preview and equip flow", () => {
  it("previews every inventory candidate and current/best/delta without equipping until explicit action", () => {
    const inputs = fixture()
    const change = vi.fn()
    render(panel(inputs, change))
    fireEvent.click(screen.getByRole("button", { name: "Find Best Build" }))
    expect(change).not.toHaveBeenCalled()
    answer()
    expect(screen.getByText(/Current DPS: 100.00/)).toBeTruthy()
    expect(screen.getByText(/Best DPS: 120.00/)).toBeTruthy()
    expect(screen.getByText(/DPS delta: 20.00/)).toBeTruthy()
    for (const slot of GEAR_SLOTS)
      expect(screen.getByText(new RegExp(`${slot} candidate`))).toBeTruthy()
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Equip Best Build" }))
    expect(change).toHaveBeenCalledTimes(1)
    for (const slot of GEAR_SLOTS) expect(change.mock.calls[0][0].equipped[slot]).toBe(slot)
    expect(inputs.equipped).toEqual(EMPTY_EQUIPPED)
  })
  it("drops cancelled replies and never retains them for a later mount", () => {
    render(panel(fixture(), vi.fn()))
    fireEvent.click(screen.getByRole("button", { name: "Find Best Build" }))
    const job = pending()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    answer(job)
    expect(screen.queryByRole("button", { name: "Equip Best Build" })).toBeNull()
    expect(retainedResponse("bestBuild")).toBeNull()
  })
  it.each(["profile", "inventory", "rotation"])(
    "rejects stale replies after %s changes, including returning to original inputs",
    (kind) => {
      const inputs = fixture()
      const change = vi.fn()
      const view = render(panel(inputs, change))
      fireEvent.click(screen.getByRole("button", { name: "Find Best Build" }))
      const job = pending()
      const next =
        kind === "inventory"
          ? { ...inputs, inventory: [] }
          : kind === "rotation"
            ? { ...inputs, selectedBuiltinRotationId: "changed" }
            : inputs
      view.rerender(panel(next, change, kind === "profile" ? "other" : "active"))
      answer(job)
      view.rerender(panel(inputs, change))
      expect(screen.queryByRole("button", { name: "Equip Best Build" })).toBeNull()
      expect(change).not.toHaveBeenCalled()
    },
  )
  it("does not retain an abandoned search result after unmount", () => {
    const view = render(panel(fixture(), vi.fn()))
    fireEvent.click(screen.getByRole("button", { name: "Find Best Build" }))
    const job = pending()
    view.unmount()
    answer(job)
    expect(retainedResponse("bestBuild")).toBeNull()
  })
})
