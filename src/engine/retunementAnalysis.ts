import { runEngine } from "./dps"
import { applyPieceContribution, maxRelayedClone, relayedCapValue } from "./gearStats"
import { getWordSpecs } from "./itemRanking"
import { attributeForClass, poolForClass } from "../definitions/classes/registry"
import {
  annotatePoolForSlot,
  rerollableSlots,
  retuneLineOutcome,
  retunePoolChoices,
  retuneAttemptSpent,
} from "./retunement"
import { retuneWeightPool, type RetuneLine } from "../data/stats/gearRetuneWeights"
import { GEAR_WORD_UNIT } from "../data/stats/statLines"
import type { RetunementPool } from "../definitions/classes/classDef"
import type { GearPiece, GearSlot, GearWordId, Inputs } from "./types"

export interface RetunementWorkerRequest {
  reqId: number
  inputs: Inputs
  pieceId: string
}

export interface RetunementRow {
  slotIndex: number
  word: GearWordId
  legal: boolean
  isCurrent: boolean
  deltaDps: number
  // The same swap with every word on the piece — the candidate included —
  // relayed to its 94 % cap, measured against that same relayed piece.
  deltaDpsRelayed: number
  poolSize: number
  // null where no weighted pool exists yet for this gear level (86, 91).
  pDraw: number | null
  pImprove: number | null
  eDeltaDps: number | null
}

export interface RetunementWorkerResponse {
  reqId: number
  pieceId: string
  rows: RetunementRow[]
  reason: "ok" | "no-piece" | "no-pool" | "relayed" | "spent"
}

export function inputsWithSlotEmpty(inputs: Inputs, slot: GearSlot): Inputs {
  const equippedId = inputs.equipped[slot]
  if (!equippedId) return inputs
  const equippedPiece = inputs.inventory.find((p) => p.id === equippedId)
  if (!equippedPiece) return inputs
  return applyPieceContribution(inputs, equippedPiece, -1)
}

function retunementDpsHelpers(
  inputs: Inputs,
  piece: GearPiece,
  scorePiece?: (piece: GearPiece) => number,
) {
  const slotEmpty = inputsWithSlotEmpty(inputs, piece.slot)
  const equipDps = scorePiece
    ? scorePiece(piece)
    : runEngine(applyPieceContribution(slotEmpty, piece, +1)).dps
  const relayedPiece = maxRelayedClone(piece, inputs, piece.level)
  const relayedDps = scorePiece
    ? scorePiece(relayedPiece)
    : runEngine(applyPieceContribution(slotEmpty, relayedPiece, +1)).dps

  const dpsWithWord = (from: GearPiece, slotIndex: number, word: GearWordId, value: number) => {
    const words = from.words.map((existing, index) =>
      index === slotIndex ? { word, value, retuned: true } : existing,
    ) as GearPiece["words"]
    const candidate = { ...from, words }
    return scorePiece
      ? scorePiece(candidate)
      : runEngine(applyPieceContribution(slotEmpty, candidate, +1)).dps
  }

  return { equipDps, relayedPiece, relayedDps, dpsWithWord }
}

