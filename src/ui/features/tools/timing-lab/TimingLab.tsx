import { useState } from "react"
import { useI18n } from "../../../../i18n/i18nContext"
import { timingMargin } from "../browserMeasurements"
import styles from "./TimingLab.module.scss"

const FIELD_KEYS = [
  "tools.stunWindow",
  "tools.recovery",
  "tools.startup",
  "tools.latencyAllowance",
  "tools.uncertainty",
]
export function TimingLab() {
  const { t } = useI18n()
  const [values, setValues] = useState(["", "", "", "", ""])
  const numbers = values.map((value) => (value.trim() ? Number(value) : NaN))
  const margin = timingMargin(numbers[0], numbers[1], numbers[2], numbers[3], numbers[4])
  return (
    <section className="panel" aria-label={t("tools.timingTitle")}>
      <h2>{t("tools.timingTitle")}</h2>
      <p>{t("tools.timingNotice")}</p>
      <div className={styles.fields}>
        {FIELD_KEYS.map((key, index) => (
          <label key={key}>
            {t(FIELD_KEYS[index])}
            <input
              type="number"
              min={0}
              max={60000}
              step="any"
              value={values[index]}
              onChange={(event) =>
                setValues(values.map((value, at) => (at === index ? event.target.value : value)))
              }
            />
          </label>
        ))}
      </div>
      <p>{t("tools.timingFormula")}</p>
      <output aria-live="polite">
        {margin === null ? (
          t("tools.enterTimings")
        ) : (
          <>
            {t("tools.margin")}: {margin.toFixed(1)} ms ·{" "}
            {t(margin > 0 ? "tools.localWindowFits" : "tools.noTimingMargin")}
          </>
        )}
      </output>
      <p>{t("tools.timingSourceBlocked")}</p>
    </section>
  )
}
