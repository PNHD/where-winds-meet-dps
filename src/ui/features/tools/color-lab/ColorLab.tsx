import { useState } from "react"
import { useI18n } from "../../../../i18n/i18nContext"
import { signatureColors } from "../browserMeasurements"
import styles from "./ColorLab.module.scss"

export function ColorLab() {
  const { t } = useI18n()
  const [text, setText] = useState("")
  const [start, setStart] = useState("#d8b070")
  const [end, setEnd] = useState("#70b8d8")
  const colors = signatureColors(text, start, end)
  return (
    <section className="panel" aria-label={t("tools.colorTitle")}>
      <h2>{t("tools.colorTitle")}</h2>
      <p>{t("tools.colorNotice")}</p>
      <label className={styles.text}>
        {t("tools.signatureText")}
        <textarea
          value={text}
          maxLength={480}
          onChange={(event) => setText(event.target.value)}
          rows={2}
        />
      </label>
      <div className={styles.colors}>
        <label>
          {t("tools.startColor")}
          <input type="color" value={start} onChange={(event) => setStart(event.target.value)} />
          {start.toUpperCase()}
        </label>
        <label>
          {t("tools.endColor")}
          <input type="color" value={end} onChange={(event) => setEnd(event.target.value)} />
          {end.toUpperCase()}
        </label>
      </div>
      <p>{t("tools.previewLimit")}</p>
      <div className={styles.preview} aria-label={t("tools.signaturePreview")}>
        {colors.map((part, index) => (
          <span key={index} style={{ color: part.color }}>
            {part.text}
          </span>
        ))}
      </div>
      {text && !colors.length && <p role="alert">{t("tools.signatureTooLong")}</p>}
      <label className={styles.text}>
        {t("tools.paletteCodes")}
        <textarea
          readOnly
          rows={3}
          value={colors.map((part) => `${part.color.toUpperCase()} ${part.text}`).join("\n")}
        />
      </label>
      <p>{t("tools.gameCodesBlocked")}</p>
    </section>
  )
}
