// Scoped to Bellstrike Umbra; synthetic regression and canonical-engine parity.
import { describe, expect, it, vi } from "vitest"
import * as bestBuild from "../../src/engine/bestBuild"
import { planGraduation, type PlannerOptions } from "../../src/engine/graduationPlanner"
import { globalStatBudget, validPlannerPiece } from "../../src/engine/globalStatBudget"
import { bestBuildDps, BEST_BUILD_LIMITS } from "../../src/engine/bestBuild"
import { relayedCapValue } from "../../src/engine/gearStats"
import { GEAR_WORD_UNIT } from "../../src/data/stats/statLines"
import { activeRotationForInputs } from "../../src/engine/dps"
import { graduationInputs } from "../../src/engine/graduation"
import { syntheticGraduationInputs } from "../fixtures/syntheticGraduation"
import type { GearPiece, Inputs } from "../../src/engine/types"

const inventoryOnly: PlannerOptions = {
  mode: "budget",
  retune: false,
  farm: false,
  retuneCost: null,
}

function spareInputs(): Inputs {
  const inputs = syntheticGraduationInputs()
  const pendant = structuredClone(inputs.inventory.find((piece) => piece.slot === "pendant")!)
  pendant.id = "synthetic-spare-pendant"
  pendant.words[2] = { word: "power", value: 49.4, retuned: false }
  const spear = structuredClone(inputs.inventory.find((piece) => piece.slot === "rightWeapon")!)
  spear.id = "synthetic-epic-relayed-spear"
  spear.rarity = "epic"
  spear.relayed = true
  spear.words[4] = { word: "momentum", value: 49.4, retuned: false }
  spear.words.forEach((entry) => {
    if (entry.word) entry.value = relayedCapValue(entry.value, GEAR_WORD_UNIT[entry.word])
  })
  inputs.inventory.push(pendant, spear)
  return inputs
}

