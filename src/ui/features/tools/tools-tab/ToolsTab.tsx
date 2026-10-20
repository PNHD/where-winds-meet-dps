import { useEffect, useRef, useState } from "react"
import { CLASS_DEFS } from "../../../../definitions/classes/registry"
import { useI18n } from "../../../../i18n/i18nContext"
import { classKey } from "../../../../i18n/contentKeys"
import { useConfirm } from "../../../components/confirm-dialog/confirmContext"
import { TextInput } from "../../../components/text-input/TextInput"
import { Select } from "../../../components/select/Select"
import {
  JOURNAL_LIMIT,
  JOURNAL_MAX_BYTES,
  MATCH_MODES,
  TOOLKIT_KEY,
  journalText,
  downloadJson,
  localCalendarDate,
  parseJournal,
  remainingSeconds,
  writeJournal,
  type JournalEntry,
} from "../toolkitJournal"
import styles from "./ToolsTab.module.scss"
import { TimingLab } from "../timing-lab/TimingLab"
import { ColorLab } from "../color-lab/ColorLab"
import { LatencyLab } from "../latency-lab/LatencyLab"
import { MapLab } from "../map-lab/MapLab"
import { TrainingPanel, type TrainingContext } from "../training-panel/TrainingPanel"

const MISSING_PATHS = [
  {
    labelKey: "tools.pathMight",
    source: "https://www.wherewindsmeetgame.com/news/official/PathBalance1015.html",
  },
  {
    labelKey: "tools.pathDeluge",
    source: "https://www.wherewindsmeetgame.com/news/official/Adjustment528.html",
  },
  {
    labelKey: "tools.pathWind",
    source: "https://www.wherewindsmeetgame.com/news/official/Adjustment528.html",
  },
  {
    labelKey: "tools.pathDust",
    source: "https://www.wherewindsmeetgame.com/news/official/PathBalance1015.html",
  },
  {
    labelKey: "tools.pathKite",
    source: "https://www.wherewindsmeetgame.com/news/official/719devletter.html",
  },
  {
    labelKey: "tools.pathWings",
    source: "https://www.wherewindsmeetgame.com/news/official/1014devletter.html",
  },
]
const RESULT_KEYS = { win: "tools.win", loss: "tools.loss", draw: "tools.draw" }
const MODE_KEYS = {
  unknown: "tools.modeUnknown",
  arena1v1: "tools.mode1v1",
  arena3v3: "tools.mode3v3",
  gvg: "tools.modeGvg",
  other: "tools.modeOther",
}
const KIND_KEYS = {
  timer: "tools.timer",
  pity: "tools.pity",
  match: "tools.match",
  marker: "tools.marker",
  training: "training.title",
}
const FORM_KINDS = ["timer", "pity", "match"] as const
const ERROR_KEYS: Record<string, string> = {
  "tools.invalidBackup": "tools.invalidBackup",
  "tools.loadFailed": "tools.loadFailed",
  "tools.storageConflict": "tools.storageConflict",
  "tools.storageFailed": "tools.storageFailed",
  "tools.lockUnavailable": "tools.lockUnavailable",
}

function readJournal() {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(TOOLKIT_KEY)
    return { raw, entries: raw === null ? [] : parseJournal(raw), error: "" }
  } catch {
    return { raw, entries: null, error: "tools.loadFailed" }
  }
}

