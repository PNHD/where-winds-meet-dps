// Scoped to Bamboocut Draught (the measured build) and Bellstrike Umbra's
// defaults â€” both validated (CLAUDE.md Â§ "Implemented classes"). Asserts the
// memo changes no answer, never an absolute DPS figure.
import { describe, expect, it } from "vitest"
import * as workerCompute from "../../src/engine/dpsWorker"
import { importProfile } from "../../src/storage"
import { runEngine } from "../../src/engine/dps"
import { withDerivedStats } from "../../src/engine/derivedInputs"
import { applyArmorSet, applyBowSet } from "../../src/engine/panel"
import { defaultInputs } from "../../src/engine/defaults"
import { passKey, withPassMemo } from "../../src/engine/passMemo"
import { rotationOptions } from "../../src/ui/features/rotation/rotationOptions"
import type { EngineRunOptions, Inputs } from "../../src/engine/types"
import profileFile from "./bamboocutDraughtMeasured.profile.json"

const SEED = 7

function workerJobs(inputs: Inputs): Record<string, () => unknown> {
  const engineInputs = applyBowSet(applyArmorSet(withDerivedStats(inputs)))
  const baseline = runEngine(engineInputs)
  const baselineDps = baseline.dps
  const equippedPiece = engineInputs.inventory.find(
    (piece) => engineInputs.equipped[piece.slot] === piece.id,
  )
  const options = rotationOptions(inputs.classId, []).map((option) => ({
    optionId: option.id,
    rotation: option.rotation,
  }))
  const jobs: Record<string, () => unknown> = {
    equippedDeltas: () =>
      workerCompute.computeEquippedDeltas({
        reqId: 1,
        inputs: engineInputs,
        baselineDps,
      }),
    dpsDeltas: () =>
      workerCompute.computeDpsDeltas({
        reqId: 1,
        inputs: engineInputs,
        baselineDps,
        pieceIds: engineInputs.inventory.map((piece) => piece.id),
      }),
    ranking: () =>
      workerCompute.computeRankingRequest({
        reqId: 1,
        inputs: engineInputs,
        baselineDps,
      }),
    gearAnalysis: () =>
      workerCompute.computeGearAnalysisRequest({
        reqId: 1,
        inputs: engineInputs,
        baselineDps,
      }),
    setTiles: () => workerCompute.computeSetTiles({ reqId: 1, inputs }),
    rotationDps: () =>
      workerCompute.computeRotationDps({ reqId: 1, inputs: engineInputs, options }),
    graduation: () => workerCompute.computeGraduation({ reqId: 1, inputs }),
    parseRunDetail: () =>
      workerCompute.computeParseRunDetail({ reqId: 1, inputs, rotation: null, seed: SEED }),
    profileMetrics: () =>
      workerCompute.computeProfileMetrics({
        reqId: 1,
        profiles: [{ id: "profile", inputs }],
        customSkills: [],
        customBuffs: [],
        customDebuffs: [],
      }),
  }
  if (equippedPiece) {
    const pieceId = equippedPiece.id
    jobs.retunement = () =>
      workerCompute.computeRetunement({
        reqId: 1,
        inputs: engineInputs,
        pieceId,
      })
    jobs.reattunement = () =>
      workerCompute.computeReattunement({
        reqId: 1,
        inputs: engineInputs,
        pieceId,
      })
    jobs.wordMax = () =>
      workerCompute.computeWordMax({
        reqId: 1,
        inputs: engineInputs,
        piece: equippedPiece,
      })
  }
  return jobs
}

function optionsKey(options: unknown): string | null {
  return passKey(defaultInputs, options as EngineRunOptions)
}

const measured = importProfile(JSON.stringify(profileFile)).inputs
const parityCases = [measured, { ...defaultInputs, classId: "bellstrikeUmbra" }].flatMap((inputs) =>
  Object.entries(workerJobs(inputs)).map(([kind, job]) => ({ classId: inputs.classId, kind, job })),
)

describe("the per-request pass memo", () => {
  it.each(parityCases)("answers $classId / $kind identically with and without memo", ({ job }) => {
    expect(withPassMemo(job)).toStrictEqual(job())
  })

  it("tells undefined, -0, NaN and Infinity apart from their JSON look-alikes in the pass key", () => {
    const variants: unknown[] = [
      {},
      { seed: undefined },
      { seed: null },
      { seed: 0 },
      { seed: -0 },
      { seed: NaN },
      { seed: Infinity },
      { seed: -Infinity },
      { seed: "NaN" },
      { seed: "Infinity" },
      { seed: "undefined" },
      { qiDamageLog: [] },
      { qiDamageLog: new Map() },
      { qiDamageLog: new Set() },
    ]
    const keys = variants.map(optionsKey)
    expect(new Set(keys).size).toBe(variants.length)
    expect(passKey(defaultInputs, undefined)).not.toBe(optionsKey({}))
  })

  it("bypasses the memo for options JSON cannot key", () => {
    const callback = { onPass: () => {} } as unknown as EngineRunOptions
    expect(passKey(defaultInputs, callback)).toBeNull()
    const inputs = { ...defaultInputs, classId: "bellstrikeUmbra" }
    withPassMemo(() => {
      expect(runEngine(inputs, callback)).not.toBe(runEngine(inputs, callback))
    })
  })

  it("keeps no memo outside a worker request", () => {
    const inputs = { ...defaultInputs, classId: "bellstrikeUmbra" }
    expect(runEngine(inputs)).not.toBe(runEngine(inputs))
    let insideFirst: unknown
    withPassMemo(() => {
      insideFirst = runEngine(inputs)
      expect(runEngine(inputs)).toBe(insideFirst)
    })
    expect(runEngine(inputs)).not.toBe(insideFirst)
  })
})