describe("bounded multi-action graduation plans", () => {
  it("orders interacting upgrades to avoid an unnecessary temporary DPS loss", async () => {
    const inputs = spareInputs()
    const score = (build: Inputs) =>
      build.equipped.pendant === "synthetic-spare-pendant"
        ? build.equipped.rightWeapon === "synthetic-epic-relayed-spear"
          ? 30
          : 10
        : build.equipped.rightWeapon === "synthetic-epic-relayed-spear"
          ? -20
          : 0
    const result = await planGraduation(inputs, { ...inventoryOnly, mode: "dps" }, { score })
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.plans[0].steps.map((step) => step.deltaDps)).toEqual([10, 30])
    expect(result.plans[0].actions.map((action) => action.slot)).toEqual(["pendant", "rightWeapon"])
  })
  it("ranks user-assumed material costs and leaves unknown costs out of resource ranking", async () => {
    const inputs = syntheticGraduationInputs()
    for (const piece of inputs.inventory) {
      piece.relayed = true
      piece.words.forEach((entry) => {
        if (entry.word) entry.value = relayedCapValue(entry.value, GEAR_WORD_UNIT[entry.word])
      })
    }
    const pendant = inputs.inventory.find((piece) => piece.slot === "pendant")!
    pendant.relayed = false
    pendant.words[2].retuned = true
    const score = (build: Inputs) =>
      build.equipped.pendant?.includes('"retune"')
        ? 100
        : build.equipped.pendant?.includes('"farm"')
          ? 90
          : 0
    const options: PlannerOptions = {
      ...inventoryOnly,
      mode: "actions",
      retune: true,
      farm: true,
      retuneCost: 1,
      retuneAttempts: 1,
      farmCost: 20,
    }
    const cheap = await planGraduation(inputs, options, { score }),
      costly = await planGraduation(inputs, { ...options, retuneCost: 1000 }, { score }),
      unknown = await planGraduation(
        inputs,
        { ...options, retuneCost: null, farmCost: null },
        { score },
      )
    if (cheap.status !== "ok" || costly.status !== "ok" || unknown.status !== "ok")
      throw new Error("Invalid result")
    expect(cheap.plans[0].costs.retuneOutcomes).toBeGreaterThan(0)
    expect(costly.plans[0].costs.retuneOutcomes).toBe(0)
    expect(costly.plans[0].costs.farmPieces).toBeGreaterThan(0)
    expect(unknown.plans).toEqual([])
    expect(unknown.hasDpsImprovement).toBe(true)
    expect(cheap.expectedSpend).toBeNull()
  })
  it("compares an observed partial seed with whole-build hypothetical completions without changing its rolls", async () => {
    const inputs = syntheticGraduationInputs(),
      seed = structuredClone(inputs.inventory.find((piece) => piece.slot === "armor")!)
    seed.id = "synthetic-partial-seed"
    seed.words[4] = { word: "", value: 0, retuned: false }
    inputs.inventory.push(seed)
    const before = structuredClone(inputs)
    const result = await planGraduation(
      inputs,
      { ...inventoryOnly, mode: "dps", farm: true },
      { score: (build) => (build.equipped.armor?.startsWith('planner:["partial"') ? 100 : 0) },
    )
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.partials[0]).toMatchObject({
      stopDps: 0,
      decision: "KEEP",
      completion: { deltaDps: 100 },
    })
    expect(
      result.partials[0].completion?.equipment.find((piece) => piece.slot === "armor")?.words[0],
    ).toEqual(seed.words[0])
    expect(result.odds).toBeNull()
    expect(inputs).toEqual(before)
  })
  it("compares partial completion with matched stop and keep builds instead of borrowing other-slot gains", async () => {
    const inputs = syntheticGraduationInputs(),
      seed = structuredClone(inputs.inventory.find((piece) => piece.slot === "armor")!),
      spare = structuredClone(inputs.inventory.find((piece) => piece.slot === "pendant")!)
    seed.id = "synthetic-partial-seed"
    seed.words[4] = { word: "", value: 0, retuned: false }
    spare.id = "synthetic-other-slot-upgrade"
    inputs.inventory.push(seed, spare)
    const score = (build: Inputs) =>
      100 +
      (build.equipped.pendant === spare.id ? 100 : 0) -
      (build.equipped.armor?.startsWith('planner:["partial"') ? 10 : 0)
    const result = await planGraduation(
      inputs,
      { ...inventoryOnly, mode: "dps", farm: true },
      { score },
    )
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.partials[0]).toMatchObject({
      stopDps: 200,
      keepDps: 200,
      completion: { dps: 190 },
      decision: "UNKNOWN",
    })
    const observed = await planGraduation(
      inputs,
      { ...inventoryOnly, mode: "dps", farm: true },
      {
        score: (build) =>
          build.equipped.armor === seed.id
            ? 300
            : build.equipped.armor?.startsWith('planner:["partial"')
              ? 200
              : 100,
      },
    )
    if (observed.status !== "ok") throw new Error(observed.status)
    expect(observed.partials[0]).toMatchObject({
      stopDps: 300,
      completion: { dps: 200 },
      decision: "UNKNOWN",
    })
  })
  it("keeps missing partial material costs UNKNOWN even when search reports exact enumeration", async () => {
    const inputs = syntheticGraduationInputs()
    const words = ["maxPhys", "power", "momentum", "affinity"] as const
    const target = graduationInputs(inputs)!
    const first = (slot: string) =>
      slot === "armor" || slot === "helm"
        ? ("affinity" as const)
        : slot === "bracer" || slot === "greaves"
          ? ("power" as const)
          : ("maxPhys" as const)
    inputs.customGraduationBuild = {
      id: "synthetic-four-stat-target",
      name: "Synthetic exact-decision target",
      classId: inputs.classId,
      slots: target.inventory.map((piece) => ({
        slot: piece.slot,
        words: [first(piece.slot), ...words],
        attunement: piece.attunement,
      })),
      set: null,
      bowSet: null,
      arsenal: "bellstrike",
      rotationId: inputs.selectedBuiltinRotationId!,
      createdAt: "synthetic",
      updatedAt: "synthetic",
    }
    inputs.graduationBuildId = inputs.customGraduationBuild.id
    const seed = structuredClone(inputs.inventory.find((piece) => piece.slot === "armor")!)
    seed.id = "synthetic-partial-seed"
    seed.words[4] = { word: "", value: 0, retuned: false }
    inputs.inventory.push(seed)
    const find = bestBuild.findBestBuild
    const exact = vi.spyOn(bestBuild, "findBestBuild").mockImplementation(async (...args) => {
      const result = await find(...args)
      return result.status === "ok" ? { ...result, approximate: false } : result
    })
    try {
      const result = await planGraduation(
        inputs,
        { ...inventoryOnly, mode: "actions", farm: true },
        { score: (build) => (build.equipped.armor?.startsWith('planner:["partial"') ? 100 : 0) },
      )
      if (result.status !== "ok") throw new Error(result.status)
      expect(result.approximate).toBe(false)
      expect(result.partials[0]).toMatchObject({
        decision: "UNKNOWN",
        completion: { dps: 100, costs: { scenarioMaterialCost: null } },
      })
    } finally {
      exact.mockRestore()
    }
  })
  it("breaks equal plan ties by raw item-ID code points", async () => {
    const inputs = spareInputs()
    const spare = inputs.inventory.find((piece) => piece.id === "synthetic-spare-pendant")!
    inputs.inventory = inputs.inventory.filter(
      (piece) => piece.id !== "synthetic-epic-relayed-spear",
    )
    spare.id = "\n"
    inputs.inventory.push({ ...spare, id: " " })
    const result = await planGraduation(inputs, inventoryOnly, { score: () => 0 })
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.plans[0].equipment.find((piece) => piece.slot === "pendant")?.id).toBe("\n")
  })
  it("reaches nine-to-eight-to-seven deficits while retaining signed DPS losses and KEEP", async () => {
    const inputs = spareInputs()
    const original = structuredClone(inputs)
    const score = (build: Inputs) =>
      -(build.equipped.pendant === "synthetic-spare-pendant" ? 5 : 0) -
      (build.equipped.rightWeapon === "synthetic-epic-relayed-spear" ? 20 : 0)
    const result = await planGraduation(inputs, inventoryOnly, { score })
    expect(result).toMatchObject({
      status: "ok",
      approximate: false,
      combinations: 4,
      keep: { budget: { missing: 9 }, deltaDps: 0 },
    })
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.plans[0]).toMatchObject({
      budget: { missing: 7 },
      deltaDps: -25,
      costs: {
        swaps: 2,
        retuneOutcomes: 0,
        farmPieces: 0,
        conditionalRetuneCost: 0,
        expectedSpend: null,
      },
    })
    expect(
      result.plans.find(
        (plan) =>
          plan.equipment.some((piece) => piece.id === "synthetic-spare-pendant") &&
          plan.actions.length === 1,
      )?.budget.missing,
    ).toBe(8)
    expect(result.plans[0].steps.map((step) => step.deltaDps)).toEqual([-5, -25])
    const dps = await planGraduation(inputs, { ...inventoryOnly, mode: "dps" }, { score })
    if (dps.status !== "ok") throw new Error(dps.status)
    expect(dps.plans[0].deltaDps).toBe(-5)
    expect(dps.keep.deltaDps).toBe(0)
    expect(inputs).toEqual(original)
  })
  it("finds interacting swaps that are individually worse without adding marginal DPS", async () => {
    const inputs = spareInputs()
    const score = (build: Inputs) => {
      const pendant = build.equipped.pendant === "synthetic-spare-pendant"
      const spear = build.equipped.rightWeapon === "synthetic-epic-relayed-spear"
      return pendant && spear ? 100 : pendant || spear ? -1 : 0
    }
    const result = await planGraduation(inputs, { ...inventoryOnly, mode: "dps" }, { score })
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.plans[0]).toMatchObject({ deltaDps: 100 })
    expect(result.plans[0].actions).toHaveLength(2)
    expect(result.plans[0].steps.map((step) => step.deltaDps)).toEqual([-1, 100])
  })
  it("matches complete canonical engine evaluations on the active custom rotation", async () => {
    const inputs = spareInputs()
    inputs.activeCustomRotation = {
      ...activeRotationForInputs(inputs)!,
      id: "synthetic-active",
      fixedWindowSec: 45,
    }
    const result = await planGraduation(inputs, inventoryOnly)
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.keep.dps).toBe(bestBuildDps(inputs))
    for (const plan of result.plans) {
      const equipped = Object.fromEntries(
        plan.equipment.map((piece) => [piece.slot, piece.id]),
      ) as Inputs["equipped"]
      expect(plan.dps).toBe(bestBuildDps({ ...inputs, equipped }))
      expect(plan.deltaDps).toBe(plan.dps - result.keep.dps)
      expect(plan.steps.at(-1)?.dps).toBe(plan.dps)
    }
  })
  it("keeps a scarce mystic redistribution count-neutral", () => {
    const inputs = syntheticGraduationInputs()
    const armor = inputs.inventory.find((piece) => piece.slot === "armor")!
    armor.words[2] = { word: "singleTargetMysticBoost", value: 0.098, retuned: false }
    expect(globalStatBudget(inputs)).toMatchObject({ covered: 31, missing: 9 })
  })
  it("reuses Retune locks, history, relay and exhaustion and accepts only valid outcomes", async () => {
    const inputs = syntheticGraduationInputs()
    for (const piece of inputs.inventory) {
      piece.words.forEach((entry) => {
        if (entry.word) entry.value = relayedCapValue(entry.value, GEAR_WORD_UNIT[entry.word])
      })
      piece.relayed = true
    }
    const pendant = inputs.inventory.find((piece) => piece.slot === "pendant")!
    pendant.relayed = false
    pendant.words[2].retuned = true
    pendant.retunedOutWords = ["momentum"]
    const result = await planGraduation(
      inputs,
      { ...inventoryOnly, retune: true },
      { score: (build) => (globalStatBudget(build).status === "ok" ? 0 : NaN) },
    )
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.plans.length).toBeGreaterThan(0)
    for (const plan of result.plans)
      for (const action of plan.actions) {
        expect(action).toMatchObject({ kind: "RETUNE", slot: "pendant", line: 2 })
        expect(action.word).not.toBe("momentum")
        expect(validPlannerPiece(action.piece)).toBe(true)
        expect(action.piece.words[0]).toEqual(pendant.words[0])
      }
    const heirs = graduationInputs(syntheticGraduationInputs())!
    expect(
      await planGraduation(heirs, { ...inventoryOnly, retune: true }, { score: () => 0 }),
    ).toMatchObject({ status: "ok", plans: [] })
  })
  it("bounds first-line-only completions separately for multiple seeds in one slot", async () => {
    const inputs = syntheticGraduationInputs()
    const sword = inputs.inventory.find((piece) => piece.slot === "leftWeapon")!
    const seeds = ["synthetic-first-line-a", "synthetic-first-line-b"].map((id) => ({
      ...structuredClone(sword),
      id,
      label: id,
      relayed: false,
      retunedOutWords: [],
      words: sword.words.map((entry, index) =>
        index === 0 ? { ...entry } : { word: "", value: 0, retuned: false },
      ) as GearPiece["words"],
    }))
    inputs.inventory.push(...seeds)
    const before = structuredClone(inputs)
    const generated = new Map<string, GearPiece>()
    const result = await planGraduation(
      inputs,
      { ...inventoryOnly, farm: true },
      {
        score: (build) => {
          for (const piece of build.inventory)
            if (
              seeds.some((seed) => seed.label === piece.label) &&
              piece.words.every((entry) => entry.word)
            )
              generated.set(piece.id, piece)
          return 0
        },
      },
    )
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.partials).toHaveLength(2)
    expect(result.generationTruncated).toBe(true)
    for (const seed of seeds) {
      const completions = [...generated.values()].filter((piece) => piece.label === seed.label)
      expect(completions).toHaveLength(16)
      for (const piece of completions) {
        expect(validPlannerPiece(piece)).toBe(true)
        expect(piece.words[0]).toEqual(seed.words[0])
      }
    }
    expect(generated.size).toBe(32)
    expect(inputs).toEqual(before)
  })
  it("bounds FARM concepts, honors pools and leaves every probability and expected spend unknown", async () => {
    const inputs = syntheticGraduationInputs()
    const result = await planGraduation(
      inputs,
      { ...inventoryOnly, farm: true },
      { score: () => 0 },
    )
    if (result.status !== "ok") throw new Error(result.status)
    expect(result.approximate).toBe(true)
    expect(result.odds).toBeNull()
    expect(result.expectedSpend).toBeNull()
    expect(result.evaluated).toBeLessThanOrEqual(BEST_BUILD_LIMITS.plannerEvaluations)
    expect(result.routeEvaluated).toBeLessThanOrEqual(BEST_BUILD_LIMITS.routeEvaluations)
    expect(result.plans.some((plan) => plan.costs.farmPieces > 0)).toBe(true)
    for (const plan of result.plans)
      for (const action of plan.actions) expect(validPlannerPiece(action.piece)).toBe(true)
  })
  it("cancels after yielding, is deterministic under inventory reorder and fails closed on malformed data", async () => {
    const inputs = spareInputs()
    const first = await planGraduation(inputs, inventoryOnly, { score: () => 0 })
    const reversed = await planGraduation(
      { ...inputs, inventory: [...inputs.inventory].reverse() },
      inventoryOnly,
      { score: () => 0 },
    )
    expect(first).toEqual(reversed)
    let cancelled = false
    const pending = planGraduation(
      inputs,
      { ...inventoryOnly, retune: true, farm: true },
      { score: () => 0, cancelled: () => cancelled },
    )
    setTimeout(() => {
      cancelled = true
    }, 0)
    expect(await pending).toEqual({ status: "cancelled" })
    expect(await planGraduation(inputs, { ...inventoryOnly, retuneCost: -1 })).toMatchObject({
      reason: "invalid-cost",
    })
    expect(await planGraduation(inputs, inventoryOnly, { score: () => NaN })).toMatchObject({
      reason: "engine-error",
    })
  })
})
