import {
  validBestBuildPiece,
  BEST_BUILD_LIMITS,
  type BestBuildError,
  type BestBuildResult,
} from "./bestBuildSelection"
export { applyBestBuild, BEST_BUILD_LIMITS, type BestBuildResult } from "./bestBuildSelection"
import { activeRotationForInputs, runEngine } from "./dps"
import { withDerivedStats } from "./derivedInputs"
import { applyArmorSet, applyBowSet } from "./panel"
import { EMPTY_EQUIPPED, GEAR_SLOTS } from "./types"
import type { EquippedSlots, Inputs } from "./types"

export function bestBuildDps(inputs: Inputs): number {
  return runEngine(applyBowSet(applyArmorSet(withDerivedStats(inputs))), { collect: "totals" }).dps
}

type Scored = { equipped: EquippedSlots; dps: number; key: string; priority: readonly number[] }
const keyFor = (equipped: EquippedSlots) => JSON.stringify(GEAR_SLOTS.map((slot) => equipped[slot]))
function compare(leftBuild: Scored, rightBuild: Scored): number {
  for (let index = 0; index < leftBuild.priority.length; index++) {
    if (leftBuild.priority[index] !== rightBuild.priority[index])
      return rightBuild.priority[index] - leftBuild.priority[index]
  }
  if (leftBuild.dps !== rightBuild.dps) return rightBuild.dps - leftBuild.dps
  for (const slot of GEAR_SLOTS) {
    const left = leftBuild.equipped[slot] ?? ""
    const right = rightBuild.equipped[slot] ?? ""
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

export async function findBestBuild(
  inputs: Inputs,
  options: {
    cancelled?: () => boolean
    score?: (inputs: Inputs) => number
    priority?: (inputs: Inputs, dps: number) => readonly number[]
    evaluationLimit?: number
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
  const score = options.score ?? bestBuildDps
  const visited = new Map<string, Scored>()
  let best: Scored | undefined
  const cancelled = () => options.cancelled?.() ?? false
  const evaluationLimit = options.evaluationLimit ?? BEST_BUILD_LIMITS.evaluations
  if (
    !Number.isInteger(evaluationLimit) ||
    evaluationLimit < 1 ||
    evaluationLimit > BEST_BUILD_LIMITS.evaluations
  )
    return error("engine-error")
  const approximate = combinations > Math.min(BEST_BUILD_LIMITS.exact, evaluationLimit)
  async function evaluate(equipped: EquippedSlots): Promise<void> {
    const key = keyFor(equipped)
    if (visited.has(key) || cancelled() || (approximate && visited.size >= evaluationLimit)) return
    const candidateInputs = { ...inputs, inventory, equipped }
    const dps = score(candidateInputs)
    if (!Number.isFinite(dps)) throw new Error("Non-finite DPS")
    const priority = options.priority?.(candidateInputs, dps) ?? []
    if (!priority.every(Number.isFinite)) throw new Error("Non-finite priority")
    const candidate = { equipped, dps, key, priority }
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
              if (cancelled() || visited.size >= evaluationLimit) break
            }
            if (cancelled() || visited.size >= evaluationLimit) break
          }
          if (cancelled() || visited.size >= evaluationLimit) break
        }
        if (visited.size === before || visited.size >= evaluationLimit) break
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
