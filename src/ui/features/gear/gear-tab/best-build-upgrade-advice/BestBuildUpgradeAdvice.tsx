import type { BestBuildAdvice, BestBuildItemAdvice } from "../../../../../engine/bestBuildAdvisor"
import type { Inputs } from "../../../../../engine/types"
import { retuneAttemptBudget } from "../../../../../engine/retunement"
import { statLineLabel } from "../../../../../data/stats/statLines"
import { statLineKey } from "../../../../../i18n/contentKeys"
import { useI18n } from "../../../../../i18n/i18nContext"
import { GEAR_SLOT_KEYS } from "../../shared/gearSlotKeys"
import styles from "./BestBuildUpgradeAdvice.module.scss"

const REASON_KEYS = {
  ok: "gear.bestBuild.advice.noPositiveItem",
  relayed: "gear.bestBuild.advice.relayed",
  heirloom: "gear.bestBuild.advice.heirloom",
  spent: "gear.retuneBudget.spent",
  "no-pool": "gear.bestBuild.advice.no-pool",
  "no-piece": "gear.bestBuild.advice.no-piece",
}

export function BestBuildUpgradeAdvice({
  advice,
  inputs,
}: {
  advice: BestBuildAdvice
  inputs: Inputs
}) {
  const { t } = useI18n()
  const wordLabel = (word: string) =>
    word ? t(statLineKey(word), statLineLabel(word)) : t("gear.bestBuild.advice.empty")
  const itemName = (item: BestBuildItemAdvice) =>
    inputs.inventory.find((piece) => piece.id === item.pieceId)?.label || item.pieceId
  function recommendation(item: BestBuildItemAdvice) {
    const row = item.recommendation
    if (!row) return <p>{t(REASON_KEYS[item.reason])}</p>
    const piece = inputs.inventory.find((entry) => entry.id === item.pieceId)!
    return (
      <>
        <p>
          {t("gear.bestBuild.advice.next")}: {t("gear.retunementAnalyzer.slot")}
          {row.slotIndex + 1}: {wordLabel(piece.words[row.slotIndex].word)} →{" "}
          <strong>{wordLabel(row.word)}</strong>
        </p>
        <p>
          {t("gear.bestBuild.advice.gain")}: +{row.deltaDps.toFixed(2)} {t("common.dps")}
        </p>
        <p>
          {t("gear.bestBuild.advice.draw")}:{" "}
          {row.pDraw === null
            ? t("gear.bestBuild.advice.unknownProbability")
            : `${(row.pDraw * 100).toFixed(1)}%`}
        </p>
        <p>
          {t("gear.bestBuild.advice.improve")}:{" "}
          {row.pImprove === null
            ? t("gear.bestBuild.advice.unknownProbability")
            : `${(row.pImprove * 100).toFixed(1)}%`}
        </p>
        {row.eDeltaDps !== null && (
          <p>
            {t("gear.bestBuild.advice.expected")}: {row.eDeltaDps.toFixed(2)} {t("common.dps")}
          </p>
        )}
      </>
    )
  }
  return (
    <section aria-label={t("gear.bestBuild.advice.title")}>
      <h3>{t("gear.bestBuild.advice.title")}</h3>
      <p>{t("gear.bestBuild.advice.scope")}</p>
      {advice.status === "error" && <p role="alert">{t("gear.bestBuild.advice.error")}</p>}
      {advice.status === "ok" && (
        <>
          <section className="panel" aria-label={t("gear.bestBuild.advice.first")}>
            <h4>{t("gear.bestBuild.advice.first")}</h4>
            {advice.first ? (
              <>
                <strong>
                  {itemName(advice.first)} · {t(GEAR_SLOT_KEYS[advice.first.slot])}
                </strong>
                {recommendation(advice.first)}
                {advice.first.heirloomSwap && (
                  <p>{t("gear.retunementAnalyzer.worthMoreThanTheDpsPick")}</p>
                )}
              </>
            ) : (
              <p>{t("gear.bestBuild.advice.noPositive")}</p>
            )}
          </section>
          <ul className={styles.items} aria-label={t("gear.bestBuild.advice.items")}>
            {advice.items.map((item) => {
              const piece = inputs.inventory.find((entry) => entry.id === item.pieceId)!
              return (
                <li className={styles.item} key={item.slot}>
                  <details open={item.slot === advice.first?.slot || !!item.heirloomSwap}>
                    <summary>
                      <strong>
                        {t(GEAR_SLOT_KEYS[item.slot])} — {itemName(item)}
                      </strong>
                      <span>
                        {item.recommendation
                          ? `+${item.recommendation.deltaDps.toFixed(2)} ${t("common.dps")}`
                          : t(REASON_KEYS[item.reason])}
                      </span>
                    </summary>
                    <small>
                      {t("gear.bestBuild.advice.itemId")}: {item.pieceId}
                    </small>
                    {item.heirloomSwap && (
                      <p>
                        <strong>{t("gear.retunementAnalyzer.makesItAnHeirloom")}</strong>:{" "}
                        {t("gear.retunementAnalyzer.slot")}
                        {item.heirloomSwap.slotIndex + 1}:{" "}
                        {wordLabel(item.heirloomSwap.currentWord)} →{" "}
                        {wordLabel(item.heirloomSwap.word)}.{" "}
                        {t("gear.retunementAnalyzer.worthMoreThanTheDpsPick")}
                      </p>
                    )}
                    {recommendation(item)}
                    <p>
                      {t(
                        retuneAttemptBudget(piece.level) === "single"
                          ? "gear.retuneBudget.single"
                          : "gear.retuneBudget.repeatable",
                      )}
                    </p>
                    {item.runnerUp ? (
                      <p>
                        {t("gear.bestBuild.advice.runnerUp")}:{" "}
                        {inputs.inventory.find((entry) => entry.id === item.runnerUp!.pieceId)
                          ?.label || item.runnerUp.pieceId}{" "}
                        · {t("gear.bestBuild.advice.gap")}: {item.runnerUp.gap.toFixed(2)}{" "}
                        {t("common.dps")}
                      </p>
                    ) : (
                      <p>{t("gear.bestBuild.advice.noAlternative")}</p>
                    )}
                  </details>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
