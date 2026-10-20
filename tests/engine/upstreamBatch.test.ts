// Scoped to the retained Umbra model; parity is not a new measured anchor.
import { describe, expect, it } from "vitest"
import { syntheticGraduationInputs } from "../fixtures/syntheticGraduation"
import { defaultInputs } from "../../src/engine/defaults"
import { runEngine } from "../../src/engine/dps"
import { allSlotsUnequipLoss } from "../../src/engine/gearAnalysis"
import { applyPieceContribution } from "../../src/engine/gearStats"
import { gearWordPoolForLine, gearWordRelayedToLevel } from "../../src/data/stats/gearWordPools"
import { gearWordMaxRoll } from "../../src/data/stats/statLines"
import { AFFIX_ID_TO_STAT_LINE } from "../../src/ui/features/gear/import-gear-dialog/affixStatLineTable"
import { shardRequest, mergeShardResponses } from "../../src/ui/hooks/workerShards"
import {
  computeGearAnalysisRequest,
  computeRankingRequest,
  type WorkerRequest,
  type WorkerResponse,
} from "../../src/engine/dpsWorker"
import { withPassMemo, rememberedPass } from "../../src/engine/passMemo"
import { makeRotation, makeStep } from "../../src/engine/rotation"
import { SKILL } from "../../src/data/skills/mystic/ids"
import { SKILL as UMBRA } from "../../src/data/skills/bellstrike-umbra/ids"

const inputs = { ...defaultInputs, classId: "bellstrikeUmbra" }

describe("pinned upstream adaptations", () => {
  it.each(["ranking", "gearAnalysis"] as const)("preserves %s through ordered shards", (kind) => {
    const synthetic = syntheticGraduationInputs()
    const inventory = synthetic.inventory.slice(0, 2).map((piece) => ({ ...piece, relayed: true }))
    const shardInputs = {
      ...inputs,
      inventory,
      equipped: {
        ...inputs.equipped,
        ...Object.fromEntries(inventory.map((piece) => [piece.slot, piece.id])),
      },
    }
    const request = {
      kind,
      reqId: 1,
      inputs: shardInputs,
      baselineDps: runEngine(shardInputs).dps,
    } as WorkerRequest
    const compute = (req: WorkerRequest): WorkerResponse =>
      req.kind === "ranking"
        ? { kind: req.kind, ...computeRankingRequest(req) }
        : {
            kind: "gearAnalysis",
            ...computeGearAnalysisRequest(req as Extract<WorkerRequest, { kind: "gearAnalysis" }>),
          }
    const complete = withPassMemo(() => compute(request))
    const parts = shardRequest(request, 4)!.map((req) => withPassMemo(() => compute(req)))
    expect(mergeShardResponses(parts)).toStrictEqual(complete)
  })

  it("measures the simultaneous all-slot loss without adding interacting slot losses", () => {
    const inputs = syntheticGraduationInputs()
    const empty = inputs.inventory
      .filter((p) => Object.values(inputs.equipped).includes(p.id))
      .reduce((state, piece) => applyPieceContribution(state, piece, -1), inputs)
    const baseline = runEngine(inputs).dps
    expect(allSlotsUnequipLoss(inputs, baseline)).toBe(baseline - runEngine(empty).dps)
  })

  it("bounds the per-request memo and clears it after exceptions", () => {
    const result = runEngine(inputs)
    let calls = 0
    const compute = (seed: number) =>
      rememberedPass(inputs, { seed }, () => {
        calls++
        return result
      })
    withPassMemo(() => {
      for (let seed = 0; seed < 9; seed++) compute(seed)
      compute(8)
      expect(calls).toBe(9)
      compute(0)
      expect(calls).toBe(10)
    })
    expect(() =>
      withPassMemo(() => {
        throw new Error("probe")
      }),
    ).toThrow("probe")
    compute(8)
    expect(calls).toBe(11)
  })

  it("retains seeded results through the memo", () => {
    expect(withPassMemo(() => runEngine(inputs, { seed: 17 }))).toStrictEqual(
      runEngine(inputs, { seed: 17 }),
    )
  })

  // Official Global 2.3 PathBalance1015, section I.2; ceilings from pinned MIT statLines.ts.
  it("keeps T96 legacy words and permits the new T100 word only on tunement lines", () => {
    expect(gearWordPoolForLine(96, "helm", 1)).not.toContain("allMysticBoost")
    expect(gearWordPoolForLine(100, "helm", 0)).not.toContain("allMysticBoost")
    expect(gearWordPoolForLine(100, "helm", 1)).toContain("allMysticBoost")
    expect(gearWordPoolForLine(100, "helm", 1)).toContain("singleTargetMysticBoost")
    expect(gearWordRelayedToLevel("areaMysticBoost", 96, 100)).toBe("allMysticBoost")
    expect(gearWordRelayedToLevel("areaMysticBoost", 100, 105)).toBe("areaMysticBoost")
    expect(gearWordMaxRoll("allMysticBoost", 96)).toBe(0)
    expect(gearWordMaxRoll("allMysticBoost", 100)).toBe(0.114)
    expect(AFFIX_ID_TO_STAT_LINE["100931001"]).toBe("word:allMysticBoost")
    expect(AFFIX_ID_TO_STAT_LINE["100941001"]).toBe("word:allMysticBoost")
  })

  it("applies All Mystic to mystic damage while preserving an unchanged martial rotation", () => {
    const rotation = makeRotation(inputs.classId, {
      name: "mystic probe",
      steps: [makeStep({ skillId: SKILL.fireBreath1Hit })],
    })
    const mystic = { ...inputs, activeCustomRotation: rotation }
    expect(runEngine({ ...mystic, allMysticBoost: 0.1 }).totalDamage).toBeGreaterThan(
      runEngine(mystic).totalDamage,
    )
    const martial = {
      ...inputs,
      activeCustomRotation: makeRotation(inputs.classId, {
        name: "martial",
        steps: [makeStep({ skillId: UMBRA.swordq })],
      }),
    }
    expect(runEngine(martial).totalDamage).toBeGreaterThan(0)
    expect(runEngine({ ...martial, allMysticBoost: 0.1 }).totalDamage).toBe(
      runEngine(martial).totalDamage,
    )
  })
})
