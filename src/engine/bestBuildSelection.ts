import { GEAR_WORD_IDS } from "../data/stats/statLines"
import { getAttunement } from "./attunements"
import { GEAR_LEVELS, GEAR_RARITIES, GEAR_SLOTS } from "./types"
import type { EquippedSlots, GearPiece, Inputs } from "./types"
import type { BestBuildAdvice } from "./bestBuildAdvisor"

export type BestBuildError =
  "missing-slots" | "duplicate-id" | "invalid-equipped" | "no-rotation" | "engine-error"
export type BestBuildResult =
  | { status: "error"; reason: BestBuildError; missingSlots?: string[]; excludedCandidates: number }
  | { status: "cancelled" }
  | {
      status: "ok"
      equipped: EquippedSlots
      currentDps: number
      bestDps: number
      approximate: boolean
      combinations: number
      evaluated: number
      excludedCandidates: number
      advice?: BestBuildAdvice
    }

export function validBestBuildPiece(piece: GearPiece): boolean {
  return (
    !!piece &&
    typeof piece.id === "string" &&
    piece.id.length > 0 &&
    GEAR_SLOTS.includes(piece.slot) &&
    GEAR_LEVELS.includes(piece.level) &&
    GEAR_RARITIES.includes(piece.rarity) &&
    [piece.minPhys, piece.maxPhys, piece.hp, piece.physDef, piece.attunementValue].every(
      Number.isFinite,
    ) &&
    typeof piece.relayed === "boolean" &&
    typeof piece.attunement === "string" &&
    (piece.attunement === "" || !!getAttunement(piece.attunement)) &&
    Array.isArray(piece.words) &&
    piece.words.length === 5 &&
    piece.words.every(
      (entry) =>
        !!entry &&
        (entry.word === "" || GEAR_WORD_IDS.includes(entry.word)) &&
        Number.isFinite(entry.value) &&
        typeof entry.retuned === "boolean",
    )
  )
}

export function applyBestBuild(
  inputs: Inputs,
  result: BestBuildResult,
  sourceKey: string,
  currentKey: string,
): Inputs | null {
  if (sourceKey !== currentKey || result.status !== "ok") return null
  if (new Set(inputs.inventory.map((piece) => piece.id)).size !== inputs.inventory.length)
    return null
  if (
    !GEAR_SLOTS.every((slot) =>
      inputs.inventory.some(
        (piece) =>
          piece.id === result.equipped[slot] && piece.slot === slot && validBestBuildPiece(piece),
      ),
    )
  )
    return null
  return { ...inputs, equipped: { ...result.equipped } }
}
