import { describe, expect, it } from "vitest"
import {
  applyBestBuild,
  bestBuildDps,
  BEST_BUILD_LIMITS,
  findBestBuild,
} from "../../src/engine/bestBuild"
import { defaultInputs } from "../../src/engine/defaults"
import { activeRotationForInputs } from "../../src/engine/dps"
import { EMPTY_EQUIPPED, GEAR_SLOTS } from "../../src/engine/types"
import type { GearPiece, GearSlot, Inputs } from "../../src/engine/types"

function piece(slot: GearSlot, choice: number): GearPiece {
  return {
    id: `${slot}-${choice}`,
    slot,
    label: `${slot} choice ${choice}`,
    level: 91,
    rarity: "legendary",
    minPhys: 0,
    maxPhys: 0,
    hp: 0,
    physDef: 0,
    words: [
      { word: "maxPhys", value: choice * 20, retuned: false },
      ...Array.from({ length: 4 }, () => ({ word: "" as const, value: 0, retuned: false })),
    ] as GearPiece["words"],
    attunement: "",
    attunementValue: 0,
    relayed: false,
  }
}
function fixture(count = 2): Inputs {
  return {
    ...defaultInputs,
    classId: "bellstrikeUmbra",
    inventory: GEAR_SLOTS.flatMap((slot) =>
      Array.from({ length: count }, (_, index) => piece(slot, index)),
    ),
    equipped: { ...EMPTY_EQUIPPED },
  }
}
const additive = (inputs: Inputs) =>
  GEAR_SLOTS.reduce((sum, slot) => sum + Number(inputs.equipped[slot]?.split("-").at(-1) ?? 0), 0)

