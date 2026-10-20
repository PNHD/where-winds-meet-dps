// Scoped to Bellstrike Umbra; synthetic regression, not a measured anchor.
import { describe, expect, it } from "vitest"
import { globalStatBudget } from "../../src/engine/globalStatBudget"
import { graduationInputs } from "../../src/engine/graduation"
import { syntheticGraduationInputs } from "../fixtures/syntheticGraduation"

describe("synthetic whole-build graduation budget", () => {
  it("does not substitute a sole target for an unknown stored target reference", () => {
    const inputs = syntheticGraduationInputs()
    const target = graduationInputs(inputs)!
    inputs.classId = "syntheticBudget"
    inputs.customGraduationBuild = {
      id: "synthetic-target",
      name: "Synthetic target",
      classId: inputs.classId,
      rotationId: "synthetic-rotation",
      set: target.set,
      bowSet: target.bowSet,
      arsenal: target.arsenal,
      createdAt: "",
      updatedAt: "",
      slots: target.inventory.map((piece) => ({
        slot: piece.slot,
        attunement: piece.attunement,
        words: piece.words.map((entry) => entry.word) as unknown as NonNullable<
          typeof inputs.customGraduationBuild
        >["slots"][number]["words"],
      })),
    }
    inputs.graduationBuildId = "unknown-target"
    expect(globalStatBudget(inputs)).toMatchObject({ reason: "no-target" })
  })
  it("returns explicit errors for malformed equipment containers and unknown target level", () => {
    const inputs = syntheticGraduationInputs()
    expect(
      globalStatBudget({ ...inputs, inventory: null as unknown as typeof inputs.inventory }),
    ).toMatchObject({ reason: "invalid-equipment" })
    expect(
      globalStatBudget({
        ...inputs,
        equipped: {} as typeof inputs.equipped,
        inventory: [null as unknown as (typeof inputs.inventory)[number]],
      }),
    ).toMatchObject({ reason: "invalid-equipment" })
    expect(globalStatBudget({ ...inputs, breakthrough: NaN })).toMatchObject({
      reason: "invalid-target",
    })
  })
  it("retains owned duplicate lines when a previous draw excluded the same stat", () => {
    const inputs = syntheticGraduationInputs()
    const helm = inputs.inventory.find((piece) => piece.slot === "helm")!
    helm.retunedOutWords = ["affinity"]
    expect(globalStatBudget(inputs)).toMatchObject({ covered: 31, missing: 9 })
  })
  it("covers 31 of 40 across slots with nine deficits and one excess target Affinity", () => {
    const inputs = syntheticGraduationInputs()
    const before = structuredClone(inputs)
    const budget = globalStatBudget(inputs)
    expect(budget).toMatchObject({
      status: "ok",
      covered: 31,
      targetCount: 40,
      actualTargetCount: 32,
      actualLineCount: 40,
      missing: 9,
    })
    if (budget.status !== "ok") throw new Error(budget.reason)
    const counts = {
      maxPhys: [12, 11],
      power: [8, 6],
      momentum: [8, 4],
      affinity: [5, 6],
      singleTargetMysticBoost: [2, 0],
      allMartialBoost: [2, 2],
      swordBoost: [1, 1],
      damageVsBoss: [2, 2],
    }
    for (const [word, [targetCount, actualCount]] of Object.entries(counts))
      expect(budget.rows.find((row) => row.word === word)).toMatchObject({
        targetCount,
        actualCount,
      })
    expect(budget.rows.find((row) => row.word === "affinity")).toMatchObject({ excess: 1 })
    expect(
      budget.rows
        .find((row) => row.word === "momentum")
        ?.contributors.find((entry) => entry.slot === "leftWeapon")?.count,
    ).toBe(2)
    expect(
      budget.rows
        .find((row) => row.word === "power")
        ?.contributors.find((entry) => entry.slot === "bracer")?.count,
    ).toBe(2)
    expect(inputs).toEqual(before)
  })
  it("separates improved count coverage from the Affinity value shortage", () => {
    const inputs = syntheticGraduationInputs()
    const pendant = inputs.inventory.find((piece) => piece.slot === "pendant")!
    pendant.words[2] = { word: "momentum", value: 49.4, retuned: true }
    const budget = globalStatBudget(inputs)
    expect(budget).toMatchObject({ covered: 32, missing: 8 })
    if (budget.status !== "ok") throw new Error(budget.reason)
    const affinity = budget.rows.find((row) => row.word === "affinity")!
    expect(affinity.actualValue).toBeCloseTo(0.209, 10)
    expect(affinity.targetValue).toBeCloseTo(0.22, 10)
    expect(affinity.valueDeficit).toBeCloseTo(0.011, 10)
  })
  it("counts equally fulfilled global distributions despite different slot templates", () => {
    const inputs = graduationInputs(syntheticGraduationInputs())!
    const left = inputs.inventory.find((piece) => piece.slot === "leftWeapon")!
    const right = inputs.inventory.find((piece) => piece.slot === "rightWeapon")!
    const sword = left.words.find((entry) => entry.word === "swordBoost")!
    const affinity = right.words.find((entry) => entry.word === "affinity")!
    const copy = { ...sword }
    Object.assign(sword, affinity)
    Object.assign(affinity, copy)
    expect(globalStatBudget(inputs)).toMatchObject({ covered: 40, missing: 0 })
  })
  it("fails explicitly on missing target, incomplete equipment, malformed rolls and wrong first line", () => {
    const inputs = syntheticGraduationInputs()
    expect(globalStatBudget({ ...inputs, graduationBuildId: "missing" })).toMatchObject({
      reason: "no-target",
    })
    expect(
      globalStatBudget({ ...inputs, equipped: { ...inputs.equipped, helm: null } }),
    ).toMatchObject({ reason: "invalid-equipment" })
    for (const value of [NaN, -1, 1000]) {
      const invalid = structuredClone(inputs)
      invalid.inventory[0].words[0].value = value
      expect(globalStatBudget(invalid)).toMatchObject({ reason: "invalid-equipment" })
    }
    inputs.inventory[0].words[0].word = "power"
    expect(globalStatBudget(inputs)).toMatchObject({ reason: "invalid-equipment" })
  })
})
