import { useState } from "react"
import { BEST_BUILD_LIMITS } from "../../../../engine/bestBuildSelection"
import type { GraduationPlan, PlannerOptions } from "../../../../engine/graduationPlanner"
import type { Inputs } from "../../../../engine/types"
import { GEAR_WORD_UNIT } from "../../../../data/stats/statLines"
import { statLineKey } from "../../../../i18n/contentKeys"
import { useI18n } from "../../../../i18n/i18nContext"
import { useGraduationPlanner } from "../../../hooks/useGraduationPlanner"
import { NumInput } from "../../../components/number-inputs/NumberInputs"
import { Select } from "../../../components/select/Select"
import { BudgetRows } from "../global-stat-budget-panel/GlobalStatBudgetPanel"
import { GEAR_SLOT_KEYS } from "../shared/gearSlotKeys"
import styles from "./GraduationPlannerPanel.module.scss"

const ERROR_KEYS = {
  "no-target": "gear.globalBudget.noTarget",
  "invalid-target": "gear.globalBudget.invalidTarget",
  "invalid-equipment": "gear.globalBudget.invalidEquipment",
  "no-rotation": "gear.bestBuild.noRotation",
  "engine-error": "gear.bestBuild.engineError",
  "invalid-cost": "gear.graduationPlanner.invalidCost",
}
const ACTION_KEYS = {
  REPLACE: "gear.graduationPlanner.replace",
  RETUNE: "gear.graduationPlanner.retune",
  FARM: "gear.graduationPlanner.farm",
}
const MODE_KEYS = {
  budget: "gear.graduationPlanner.budgetMode",
  dps: "gear.graduationPlanner.dpsMode",
  actions: "gear.graduationPlanner.actionsMode",
}
const DECISION_KEYS = {
  KEEP: "gear.graduationPlanner.holdSeed",
  STOP: "gear.graduationPlanner.stopSeed",
  UNKNOWN: "gear.graduationPlanner.unknown",
}
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`

function PlanCard({ plan, keep }: { plan: GraduationPlan; keep: GraduationPlan }) {
  const { t } = useI18n()
  const pieceName = (piece: GraduationPlan["equipment"][number]) =>
    piece.label || t(GEAR_SLOT_KEYS[piece.slot])
  return (
    <article className={styles.card}>
      <h4>
        {plan.actions.length === 0
          ? t("gear.graduationPlanner.keep")
          : `${t("gear.graduationPlanner.plan")} · ${plan.actions.length}`}
      </h4>
      <p>
        {t("gear.graduationPlanner.modeledDps")}: {plan.dps.toFixed(2)} ·{" "}
        {t("gear.graduationPlanner.signedDelta")}: {signed(plan.deltaDps)} ·{" "}
        {t("gear.globalBudget.covered")}: {plan.budget.covered}/{plan.budget.targetCount} ·{" "}
        {t("gear.globalBudget.missing")}: {plan.budget.missing}
      </p>
      <p>
        {t("gear.graduationPlanner.valueCoverage")}: {(plan.valueCoverage * 100).toFixed(2)}% ·{" "}
        {t("gear.graduationPlanner.resources")}: {plan.costs.swaps}/{plan.costs.retuneOutcomes}/
        {plan.costs.farmPieces} · {t("gear.graduationPlanner.conditionalCost")}:{" "}
        {plan.costs.conditionalRetuneCost === null
          ? t("gear.graduationPlanner.unknown")
          : plan.costs.conditionalRetuneCost}{" "}
        · {t("gear.graduationPlanner.expected")}:{" "}
        {plan.actions.some((action) => action.kind !== "REPLACE")
          ? t("gear.graduationPlanner.unknown")
          : 0}
      </p>
      <p>
        {t("gear.graduationPlanner.scenarioCost")}:{" "}
        {plan.costs.scenarioMaterialCost ?? t("gear.graduationPlanner.unknown")}
      </p>
      {plan.actions.length > 0 && (
        <ol>
          {plan.steps.map((step, index) => (
            <li key={index}>
              {t("gear.graduationPlanner.pendingAction")} · {t(ACTION_KEYS[step.action.kind])} ·{" "}
              {t(GEAR_SLOT_KEYS[step.action.slot])}:{" "}
              {pieceName(
                keep.equipment.find((piece) => piece.id === step.action.fromId) ??
                  plan.actions.find((action) => action.piece.id === step.action.fromId)?.piece ??
                  step.action.piece,
              )}{" "}
              → {pieceName(step.action.piece)}
              {step.action.kind === "RETUNE" && (
                <>
                  {" "}
                  · {t("gear.graduationPlanner.line")} {step.action.line! + 1}:{" "}
                  {step.action.lostWord && t(statLineKey(step.action.lostWord))} →{" "}
                  {t(statLineKey(step.action.word!))}
                </>
              )}
              <p>
                {t("gear.graduationPlanner.afterStep")}: {signed(step.deltaDps)} · {step.covered}/
                {plan.budget.targetCount} · {t("gear.globalBudget.missing")}: {step.missing}
              </p>
            </li>
          ))}
        </ol>
      )}
      {plan.actions.length > 0 && (
        <details>
          <summary>{t("gear.graduationPlanner.tradeoffs")}</summary>
          <ul>
            {[
              ...new Map(
                [...keep.budget.rows, ...plan.budget.rows].map((row) => [row.word, row]),
              ).values(),
            ].map((row) => {
              const before = keep.budget.rows.find((entry) => entry.word === row.word)
              const after = plan.budget.rows.find((entry) => entry.word === row.word)
              const count = (after?.actualCount ?? 0) - (before?.actualCount ?? 0)
              const value = (after?.actualValue ?? 0) - (before?.actualValue ?? 0)
              return count !== 0 || Math.abs(value) > 1e-9 ? (
                <li key={row.word}>
                  {t(statLineKey(row.word))}: {signed(count)} {t("gear.globalBudget.lines")} ·{" "}
                  {signed(row.unit === "percent" ? value * 100 : value)}
                  {row.unit === "percent" ? "%" : ""}
                </li>
              ) : null
            })}
          </ul>
        </details>
      )}
      <details>
        <summary>{t("gear.graduationPlanner.endState")}</summary>
        <ul>
          {plan.equipment.map((piece) => (
            <li key={piece.slot}>
              {t(GEAR_SLOT_KEYS[piece.slot])}: {pieceName(piece)} · {piece.level} ·{" "}
              {t(
                piece.rarity === "legendary"
                  ? "gear.graduationPlanner.legendary"
                  : "gear.graduationPlanner.epic",
              )}
              {piece.relayed && <> · {t("gear.graduationPlanner.relayed")}</>}
              <ol>
                {piece.words.map(
                  (entry, index) =>
                    entry.word && (
                      <li key={index}>
                        {t(statLineKey(entry.word))}:{" "}
                        {GEAR_WORD_UNIT[entry.word] === "percent"
                          ? `${(entry.value * 100).toFixed(2)}%`
                          : entry.value.toFixed(2)}
                      </li>
                    ),
                )}
              </ol>
            </li>
          ))}
        </ul>
        <BudgetRows budget={plan.budget} />
      </details>
    </article>
  )
}

export function GraduationPlannerPanel({
  inputs,
  profileId,
}: {
  inputs: Inputs
  profileId?: string
}) {
  const { t } = useI18n()
  const [options, setOptions] = useState<PlannerOptions>({
    mode: "budget",
    retune: true,
    farm: false,
    retuneCost: null,
  })
  const search = useGraduationPlanner(inputs, options, profileId)
  const result = search.result
  return (
    <section
      className="panel"
      aria-label={t("gear.graduationPlanner.title")}
      aria-busy={search.isPending}
    >
      <div className="panel-head">
        <h3>{t("gear.graduationPlanner.title")}</h3>
        <button
          type="button"
          className="btn primary"
          onClick={search.start}
          disabled={search.isPending}
        >
          {t("gear.graduationPlanner.compare")}
        </button>
        {search.isPending && (
          <button type="button" className="btn secondary" onClick={search.cancel}>
            {t("common.cancel")}
          </button>
        )}
      </div>
      <p>{t("gear.graduationPlanner.scope")}</p>
      <div className={styles.controls}>
        <label>
          {t("gear.graduationPlanner.objective")}
          <Select
            value={options.mode}
            ariaLabel={t("gear.graduationPlanner.objective")}
            onChange={(mode) => setOptions({ ...options, mode })}
            options={(Object.keys(MODE_KEYS) as PlannerOptions["mode"][]).map((mode) => ({
              value: mode,
              label: t(MODE_KEYS[mode]),
            }))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.retune}
            onChange={(event) => setOptions({ ...options, retune: event.target.checked })}
          />
          {t("gear.graduationPlanner.includeRetune")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.farm}
            onChange={(event) => setOptions({ ...options, farm: event.target.checked })}
          />
          {t("gear.graduationPlanner.includeFarm")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.retuneCost !== null}
            onChange={(event) =>
              setOptions({ ...options, retuneCost: event.target.checked ? 0 : null })
            }
          />
          {t("gear.graduationPlanner.explicitCost")}
          {options.retuneCost !== null && (
            <NumInput
              aria-label={t("gear.graduationPlanner.explicitCost")}
              value={options.retuneCost}
              onChange={(value) => setOptions({ ...options, retuneCost: value })}
              min={0}
              step={1}
            />
          )}
        </label>
        <label>
          {t("gear.graduationPlanner.assumedAttempts")}
          <input
            type="checkbox"
            checked={options.retuneAttempts != null}
            onChange={(event) =>
              setOptions({ ...options, retuneAttempts: event.target.checked ? 1 : null })
            }
          />
          {options.retuneAttempts != null && (
            <NumInput
              aria-label={t("gear.graduationPlanner.assumedAttempts")}
              value={options.retuneAttempts}
              onChange={(value) => setOptions({ ...options, retuneAttempts: value })}
              min={1}
              step={1}
            />
          )}
        </label>
        <label>
          {t("gear.graduationPlanner.assumedFarmCost")}
          <input
            type="checkbox"
            checked={options.farmCost != null}
            onChange={(event) =>
              setOptions({ ...options, farmCost: event.target.checked ? 0 : null })
            }
          />
          {options.farmCost != null && (
            <NumInput
              aria-label={t("gear.graduationPlanner.assumedFarmCost")}
              value={options.farmCost}
              onChange={(value) => setOptions({ ...options, farmCost: value })}
              min={0}
              step={1}
            />
          )}
        </label>
      </div>
      <p>{t("gear.graduationPlanner.unknownRates")}</p>
      {search.isPending && <p role="status">{t("gear.bestBuild.searching")}</p>}
      {result?.status === "error" && <p role="alert">{t(ERROR_KEYS[result.reason])}</p>}
      {result?.status === "ok" && (
        <>
          <p role="status">
            {t(result.approximate ? "gear.bestBuild.approximate" : "gear.bestBuild.exact")} ·{" "}
            {t("gear.bestBuild.evaluated")}: {result.evaluated}/{result.combinations} ·{" "}
            {t("gear.bestBuild.excluded")}: {result.excluded} ·{" "}
            {t("gear.graduationPlanner.ceilings")}: {BEST_BUILD_LIMITS.exact}/
            {BEST_BUILD_LIMITS.plannerEvaluations}/{BEST_BUILD_LIMITS.beam}/
            {BEST_BUILD_LIMITS.rounds}/{BEST_BUILD_LIMITS.plannerPieces} ·{" "}
            {t("gear.graduationPlanner.routeChecks")}: {result.routeEvaluated}/
            {BEST_BUILD_LIMITS.routeEvaluations} · {t("gear.graduationPlanner.farmCeiling")}:{" "}
            {BEST_BUILD_LIMITS.farmConceptsPerSlot}/{BEST_BUILD_LIMITS.farmConceptsPerSlot}/
            {BEST_BUILD_LIMITS.farmConceptsPerSlot}
          </p>
          <PlanCard plan={result.keep} keep={result.keep} />
          {result.sensitivities.length > 0 && (
            <details>
              <summary>{t("gear.globalBudget.sensitivities")}</summary>
              <p>{t("gear.globalBudget.sensitivityScope")}</p>
              <ul>
                {result.sensitivities.map((row) => (
                  <li key={row.statLineId}>
                    {t(row.labelKey)} · +
                    {row.unit === "percent"
                      ? `${(row.amount * 100).toFixed(2)}%`
                      : row.amount.toFixed(2)}{" "}
                    · {t("gear.graduationPlanner.signedDelta")}: {signed(row.dpsDelta)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.partials.length > 0 && (
            <details>
              <summary>{t("gear.graduationPlanner.partialSeeds")}</summary>
              <p>{t("gear.graduationPlanner.partialScope")}</p>
              <ul>
                {result.partials.map((row) => (
                  <li key={row.seed.id}>
                    {row.seed.label || t(GEAR_SLOT_KEYS[row.seed.slot])} ·{" "}
                    {t(DECISION_KEYS[row.decision])} · {t("gear.graduationPlanner.observedDps")}:{" "}
                    {row.stopDps.toFixed(2)} · {t("gear.graduationPlanner.completionDps")}:{" "}
                    {row.completion?.dps.toFixed(2) ?? t("gear.graduationPlanner.unknown")} ·{" "}
                    {t("gear.graduationPlanner.matchedKeepDps")}: {row.keepDps.toFixed(2)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.plans.length === 0 ? (
            <p>
              {t(
                options.mode === "actions"
                  ? "gear.graduationPlanner.noResourceAlternative"
                  : "gear.graduationPlanner.noAlternative",
              )}
            </p>
          ) : (
            <>
              <h4>{t("gear.graduationPlanner.topPlans")}</h4>
              {result.plans.map((plan, index) => (
                <PlanCard key={index} plan={plan} keep={result.keep} />
              ))}
            </>
          )}
          {!result.hasDpsImprovement && <p>{t("gear.graduationPlanner.noBenefit")}</p>}
          {result.strategies.length > 0 && (
            <details>
              <summary>{t("gear.graduationPlanner.strategies")}</summary>
              {result.strategies.map((plan, index) => (
                <PlanCard key={index} plan={plan} keep={result.keep} />
              ))}
            </details>
          )}
        </>
      )}
    </section>
  )
}