export function ToolsTab({
  context,
  view = "all",
}: {
  context: TrainingContext
  view?: "all" | "training" | "arena"
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [journal, setJournal] = useState(readJournal)
  const [error, setError] = useState("")
  const [pending, setPending] = useState<JournalEntry[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [kind, setKind] = useState<(typeof FORM_KINDS)[number]>(
    view === "arena" ? "match" : "timer",
  )
  const [mode, setMode] = useState<(typeof MATCH_MODES)[number]>("unknown")
  const [name, setName] = useState("")
  const [minutes, setMinutes] = useState("10")
  const [date, setDate] = useState(localCalendarDate)
  const [result, setResult] = useState<"win" | "loss" | "draw">("win")
  const [note, setNote] = useState("")
  const [now, setNow] = useState(Date.now)
  const input = useRef<HTMLInputElement>(null)
  const importGeneration = useRef(0)
  const entries = journal.entries
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [])

  async function save(next: JournalEntry[]) {
    if (saving) return false
    setSaving(true)
    try {
      const raw = await writeJournal(next, journal.raw)
      setJournal({ entries: next, raw, error: "" })
      setError("")
      return true
    } catch (err) {
      const key = err instanceof Error ? err.message : ""
      setError(
        key === "tools.storageConflict" || key === "tools.lockUnavailable"
          ? key
          : "tools.storageFailed",
      )
      return false
    } finally {
      setSaving(false)
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!entries || entries.length >= JOURNAL_LIMIT || !name.trim()) return
    const base = { id: crypto.randomUUID(), name: name.trim() }
    let entry: JournalEntry
    if (kind === "timer") {
      const duration = Number(minutes)
      if (!Number.isFinite(duration) || duration < 1 || duration > 1440) return
      entry = { ...base, kind, deadline: Date.now() + Math.round(duration * 60_000) }
    } else if (kind === "pity") entry = { ...base, kind, count: 0 }
    else entry = { ...base, kind, date, result, note, mode }
    if (await save([...entries, entry])) {
      setName("")
      setNote("")
    }
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const generation = ++importGeneration.current
    const file = event.target.files?.[0]
    event.target.value = ""
    setPending(null)
    if (!file) return
    try {
      if (file.size > JOURNAL_MAX_BYTES) throw new Error()
      const text = await file.text()
      if (generation !== importGeneration.current) return
      setPending(parseJournal(text))
      setError("")
    } catch {
      if (generation === importGeneration.current) setError("tools.invalidBackup")
    }
  }

  async function remove(id: string) {
    if (!entries || !(await confirm(t("tools.deleteConfirm")))) return
    save(entries.filter((entry) => entry.id !== id))
  }

  return (
    <div className={styles.tools}>
      {view === "all" && (
        <>
          <section className="panel">
            <h2>{t("tools.title")}</h2>
            <p>{t("tools.privacy")}</p>
            <p>{t("tools.currentDps")}</p>
          </section>
          <section className="panel" aria-label={t("tools.coverage")}>
            <h2>{t("tools.coverage")}</h2>
            <p>{t("tools.patchNotice")}</p>
            <ul className={styles.paths}>
              {CLASS_DEFS().map((def) => (
                <li key={def.id}>
                  <strong>{t(classKey(def.id), def.displayName)}</strong>
                  <span>{t(def.validated ? "tools.calibrated" : "tools.modelOnly")}</span>
                </li>
              ))}
              {MISSING_PATHS.map((path) => (
                <li key={path.labelKey}>
                  <strong>{t(path.labelKey)}</strong>
                  <span>{t("tools.dataNeeded")}</span>
                  <a href={path.source} target="_blank" rel="noreferrer">
                    {t("tools.officialSource")}
                  </a>
                </li>
              ))}
            </ul>
            <p>{t("tools.missingDetail")}</p>
          </section>
          <TimingLab />
          <ColorLab />
          <LatencyLab />
          <MapLab entries={entries} onSave={save} onDelete={(id) => void remove(id)} />
        </>
      )}
      {view === "arena" && (
        <>
          <section className="panel">
            <h2>{t("tools.arenaTitle")}</h2>
            <p>{t("tools.arenaNotice")}</p>
          </section>
          <TimingLab />
        </>
      )}
      {view !== "arena" && <TrainingPanel {...context} entries={entries} onSave={save} />}
      <section className="panel" aria-label={t("tools.journal")}>
        <h2>{t("tools.journal")}</h2>
        <p>{t("tools.manualNotice")}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className="btn"
            disabled={journal.raw === null && !entries}
            onClick={() =>
              downloadJson(journal.raw ?? journalText(entries ?? []), "wwm-personal-tools.json")
            }
          >
            {t("tools.backup")}
          </button>
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            {t("tools.restore")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              importGeneration.current++
              setJournal(readJournal())
              setError("")
              setPending(null)
            }}
          >
            {t("tools.reload")}
          </button>
          <input
            type="file"
            accept="application/json,.json"
            ref={input}
            hidden
            onChange={importFile}
            aria-label={t("tools.restore")}
          />
        </div>
        {(journal.error || error) && <p role="alert">{t(ERROR_KEYS[error || journal.error])}</p>}
        {pending && (
          <section aria-label={t("tools.restorePreview")} className={styles.preview}>
            <h3>
              {t("tools.restorePreview")} · {pending.length}
            </h3>
            <p>{t("tools.restoreWarning")}</p>
            <ul>
              {pending.slice(0, 10).map((entry) => (
                <li key={entry.id}>
                  {t(KIND_KEYS[entry.kind])}: {entry.name}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                importGeneration.current++
                downloadJson(
                  journal.raw ?? journalText(entries ?? []),
                  "wwm-personal-tools-before-restore.json",
                )
                if (await save(pending)) setPending(null)
              }}
            >
              {t("tools.confirmRestore")}
            </button>{" "}
            <button
              type="button"
              className="btn"
              onClick={() => {
                importGeneration.current++
                setPending(null)
              }}
            >
              {t("common.cancel")}
            </button>
          </section>
        )}
        <form onSubmit={add}>
          <fieldset className={styles.form} disabled={saving || !entries}>
            <label>
              {t("tools.kind")}
              <Select
                ariaLabel={t("tools.kind")}
                value={kind}
                onChange={(value) => setKind(value as typeof kind)}
                options={FORM_KINDS.map((value) => ({ value, label: t(KIND_KEYS[value]) }))}
              />
            </label>
            <label>
              {t("tools.entryName")}
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </label>
            {kind === "timer" && (
              <label>
                {t("tools.minutes")}
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  required
                />
              </label>
            )}
            {kind === "match" && (
              <>
                <label>
                  {t("tools.mode")}
                  <Select
                    ariaLabel={t("tools.mode")}
                    value={mode}
                    onChange={setMode}
                    options={MATCH_MODES.map((value) => ({ value, label: t(MODE_KEYS[value]) }))}
                  />
                </label>
                <label>
                  {t("tools.matchDate")}
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </label>
                <label>
                  {t("tools.result")}
                  <Select
                    ariaLabel={t("tools.result")}
                    value={result}
                    onChange={(value) => setResult(value as typeof result)}
                    options={Object.entries(RESULT_KEYS).map(([value, key]) => ({
                      value,
                      label: t(key),
                    }))}
                  />
                </label>
                <label>
                  {t("tools.note")}
                  <TextInput
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                  />
                </label>
              </>
            )}
            <button
              type="submit"
              className="btn primary"
              disabled={!entries || entries.length >= JOURNAL_LIMIT}
            >
              {t("tools.record")}
            </button>
          </fieldset>
        </form>
        <p>
          {entries?.length ?? 0} / {JOURNAL_LIMIT}
        </p>
        <ul className={styles.entries}>
          {entries?.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.name}</strong> · {t(KIND_KEYS[entry.kind])}
              </div>
              {entry.kind === "timer" && (
                <>
                  <time dateTime={new Date(entry.deadline).toISOString()}>
                    {new Date(entry.deadline).toLocaleString()}
                  </time>
                  <output>
                    {remainingSeconds(entry.deadline, now)
                      ? `${remainingSeconds(entry.deadline, now)} ${t("tools.seconds")}`
                      : t("tools.expired")}
                  </output>
                </>
              )}
              {entry.kind === "pity" && (
                <div className={styles.actions}>
                  <output>{entry.count}</output>
                  <button
                    type="button"
                    className="btn"
                    disabled={entry.count >= 1_000_000}
                    onClick={() =>
                      save(
                        entries.map((row) =>
                          row.id === entry.id ? { ...entry, count: entry.count + 1 } : row,
                        ),
                      )
                    }
                  >
                    {t("tools.addPull")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={entry.count === 0}
                    onClick={() =>
                      save(
                        entries.map((row) =>
                          row.id === entry.id ? { ...entry, count: entry.count - 1 } : row,
                        ),
                      )
                    }
                  >
                    {t("tools.undoPull")}
                  </button>
                </div>
              )}
              {entry.kind === "match" && (
                <>
                  <p>
                    {entry.date} · {t(RESULT_KEYS[entry.result])} ·{" "}
                    {t(MODE_KEYS[entry.mode ?? "unknown"])}
                  </p>
                  <p>{entry.note}</p>
                </>
              )}
              {entry.kind === "training" && (
                <>
                  <p>
                    {entry.date} · {entry.classId} · {entry.rotationId} · {entry.patch} ·{" "}
                    {entry.target}
                  </p>
                  <p>
                    {t("training.observed")}: {(entry.damage / entry.duration).toFixed(2)} ·{" "}
                    {entry.duration} s
                  </p>
                  <p>
                    {t("training.modeled")}: {entry.modeledDps.toFixed(2)} · {entry.modeledDuration}{" "}
                    s
                  </p>
                  <p>
                    {t("training.context")}: {entry.profileId} · {entry.fingerprint}
                  </p>
                  <a href={entry.source} target="_blank" rel="noreferrer">
                    {t("training.source")}
                  </a>
                  <p>{entry.note}</p>
                </>
              )}
              <button
                type="button"
                className="btn"
                aria-label={`${t("common.delete")} ${entry.name}`}
                onClick={() => void remove(entry.id)}
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
