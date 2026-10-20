import { useState } from "react"
import { NavLink } from "react-router-dom"
import { CLASS_DEFS } from "../../../../definitions/classes/registry"
import type { Inputs, StoredProfile } from "../../../../engine/types"
import { SharedInventory } from "./SharedInventory"
import { activeRotationForInputs } from "../../../../engine/dps"
import { useI18n } from "../../../../i18n/i18nContext"
import { classKey } from "../../../../i18n/contentKeys"
import { TextInput } from "../../../components/text-input/TextInput"
import styles from "../tools-tab/ToolsTab.module.scss"

export function LibraryTab({
  inputs,
  profiles,
  profileId,
  onChange,
}: {
  inputs: Inputs
  profiles: StoredProfile[]
  profileId: string
  onChange: (inputs: Inputs) => void
}) {
  const { t } = useI18n()
  const [search, setSearch] = useState("")
  const rotation = activeRotationForInputs(inputs)
  const query = search.trim().toLowerCase()
  return (
    <div className={styles.tools}>
      <section className="panel">
        <h2>{t("library.title")}</h2>
        <p>{t("library.notice")}</p>
        <p>
          {t("library.selected")}: {t(classKey(inputs.classId))} · {rotation?.name}
        </p>
        <div className={styles.actions}>
          <NavLink to="/training">{t("training.title")}</NavLink>
          <NavLink to="/profile">{t("library.privateImport")}</NavLink>
          <NavLink to="/rotation">{t("common.rotation")}</NavLink>
        </div>
        <label>
          {t("library.search")}{" "}
          <TextInput value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <ul className={styles.entries}>
          {CLASS_DEFS()
            .flatMap((def) => def.rotations.map((reference) => ({ def, reference })))
            .filter(({ def, reference }) =>
              `${def.displayName} ${reference.name} ${reference.description ?? ""}`
                .toLowerCase()
                .includes(query),
            )
            .map(({ def, reference }) => (
              <li key={`${def.id}:${reference.id}`}>
                <strong>
                  {t(classKey(def.id), def.displayName)} · {reference.name}
                </strong>
                <span>
                  {t("library.reference")} ·{" "}
                  {t(def.validated ? "tools.calibrated" : "tools.modelOnly")}
                </span>
                {reference.description && <p>{reference.description}</p>}
                <span>
                  {t("library.steps")}: {reference.steps.length}
                </span>
              </li>
            ))}
        </ul>
        <a
          href="https://github.com/PNHD/where-winds-meet-dps/tree/74952e3c4b39bc46b82978958ae10ce964f595ef/src/data/classes"
          target="_blank"
          rel="noreferrer"
        >
          {t("library.modelSource")}
        </a>
        <p>
          <a
            href="https://www.wherewindsmeetgame.com/news/official/PathBalance1015.html"
            target="_blank"
            rel="noreferrer"
          >
            {t("tools.officialSource")}
          </a>
        </p>
      </section>
      <SharedInventory
        profiles={profiles}
        profileId={profileId}
        inputs={inputs}
        onChange={onChange}
      />
    </div>
  )
}
