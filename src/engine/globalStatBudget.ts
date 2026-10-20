import { gearWordPoolForLine } from "../data/stats/gearWordPools"
import { gearWordMaxRoll, GEAR_WORD_UNIT, GEAR_WORD_IDS } from "../data/stats/statLines"
import { gearLevelForBreakthrough } from "../definitions/baseStats/breakthroughs"
import { validBestBuildPiece } from "./bestBuildSelection"
import { followedGraduationBuild, graduationBuildAtLevel } from "./graduation"
import { relayedCapValue } from "./gearStats"
import { annotatePoolForSlot } from "./retunement"
import { isCustomGraduationBuild } from "./customGraduationBuild"
import { GEAR_SLOTS, type GearPiece, type GearSlot, type GearWordId, type Inputs } from "./types"

export interface GlobalStatRow {
  word: GearWordId
  unit: "raw" | "percent"
  targetCount: number
  actualCount: number
  missing: number
  excess: number
  targetValue: number
  actualValue: number
  valueDeficit: number
  contributors: { slot: GearSlot; count: number; value: number }[]
}

export interface GlobalStatBudget {
  status: "ok"
  targetId: string
  rows: GlobalStatRow[]
  covered: number
  targetCount: number
  actualTargetCount: number
  actualLineCount: number
  missing: number
  excess: number
}

export type GlobalBudgetResult =
  | GlobalStatBudget
  | { status: "error"; reason: "no-target" | "invalid-target" | "invalid-equipment" }

export function validPlannerPiece(piece: GearPiece): boolean {
  return validPiece(piece, false)
}

export function validPartialPlannerPiece(piece: GearPiece): boolean {
  return validPiece(piece, true)
}

function validPiece(piece: GearPiece, allowPartial: boolean): boolean {
  if (!validBestBuildPiece(piece)) return false
  if (piece.words[0].retuned || piece.words.filter((entry) => entry.retuned).length > 1)
    return false
  if (
    piece.retunedOutWords !== undefined &&
    (!Array.isArray(piece.retunedOutWords) ||
      !piece.retunedOutWords.every((word) => GEAR_WORD_IDS.includes(word)))
  )
    return false
  const currentLines = { ...piece, retunedOutWords: [] }
  return piece.words.every((entry, index) => {
    if (!entry.word) return allowPartial && entry.value === 0 && !entry.retuned
    if (entry.value < 0) return false
    const max = gearWordMaxRoll(entry.word, piece.level)
    const cap = piece.relayed ? relayedCapValue(max, GEAR_WORD_UNIT[entry.word]) : max
    return (
      gearWordPoolForLine(piece.level, piece.slot, index).includes(entry.word) &&
      (index === 0 || annotatePoolForSlot(currentLines, index, { stats: [entry.word] })[0].legal) &&
      entry.value <= cap + 1e-9
    )
  })
}

export function globalStatBudget(inputs: Inputs): GlobalBudgetResult {
  if (!Number.isFinite(inputs.breakthrough)) return { status: "error", reason: "invalid-target" }
  if (!Array.isArray(inputs.inventory) || !inputs.equipped || typeof inputs.equipped !== "object")
    return { status: "error", reason: "invalid-equipment" }
  if (inputs.customGraduationBuild && !isCustomGraduationBuild(inputs.customGraduationBuild))
    return { status: "error", reason: "invalid-target" }
  const followed = followedGraduationBuild(inputs)
  if (!followed || (inputs.graduationBuildId && followed.id !== inputs.graduationBuildId))
    return { status: "error", reason: "no-target" }
  const target = graduationBuildAtLevel(
    followed,
    "maxRolls",
    gearLevelForBreakthrough(inputs.breakthrough),
  )
  if (
    target.gear.length !== GEAR_SLOTS.length ||
    !GEAR_SLOTS.every((slot) => target.gear.filter((piece) => piece.slot === slot).length === 1) ||
    !target.gear.every(validPlannerPiece)
  )
    return { status: "error", reason: "invalid-target" }
  if (new Set(inputs.inventory.map((piece) => piece?.id)).size !== inputs.inventory.length)
    return { status: "error", reason: "invalid-equipment" }
  const actual = GEAR_SLOTS.map((slot) =>
    inputs.inventory.find(
      (piece) => piece && piece.id === inputs.equipped[slot] && piece.slot === slot,
    ),
  )
  if (actual.some((piece) => !piece || !validPlannerPiece(piece)))
    return { status: "error", reason: "invalid-equipment" }
  return aggregateStatBudget(target.id, target.gear, actual as GearPiece[])
}

export function aggregateStatBudget(
  targetId: string,
  target: readonly GearPiece[],
  actual: readonly GearPiece[],
): GlobalStatBudget {
  const rows = new Map<GearWordId, GlobalStatRow>()
  for (const piece of target)
    for (const entry of piece.words) {
      if (!entry.word) continue
      const row = rows.get(entry.word) ?? {
        word: entry.word,
        unit: GEAR_WORD_UNIT[entry.word],
        targetCount: 0,
        actualCount: 0,
        missing: 0,
        excess: 0,
        targetValue: 0,
        actualValue: 0,
        valueDeficit: 0,
        contributors: [],
      }
      row.targetCount++
      row.targetValue += entry.value
      rows.set(entry.word, row)
    }
  for (const piece of actual)
    for (const entry of piece.words) {
      if (!entry.word) continue
      const row = rows.get(entry.word) ?? {
        word: entry.word,
        unit: GEAR_WORD_UNIT[entry.word],
        targetCount: 0,
        actualCount: 0,
        missing: 0,
        excess: 0,
        targetValue: 0,
        actualValue: 0,
        valueDeficit: 0,
        contributors: [],
      }
      row.actualCount++
      row.actualValue += entry.value
      let contribution = row.contributors.find((contributor) => contributor.slot === piece.slot)
      if (!contribution) {
        contribution = { slot: piece.slot, count: 0, value: 0 }
        row.contributors.push(contribution)
      }
      contribution.count++
      contribution.value += entry.value
      rows.set(entry.word, row)
    }
  const result = [...rows.values()]
  for (const row of result) {
    row.missing = Math.max(0, row.targetCount - row.actualCount)
    row.excess = Math.max(0, row.actualCount - row.targetCount)
    row.valueDeficit = Math.max(0, row.targetValue - row.actualValue)
  }
  return {
    status: "ok",
    targetId,
    rows: result,
    covered: result.reduce((sum, row) => sum + Math.min(row.actualCount, row.targetCount), 0),
    targetCount: result.reduce((sum, row) => sum + row.targetCount, 0),
    actualTargetCount: result
      .filter((row) => row.targetCount > 0)
      .reduce((sum, row) => sum + row.actualCount, 0),
    actualLineCount: result.reduce((sum, row) => sum + row.actualCount, 0),
    missing: result.reduce((sum, row) => sum + row.missing, 0),
    excess: result.reduce((sum, row) => sum + row.excess, 0),
  }
}
