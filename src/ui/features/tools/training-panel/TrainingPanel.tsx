import { useState } from "react"
import type { Inputs, Result } from "../../../../engine/types"
import { activeRotationForInputs } from "../../../../engine/dps"
import { classDefinition } from "../../../../definitions/classes/registry"
import { useI18n } from "../../../../i18n/i18nContext"
import { TextInput } from "../../../components/text-input/TextInput"
import { JOURNAL_LIMIT, localCalendarDate, type JournalEntry } from "../toolkitJournal"
import styles from "../tools-tab/ToolsTab.module.scss"

export interface TrainingContext {
  inputs: Inputs
  profileId: string
  result: Result
}

export function TrainingPanel({
  inputs,
  profileId,
  result,
  entries,
  onSave,
}: TrainingContext & {
  entries: JournalEntry[] | null
  onSave: (entries: JournalEntry[]) => Promise<boolean>
}) {
  const { t } = useI18n()
  const [name, setName] = useState("")
  const [patch, setPatch] = useState("")
  const [target, setTarget] = useState("")
  const [damage, setDamage] = useState("")
  const [duration, setDuration] = useState("")
  const [source, setSource] = useState("")
  const [note, setNote] = useState("")
  const [date, setDate] = useState(localCalendarDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const rotation = activeRotationForInputs(inputs)
  const classDef = classDefinition(inputs.classId)

  async function record(event: React.FormEvent) {
    event.preventDefault()
    if (!entries || entries.length >= JOURNAL_LIMIT || !rotation || saving) return
    setSaving(true)
    setError(false)
    try {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(inputs)),
      )
      const fingerprint = Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
      const saved = await onSave([
        ...entries,
        {
          id: crypto.randomUUID(),
          kind: "training",
          name: name.trim(),
          date,
          classId: inputs.classId,
          profileId,
          rotationId: rotation.id,
          fingerprint,
          patch: patch.trim(),
          target: target.trim(),
          damage: Number(damage),
          duration: Number(duration),
          modeledDps: result.dps,
          modeledDuration: result.rotationDuration,
          source: source.trim(),
          note,
        },
      ])
      if (saved) {
        setName("")
        setDamage("")
        setDuration("")
        setNote("")
      }
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel" aria-label={t("training.title")}>
      <h2>{t("training.title")}</h2>
      <p>{t("training.notice")}</p>
      <p>
        {classDef?.displayName} · {rotation?.name} · {t("training.modeled")}:{" "}
        {result.dps.toFixed(2)} · {result.rotationDuration.toFixed(2)} s
      </p>
      <p>{t("training.clock")}</p>
      <form onSubmit={record}>
        <fieldset
          className={styles.form}
          disabled={saving || !entries || entries.length >= JOURNAL_LIMIT || !rotation}
        >
          <label>
            {t("training.name")}
            <TextInput
              required
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {t("training.date")}
            <input
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            {t("training.patch")}
            <TextInput
              required
              value={patch}
              maxLength={100}
              onChange={(event) => setPatch(event.target.value)}
            />
          </label>
          <label>
            {t("training.target")}
            <TextInput
              required
              value={target}
              maxLength={100}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          <label>
            {t("training.damage")}
            <input
              type="number"
              required
              min={0}
              max={1e12}
              step="any"
              value={damage}
              onChange={(event) => setDamage(event.target.value)}
            />
          </label>
          <label>
            {t("training.duration")}
            <input
              type="number"
              required
              min={0.001}
              max={86400}
              step="any"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <label>
            {t("training.source")}
            <input
              type="url"
              required
              maxLength={1000}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
          </label>
          <label>
            {t("training.note")}
            <TextInput
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button className="btn" type="submit">
            {t("training.record")}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{t("tools.storageFailed")}</p>}
      <p>{t("training.backup")}</p>
    </section>
  )
}
