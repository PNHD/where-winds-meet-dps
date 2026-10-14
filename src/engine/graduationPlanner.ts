import { bestBuildDps, BEST_BUILD_LIMITS, findBestBuild } from "./bestBuild"
import { activeRotationForInputs } from "./dps"
import {
  aggregateStatBudget,
  globalStatBudget,
  validPlannerPiece,
  validPartialPlannerPiece,
  type GlobalStatBudget,
} from "./globalStatBudget"
import { heirloomMatch } from "./heirloom"
import { computeRetunement } from "./retunementAnalysis"
import { getWordSpecs, computeRanking } from "./itemRanking"
import { withDerivedStats } from "./derivedInputs"
import { applyArmorSet, applyBowSet } from "./panel"
import type { ItemRankingRow } from "./types"
import { followedGraduationBuild, graduationBuildAtLevel } from "./graduation"
import { gearLevelForBreakthrough } from "../definitions/baseStats/breakthroughs"
import { gearWordPoolInitial, gearWordPoolRetune } from "../data/stats/gearWordPools"
import { gearWordMaxRoll } from "../data/stats/statLines"
import { attributeForClass } from "../definitions/classes/registry"
import { retuneWeightPool } from "../data/stats/gearRetuneWeights"
import { GEAR_SLOTS, type GearPiece, type GearSlot, type GearWordId, type Inputs } from "./types"

export type PlannerMode = "budget" | "dps" | "actions"
export interface PlannerOptions {
  mode: PlannerMode
  retune: boolean
  farm: boolean
  retuneCost: number | null
  retuneAttempts?: number | null
  farmCost?: number | null
}
export interface GraduationAction {
  kind: "REPLACE" | "RETUNE" | "FARM"
  slot: GearSlot
  fromId: string
  piece: GearPiece
  line?: number
  lostWord?: GearWordId | ""
  word?: GearWordId
  seedId?: string
}
export interface GraduationPlan {
  actions: GraduationAction[]
  equipment: GearPiece[]
  budget: GlobalStatBudget
  dps: number
  deltaDps: number
  valueCoverage: number
  costs: {
    swaps: number
    retuneOutcomes: number
    farmPieces: number
    conditionalRetuneCost: number | null
    scenarioMaterialCost: number | null
    expectedSpend: null
  }
  steps: {
    action: GraduationAction
    dps: number
    deltaDps: number
    covered: number
    missing: number
  }[]
}
export type GraduationPlannerResult =
  | {
      status: "error"
      reason:
        | "no-target"
        | "invalid-target"
        | "invalid-equipment"
        | "no-rotation"
        | "engine-error"
        | "invalid-cost"
    }
  | { status: "cancelled" }
  | {
      status: "ok"
      keep: GraduationPlan
      plans: GraduationPlan[]
      strategies: GraduationPlan[]
      hasDpsImprovement: boolean
      approximate: boolean
      combinations: number
      evaluated: number
      routeEvaluated: number
      excluded: number
      generationTruncated: boolean
      sensitivities: ItemRankingRow[]
      partials: {
        seed: GearPiece
        stopDps: number
        keepDps: number
        completion: GraduationPlan | null
        decision: "KEEP" | "STOP" | "UNKNOWN"
      }[]
      odds: null
      expectedSpend: null
    }

type Candidate = { piece: GearPiece; actions: GraduationAction[] }
const selectedKey = (inputs: Inputs) =>
  JSON.stringify(GEAR_SLOTS.map((slot) => inputs.equipped[slot]))
const yieldToWorker = () => new Promise((resolve) => setTimeout(resolve, 0))

export function planValueCoverage(budget: GlobalStatBudget): number {
  const targets = budget.rows.filter((row) => row.targetValue > 0)
  return (
    targets.reduce((sum, row) => sum + Math.min(1, row.actualValue / row.targetValue), 0) /
    targets.length
  )
}

