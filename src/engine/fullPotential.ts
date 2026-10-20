import type { GearLevel, GearPiece, GearSlot, Inputs } from "./types"
import { runEngine } from "./dps"
import { applyPieceContribution, maxRelayedClone, relayedCapValue } from "./gearStats"
import { getWordSpecs } from "./itemRanking"
import { attunementMax, attunementsFor } from "./attunements"
import { gearLevelForBreakthrough } from "../definitions/baseStats/breakthroughs"
import { poolForClass } from "../definitions/classes/registry"
import { annotatePoolForSlot, rerollableSlots } from "./retunement"

function slotEmptyBaseline(slot: GearSlot, inputs: Inputs): Inputs {
  const equippedId = inputs.equipped[slot]
  const equipped = equippedId ? (inputs.inventory.find((p) => p.id === equippedId) ?? null) : null
  return equipped ? applyPieceContribution(inputs, equipped, -1) : inputs
}

function bestRetunedVariant(
  piece: GearPiece,
  inputs: Inputs,
  baseline: Inputs,
  level: GearLevel,
): GearPiece {
  const pool = poolForClass(inputs.classId)
  if (!pool || pool.stats.length === 0) return piece

  const specs = getWordSpecs(inputs, level)
  let bestPiece = piece
  let bestDps = runEngine(applyPieceContribution(baseline, piece, +1)).dps

  for (const slotIndex of rerollableSlots(piece)) {
    const annotated = annotatePoolForSlot(piece, slotIndex, pool)
    for (const { word, legal, isCurrent } of annotated) {
      if (!legal || isCurrent) continue
      const spec = specs.find((s) => s.word === word)
      if (!spec) continue
      const value = piece.relayed ? relayedCapValue(spec.amount, spec.unit) : spec.amount
      const swappedWords = piece.words.map((existing, index) =>
        index === slotIndex ? { word, value, retuned: true } : existing,
      ) as GearPiece["words"]
      const candidate: GearPiece = { ...piece, words: swappedWords }
      const dps = runEngine(applyPieceContribution(baseline, candidate, +1)).dps
      if (dps > bestDps) {
        bestDps = dps
        bestPiece = candidate
      }
    }
  }
  return bestPiece
}

function applyBestAttunement(
  piece: GearPiece,
  inputs: Inputs,
  baseline: Inputs,
  level: GearLevel,
): GearPiece {
  const opts = attunementsFor(piece.slot, inputs.classId).filter((o) => o.enginePath !== null)
  if (opts.length === 0) return piece

  let bestPiece = piece
  let bestDps = runEngine(applyPieceContribution(baseline, piece, +1)).dps
  for (const opt of opts) {
    const candidate: GearPiece = {
      ...piece,
      attunement: opt.id,
      attunementValue: attunementMax(opt, level),
    }
    const dps = runEngine(applyPieceContribution(baseline, candidate, +1)).dps
    if (dps > bestDps) {
      bestDps = dps
      bestPiece = candidate
    }
  }
  return bestPiece
}

function fullPotentialPiece(
  piece: GearPiece,
  inputs: Inputs,
): { piece: GearPiece; level: GearLevel } {
  const baseline = slotEmptyBaseline(piece.slot, inputs)
  const breakthroughLevel = gearLevelForBreakthrough(inputs.breakthrough)

  if (piece.relayed) {
    const relayedClone = maxRelayedClone(piece, inputs, breakthroughLevel)
    return {
      piece: applyBestAttunement(relayedClone, inputs, baseline, breakthroughLevel),
      level: breakthroughLevel,
    }
  }

  const retuned = bestRetunedVariant(piece, inputs, baseline, piece.level)
  const retunedDps = runEngine(applyPieceContribution(baseline, retuned, +1)).dps
  const relayed = bestRetunedVariant(
    maxRelayedClone(piece, inputs, breakthroughLevel),
    inputs,
    baseline,
    breakthroughLevel,
  )
  const relayedDps = runEngine(applyPieceContribution(baseline, relayed, +1)).dps
  const relayWins = relayedDps > retunedDps

  const level = relayWins ? breakthroughLevel : piece.level
  return {
    piece: applyBestAttunement(relayWins ? relayed : retuned, inputs, baseline, level),
    level,
  }
}

export function getFTPiece(piece: GearPiece, inputs: Inputs): GearPiece {
  return fullPotentialPiece(piece, inputs).piece
}

export interface FullPotentialDps {
  dps: number
  level: GearLevel
}

export function ftEvaluationWhenEquipped(piece: GearPiece, inputs: Inputs): FullPotentialDps {
  const baseline = slotEmptyBaseline(piece.slot, inputs)
  const ft = fullPotentialPiece(piece, inputs)
  return { dps: runEngine(applyPieceContribution(baseline, ft.piece, +1)).dps, level: ft.level }
}

export function ftDpsWhenEquipped(piece: GearPiece, inputs: Inputs): number {
  return ftEvaluationWhenEquipped(piece, inputs).dps
}

export function ftDpsWithSlotEmpty(slot: GearSlot, inputs: Inputs): number {
  return runEngine(slotEmptyBaseline(slot, inputs)).dps
}
