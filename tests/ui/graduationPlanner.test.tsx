// Scoped to synthetic Bellstrike Umbra previews and the shared worker lifecycle.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { GraduationPlannerPanel } from "../../src/ui/features/gear/graduation-planner-panel/GraduationPlannerPanel"
import { GlobalStatBudgetPanel } from "../../src/ui/features/gear/global-stat-budget-panel/GlobalStatBudgetPanel"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { syntheticGraduationInputs } from "../fixtures/syntheticGraduation"
import type { WorkerRequest, WorkerResponse } from "../../src/engine/dpsWorker"
import { retainedResponse } from "../../src/ui/hooks/dpsWorkerClient"
import { planGraduation } from "../../src/engine/graduationPlanner"

const { workers, MockWorker } = vi.hoisted(() => {
  const workers: {
    terminated: boolean
    posted: WorkerRequest[]
    onmessage: ((event: { data: WorkerResponse }) => void) | null
  }[] = []
  class MockWorker {
    terminated = false
    terminate() {
      this.terminated = true
    }
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

function lastJob() {
  const jobs = workers.flatMap((worker) =>
    worker.posted
      .filter(
        (request): request is Extract<WorkerRequest, { kind: "graduationPlanner" }> =>
          request.kind === "graduationPlanner",
      )
      .map((request) => ({ worker, request })),
  )
  return jobs.sort((left, right) => right.request.reqId - left.request.reqId)[0]
}
function answer(
  job: ReturnType<typeof lastJob>,
  reason: "engine-error" | "no-rotation" = "engine-error",
) {
  act(() =>
    job.worker.onmessage?.({
      data: {
        kind: "graduationPlanner",
        reqId: job.request.reqId,
        sourceKey: job.request.sourceKey,
        result: { status: "error", reason },
      },
    }),
  )
}

describe("graduation preview UI", () => {
  it("does not claim there is no DPS improvement when resource costs hide positive alternatives", async () => {
    const inputs = syntheticGraduationInputs()
    render(
      <I18nProvider>
        <GraduationPlannerPanel inputs={inputs} />
      </I18nProvider>,
    )
    const mode = screen.getByRole("combobox")
    fireEvent.keyDown(mode, { key: "Enter" })
    fireEvent.keyDown(mode, { key: "End" })
    fireEvent.keyDown(mode, { key: "Enter" })
    fireEvent.click(screen.getByLabelText("Include legal Retune outcomes"))
    fireEvent.click(screen.getByLabelText("Include hypothetical FARM concepts"))
    fireEvent.click(screen.getByRole("button", { name: "Compare graduation plans" }))
    const job = lastJob()
    expect(job.request.options).toMatchObject({ mode: "actions", retune: false, farm: true })
    const result = await planGraduation(inputs, job.request.options, {
      score: (build) =>
        Object.values(build.equipped).some((id) => id?.startsWith('planner:["farm"')) ? 100 : 0,
    })
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.plans).toEqual([])
    expect(result.strategies.some((plan) => plan.deltaDps > 0)).toBe(true)
    act(() =>
      job.worker.onmessage?.({
        data: {
          kind: "graduationPlanner",
          reqId: job.request.reqId,
          sourceKey: job.request.sourceKey,
          result,
        },
      }),
    )
    expect(
      screen.getByText(
        (text) =>
          text.includes(
            "FARM ceilings (fresh concepts per slot / completions per seed / partial seeds)",
          ) && text.includes("16/16/16"),
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/No alternative qualifies for resource ranking/)).toBeInTheDocument()
    expect(
      screen.queryByText("No evaluated alternative improves modeled DPS. KEEP remains available."),
    ).not.toBeInTheDocument()
  })
  it("shows the loss when an alternative removes a non-target stat entirely", async () => {
    const inputs = syntheticGraduationInputs()
    const pendant = structuredClone(inputs.inventory.find((piece) => piece.slot === "pendant")!)
    pendant.id = "synthetic-no-min-phys"
    pendant.words[4] = { word: "momentum", value: 49.4, retuned: false }
    inputs.inventory.push(pendant)
    render(
      <I18nProvider>
        <GraduationPlannerPanel inputs={inputs} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Compare graduation plans" }))
    const job = lastJob()
    const result = await planGraduation(
      inputs,
      { mode: "budget", retune: false, farm: false, retuneCost: null },
      { score: () => 0 },
    )
    expect(result.status).toBe("ok")
    act(() =>
      job.worker.onmessage?.({
        data: {
          kind: "graduationPlanner",
          reqId: job.request.reqId,
          sourceKey: job.request.sourceKey,
          result,
        },
      }),
    )
    expect(screen.getAllByText(/Min Physical Attack: -1.00/).length).toBeGreaterThan(0)
  })
  it("renders the aggregate baseline, extra stats and separate value diagnostics", () => {
    render(
      <I18nProvider>
        <GlobalStatBudgetPanel inputs={syntheticGraduationInputs()} />
      </I18nProvider>,
    )
    expect(screen.getByText(/31\/40/)).toBeInTheDocument()
    expect(screen.getByText(/Line deficits: 9/)).toBeInTheDocument()
    expect(screen.getByText(/25.30%\/22.00%/)).toBeInTheDocument()
    expect(screen.getByText("Max Formless Attack", { selector: "strong" })).toBeInTheDocument()
    expect(screen.getByText("Derived stats, effective caps and overflow")).toBeInTheDocument()
  })
  it("discards cancellation, input, profile, option and unmount stale replies without storage writes", () => {
    const inputs = syntheticGraduationInputs()
    const storage = vi.spyOn(Storage.prototype, "setItem")
    const tree = (next = inputs, profileId = "synthetic") => (
      <I18nProvider>
        <GraduationPlannerPanel inputs={next} profileId={profileId} />
      </I18nProvider>
    )
    const view = render(tree())
    storage.mockClear()
    const start = () =>
      fireEvent.click(screen.getByRole("button", { name: "Compare graduation plans" }))
    start()
    const cancelled = lastJob()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    answer(cancelled)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(retainedResponse("graduationPlanner")).toBeNull()
    start()
    const prior = lastJob()
    view.rerender(tree({ ...inputs, bowSet: "affinity", dummyMode: !inputs.dummyMode }, "other"))
    answer(prior)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(lastJob().request.reqId).toBeGreaterThan(prior.request.reqId)
    expect(lastJob().request.sourceKey).not.toBe(prior.request.sourceKey)
    start()
    const latest = lastJob()
    expect(latest.request.sourceKey).not.toBe(prior.request.sourceKey)
    answer(latest, "no-rotation")
    expect(screen.getByRole("alert")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Include legal Retune outcomes"))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    start()
    const abandoned = lastJob()
    view.unmount()
    answer(abandoned)
    expect(retainedResponse("graduationPlanner")).toBeNull()
    expect(workers.filter((worker) => worker.terminated).length).toBeGreaterThanOrEqual(3)
    expect(storage).not.toHaveBeenCalled()
    storage.mockRestore()
  })
})