function costsFor(actions: GraduationAction[], options: PlannerOptions): GraduationPlan["costs"] {
  const retuneOutcomes = actions.filter((action) => action.kind === "RETUNE").length
  const farmPieces = actions.filter((action) => action.kind === "FARM").length
  const retuneScenario =
    retuneOutcomes === 0
      ? 0
      : options.retuneCost == null || options.retuneAttempts == null
        ? null
        : retuneOutcomes * options.retuneCost * options.retuneAttempts
  const farmScenario =
    farmPieces === 0 ? 0 : options.farmCost == null ? null : farmPieces * options.farmCost
  return {
    swaps: actions.filter((action) => action.kind === "REPLACE").length,
    retuneOutcomes,
    farmPieces,
    conditionalRetuneCost:
      retuneOutcomes === 0
        ? 0
        : options.retuneCost === null
          ? null
          : retuneOutcomes * options.retuneCost,
    scenarioMaterialCost:
      retuneScenario === null || farmScenario === null ? null : retuneScenario + farmScenario,
    expectedSpend: null,
  }
}

function planPriority(plan: GraduationPlan, mode: PlannerMode): number[] {
  const actions = plan.actions.length
  if (mode === "budget") return [plan.budget.covered, plan.valueCoverage, plan.dps, -actions]
  if (mode === "actions") {
    const cost = plan.costs.scenarioMaterialCost
    if (cost === null) return [0, 0, 0, plan.dps, -actions]
    return [
      1,
      cost === 0 && plan.deltaDps > 0 ? 2 : plan.deltaDps < 0 ? -1 : 1,
      cost > 0 ? plan.deltaDps / cost : plan.deltaDps,
      plan.dps,
      -actions,
    ]
  }
  return [plan.dps, plan.budget.covered, plan.valueCoverage, -actions]
}

function comparePlans(left: GraduationPlan, right: GraduationPlan, mode: PlannerMode): number {
  const leftPriority = planPriority(left, mode)
  const rightPriority = planPriority(right, mode)
  for (let index = 0; index < leftPriority.length; index++) {
    if (leftPriority[index] !== rightPriority[index])
      return rightPriority[index] - leftPriority[index]
  }
  for (let index = 0; index < left.equipment.length; index++) {
    const leftId = left.equipment[index].id
    const rightId = right.equipment[index].id
    if (leftId !== rightId) return leftId < rightId ? -1 : 1
  }
  return 0
}

