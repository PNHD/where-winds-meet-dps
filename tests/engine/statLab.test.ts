// Scoped to validated Bellstrike Umbra and Bellstrike Splendor; parity asserts model consistency.
import { describe, expect, it } from "vitest"
import { defaultInputs } from "../../src/engine/defaults"
import { activeRotationForInputs, runEngine } from "../../src/engine/dps"
import { withDerivedStats } from "../../src/engine/derivedInputs"
import { applyArmorSet, applyBowSet } from "../../src/engine/panel"
import { builtinRotationsForClass, builtinSkillsForClass } from "../../src/engine/builtinLibrary"
import { gearLevelForBreakthrough } from "../../src/definitions/baseStats/breakthroughs"
import { gearWordMaxRoll } from "../../src/data/stats/statLines"
import { computeRanking, getWordSpecs } from "../../src/engine/itemRanking"
import {
  compareStatPriority,
  computeStatLab,
  statLabOptions,
  unavailableStatKeys,
  STAT_LAB_MAX_CHANGES,
} from "../../src/engine/statLab"
import { GEAR_SLOTS, EMPTY_EQUIPPED } from "../../src/engine/types"
import { gearWordPoolForLine } from "../../src/data/stats/gearWordPools"
import type { GearPiece, Inputs } from "../../src/engine/types"

const configInputs = { ...defaultInputs, classId: "bellstrikeUmbra", breakthrough: 20 }
function fixture(config = configInputs) {
  return applyBowSet(applyArmorSet(withDerivedStats(config)))
}
const inputs = fixture()

