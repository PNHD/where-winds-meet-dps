import {
  validBestBuildPiece,
  type BestBuildError,
  type BestBuildResult,
} from "./bestBuildSelection"
export { applyBestBuild, type BestBuildResult } from "./bestBuildSelection"
import { activeRotationForInputs, runEngine } from "./dps"
import { withDerivedStats } from "./derivedInputs"
import { applyArmorSet, applyBowSet } from "./panel"
import { EMPTY_EQUIPPED, GEAR_SLOTS } from "./types"
import type { EquippedSlots, Inputs } from "./types"

// Exact Cartesian search below this ceiling. Larger spaces use complete-build
// beam neighbours, capped by evaluations and rounds; never claim a global optimum.
export const BEST_BUILD_LIMITS = {
  exact: 1024,
  evaluations: 4096,
  beam: 16,
  rounds: 8,
  yieldEvery: 16,
} as const

export function bestBuildDps(inputs: Inputs): number {
  return runEngine(applyBowSet(applyArmorSet(withDerivedStats(inputs))), { collect: "totals" }).dps
}

type Scored = { equipped: EquippedSlots; dps: number; key: string }
const keyFor = (equipped: EquippedSlots) => JSON.stringify(GEAR_SLOTS.map((slot) => equipped[slot]))
function compare(a: Scored, b: Scored): number {
  if (a.dps !== b.dps) return b.dps - a.dps
  for (const slot of GEAR_SLOTS) {
    const left = a.equipped[slot] ?? ""
    const right = b.equipped[slot] ?? ""
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

export async function findBestBuild(
  inputs: Inputs,
  options: {
    cancelled?: () => boolean
    score?: (inputs: Inputs) => number
  } = {},
): Promise<BestBuildResult> {
  const ids = new Set<string>()
  for (const piece of inputs.inventory) {
    if (!piece || typeof piece.id !== "string") continue
    if (ids.has(piece.id)) return { status: "error", reason: "duplicate-id", excludedCandidates: 0 }
    ids.add(piece.id)
  }
  const inventory = inputs.inventory.filter(validBestBuildPiece)
  const excludedCandidates = inputs.inventory.length - inventory.length
  const error = (reason: BestBuildError): BestBuildResult => ({
    status: "error",
    reason,
    excludedCandidates,
  })
  for (const slot of GEAR_SLOTS) {
    const id = inputs.equipped[slot]
    if (id !== null && !inventory.some((piece) => piece.id === id && piece.slot === slot))
      return error("invalid-equipped")
  }
  const candidates = GEAR_SLOTS.map((slot) =>
    inventory
      .filter((piece) => piece.slot === slot)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  )
  const missingSlots = GEAR_SLOTS.filter((_, index) => candidates[index].length === 0)
  if (missingSlots.length)
    return { status: "error", reason: "missing-slots", missingSlots, excludedCandidates }
  if (!activeRotationForInputs(inputs)) return error("no-rotation")
  const combinations = candidates.reduce(
    (count, pieces) => Math.min(Number.MAX_SAFE_INTEGER, count * pieces.length),
    1,
  )
  const approximate = combinations > BEST_BUILD_LIMITS.exact
  const score = options.score ?? bestBuildDps
  const visited = new Map<string, Scored>()
  let best: Scored | undefined
  const cancelled = () => options.cancelled?.() ?? false
  async function evaluate(equipped: EquippedSlots): Promise<void> {
    const key = keyFor(equipped)
    if (
      visited.has(key) ||
      cancelled() ||
      (approximate && visited.size >= BEST_BUILD_LIMITS.evaluations)
    )
      return
    const dps = score({ ...inputs, inventory, equipped })
    if (!Number.isFinite(dps)) throw new Error("Non-finite DPS")
    const candidate = { equipped, dps, key }
    visited.set(key, candidate)
    if (!best || compare(candidate, best) < 0) best = candidate
    if (visited.size % BEST_BUILD_LIMITS.yieldEvery === 0)
      await new Promise((resolve) => setTimeout(resolve, 0))
  }
  try {
    if (cancelled()) return { status: "cancelled" }
    const currentDps = score({ ...inputs, inventory })
    if (!Number.isFinite(currentDps)) return error("engine-error")
    const first = { ...EMPTY_EQUIPPED }
    GEAR_SLOTS.forEach((slot, index) => {
      first[slot] = candidates[index][0].id
    })
    if (approximate) {
      await evaluate(first)
      if (GEAR_SLOTS.every((slot) => inputs.equipped[slot] !== null))
        await evaluate({ ...inputs.equipped })
      for (let round = 0; round < BEST_BUILD_LIMITS.rounds && !cancelled(); round++) {
        const before = visited.size
        const beam = [...visited.values()].sort(compare).slice(0, BEST_BUILD_LIMITS.beam)
        for (const build of beam) {
          for (let index = 0; index < GEAR_SLOTS.length; index++) {
            for (const piece of candidates[index]) {
              await evaluate({ ...build.equipped, [GEAR_SLOTS[index]]: piece.id })
              if (cancelled() || visited.size >= BEST_BUILD_LIMITS.evaluations) break
            }
            if (cancelled() || visited.size >= BEST_BUILD_LIMITS.evaluations) break
          }
          if (cancelled() || visited.size >= BEST_BUILD_LIMITS.evaluations) break
        }
        if (visited.size === before || visited.size >= BEST_BUILD_LIMITS.evaluations) break
      }
    } else {
      async function enumerate(index: number, equipped: EquippedSlots): Promise<void> {
        if (cancelled()) return
        if (index === GEAR_SLOTS.length) {
          await evaluate(equipped)
          return
        }
        for (const piece of candidates[index]) {
          await enumerate(index + 1, { ...equipped, [GEAR_SLOTS[index]]: piece.id })
          if (cancelled()) break
        }
      }
      await enumerate(0, { ...EMPTY_EQUIPPED })
    }
    if (cancelled()) return { status: "cancelled" }
    if (!best) return error("engine-error")
    return {
      status: "ok",
      equipped: best.equipped,
      bestDps: best.dps,
      currentDps,
      approximate,
      combinations,
      evaluated: visited.size,
      excludedCandidates,
    }
  } catch {
    return cancelled() ? { status: "cancelled" } : error("engine-error")
  }
}
