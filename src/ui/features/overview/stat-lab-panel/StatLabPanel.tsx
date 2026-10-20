import { useMemo, useState } from "react"
import { classDefinition } from "../../../../definitions/classes/registry"
import {
  statLabOptions,
  unavailableStatKeys,
  STAT_LAB_MAX_CHANGES,
  type StatChange,
} from "../../../../engine/statLab"
import type { Inputs } from "../../../../engine/types"
import { useI18n } from "../../../../i18n/i18nContext"
import { Select } from "../../../components/select/Select"
import { NumInput, PercentInput } from "../../../components/number-inputs/NumberInputs"
import { useStatLab } from "../../../hooks/useStatLab"
import { ItemRankingTable } from "../item-ranking-table/ItemRankingTable"
import styles from "./StatLabPanel.module.scss"

const NO_CHANGES: StatChange[] = []
const fmt = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 })

export function StatLabPanel({ inputs, profileId }: { inputs: Inputs; profileId?: string }) {
  const { t } = useI18n()
  const options = useMemo(() => statLabOptions(inputs), [inputs])
  const unavailable = useMemo(() => unavailableStatKeys(inputs), [inputs])
  const [draft, setDraft] = useState<{
    inputs: Inputs
    profileId?: string
    changes: StatChange[]
  } | null>(null)
  const changes =
    draft?.inputs === inputs && draft.profileId === profileId ? draft.changes : NO_CHANGES
  const lab = useStatLab(inputs, changes, profileId)
  const result = lab.result?.status === "ok" ? lab.result : null
  function update(next: StatChange[]) {
    setDraft({ inputs, profileId, changes: next })
  }
  function add() {
    const option = options.find(
      (option) =>
        !changes.some(
          (change) => change.source === option.source && change.statLineId === option.word,
        ),
    )
    if (option) update([...changes, { source: option.source, statLineId: option.word, amount: 0 }])
  }
  return (
    <section
      className={`panel ${styles.lab}`}
      aria-label={t("statLab.title")}
      aria-busy={lab.isPending}
    >
      <div className="panel-head">
        <h2>{t("statLab.title")}</h2>
        <button
          type="button"
          className="btn secondary"
          onClick={lab.isPending ? lab.cancel : lab.retry}
        >
          {lab.isPending ? t("common.cancel") : t("statLab.recalculate")}
        </button>
      </div>
      <p>{t("statLab.description")}</p>
      <p>{t("statLab.hypothetical")}</p>
      {!classDefinition(inputs.classId)?.validated && <p role="note">{t("statLab.unvalidated")}</p>}
      <h3>{t("statLab.swap")}</h3>
      {changes.map((change, index) => {
        const option = options.find(
          (option) => option.source === change.source && option.word === change.statLineId,
        )!
        const Input = option.unit === "percent" ? PercentInput : NumInput
        return (
          <div className={styles.change} key={index}>
            <div className={styles.statSelect}>
              <span>{t("statLab.stat")}</span>
              <Select
                ariaLabel={`${t("statLab.stat")} ${index + 1}`}
                value={`${change.source}:${change.statLineId}`}
                options={options
                  .filter(
                    (entry) =>
                      (entry.source === change.source && entry.word === change.statLineId) ||
                      !changes.some(
                        (held) => held.source === entry.source && held.statLineId === entry.word,
                      ),
                  )
                  .map((entry) => ({
                    value: `${entry.source}:${entry.word}`,
                    label: `${t(entry.labelKey, entry.label)} (${entry.source === "tunement" ? t("statLab.tunement") : t("statLab.attunement")})`,
                  }))}
                onChange={(value) => {
                  const selected = options.find(
                    (entry) => `${entry.source}:${entry.word}` === value,
                  )!
                  update(
                    changes.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { source: selected.source, statLineId: selected.word, amount: 0 }
                        : entry,
                    ),
                  )
                }}
              />
            </div>
            <label>
              {t("statLab.signedChange")} (
              {option.unit === "percent" ? t("statLab.percentagePoints") : t("statLab.rawUnits")})
              <Input
                value={change.amount}
                min={-option.amount * (option.unit === "percent" ? 100 : 1)}
                max={option.amount * (option.unit === "percent" ? 100 : 1)}
                onChange={(amount) =>
                  update(
                    changes.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, amount } : entry,
                    ),
                  )
                }
              />
              <small>
                {t("statLab.bound")}: ±{fmt(option.amount * (option.unit === "percent" ? 100 : 1))}
              </small>
            </label>
            <button
              type="button"
              className="btn secondary"
              aria-label={`${t("statLab.remove")} ${index + 1}`}
              onClick={() => update(changes.filter((_, entryIndex) => index !== entryIndex))}
            >
              {t("statLab.remove")}
            </button>
          </div>
        )
      })}
      <div className={styles.actions}>
        <button
          type="button"
          className="btn secondary"
          disabled={changes.length >= Math.min(STAT_LAB_MAX_CHANGES, options.length)}
          onClick={add}
        >
          {t("statLab.add")}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={!changes.length}
          onClick={() => update(NO_CHANGES)}
        >
          {t("statLab.reset")}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {lab.isPending
          ? t("statLab.loading")
          : lab.result?.status === "error"
            ? t("statLab.error")
            : !result
              ? t("statLab.empty")
              : null}
      </div>
      {result && (
        <div style={{ opacity: lab.isPending ? 0.6 : 1 }}>
          <dl className={styles.summary}>
            <div>
              <dt>{t("statLab.baseline")}</dt>
              <dd>{fmt(result.baselineDps)}</dd>
            </div>
            <div>
              <dt>{t("statLab.projected")}</dt>
              <dd>{fmt(result.hypotheticalDps)}</dd>
            </div>
            <div>
              <dt>{t("statLab.delta")}</dt>
              <dd>
                {fmt(result.deltaDps)} /{" "}
                {result.deltaPercent === null
                  ? t("statLab.unavailablePercent")
                  : `${fmt(result.deltaPercent)} %`}
              </dd>
            </div>
          </dl>
          <h3>{t("statLab.priority")}</h3>
          <p>
            {t("statLab.rolls")} {result.level}. {t("statLab.units")}
          </p>
          <div
            className={styles.table}
            tabIndex={0}
            role="region"
            aria-label={t("statLab.priority")}
          >
            <ItemRankingTable rows={result.rows} baselineDps={result.baselineDps} />
          </div>
        </div>
      )}
      {!!unavailable.length && (
        <details>
          <summary>{t("statLab.unavailable")}</summary>
          <p>{unavailable.map((key) => t(key)).join(", ")}</p>
        </details>
      )}
    </section>
  )
}
