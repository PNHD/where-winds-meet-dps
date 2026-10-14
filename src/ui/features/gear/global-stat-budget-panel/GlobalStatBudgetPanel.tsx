import { useMemo } from "react"
import { globalStatBudget, type GlobalStatBudget } from "../../../../engine/globalStatBudget"
import type { Inputs } from "../../../../engine/types"
import { statLineKey } from "../../../../i18n/contentKeys"
import { useI18n } from "../../../../i18n/i18nContext"
import { GEAR_SLOT_KEYS } from "../shared/gearSlotKeys"
import styles from "./GlobalStatBudgetPanel.module.scss"
import { StatsOverviewPanel } from "../../../components/stats-overview-panel/StatsOverviewPanel"
import { withDerivedStats } from "../../../../engine/derivedInputs"
import { applyArmorSet, applyBowSet, effectiveRates } from "../../../../engine/panel"
import { AFFINITY_RATE_CAP, CRIT_RATE_CAP, PRECISION_RATE_CAP } from "../../../../engine/formula"
import { getWordSpecs } from "../../../../engine/itemRanking"
import { listKnownPaths } from "../../../../engine/gearStats"
import { STAT_LINES } from "../../../../data/stats/statLines"
import { readPath, statPathLabel } from "../../../utils/statFormatting"
import { gearLevelForBreakthrough } from "../../../../definitions/baseStats/breakthroughs"

const ERROR_KEYS = {
  "no-target": "gear.globalBudget.noTarget",
  "invalid-target": "gear.globalBudget.invalidTarget",
  "invalid-equipment": "gear.globalBudget.invalidEquipment",
}

function budgetValue(value: number, unit: "raw" | "percent"): string {
  return unit === "percent" ? `${(value * 100).toFixed(2)}%` : value.toFixed(2)
}

export function BudgetRows({ budget, inputs }: { budget: GlobalStatBudget; inputs?: Inputs }) {
  const { t } = useI18n()
  const specs = inputs ? getWordSpecs(inputs, gearLevelForBreakthrough(inputs.breakthrough)) : []
  return (
    <div className={styles.rows}>
      {budget.rows.map((row) => (
        <div key={row.word} className={styles.row}>
          <strong>{t(statLineKey(row.word))}</strong>
          {inputs && (
            <span>
              {t("gear.globalBudget.engineStats")}:{" "}
              {(() => {
                const applied = specs.find((spec) => spec.word === row.word)?.apply(inputs, 1)
                const paths = applied
                  ? listKnownPaths().filter(
                      (path) => readPath(applied, path) !== readPath(inputs, path),
                    )
                  : STAT_LINES.filter((line) => line.id === row.word).flatMap((line) =>
                      "enginePath" in line ? [line.enginePath] : [],
                    )
                return (
                  paths.map((path) => statPathLabel(path, t)).join(", ") ||
                  t("gear.graduationPlanner.unknown")
                )
              })()}
            </span>
          )}
          <span>
            {t("gear.globalBudget.lines")}: {row.actualCount}/{row.targetCount} ·{" "}
            {t("gear.globalBudget.missing")}: {row.missing} · {t("gear.globalBudget.excess")}:{" "}
            {row.excess}
          </span>
          <span>
            {t("gear.globalBudget.rolls")}: {budgetValue(row.actualValue, row.unit)}/
            {budgetValue(row.targetValue, row.unit)} · {t("gear.globalBudget.valueDeficit")}:{" "}
            {budgetValue(row.valueDeficit, row.unit)}
          </span>
          <details>
            <summary>{t("gear.globalBudget.contributors")}</summary>
            <ul>
              {row.contributors.map((entry) => (
                <li key={entry.slot}>
                  {t(GEAR_SLOT_KEYS[entry.slot])}: {entry.count} ·{" "}
                  {budgetValue(entry.value, row.unit)}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ))}
    </div>
  )
}

export function GlobalStatBudgetPanel({ inputs }: { inputs: Inputs }) {
  const { t } = useI18n()
  const budget = useMemo(() => globalStatBudget(inputs), [inputs])
  const rates = useMemo(
    () =>
      budget.status === "ok"
        ? effectiveRates(applyBowSet(applyArmorSet(withDerivedStats(inputs))))
        : null,
    [inputs, budget],
  )
  return (
    <section className="panel" aria-label={t("gear.globalBudget.title")}>
      <div className="panel-head">
        <h3>{t("gear.globalBudget.title")}</h3>
      </div>
      <p>{t("gear.globalBudget.scope")}</p>
      {budget.status === "error" ? (
        <p role="status">{t(ERROR_KEYS[budget.reason])}</p>
      ) : (
        <>
          <p role="status">
            {t("gear.globalBudget.covered")}: {budget.covered}/{budget.targetCount} ·{" "}
            {t("gear.globalBudget.missing")}: {budget.missing} ·{" "}
            {t("gear.globalBudget.targetLines")}: {budget.actualTargetCount} ·{" "}
            {t("gear.globalBudget.excess")}: {budget.excess}
          </p>
          <BudgetRows budget={budget} inputs={inputs} />
          {rates && (
            <details>
              <summary>{t("gear.globalBudget.derivedCaps")}</summary>
              <p>{t("gear.globalBudget.capScope")}</p>
              {[
                ["precision", rates.precision, PRECISION_RATE_CAP],
                ["critRate", rates.critRate, CRIT_RATE_CAP],
                ["affinityRate", rates.affinityRate, AFFINITY_RATE_CAP],
              ].map(([path, value, cap]) => (
                <p key={path}>
                  {statPathLabel(String(path), t)} · {t("gear.globalBudget.effectiveCap")}:{" "}
                  {budgetValue(Math.min(Math.max(Number(value), 0), Number(cap)), "percent")} /{" "}
                  {budgetValue(Number(cap), "percent")} · {t("gear.globalBudget.overflow")}:{" "}
                  {budgetValue(Math.max(0, Number(value) - Number(cap)), "percent")}
                </p>
              ))}
              <StatsOverviewPanel inputs={inputs} />
            </details>
          )}
        </>
      )}
    </section>
  )
}
