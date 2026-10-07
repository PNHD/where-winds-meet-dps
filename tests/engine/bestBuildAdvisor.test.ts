import { describe, expect, it } from "vitest"
// Scoped to the active fixture class: directional and parity checks, not damage validation.
import { analyzeBestBuild, bestPositiveRetunement } from "../../src/engine/bestBuildAdvisor"
import { bestBuildDps, findBestBuild } from "../../src/engine/bestBuild"
import { defaultInputs } from "../../src/engine/defaults"
import { activeRotationForInputs } from "../../src/engine/dps"
import { computeRetunement, type RetunementRow } from "../../src/engine/retunementAnalysis"
import { classDefinition } from "../../src/definitions/classes/registry"
import { retuneWeightPool } from "../../src/data/stats/gearRetuneWeights"
import { EMPTY_EQUIPPED, GEAR_SLOTS, type GearPiece, type Inputs } from "../../src/engine/types"

function fixture(): Inputs {
  return {
    ...defaultInputs,
    inventory: GEAR_SLOTS.map((slot) => ({
      id: slot,
      slot,
      label: slot,
      level: 96,
      rarity: "legendary",
      minPhys: 0,
      maxPhys: 0,
      hp: 0,
      physDef: 0,
      words: [
        { word: "maxPhys", value: 50, retuned: false },
        { word: "minPhys", value: 10, retuned: true },
        { word: "", value: 0, retuned: false },
        { word: "", value: 0, retuned: false },
        { word: "", value: 0, retuned: false },
      ] as GearPiece["words"],
      attunement: "",
      attunementValue: 0,
      relayed: slot !== "helm" && slot !== "pendant",
    })),
    equipped: { ...EMPTY_EQUIPPED },
  }
}
async function resultFor(inputs: Inputs) {
  const result = await findBestBuild(inputs)
  if (result.status !== "ok") throw new Error("Fixture must have a Best Build")
  return result
}
async function adviceFor(inputs: Inputs) {
  const advice = await analyzeBestBuild(inputs, await resultFor(inputs))
  if (advice.status !== "ok") throw new Error("Fixture must have advice")
  return advice
}

