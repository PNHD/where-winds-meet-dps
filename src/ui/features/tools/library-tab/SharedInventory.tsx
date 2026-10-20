import type { Inputs, StoredProfile } from "../../../../engine/types"
import { newGearPieceId } from "../../../../storage"
import { useI18n } from "../../../../i18n/i18nContext"
import styles from "../tools-tab/ToolsTab.module.scss"

export function SharedInventory({
  profiles,
  profileId,
  inputs,
  onChange,
}: {
  profiles: StoredProfile[]
  profileId: string
  inputs: Inputs
  onChange: (inputs: Inputs) => void
}) {
  const { t } = useI18n()
  return (
    <section className="panel" aria-label={t("library.inventory")}>
      <h2>{t("library.inventory")}</h2>
      <p>{t("library.inventoryNotice")}</p>
      <ul className={styles.entries}>
        {profiles
          .filter((profile) => profile.id !== profileId)
          .flatMap((profile) =>
            profile.inputs.inventory.map((piece) => (
              <li key={`${profile.id}:${piece.id}`}>
                <details>
                  <summary>
                    {profile.name} · {piece.label || piece.slot} · {piece.level}
                  </summary>
                  <pre className={styles.piecePreview}>{JSON.stringify(piece, null, 2)}</pre>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      onChange({
                        ...inputs,
                        inventory: [
                          ...inputs.inventory,
                          { ...structuredClone(piece), id: newGearPieceId() },
                        ],
                      })
                    }
                  >
                    {t("library.copyPiece")}
                  </button>
                </details>
              </li>
            )),
          )}
      </ul>
    </section>
  )
}