describe("Unified Stat Lab", () => {
  it.each(
    ["bellstrikeUmbra", "bellstrikeSplendor"].flatMap((classId) =>
      ["Spear", "Sword", "both", "empty"].map((weapon) => ({ classId, weapon })),
    ),
  )(
    "keeps unique catalogue identities for $classId / $weapon rotations",
    async ({ classId, weapon }) => {
      const config = { ...configInputs, classId }
      const rotation = activeRotationForInputs(config)!
      const skills = builtinSkillsForClass(classId)
      const custom = {
        ...rotation,
        steps: rotation.steps.filter(
          (step) =>
            weapon === "both" ||
            skills.find((skill) => skill.id === step.skillId)?.weaponOrAttribute === weapon,
        ),
      }
      if (weapon !== "empty") expect(custom.steps.length).toBeGreaterThan(0)
      const build = fixture({ ...config, activeCustomRotation: custom })
      const words = getWordSpecs(build, gearLevelForBreakthrough(build.breakthrough))
      expect(new Set(words.map((spec) => spec.word)).size).toBe(words.length)
      const options = statLabOptions(build)
      const optionKeys = options.map((spec) => `${spec.source}:${spec.word}`)
      expect(new Set(optionKeys).size).toBe(optionKeys.length)
      expect(
        options.filter((spec) => spec.word === "spearBoost" && spec.source === "tunement"),
      ).toHaveLength(1)
      if (weapon !== "Spear") {
        expect(
          options.filter((spec) => spec.word === "swordBoost" && spec.source === "tunement"),
        ).toHaveLength(1)
      }
      const ranking = computeRanking(build, runEngine(build).dps)
      const rankingKeys = ranking.map((row) => `${row.source}:${row.statLineId}`)
      expect(new Set(rankingKeys).size).toBe(rankingKeys.length)
      const before = JSON.stringify(build)
      const storage = JSON.stringify(localStorage)
      const boost = options.find(
        (spec) => spec.source === "tunement" && spec.word === "spearBoost",
      )!
      const result = await computeStatLab(build, [
        { source: "tunement", statLineId: "spearBoost", amount: boost.amount },
      ])
      if (result.status !== "ok") throw new Error("missing result")
      const keys = result.rows.map((row) => `${row.source}:${row.statLineId}`)
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.filter((key) => key === "tunement:spearBoost")).toHaveLength(1)
      const expected = runEngine({ ...build, spearBoost: build.spearBoost + boost.amount }).dps
      expect(result.baselineDps).toBe(runEngine(build).dps)
      expect(result.hypotheticalDps).toBe(expected)
      expect(result.deltaDps).toBe(expected - result.baselineDps)
      expect(
        result.rows.find((row) => row.source === "tunement" && row.statLineId === "spearBoost")
          ?.expectedDps,
      ).toBe(expected)
      if (weapon === "empty") {
        expect(result.baselineDps).toBe(0)
        expect(result.hypotheticalDps).toBe(0)
        expect(result.deltaPercent).toBeNull()
        expect(result.rows.every((row) => row.dpsDelta === 0)).toBe(true)
      }
      const signed = await computeStatLab(build, [
        { source: "tunement", statLineId: "spearBoost", amount: boost.amount },
        { source: "tunement", statLineId: "crit", amount: -0.01 },
      ])
      if (signed.status !== "ok") throw new Error("missing signed result")
      expect(signed.hypotheticalDps).toBe(
        runEngine({
          ...build,
          spearBoost: build.spearBoost + boost.amount,
          critRate: build.critRate - 0.01,
        }).dps,
      )
      expect(JSON.stringify(build)).toBe(before)
      expect(JSON.stringify(localStorage)).toBe(storage)
    },
  )

  it("matches actual complete-engine baseline, increments and existing stat ranking", async () => {
    const result = await computeStatLab(inputs, [])
    expect(result.status).toBe("ok")
    if (result.status !== "ok") throw new Error("missing result")
    expect(result.baselineDps).toBe(runEngine(inputs).dps)
    const previous = computeRanking(inputs, result.baselineDps)
    for (const row of result.rows) {
      const spec = statLabOptions(inputs).find(
        (option) => option.source === row.source && option.word === row.statLineId,
      )!
      expect(row.expectedDps).toBe(runEngine(spec.apply(inputs)).dps)
      expect(row.dpsDelta).toBe(row.expectedDps - result.baselineDps)
      expect(
        previous.find((entry) => entry.source === row.source && entry.statLineId === row.statLineId)
          ?.dpsDelta,
      ).toBe(row.dpsDelta)
    }
    expect(result.rows).toEqual([...result.rows].sort(compareStatPriority))
    const tied = result.rows.filter((row) => row.dpsDelta === 0)
    expect([...tied].reverse().sort(compareStatPriority)).toEqual(tied)
  })

  it("evaluates all eight equipped slots and retains their contributions during preview", async () => {
    const level = gearLevelForBreakthrough(configInputs.breakthrough)
    const inventory: GearPiece[] = GEAR_SLOTS.map((slot) => {
      const word = gearWordPoolForLine(level, slot, 0)[0]
      return {
        id: slot,
        slot,
        label: slot,
        level,
        rarity: "legendary",
        minPhys: 0,
        maxPhys: 0,
        hp: 0,
        physDef: 0,
        words: [
          { word, value: gearWordMaxRoll(word, level) / 2, retuned: false },
          { word: "", value: 0, retuned: false },
          { word: "", value: 0, retuned: false },
          { word: "", value: 0, retuned: false },
          { word: "", value: 0, retuned: false },
        ],
        attunement: "",
        attunementValue: 0,
        relayed: false,
      }
    })
    const equipped = { ...EMPTY_EQUIPPED }
    for (const slot of GEAR_SLOTS) equipped[slot] = slot
    const full = fixture({ ...configInputs, inventory, equipped })
    const spec = statLabOptions(full).find((option) => option.word === "crit")!
    const original = JSON.stringify(full)
    const result = await computeStatLab(full, [
      { source: spec.source, statLineId: spec.word, amount: spec.amount },
    ])
    if (result.status !== "ok") throw new Error("missing result")
    expect(result.baselineDps).toBe(runEngine(full).dps)
    expect(result.hypotheticalDps).toBe(runEngine(spec.apply(full)).dps)
    expect(result.baselineDps).not.toBe(runEngine(inputs).dps)
    expect(JSON.stringify(full)).toBe(original)
  })

  it("evaluates combined signed stat changes together rather than adding marginal deltas", async () => {
    const specs = statLabOptions(inputs)
    const power = specs.find((spec) => spec.word === "power")!
    const crit = specs.find((spec) => spec.word === "crit")!
    const changes = [
      { source: power.source, statLineId: power.word, amount: power.amount },
      { source: crit.source, statLineId: crit.word, amount: -crit.amount / 2 },
    ]
    const result = await computeStatLab(inputs, changes)
    if (result.status !== "ok") throw new Error("missing result")
    const expected = runEngine(crit.apply(power.apply(inputs, power.amount), -crit.amount / 2)).dps
    expect(result.hypotheticalDps).toBe(expected)
    expect(result.deltaDps).toBe(expected - result.baselineDps)
    expect(result.deltaPercent).toBe((result.deltaDps / result.baselineDps) * 100)
  })

  it("uses level-specific definitions and exposes unavailable mappings without inventing caps", async () => {
    const level = gearLevelForBreakthrough(inputs.breakthrough)
    expect(statLabOptions(inputs).find((spec) => spec.word === "crit")?.amount).toBe(
      gearWordMaxRoll("crit", level),
    )
    expect(
      statLabOptions(fixture({ ...configInputs, breakthrough: 13 })).find(
        (spec) => spec.word === "crit",
      )?.amount,
    ).not.toBe(gearWordMaxRoll("crit", level))
    expect(unavailableStatKeys(inputs).length).toBeGreaterThan(0)
    const result = await computeStatLab(inputs, [])
    if (result.status !== "ok") throw new Error("missing result")
    expect(result.rows.some((row) => row.dpsDelta === 0)).toBe(true)
    expect(result.rows.every((row) => row.amount > 0 && Number.isFinite(row.amount))).toBe(true)
  })

  it.each(["unknown-stat", "body"])("rejects unsupported %s", async (statLineId) => {
    expect(await computeStatLab(inputs, [{ source: "tunement", statLineId, amount: 1 }])).toEqual({
      status: "error",
      reason: "invalid-change",
    })
  })

  it("rejects nonfinite, excessive, duplicate and over-budget changes", async () => {
    const spec = statLabOptions(inputs)[0]
    const change = { source: spec.source, statLineId: spec.word, amount: spec.amount }
    for (const amount of [NaN, Infinity, spec.amount + 1, -spec.amount - 1])
      expect(await computeStatLab(inputs, [{ ...change, amount }])).toEqual({
        status: "error",
        reason: "invalid-change",
      })
    expect(await computeStatLab(inputs, [change, change])).toEqual({
      status: "error",
      reason: "invalid-change",
    })
    expect(
      await computeStatLab(
        inputs,
        Array.from({ length: STAT_LAB_MAX_CHANGES + 1 }, () => change),
      ),
    ).toEqual({ status: "error", reason: "invalid-change" })
  })

  const rotations = builtinRotationsForClass(inputs.classId)
  const variants: [string, Inputs][] = [
    ["class", fixture({ ...configInputs, classId: "bellstrikeSplendor" })],
    ["profile stats", { ...inputs, phys: { ...inputs.phys, max: inputs.phys.max + 200 } }],
    [
      "rotation",
      { ...inputs, activeCustomRotation: null, selectedBuiltinRotationId: rotations[1].id },
    ],
    ["scenario", { ...inputs, dummyMode: !inputs.dummyMode }],
    ["sets", fixture({ ...configInputs, set: null, bowSet: "crit" })],
    ["buffs", { ...inputs, food: !inputs.food }],
    [
      "Inner Ways",
      fixture({
        ...configInputs,
        mindMethods: [
          { name: "Sword Morph", stacks: "tier 6" },
          { name: "", stacks: "" },
          { name: "", stacks: "" },
          { name: "", stacks: "" },
        ],
      }),
    ],
  ]
  it.each(variants)("responds to active %s", async (_name, variant) => {
    const base = await computeStatLab(inputs, [])
    const result = await computeStatLab(variant, [])
    if (base.status !== "ok" || result.status !== "ok") throw new Error("missing result")
    expect(result.baselineDps).toBe(runEngine(variant).dps)
    expect(result.rows).not.toEqual(base.rows)
  })

  it("handles an empty rotation and zero DPS without a fabricated percentage", async () => {
    const rotation = builtinRotationsForClass(inputs.classId)[0]
    const result = await computeStatLab(
      { ...inputs, activeCustomRotation: { ...rotation, steps: [] } },
      [],
    )
    if (result.status !== "ok") throw new Error("missing result")
    expect(result.baselineDps).toBe(0)
    expect(result.deltaPercent).toBeNull()
    expect(result.rows.every((row) => row.dpsDelta === 0)).toBe(true)
  })

  it("cancels before evaluation and between yielded increments", async () => {
    expect(await computeStatLab(inputs, [], () => true)).toEqual({ status: "cancelled" })
    let checks = 0
    expect(await computeStatLab(inputs, [], () => ++checks > 2)).toEqual({ status: "cancelled" })
    expect(checks).toBe(3)
  })

  it("never mutates original Inputs, nested equipment or storage", async () => {
    const original = JSON.stringify(inputs)
    localStorage.setItem("stat-lab-test", "unchanged")
    const storage = JSON.stringify(localStorage)
    const spec = statLabOptions(inputs)[0]
    await computeStatLab(inputs, [
      { source: spec.source, statLineId: spec.word, amount: spec.amount },
    ])
    expect(JSON.stringify(inputs)).toBe(original)
    expect(JSON.stringify(localStorage)).toBe(storage)
    expect(runEngine(inputs).dps).toBe(runEngine(JSON.parse(original)).dps)
  })
})