describe("complete-build optimizer", () => {
  it("finds the known exact global optimum and maps every equipped slot", async () => {
    const inputs = fixture()
    const result = await findBestBuild(inputs, { score: additive })
    expect(result).toMatchObject({ status: "ok", bestDps: 8, approximate: false, evaluated: 256 })
    const applied = applyBestBuild(inputs, result, "current", "current")!
    for (const slot of GEAR_SLOTS) expect(applied.equipped[slot]).toBe(`${slot}-1`)
    expect(inputs.equipped).toEqual(EMPTY_EQUIPPED)
  })
  it("finds cross-slot synergy which independently greedy deltas miss", async () => {
    const inputs = fixture()
    const score = (build: Inputs) => {
      const left = build.equipped.leftWeapon?.endsWith("-1")
      const right = build.equipped.rightWeapon?.endsWith("-1")
      return left && right ? 100 : left || right ? -1 : 0
    }
    expect(
      score({ ...inputs, equipped: { ...EMPTY_EQUIPPED, leftWeapon: "leftWeapon-1" } }),
    ).toBeLessThan(score(inputs))
    const result = await findBestBuild(inputs, { score })
    expect(result).toMatchObject({
      status: "ok",
      bestDps: 100,
      equipped: { leftWeapon: "leftWeapon-1", rightWeapon: "rightWeapon-1" },
    })
  })
  it("breaks ties deterministically regardless of inventory order", async () => {
    const inputs = fixture()
    const a = await findBestBuild(inputs, { score: () => 1 })
    const b = await findBestBuild(
      { ...inputs, inventory: [...inputs.inventory].reverse() },
      { score: () => 1 },
    )
    expect(a).toEqual(b)
    expect(a).toMatchObject({ equipped: { leftWeapon: "leftWeapon-0", bracer: "bracer-0" } })
  })
  it("reports missing required candidates safely", async () => {
    const inputs = fixture(1)
    inputs.inventory = inputs.inventory.filter((item) => item.slot !== "helm")
    expect(await findBestBuild(inputs)).toMatchObject({
      status: "error",
      reason: "missing-slots",
      missingSlots: ["helm"],
    })
  })
  it("compares raw IDs even when JSON escaping changes their serialized order", async () => {
    const inputs = fixture(1)
    inputs.inventory[0] = { ...piece("leftWeapon", 0), id: "\n" }
    inputs.inventory.push({ ...piece("leftWeapon", 1), id: " " })
    expect(await findBestBuild(inputs, { score: () => 1 })).toMatchObject({
      equipped: { leftWeapon: "\n" },
    })
  })
  it("bounds large spaces deterministically and explicitly reports approximate", async () => {
    const inputs = fixture(4)
    const a = await findBestBuild(inputs, { score: additive })
    const b = await findBestBuild(
      { ...inputs, inventory: [...inputs.inventory].reverse() },
      { score: additive },
    )
    expect(a).toEqual(b)
    expect(a.status).toBe("ok")
    if (a.status === "ok") {
      expect(a.approximate).toBe(true)
      expect(a.evaluated).toBeLessThanOrEqual(BEST_BUILD_LIMITS.evaluations)
      expect(a.combinations).toBe(65536)
    }
  })
  it("does not mutate original inputs during engine evaluation", async () => {
    const inputs = fixture(1)
    const before = structuredClone(inputs)
    const result = await findBestBuild(inputs)
    expect(result).toMatchObject({ status: "ok" })
    expect(inputs).toEqual(before)
    if (result.status === "ok")
      expect(result.bestDps).toBe(bestBuildDps({ ...inputs, equipped: result.equipped }))
  })
  it("matches a real-engine exhaustive reference for the active custom rotation", async () => {
    const inputs = fixture(1)
    const builtin = activeRotationForInputs(inputs)!
    inputs.activeCustomRotation = { ...builtin, id: "optimizer-custom", fixedWindowSec: 90 }
    inputs.inventory.push(piece("leftWeapon", 1), piece("rightWeapon", 1))
    const scores = []
    for (const left of [0, 1])
      for (const right of [0, 1]) {
        const equipped = { ...EMPTY_EQUIPPED }
        for (const slot of GEAR_SLOTS) equipped[slot] = `${slot}-0`
        equipped.leftWeapon = `leftWeapon-${left}`
        equipped.rightWeapon = `rightWeapon-${right}`
        scores.push(bestBuildDps({ ...inputs, equipped }))
      }
    expect(await findBestBuild(inputs)).toMatchObject({
      status: "ok",
      bestDps: Math.max(...scores),
      evaluated: 4,
    })
  })
  it("rejects duplicate IDs and wrong-slot or unavailable equipped references", async () => {
    const inputs = fixture(1)
    expect(
      await findBestBuild({ ...inputs, inventory: [...inputs.inventory, inputs.inventory[0]] }),
    ).toMatchObject({ reason: "duplicate-id" })
    for (const id of ["missing", "helm-0"])
      expect(
        await findBestBuild({ ...inputs, equipped: { ...EMPTY_EQUIPPED, leftWeapon: id } }),
      ).toMatchObject({ reason: "invalid-equipped" })
  })
  it("excludes malformed candidates without losing valid alternatives", async () => {
    const inputs = fixture(1)
    inputs.inventory.push({ ...piece("helm", 9), attunementValue: NaN })
    expect(await findBestBuild(inputs, { score: additive })).toMatchObject({
      status: "ok",
      excludedCandidates: 1,
    })
  })
  it("cancels while searching and cannot apply stale or cancelled results", async () => {
    let evaluations = 0
    const inputs = fixture()
    const result = await findBestBuild(inputs, {
      score: () => ++evaluations,
      cancelled: () => evaluations > 20,
    })
    expect(result).toEqual({ status: "cancelled" })
    expect(applyBestBuild(inputs, result, "a", "a")).toBeNull()
    const valid = await findBestBuild(fixture(1), { score: additive })
    expect(applyBestBuild(inputs, valid, "old", "new")).toBeNull()
  })
  it("reports unavailable rotation and engine failures without applying", async () => {
    expect(await findBestBuild({ ...fixture(1), classId: "unavailable" })).toMatchObject({
      reason: "no-rotation",
    })
    expect(await findBestBuild(fixture(1), { score: () => NaN })).toMatchObject({
      reason: "engine-error",
    })
  })
})
