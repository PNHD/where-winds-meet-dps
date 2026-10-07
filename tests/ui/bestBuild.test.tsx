import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { defaultInputs } from "../../src/engine/defaults"
import { EMPTY_EQUIPPED, GEAR_SLOTS } from "../../src/engine/types"
import type { GearPiece, Inputs } from "../../src/engine/types"
import type { WorkerRequest, WorkerResponse } from "../../src/engine/dpsWorker"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { BestBuildPanel } from "../../src/ui/features/gear/gear-tab/BestBuildPanel"
import { retainedResponse } from "../../src/ui/hooks/dpsWorkerClient"
import type { BestBuildAdvice, BestBuildItemAdvice } from "../../src/engine/bestBuildAdvisor"

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
function adviceFixture(): Extract<BestBuildAdvice, { status: "ok" }> {
  const items: BestBuildItemAdvice[] = GEAR_SLOTS.map((slot) => ({
    slot,
    pieceId: slot,
    reason: slot === "armor" ? "relayed" : "ok",
    heirloomSwap: null,
    runnerUp: slot === "helm" ? { pieceId: "helm-backup", dps: 115, gap: 5 } : null,
    recommendation:
      slot === "helm"
        ? {
            slotIndex: 2,
            word: "maxPhys",
            legal: true,
            isCurrent: false,
            deltaDps: 183,
            deltaDpsRelayed: 120,
            poolSize: 7,
            pDraw: 1 / 7,
            pImprove: 0.682,
            eDeltaDps: 12.3,
          }
        : null,
  }))
  return { status: "ok", items, first: items.find((item) => item.slot === "helm")! }
}
function answer(job = pending(), advice: BestBuildAdvice = adviceFixture()) {
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
          advice,
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
    const selected = within(screen.getByRole("list", { name: "Selected Best Build items" }))
    for (const slot of GEAR_SLOTS)
      expect(selected.getByText(new RegExp(`${slot} candidate`))).toBeTruthy()
    const advice = within(screen.getByRole("region", { name: "Best Build — Upgrade Advice" }))
    const first = within(advice.getByRole("region", { name: "Best Upgrade First" }))
    expect(first.getByText(/helm candidate/)).toBeTruthy()
    expect(first.getByText(/Slot 3: Empty stat/)).toBeTruthy()
    expect(first.getByText(/Modeled gain at maximum roll: \+183.00 DPS/)).toBeTruthy()
    expect(first.getByText(/Draw chance: 14.3%/)).toBeTruthy()
    expect(first.getByText(/Chance to improve if target is drawn: 68.2%/)).toBeTruthy()
    expect(first.getByText(/Probability-weighted expected gain per draw.*12.30 DPS/)).toBeTruthy()
    expect(advice.getAllByText("Relayed gear cannot be Retuned.")).toHaveLength(2)
    expect(
      advice.getAllByText("No positive legal next Retunement upgrade found for this item.").length,
    ).toBe(12)
    expect(advice.getByText(/Best local replacement.*helm-backup.*5.00 DPS/)).toBeTruthy()
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
  it("shows an explicit no-positive-upgrade state and preserves explicit equip", () => {
    const change = vi.fn()
    render(panel(fixture(), change))
    fireEvent.click(screen.getByRole("button", { name: "Find Best Build" }))
    const advice = adviceFixture()
    advice.items = advice.items.map((item) => ({ ...item, recommendation: null }))
    advice.first = null
    answer(pending(), advice)
    expect(
      screen.getByText("No positive next Retunement upgrade found for this Best Build."),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Equip Best Build" })).toBeTruthy()
    expect(change).not.toHaveBeenCalled()
  })
  it.each(["profile", "inventory", "rotation", "class", "stats", "retunement", "equipment"])(
    "invalidates already visible advice when %s changes",
    (kind) => {
      const inputs = fixture()
      const view = render(panel(inputs, vi.fn()))
      fireEvent.click(screen.getByRole("button", { name: "Find Best Build" }))
      answer()
      expect(screen.getByRole("region", { name: "Best Upgrade First" })).toBeTruthy()
      const next =
        kind === "inventory"
          ? { ...inputs, inventory: [] }
          : kind === "rotation"
            ? { ...inputs, selectedBuiltinRotationId: "changed" }
            : kind === "class"
              ? { ...inputs, classId: "stonesplitStrength" }
              : kind === "stats"
                ? {
                    ...inputs,
                    inventory: inputs.inventory.map((piece, index) =>
                      index === 0 ? { ...piece, maxPhys: 99 } : piece,
                    ),
                  }
                : kind === "retunement"
                  ? {
                      ...inputs,
                      inventory: inputs.inventory.map((piece, index) =>
                        index === 0 ? { ...piece, retunedOutWords: ["crit" as const] } : piece,
                      ),
                    }
                  : kind === "equipment"
                    ? { ...inputs, equipped: { ...inputs.equipped, helm: "helm" } }
                    : inputs
      view.rerender(panel(next, vi.fn(), kind === "profile" ? "other" : "active"))
      expect(screen.queryByRole("region", { name: "Best Upgrade First" })).toBeNull()
      expect(screen.queryByRole("button", { name: "Equip Best Build" })).toBeNull()
      view.rerender(panel(inputs, vi.fn()))
      expect(screen.queryByRole("region", { name: "Best Upgrade First" })).toBeNull()
    },
  )
  it("keeps heirloom guidance visible even alongside a higher DPS recommendation", () => {
    render(panel(fixture(), vi.fn()))
    fireEvent.click(screen.getByRole("button", { name: "Find Best Build" }))
    const advice = adviceFixture()
    advice.items.find((item) => item.slot === "pendant")!.heirloomSwap = {
      slotIndex: 1,
      currentWord: "crit",
      word: "maxPhys",
    }
    answer(pending(), advice)
    expect(screen.getByText("Makes it an heirloom")).toBeTruthy()
    expect(screen.getByText("Makes it an heirloom").closest("details")?.open).toBe(true)
    expect(screen.getByText(/An heirloom is worth more than the last few DPS\./)).toBeTruthy()
    expect(screen.getByRole("region", { name: "Best Upgrade First" })).toBeTruthy()
  })
})
