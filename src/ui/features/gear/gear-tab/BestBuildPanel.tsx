import type { Inputs } from "../../../../engine/types"
import { GEAR_SLOTS } from "../../../../engine/types"
import { applyBestBuild } from "../../../../engine/bestBuildSelection"
import { useI18n } from "../../../../i18n/i18nContext"
import { useBestBuild } from "../../../hooks/useBestBuild"
import { GEAR_SLOT_KEYS } from "../shared/gearSlotKeys"

const ERROR_KEYS = {
  "missing-slots": "gear.bestBuild.missing",
  "duplicate-id": "gear.bestBuild.duplicate",
  "invalid-equipped": "gear.bestBuild.invalidEquipped",
  "no-rotation": "gear.bestBuild.noRotation",
  "engine-error": "gear.bestBuild.engineError",
}

export function BestBuildPanel({
  inputs,
  optimizerInputs,
  profileId,
  onChange,
}: {
  inputs: Inputs
  optimizerInputs: Inputs
  profileId?: string
  onChange(next: Inputs): void
}) {
  const { t } = useI18n()
  const search = useBestBuild(optimizerInputs, profileId)
  const result = search.result
  return (
    <section className="panel" aria-label={t("common.bestBuild")}>
      <div className="panel-head">
        <h3>{t("common.bestBuild")}</h3>
        <button
          type="button"
          className="btn primary"
          disabled={search.isPending}
          onClick={search.start}
        >
          {t("gear.bestBuild.find")}
        </button>
        {search.isPending && (
          <button type="button" className="btn secondary" onClick={search.cancel}>
            {t("common.cancel")}
          </button>
        )}
      </div>
      <p>{t("gear.bestBuild.scope")}</p>
      {search.isPending && <p role="status">{t("gear.bestBuild.searching")}</p>}
      {result?.status === "error" && <p role="alert">{t(ERROR_KEYS[result.reason])}</p>}
      {result?.status === "ok" && (
        <>
          <p role="status">
            {t(result.approximate ? "gear.bestBuild.approximate" : "gear.bestBuild.exact")}
          </p>
          <p>
            {t("gear.bestBuild.current")}: {result.currentDps.toFixed(2)} ·{" "}
            {t("gear.bestBuild.best")}: {result.bestDps.toFixed(2)} · {t("gear.bestBuild.delta")}:{" "}
            {(result.bestDps - result.currentDps).toFixed(2)}
          </p>
          <p>
            {t("gear.bestBuild.evaluated")}: {result.evaluated} / {result.combinations} ·{" "}
            {t("gear.bestBuild.excluded")}: {result.excludedCandidates}
          </p>
          <ul>
            {GEAR_SLOTS.map((slot) => (
              <li key={slot}>
                {t(GEAR_SLOT_KEYS[slot])}:{" "}
                {inputs.inventory.find((piece) => piece.id === result.equipped[slot])?.label ||
                  result.equipped[slot]}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const next = applyBestBuild(
                inputs,
                result,
                search.sourceKey,
                JSON.stringify({ profileId, inputs: optimizerInputs }),
              )
              if (next) onChange(next)
            }}
          >
            {t("gear.bestBuild.equip")}
          </button>
        </>
      )}
    </section>
  )
}
