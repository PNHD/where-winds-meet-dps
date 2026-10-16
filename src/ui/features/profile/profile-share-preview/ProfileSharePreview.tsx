import { useMemo, useState } from "react"
import type { StoredProfile } from "../../../../engine/types"
import { exportProfile } from "../../../../storage"
import { useI18n } from "../../../../i18n/i18nContext"
import { TextInput } from "../../../components/text-input/TextInput"
import { equippedShare } from "./equippedShare"
import styles from "./ProfileSharePreview.module.scss"

export function ProfileSharePreview({
  profile,
  onDownload,
  onClose,
}: {
  profile: StoredProfile
  onDownload: (profile: StoredProfile) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState(() => t("profile.sharedName"))
  const [reviewed, setReviewed] = useState(false)
  const shared = useMemo(() => equippedShare(profile, name), [profile, name])
  const text = useMemo(() => exportProfile(shared), [shared])
  return (
    <section className="panel" aria-label={t("profile.sharePreview")}>
      <h2>{t("profile.sharePreview")}</h2>
      <p>{t("profile.sharePrivacy")}</p>
      <label className={styles.field}>
        {t("profile.publicBuildName")}
        <TextInput
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setReviewed(false)
          }}
        />
      </label>
      <label className={styles.field}>
        {t("profile.shareJson")}
        <textarea readOnly rows={12} value={text} />
      </label>
      <label className={styles.consent}>
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        {t("profile.shareConsent")}
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={!reviewed || !name.trim()}
        onClick={() => onDownload(shared)}
      >
        {t("profile.downloadShared")}
      </button>{" "}
      <button type="button" className="btn" onClick={onClose}>
        {t("common.cancel")}
      </button>
    </section>
  )
}