function computeLegacyRetunement(
  req: RetunementWorkerRequest,
  piece: GearPiece,
  pool: RetunementPool,
  scorePiece?: (piece: GearPiece) => number,
): RetunementWorkerResponse {
  const { inputs, pieceId } = req
  const specs = getWordSpecs(inputs, piece.level)
  const specByWord = new Map(specs.map((s) => [s.word, s] as const))
  const rows: RetunementRow[] = []
  const slots = rerollableSlots(piece)
  const { equipDps, relayedPiece, relayedDps, dpsWithWord } = retunementDpsHelpers(
    inputs,
    piece,
    scorePiece,
  )

  for (const slotIndex of slots) {
    const annotated = annotatePoolForSlot(piece, slotIndex, pool)
    for (const { word, legal, isCurrent } of annotated) {
      if (!legal) {
        rows.push({
          slotIndex,
          word,
          legal: false,
          isCurrent: false,
          deltaDps: 0,
          deltaDpsRelayed: 0,
          poolSize: pool.stats.length,
          pDraw: null,
          pImprove: null,
          eDeltaDps: null,
        })
        continue
      }
      const spec = specByWord.get(word)
      if (!spec) {
        rows.push({
          slotIndex,
          word,
          legal: true,
          isCurrent,
          deltaDps: 0,
          deltaDpsRelayed: 0,
          poolSize: pool.stats.length,
          pDraw: null,
          pImprove: null,
          eDeltaDps: null,
        })
        continue
      }
      const cappedValue = relayedCapValue(spec.amount, spec.unit)
      rows.push({
        slotIndex,
        word,
        legal: true,
        isCurrent,
        deltaDps: dpsWithWord(piece, slotIndex, word, spec.amount) - equipDps,
        deltaDpsRelayed: dpsWithWord(relayedPiece, slotIndex, word, cappedValue) - relayedDps,
        poolSize: pool.stats.length,
        pDraw: null,
        pImprove: null,
        eDeltaDps: null,
      })
    }
  }

  return { reqId: req.reqId, pieceId, rows, reason: "ok" }
}

function computeWeightedRetunement(
  req: RetunementWorkerRequest,
  piece: GearPiece,
  weightPool: readonly RetuneLine[],
  scorePiece?: (piece: GearPiece) => number,
): RetunementWorkerResponse {
  const { inputs, pieceId } = req
  const rows: RetunementRow[] = []
  const slots = rerollableSlots(piece)
  const { equipDps, relayedPiece, relayedDps, dpsWithWord } = retunementDpsHelpers(
    inputs,
    piece,
    scorePiece,
  )

  const choices = retunePoolChoices(piece, weightPool).filter(
    (choice) => !choice.deselected && !choice.onRerollableLine,
  )
  const lineByWord = new Map(weightPool.map((line) => [line.word, line] as const))

  for (const slotIndex of slots) {
    for (const { word, pDraw } of choices) {
      const line = lineByWord.get(word)
      if (!line) continue
      const outcome = retuneLineOutcome(line, piece.rarity, equipDps, (value) =>
        dpsWithWord(piece, slotIndex, word, value),
      )
      const maxValue = line.bands[2].max
      const relayedMaxValue = relayedCapValue(maxValue, GEAR_WORD_UNIT[word])
      rows.push({
        slotIndex,
        word,
        legal: true,
        isCurrent: false,
        deltaDps: dpsWithWord(piece, slotIndex, word, maxValue) - equipDps,
        deltaDpsRelayed: dpsWithWord(relayedPiece, slotIndex, word, relayedMaxValue) - relayedDps,
        poolSize: weightPool.length,
        pDraw,
        pImprove: outcome.pImprove,
        eDeltaDps: pDraw * outcome.eDeltaDpsGivenDrawn,
      })
    }
  }

  return { reqId: req.reqId, pieceId, rows, reason: "ok" }
}

export function computeRetunement(
  req: RetunementWorkerRequest,
  scorePiece?: (piece: GearPiece) => number,
): RetunementWorkerResponse {
  const { inputs, pieceId } = req
  const piece = inputs.inventory.find((p) => p.id === pieceId)
  if (!piece) {
    return { reqId: req.reqId, pieceId, rows: [], reason: "no-piece" }
  }
  if (piece.relayed) {
    return { reqId: req.reqId, pieceId, rows: [], reason: "relayed" }
  }
  if (retuneAttemptSpent(piece)) return { reqId: req.reqId, pieceId, rows: [], reason: "spent" }

  const attribute = attributeForClass(inputs.classId)
  const weightPool = attribute ? retuneWeightPool(attribute, piece.level, piece.slot) : null
  if (weightPool) return computeWeightedRetunement(req, piece, weightPool, scorePiece)

  const pool = poolForClass(inputs.classId)
  if (!pool || pool.stats.length === 0) {
    return { reqId: req.reqId, pieceId, rows: [], reason: "no-pool" }
  }
  return computeLegacyRetunement(req, piece, pool, scorePiece)
}