describe("Best Build next legal Retunement advice", () => {
  it("selects the largest legal next target using the shared analyzer and actual proposed-build DPS", async () => {
    const inputs = fixture()
    const result = await resultFor(inputs)
    const proposed = { ...inputs, equipped: result.equipped }
    const piece = inputs.inventory.find((entry) => entry.id === "helm")!
    const scorePiece = (candidate: GearPiece) =>
      bestBuildDps({
        ...proposed,
        inventory: proposed.inventory.map((entry) => (entry.id === piece.id ? candidate : entry)),
      })
    const rows = computeRetunement(
      { reqId: 1, inputs: proposed, pieceId: piece.id },
      scorePiece,
    ).rows
    const advice = await analyzeBestBuild(inputs, result)
    expect(advice.status).toBe("ok")
    if (advice.status !== "ok") return
    const pick = advice.items.find((item) => item.pieceId === piece.id)!.recommendation!
    expect(pick.deltaDps).toBeGreaterThan(0)
    expect(pick.deltaDps).toBe(
      Math.max(...rows.filter((row) => row.legal && !row.isCurrent).map((row) => row.deltaDps)),
    )
    const line = retuneWeightPool("Bellstrike", piece.level, piece.slot)!.find(
      (entry) => entry.word === pick.word,
    )!
    const words = piece.words.map((entry, index) =>
      index === pick.slotIndex
        ? { word: pick.word, value: line.bands[2].max, retuned: true }
        : entry,
    ) as GearPiece["words"]
    expect(pick.deltaDps).toBeCloseTo(scorePiece({ ...piece, words }) - result.bestDps, 8)
    expect(pick.pDraw).toBeGreaterThan(0)
    expect(pick.pImprove).not.toBeNull()
    expect(pick.eDeltaDps).not.toBeNull()
  })
  it("excludes duplicate targets, retuned-out words, and fixed/non-rerollable lines", async () => {
    const inputs = fixture()
    const helm = inputs.inventory.find((piece) => piece.id === "helm")!
    helm.words[2] = { word: "maxPhys", value: 20, retuned: false }
    helm.retunedOutWords = ["crit"]
    const rows = computeRetunement({ reqId: 1, inputs, pieceId: "helm" }).rows
    expect(rows.length).toBeGreaterThan(0)
    expect(
      rows.every((row) => row.slotIndex === 1 && row.word !== "maxPhys" && row.word !== "crit"),
    ).toBe(true)
    const pick = (await adviceFor(inputs)).items.find(
      (item) => item.pieceId === "helm",
    )!.recommendation!
    expect(pick.slotIndex).toBe(1)
    expect(["maxPhys", "crit"]).not.toContain(pick.word)
  })
  it("never recommends relayed pieces and represents no-positive-upgrade builds", async () => {
    const inputs = fixture()
    inputs.inventory = inputs.inventory.map((piece) => ({ ...piece, relayed: true }))
    const advice = await adviceFor(inputs)
    expect(advice.first).toBeNull()
    expect(advice.items).toHaveLength(8)
    expect(
      advice.items.every((item) => item.reason === "relayed" && item.recommendation === null),
    ).toBe(true)
  })
  it("ranks two selected pieces by positive DPS gain with deterministic ties", async () => {
    const inputs = fixture()
    inputs.inventory.find((piece) => piece.id === "pendant")!.words[1].value = 60
    const advice = await adviceFor(inputs)
    const upgrades = advice.items.filter((item) => item.recommendation)
    expect(upgrades).toHaveLength(2)
    expect(upgrades[0].recommendation!.deltaDps).not.toBeCloseTo(
      upgrades[1].recommendation!.deltaDps,
      5,
    )
    expect(advice.first!.recommendation!.deltaDps).toBe(
      Math.max(...upgrades.map((item) => item.recommendation!.deltaDps)),
    )
    expect(await adviceFor({ ...inputs, inventory: [...inputs.inventory].reverse() })).toEqual(
      advice,
    )
  })
  it("rejects zero, negative, illegal, current and non-finite candidates as upgrades", () => {
    const row: RetunementRow = {
      slotIndex: 1,
      word: "crit",
      legal: true,
      isCurrent: false,
      deltaDps: 0,
      deltaDpsRelayed: 0,
      poolSize: 1,
      pDraw: null,
      pImprove: null,
      eDeltaDps: null,
    }
    const rows = [
      row,
      { ...row, deltaDps: -1 },
      { ...row, deltaDps: 100, legal: false },
      { ...row, deltaDps: 100, isCurrent: true },
      { ...row, deltaDps: Infinity },
    ]
    expect(bestPositiveRetunement(rows)).toBeNull()
    expect(bestPositiveRetunement([...rows, { ...row, deltaDps: 2 }])!.deltaDps).toBe(2)
  })
  it("uses proposed equipment rather than old equipped gear and does not mutate Inputs", async () => {
    const inputs = fixture()
    const result = await resultFor(inputs)
    const before = structuredClone(inputs)
    const emptyEquippedAdvice = await analyzeBestBuild(inputs, result)
    const equippedAdvice = await analyzeBestBuild({ ...inputs, equipped: result.equipped }, result)
    expect(emptyEquippedAdvice).toEqual(equippedAdvice)
    expect(inputs).toEqual(before)
    expect(emptyEquippedAdvice.status).toBe("ok")
  })
  it("changes recommended DPS weighting with the active rotation", async () => {
    const inputs = fixture()
    const rotation = activeRotationForInputs(inputs)!
    const originalAdvice = await adviceFor(inputs)
    const rotatedAdvice = await adviceFor({
      ...inputs,
      activeCustomRotation: {
        ...rotation,
        id: "advice-custom",
        steps: rotation.steps.slice(Math.floor(rotation.steps.length / 2)),
        fixedWindowSec: 120,
      },
    })
    expect(originalAdvice.first).not.toBeNull()
    expect(rotatedAdvice.first).not.toBeNull()
    expect(rotatedAdvice.first!.recommendation!.deltaDps).not.toBeCloseTo(
      originalAdvice.first!.recommendation!.deltaDps,
      5,
    )
  })
  it("preserves heirlooms and the single-attempt budget", async () => {
    const inputs = fixture()
    const target = classDefinition(inputs.classId)!.graduationBuilds[0].gear.find(
      (piece) => piece.slot === "helm",
    )!
    inputs.inventory = inputs.inventory.map((piece) =>
      piece.slot === "helm"
        ? { ...target, id: "helm", relayed: false }
        : piece.slot === "pendant"
          ? { ...piece, level: 86 }
          : piece,
    )
    const advice = await adviceFor(inputs)
    expect(advice.items.find((item) => item.slot === "helm")).toMatchObject({
      reason: "heirloom",
      recommendation: null,
    })
    expect(advice.items.find((item) => item.slot === "pendant")).toMatchObject({
      reason: "spent",
      recommendation: null,
    })
    expect(advice.first).toBeNull()
    expect(computeRetunement({ reqId: 0, inputs, pieceId: "pendant" })).toMatchObject({
      reason: "spent",
      rows: [],
    })
  })
  it("uses shared history restrictions at unweighted levels and leaves unknown probabilities undefined", async () => {
    const inputs = fixture()
    inputs.inventory = inputs.inventory.map((piece) => ({
      ...piece,
      level: 91,
      retunedOutWords: ["crit"],
    }))
    const rows = computeRetunement({ reqId: 0, inputs, pieceId: "helm" }).rows
    expect(rows.some((row) => row.word === "crit" && row.legal)).toBe(false)
    const advice = await adviceFor(inputs)
    const pick = advice.items.find((item) => item.slot === "helm")!.recommendation!
    expect(pick).not.toBeNull()
    expect(pick.word).not.toBe("crit")
    expect(pick.pDraw).toBeNull()
    expect(pick.pImprove).toBeNull()
    expect(pick.eDeltaDps).toBeNull()
  })
  it("scores local replacements with the other seven proposed slots fixed", async () => {
    const inputs = fixture()
    inputs.inventory.push({
      ...inputs.inventory.find((piece) => piece.id === "helm")!,
      id: "helm-alternative",
      words: inputs.inventory
        .find((piece) => piece.id === "helm")!
        .words.map((entry, index) =>
          index === 1 ? { ...entry, value: entry.value + 30 } : entry,
        ) as GearPiece["words"],
    })
    const result = await resultFor(inputs)
    const advice = await analyzeBestBuild(inputs, result)
    expect(advice.status).toBe("ok")
    if (advice.status !== "ok") return
    const item = advice.items.find((entry) => entry.slot === "helm")!
    const runner = item.runnerUp!
    const dps = bestBuildDps({ ...inputs, equipped: { ...result.equipped, helm: runner.pieceId } })
    expect(runner).toEqual({ pieceId: "helm", dps, gap: result.bestDps - dps })
  })
  it("cancels advice between pieces without publishing partial results", async () => {
    const inputs = fixture()
    const result = await resultFor(inputs)
    let checks = 0
    expect(await analyzeBestBuild(inputs, result, () => ++checks > 2)).toEqual({
      status: "cancelled",
    })
  })
})
