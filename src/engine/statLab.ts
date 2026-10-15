import { gearLevelForBreakthrough } from "../definitions/baseStats/breakthroughs"
import { GEAR_WORD_LINES } from "../data/stats/statLines"
import { statLineKey } from "../i18n/contentKeys"
import { attunementLabelKey, attunementsForClass, getAttunement } from "./attunements"
import { runEngine } from "./dps"
import { evaluateStatIncrement, rankingCatalogues, withRankingLeads } from "./itemRanking"
import type { Inputs, ItemRankingRow } from "./types"

export const STAT_LAB_MAX_CHANGES = 8

export interface StatChange {
  source: ItemRankingRow["source"]
  statLineId: string
  amount: number
}

export function statLabOptions(inputs: Inputs) {
  return rankingCatalogues(inputs).flatMap(({ source, specs }) =>
    specs
      .filter((spec) => source === "tunement" || !!getAttunement(spec.word)?.enginePath)
      .map((spec) => ({ ...spec, source })),
  )
}

export function unavailableStatKeys(inputs: Inputs): string[] {
  const available = new Set(statLabOptions(inputs).map((spec) => spec.word))
  return [
    ...GEAR_WORD_LINES.filter((line) => !available.has(line.id)).map((line) =>
      statLineKey(line.id),
    ),
    ...attunementsForClass(inputs.classId)
      .filter(
        (option) => !available.has(option.id) && !["physPen", "formlessPen"].includes(option.id),
      )
      .map((option) => attunementLabelKey(option, inputs.classId)),
  ]
}

export function compareStatPriority(first: ItemRankingRow, second: ItemRankingRow): number {
  if (first.dpsDelta !== second.dpsDelta) return second.dpsDelta - first.dpsDelta
  const firstKey = `${first.source}:${first.statLineId}`
  const secondKey = `${second.source}:${second.statLineId}`
  return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0
}

export type StatLabResult =
  | { status: "cancelled" }
  | { status: "error"; reason: "invalid-change" | "non-finite" | "evaluation" }
  | {
      status: "ok"
      level: number
      baselineDps: number
      hypotheticalDps: number
      deltaDps: number
      deltaPercent: number | null
      rows: ItemRankingRow[]
    }

export async function computeStatLab(
  inputs: Inputs,
  changes: readonly StatChange[],
  cancelled: () => boolean = () => false,
): Promise<StatLabResult> {
  try {
    if (cancelled()) return { status: "cancelled" }
    const options = statLabOptions(inputs)
    if (changes.length > STAT_LAB_MAX_CHANGES) return { status: "error", reason: "invalid-change" }
    const seen = new Set<string>()
    let hypothetical = inputs
    for (const change of changes) {
      const key = `${change.source}:${change.statLineId}`
      const spec = options.find(
        (option) => option.source === change.source && option.word === change.statLineId,
      )
      if (
        !spec ||
        seen.has(key) ||
        !Number.isFinite(change.amount) ||
        Math.abs(change.amount) > spec.amount
      )
        return { status: "error", reason: "invalid-change" }
      seen.add(key)
      hypothetical = spec.apply(hypothetical, change.amount)
    }
    const baselineDps = runEngine(inputs, { collect: "totals" }).dps
    const hypotheticalDps = changes.length
      ? runEngine(hypothetical, { collect: "totals" }).dps
      : baselineDps
    if (!Number.isFinite(baselineDps) || !Number.isFinite(hypotheticalDps))
      return { status: "error", reason: "non-finite" }
    const rows: ItemRankingRow[] = []
    for (const option of options) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (cancelled()) return { status: "cancelled" }
      const row = evaluateStatIncrement(inputs, baselineDps, option, option.source)
      if (!Number.isFinite(row.expectedDps)) return { status: "error", reason: "non-finite" }
      rows.push(row)
    }
    withRankingLeads(rows).sort(compareStatPriority)
    const deltaDps = hypotheticalDps - baselineDps
    return {
      status: "ok",
      level: gearLevelForBreakthrough(inputs.breakthrough),
      baselineDps,
      hypotheticalDps,
      deltaDps,
      deltaPercent: baselineDps > 0 ? (deltaDps / baselineDps) * 100 : null,
      rows,
    }
  } catch {
    return { status: "error", reason: "evaluation" }
  }
}