export async function planGraduation(
  inputs: Inputs,
  options: PlannerOptions,
  control: { cancelled?: () => boolean; score?: (inputs: Inputs) => number } = {},
): Promise<GraduationPlannerResult> {
  const cancelled = () => control.cancelled?.() ?? false
  if (cancelled()) return { status: "cancelled" }
  if (
    options.retuneCost !== null &&
    (!Number.isFinite(options.retuneCost) || options.retuneCost < 0)
  )
    return { status: "error", reason: "invalid-cost" }
  if (
    [options.retuneAttempts, options.farmCost].some(
      (value) => value != null && (!Number.isFinite(value) || value < 0),
    ) ||
    (options.retuneAttempts != null && options.retuneAttempts < 1)
  )
    return { status: "error", reason: "invalid-cost" }
  const baselineBudget = globalStatBudget(inputs)
  if (baselineBudget.status === "error") return baselineBudget
  if (!activeRotationForInputs(inputs)) return { status: "error", reason: "no-rotation" }
  const score = control.score ?? bestBuildDps
  try {
    const target = graduationBuildAtLevel(
      followedGraduationBuild(inputs)!,
      "maxRolls",
      gearLevelForBreakthrough(inputs.breakthrough),
    )
    const baselineDps = score(inputs)
    if (!Number.isFinite(baselineDps)) throw new Error("Non-finite DPS")
    const keep: GraduationPlan = {
      actions: [],
      equipment: GEAR_SLOTS.map((slot) =>
        inputs.inventory.find((piece) => piece.id === inputs.equipped[slot])!,
      ),
      budget: baselineBudget,
      dps: baselineDps,
      deltaDps: 0,
      valueCoverage: planValueCoverage(baselineBudget),
      costs: costsFor([], options),
      steps: [],
    }
    const candidates = new Map<string, Candidate>()
    const occupied = new Set(inputs.inventory.map((piece) => piece.id))
    let truncated = false
    function add(piece: GearPiece, actions: GraduationAction[]): void {
      if (candidates.size >= BEST_BUILD_LIMITS.plannerPieces) {
        truncated = true
        return
      }
      candidates.set(piece.id, { piece, actions })
    }
    function uniqueId(parts: unknown[]): string {
      let id = `planner:${JSON.stringify(parts)}`
      while (occupied.has(id)) id += "~"
      occupied.add(id)
      return id
    }
    const originals = inputs.inventory
      .filter(validPlannerPiece)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    if (originals.length > BEST_BUILD_LIMITS.plannerPieces)
      return { status: "error", reason: "invalid-equipment" }
    for (const piece of originals)
      add(
        piece,
        piece.id === inputs.equipped[piece.slot]
          ? []
          : [{ kind: "REPLACE", slot: piece.slot, fromId: inputs.equipped[piece.slot]!, piece }],
      )
    for (const [index, piece] of originals.entries()) {
      if (cancelled()) return { status: "cancelled" }
      if (options.retune && heirloomMatch(piece, inputs).builds.length === 0) {
        const analysis = computeRetunement({ reqId: 0, inputs, pieceId: piece.id }, () => 0)
        const specs = getWordSpecs(inputs, piece.level)
        const attribute = attributeForClass(inputs.classId)
        const weights = attribute ? retuneWeightPool(attribute, piece.level, piece.slot) : null
        for (const row of analysis.rows.filter((row) => row.legal && !row.isCurrent)) {
          const value =
            weights?.find((line) => line.word === row.word)?.bands[2].max ??
            specs.find((spec) => spec.word === row.word)?.amount
          if (value === undefined) continue
          const outcome: GearPiece = {
            ...piece,
            id: uniqueId(["retune", piece.id, row.slotIndex, row.word]),
            words: piece.words.map((entry, line) =>
              line === row.slotIndex ? { word: row.word, value, retuned: true } : { ...entry },
            ) as GearPiece["words"],
            retunedOutWords: [
              ...new Set(
                [...(piece.retunedOutWords ?? []), piece.words[row.slotIndex].word].filter(
                  (word): word is GearWordId => word !== "",
                ),
              ),
            ],
          }
          if (!validPlannerPiece(outcome)) continue
          add(outcome, [
            ...candidates.get(piece.id)!.actions,
            {
              kind: "RETUNE",
              slot: piece.slot,
              fromId: piece.id,
              piece: outcome,
              line: row.slotIndex,
              lostWord: piece.words[row.slotIndex].word,
              word: row.word,
            },
          ])
        }
      }
      if (index % BEST_BUILD_LIMITS.yieldEvery === 0) await yieldToWorker()
    }
    let partialSeeds: GearPiece[] = []
    if (options.farm) {
      partialSeeds = inputs.inventory
        .filter(
          (piece) =>
            validPartialPlannerPiece(piece) && !validPlannerPiece(piece) && !!piece.words[0].word,
        )
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      if (partialSeeds.length > BEST_BUILD_LIMITS.farmConceptsPerSlot) truncated = true
      partialSeeds = partialSeeds.slice(0, BEST_BUILD_LIMITS.farmConceptsPerSlot)
      for (const seed of partialSeeds.filter(
        (piece) =>
          validPartialPlannerPiece(piece) &&
          !validPlannerPiece(piece) &&
          !!piece.words[0].word &&
          !piece.relayed &&
          !piece.retunedOutWords?.length,
      )) {
        let concepts = 0
        const wanted = baselineBudget.rows
          .filter((row) => row.targetCount > 0)
          .map((row) => row.word)
        const pool = gearWordPoolRetune(seed.level, seed.slot)
        function complete(line: number, words: GearPiece["words"]): void {
          if (concepts >= BEST_BUILD_LIMITS.farmConceptsPerSlot) {
            truncated = true
            return
          }
          if (line === words.length) {
            const piece = { ...seed, id: uniqueId(["partial", seed.id, words]), words }
            if (!validPlannerPiece(piece)) return
            concepts++
            add(piece, [
              {
                kind: "FARM",
                slot: seed.slot,
                fromId: inputs.equipped[seed.slot]!,
                piece,
                seedId: seed.id,
              },
            ])
            return
          }
          if (words[line].word) {
            complete(line + 1, words)
            return
          }
          for (const word of wanted.filter((word) => pool.includes(word))) {
            const next = words.map((entry, index) =>
              index === line
                ? { word, value: gearWordMaxRoll(word, seed.level), retuned: false }
                : entry,
            ) as GearPiece["words"]
            if (validPartialPlannerPiece({ ...seed, words: next })) complete(line + 1, next)
          }
        }
        complete(1, seed.words)
        await yieldToWorker()
        if (cancelled()) return { status: "cancelled" }
      }
      for (const targetPiece of target.gear) {
        if (cancelled()) return { status: "cancelled" }
        const wanted = baselineBudget.rows
          .filter((row) => row.targetCount > 0)
          .sort((left, right) => right.missing - left.missing || (left.word < right.word ? -1 : 1))
          .map((row) => row.word)
        const initial = gearWordPoolInitial(targetPiece.level, targetPiece.slot)
        const pool = gearWordPoolRetune(targetPiece.level, targetPiece.slot)
        let concepts = 0
        function enumerate(
          first: GearWordId,
          rest: GearWordId[],
          offset: number,
          chosen: GearWordId[],
        ): void {
          if (concepts > BEST_BUILD_LIMITS.farmConceptsPerSlot) return
          if (chosen.length === 4) {
            concepts++
            if (concepts > BEST_BUILD_LIMITS.farmConceptsPerSlot) {
              truncated = true
              return
            }
            const words = [first, ...chosen]
            const piece: GearPiece = {
              ...targetPiece,
              id: uniqueId(["farm", targetPiece.slot, words]),
              label: undefined,
              words: words.map((word) => ({
                word,
                value: gearWordMaxRoll(word, targetPiece.level),
                retuned: false,
              })) as GearPiece["words"],
              retunedOutWords: [],
              relayed: false,
            }
            if (validPlannerPiece(piece))
              add(piece, [
                { kind: "FARM", slot: piece.slot, fromId: inputs.equipped[piece.slot]!, piece },
              ])
            return
          }
          for (let index = offset; index < rest.length; index++)
            enumerate(first, rest, index + 1, [...chosen, rest[index]])
        }
        for (const first of wanted.filter((word) => initial.includes(word)))
          enumerate(
            first,
            wanted.filter((word) => pool.includes(word)),
            0,
            [],
          )
        await yieldToWorker()
      }
    }
    if (cancelled()) return { status: "cancelled" }
    const inventory = [...candidates.values()].map((candidate) => candidate.piece)
    const evaluated = new Map<string, GraduationPlan>([[selectedKey(inputs), keep]])
    function evaluate(build: Inputs): number {
      const key = selectedKey(build)
      const prior = evaluated.get(key)
      if (prior) return prior.dps
      const equipment = GEAR_SLOTS.map((slot) => candidates.get(build.equipped[slot]!)!)
      const budget = aggregateStatBudget(
        target.id,
        target.gear,
        equipment.map((candidate) => candidate.piece),
      )
      const actions = equipment.flatMap((candidate) => candidate.actions)
      const dps = score(build)
      if (!Number.isFinite(dps)) throw new Error("Non-finite DPS")
      evaluated.set(key, {
        actions,
        equipment: equipment.map((candidate) => candidate.piece),
        budget,
        dps,
        deltaDps: dps - baselineDps,
        valueCoverage: planValueCoverage(budget),
        costs: costsFor(actions, options),
        steps: [],
      })
      return dps
    }
    const search = await findBestBuild(
      { ...inputs, inventory },
      {
        cancelled,
        score: evaluate,
        evaluationLimit: BEST_BUILD_LIMITS.plannerEvaluations,
        priority: (build) => planPriority(evaluated.get(selectedKey(build))!, options.mode),
      },
    )
    if (search.status === "cancelled") return search
    if (search.status === "error")
      return {
        status: "error",
        reason: search.reason === "no-rotation" ? "no-rotation" : "engine-error",
      }
    const ranked = [...evaluated.values()].sort((left, right) =>
      comparePlans(left, right, options.mode),
    )
    const plans = ranked
      .filter(
        (plan) =>
          plan.actions.length > 0 &&
          (options.mode !== "actions" || plan.costs.scenarioMaterialCost !== null),
      )
      .slice(0, 3)
    const strategies = [
      ranked.find(
        (plan) =>
          plan.actions.length > 0 && plan.actions.every((action) => action.kind === "REPLACE"),
      ),
      ranked.find((plan) => plan.costs.retuneOutcomes > 0 && plan.costs.farmPieces === 0),
      ranked.find((plan) => plan.costs.farmPieces > 0),
    ].filter((plan): plan is GraduationPlan => !!plan)
    let routeEvaluated = 0
    let routeVisited = 0
    let routeApproximate = false
    const routes = new Set([...plans, ...strategies])
    for (const plan of routes) {
      const actions = plan.actions
      const routeLimit = Math.floor(BEST_BUILD_LIMITS.routeEvaluations / routes.size)
      let localEvaluated = 0
      type Route = {
        state: Inputs
        used: number
        steps: GraduationPlan["steps"]
        priority: number[]
      }
      const compareRoutes = (left: Route, right: Route) => {
        for (let index = 0; index < left.priority.length; index++)
          if (left.priority[index] !== right.priority[index])
            return right.priority[index] - left.priority[index]
        const leftKey = left.steps.map((step) => actions.indexOf(step.action)).join(",")
        const rightKey = right.steps.map((step) => actions.indexOf(step.action)).join(",")
        return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1
      }
      let beam: Route[] = [
        { state: inputs, used: 0, steps: [], priority: [0, 0, Number.MAX_VALUE] },
      ]
      for (let depth = 0; depth < actions.length; depth++) {
        if (cancelled()) return { status: "cancelled" }
        const next = new Map<number, Route>()
        expansion: for (const route of beam)
          for (const [index, action] of actions.entries()) {
            if (route.used & (1 << index) || route.state.equipped[action.slot] !== action.fromId)
              continue
            if (next.size > 0 && localEvaluated >= routeLimit - (actions.length - depth)) {
              routeApproximate = true
              break expansion
            }
            const state = {
              ...route.state,
              inventory: [
                ...route.state.inventory.filter((piece) => piece.id !== action.piece.id),
                action.piece,
              ],
              equipped: { ...route.state.equipped, [action.slot]: action.piece.id },
            }
            const budget = aggregateStatBudget(
              target.id,
              target.gear,
              GEAR_SLOTS.map((slot) =>
                state.inventory.find((piece) => piece.id === state.equipped[slot])!,
              ),
            )
            const cached = evaluated.get(selectedKey(state))
            const dps = cached?.dps ?? score(state)
            if (!Number.isFinite(dps)) throw new Error("Non-finite route DPS")
            if (!cached) {
              localEvaluated++
              routeEvaluated++
            }
            const step = {
              action,
              dps,
              deltaDps: dps - baselineDps,
              covered: budget.covered,
              missing: budget.missing,
            }
            const candidate: Route = {
              state,
              used: route.used | (1 << index),
              steps: [...route.steps, step],
              priority: [
                route.priority[0] + step.deltaDps,
                route.priority[1] + step.covered,
                Math.min(route.priority[2], step.deltaDps),
              ],
            }
            const prior = next.get(candidate.used)
            if (!prior || compareRoutes(candidate, prior) < 0) next.set(candidate.used, candidate)
            if (++routeVisited % BEST_BUILD_LIMITS.yieldEvery === 0) await yieldToWorker()
            if (cancelled()) return { status: "cancelled" }
          }
        if (next.size === 0) throw new Error("Invalid route")
        if (next.size > BEST_BUILD_LIMITS.beam) routeApproximate = true
        beam = [...next.values()].sort(compareRoutes).slice(0, BEST_BUILD_LIMITS.beam)
      }
      plan.steps = beam[0].steps
      plan.actions = plan.steps.map((step) => step.action)
    }
    const approximate = search.approximate || truncated || routeApproximate
    const partials = options.farm
      ? partialSeeds.map((seed) => {
          const completion =
            [...evaluated.values()]
              .filter((plan) => plan.actions.some((action) => action.seedId === seed.id))
              .sort((left, right) => comparePlans(left, right, options.mode))[0] ?? null
          const matchedPieces = completion?.equipment ?? keep.equipment
          const matchedInventory = [
            ...inputs.inventory.filter(
              (piece) => !matchedPieces.some((entry) => entry.id === piece.id),
            ),
            ...matchedPieces,
          ]
          const matched = [seed, keep.equipment.find((piece) => piece.slot === seed.slot)!].map(
            (piece) => {
              const equipment = matchedPieces.map((entry) =>
                entry.slot === seed.slot ? piece : entry,
              )
              const actions = (completion?.actions ?? []).filter(
                (action) => action.slot !== seed.slot,
              )
              if (piece.id !== inputs.equipped[seed.slot])
                actions.push({
                  kind: "REPLACE",
                  slot: seed.slot,
                  fromId: inputs.equipped[seed.slot]!,
                  piece,
                })
              const dps = score({
                ...inputs,
                inventory: matchedInventory,
                equipped: Object.fromEntries(
                  equipment.map((entry) => [entry.slot, entry.id]),
                ) as Inputs["equipped"],
              })
              if (!Number.isFinite(dps)) throw new Error("Non-finite partial DPS")
              const budget = aggregateStatBudget(target.id, target.gear, equipment)
              return {
                ...(completion ?? keep),
                actions,
                equipment,
                dps,
                deltaDps: dps - baselineDps,
                budget,
                valueCoverage: planValueCoverage(budget),
                costs: costsFor(actions, options),
              }
            },
          )
          const unknownCost =
            options.mode === "actions" &&
            (!completion ||
              completion.costs.scenarioMaterialCost === null ||
              matched.some((plan) => plan.costs.scenarioMaterialCost === null))
          const decision = unknownCost
            ? ("UNKNOWN" as const)
            : completion &&
                matched.every((plan) => comparePlans(completion, plan, options.mode) < 0)
              ? ("KEEP" as const)
              : approximate || completion === null
                ? ("UNKNOWN" as const)
                : ("STOP" as const)
          return { seed, stopDps: matched[0].dps, keepDps: matched[1].dps, completion, decision }
        })
      : []
    return {
      status: "ok",
      keep,
      plans,
      strategies,
      hasDpsImprovement: ranked.some((plan) => plan.deltaDps > 0),
      approximate,
      combinations: search.combinations,
      evaluated: search.evaluated,
      routeEvaluated,
      excluded: inputs.inventory.length - originals.length,
      generationTruncated: truncated,
      sensitivities: control.score
        ? []
        : computeRanking(
            applyBowSet(applyArmorSet(withDerivedStats(inputs))),
            baselineDps,
            baselineBudget.rows.filter((row) => row.targetCount > 0).map((row) => row.word),
          ).filter((row) => row.source === "tunement"),
      partials,
      odds: null,
      expectedSpend: null,
    }
  } catch {
    return cancelled() ? { status: "cancelled" } : { status: "error", reason: "engine-error" }
  }
}
