import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../../../i18n/i18nContext"
import { measureBrowserLatency } from "../browserMeasurements"

export function LatencyLab() {
  const { t } = useI18n()
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof measureBrowserLatency>> | null>(
    null,
  )
  useEffect(
    () => () => {
      generation.current++
      controller.current?.abort()
    },
    [],
  )
  async function run() {
    if (running) return
    const request = ++generation.current
    const active = new AbortController()
    controller.current = active
    setRunning(true)
    setResult(null)
    const measured = await measureBrowserLatency(active.signal)
    if (request !== generation.current) return
    setResult(measured)
    setRunning(false)
  }
  return (
    <section className="panel" aria-label={t("tools.latencyTitle")}>
      <h2>{t("tools.latencyTitle")}</h2>
      <p>{t("tools.latencyNotice")}</p>
      <button type="button" className="btn" disabled={running} onClick={() => void run()}>
        {t("tools.measureLatency")}
      </button>{" "}
      <button
        type="button"
        className="btn"
        disabled={!running}
        onClick={() => controller.current?.abort()}
      >
        {t("common.cancel")}
      </button>
      <div role="status">
        {running
          ? t("tools.measuring")
          : result && (
              <>
                <p>{t(result.cancelled ? "tools.cancelled" : "tools.measurementDone")}</p>
                <p>
                  {t("tools.successfulSamples")}: {result.samples.length} / 8 ·{" "}
                  {t("tools.failedSamples")}: {result.failed}
                </p>
                <p>
                  {t("tools.medianHttp")}:{" "}
                  {result.median === null
                    ? t("tools.unavailable")
                    : `${result.median.toFixed(1)} ms`}
                </p>
                <p>
                  {t("tools.sampleVariation")}:{" "}
                  {result.variation === null
                    ? t("tools.unavailable")
                    : `${result.variation.toFixed(1)} ms`}
                </p>
                <p>
                  {t("tools.sampleTimings")}:{" "}
                  {result.samples.map((sample) => sample.toFixed(1)).join(", ")} ms
                </p>
              </>
            )}
      </div>
    </section>
  )
}
