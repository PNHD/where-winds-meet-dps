import type { BestBuildResult } from "./bestBuildSelection"
import { bestBuildDps } from "./bestBuild"
import { validBestBuildPiece } from "./bestBuildSelection"
import { heirloomMatch, type HeirloomSwap } from "./heirloom"
import { computeRetunement, type RetunementRow } from "./retunementAnalysis"
import { GEAR_SLOTS, type GearSlot, type Inputs } from "./types"

export interface BestBuildItemAdvice {
  slot: GearSlot
  pieceId: string
  recommendation: RetunementRow | null
  reason: "ok" | "no-piece" | "no-pool" | "relayed" | "heirloom" | "spent"
  heirloomSwap: HeirloomSwap | null
  runnerUp: { pieceId: string; dps: number; gap: number } | null
}

export type BestBuildAdvice =
  | { status: "ok"; items: BestBuildItemAdvice[]; first: BestBuildItemAdvice | null }
  | { status: "error" | "cancelled" }

export function bestPositiveRetunement(rows: readonly RetunementRow[]): RetunementRow | null {
  return (
    rows
      .filter(
        (row) => row.legal && !row.isCurrent && Number.isFinite(row.deltaDps) && row.deltaDps > 0,
      )
      .sort(
        (left, right) =>
          right.deltaDps - left.deltaDps ||
          left.slotIndex - right.slotIndex ||
          (left.word < right.word ? -1 : left.word > right.word ? 1 : 0),
      )[0] ?? null
  )
}

export async function analyzeBestBuild(
  inputs: Inputs,
  result: Extract<BestBuildResult, { status: "ok" }>,
  cancelled: () => boolean = () => false,
): Promise<BestBuildAdvice> {
  const proposed = { ...inputs, equipped: { ...result.equipped } }
  const items: BestBuildItemAdvice[] = []
  try {
    for (const slot of GEAR_SLOTS) {
      if (cancelled()) return { status: "cancelled" }
      const pieceId = result.equipped[slot]!
      const piece = inputs.inventory.find((item) => item.id === pieceId)!
      const analysis = computeRetunement({ reqId: 0, inputs: proposed, pieceId }, (candidate) => {
        const dps = bestBuildDps({
          ...proposed,
          inventory: proposed.inventory.map((entry) => (entry.id === pieceId ? candidate : entry)),
        })
        if (!Number.isFinite(dps)) throw new Error("Non-finite Retunement DPS")
        return dps
      })
      const heirloom = heirloomMatch(piece, inputs)
      const reason = piece.relayed
        ? "relayed"
        : heirloom.builds.length > 0
          ? "heirloom"
          : analysis.reason
      let runnerUp: BestBuildItemAdvice["runnerUp"] = null
      for (const alternative of inputs.inventory
        .filter((item) => item.slot === slot && item.id !== pieceId && validBestBuildPiece(item))
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))) {
        if (cancelled()) return { status: "cancelled" }
        const dps = bestBuildDps({
          ...proposed,
          equipped: { ...proposed.equipped, [slot]: alternative.id },
        })
        if (!Number.isFinite(dps)) throw new Error("Non-finite replacement DPS")
        if (!runnerUp || dps > runnerUp.dps)
          runnerUp = { pieceId: alternative.id, dps, gap: result.bestDps - dps }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      items.push({
        slot,
        pieceId,
        reason,
        recommendation: reason === "ok" ? bestPositiveRetunement(analysis.rows) : null,
        heirloomSwap: piece.relayed ? null : heirloom.swap,
        runnerUp,
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (cancelled()) return { status: "cancelled" }
    const ranked = items
      .filter((item) => item.recommendation)
      .sort((left, right) => right.recommendation!.deltaDps - left.recommendation!.deltaDps)
    return { status: "ok", items, first: ranked[0] ?? null }
  } catch {
    return { status: cancelled() ? "cancelled" : "error" }
  }
}
