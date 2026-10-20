import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../../../i18n/i18nContext"
import { TextInput } from "../../../components/text-input/TextInput"
import { JOURNAL_LIMIT, type JournalEntry } from "../toolkitJournal"
import { MAP_MAX_BYTES, pngMapDimensions } from "./pngMap"
import styles from "./MapLab.module.scss"

export function MapLab({
  entries,
  onSave,
  onDelete,
}: {
  entries: JournalEntry[] | null
  onSave: (entries: JournalEntry[]) => Promise<boolean>
  onDelete: (id: string) => void
}) {
  const { t } = useI18n()
  const [map, setMap] = useState<{ id: string; url: string; name: string } | null>(null)
  const [name, setName] = useState("")
  const [x, setX] = useState("50"),
    [y, setY] = useState("50")
  const [error, setError] = useState(false),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false)
  const generation = useRef(0),
    image = useRef<HTMLImageElement>(null)
  const markers =
    entries?.filter(
      (entry): entry is Extract<JournalEntry, { kind: "marker" }> =>
        entry.kind === "marker" && entry.mapId === map?.id,
    ) ?? []
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  useEffect(
    () => () => {
      if (map) URL.revokeObjectURL(map.url)
    },
    [map],
  )

  async function load(event: React.ChangeEvent<HTMLInputElement>) {
    const request = ++generation.current,
      file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setLoading(true)
    setError(false)
    try {
      if (file.size > MAP_MAX_BYTES) throw new Error()
      const bytes = await file.arrayBuffer()
      if (!pngMapDimensions(bytes)) throw new Error()
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
      bitmap.close()
      const digest = await crypto.subtle.digest("SHA-256", bytes)
      if (request !== generation.current) return
      const id = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")
      setMap({
        id,
        url: URL.createObjectURL(new Blob([bytes], { type: "image/png" })),
        name: file.name,
      })
    } catch {
      if (request === generation.current) setError(true)
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!map || !entries || !name.trim() || !x.trim() || !y.trim() || saving) return
    const horizontal = Number(x) / 100,
      vertical = Number(y) / 100
    if (
      !Number.isFinite(horizontal) ||
      !Number.isFinite(vertical) ||
      horizontal < 0 ||
      horizontal > 1 ||
      vertical < 0 ||
      vertical > 1
    )
      return
    setSaving(true)
    try {
      if (
        await onSave([
          ...entries,
          {
            id: crypto.randomUUID(),
            kind: "marker",
            name: name.trim(),
            mapId: map.id,
            x: horizontal,
            y: vertical,
            done: false,
          },
        ])
      )
        setName("")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel" aria-label={t("tools.mapTitle")}>
      <h2>{t("tools.mapTitle")}</h2>
      <p>{t("tools.mapNotice")}</p>
      <label>
        {t("tools.mapFile")}
        <input className={styles.file} type="file" accept="image/png,.png" onChange={load} />
      </label>
      {loading && <p role="status">{t("tools.mapLoading")}</p>}
      {error && <p role="alert">{t("tools.mapInvalid")}</p>}
      {map && (
        <>
          <p>
            {map.name} · {markers.length} {t("tools.mapMarkers")}
          </p>
          <div
            className={styles.map}
            role="group"
            aria-label={t("tools.mapBoard")}
            onPointerDown={(event) => {
              if (event.target instanceof Element && event.target.closest("button")) return
              const rect = image.current?.getBoundingClientRect()
              if (!rect || !rect.width || !rect.height) return
              setX(
                String(
                  Math.round(
                    Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 10000,
                  ) / 100,
                ),
              )
              setY(
                String(
                  Math.round(
                    Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 10000,
                  ) / 100,
                ),
              )
            }}
          >
            <img ref={image} src={map.url} alt={t("tools.mapImage")} />
            {markers.map((marker) => (
              <button
                key={marker.id}
                type="button"
                className={styles.marker}
                aria-label={marker.name}
                aria-pressed={marker.done}
                title={marker.name}
                style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
                onClick={() =>
                  void onSave(
                    (entries ?? []).map((entry) =>
                      entry.id === marker.id ? { ...marker, done: !marker.done } : entry,
                    ),
                  )
                }
              >
                {marker.done ? "✓" : "+"}
              </button>
            ))}
          </div>
          <form onSubmit={add}>
            <fieldset
              disabled={saving || !entries || entries.length >= JOURNAL_LIMIT}
              className={styles.fields}
            >
              <label>
                {t("tools.markerName")}
                <TextInput
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                />
              </label>
              <label>
                {t("tools.markerX")}
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={x}
                  onChange={(event) => setX(event.target.value)}
                  required
                />
              </label>
              <label>
                {t("tools.markerY")}
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={y}
                  onChange={(event) => setY(event.target.value)}
                  required
                />
              </label>
              <button type="submit" className="btn">
                {t("tools.addMarker")}
              </button>
            </fieldset>
          </form>
          <ul className={styles.list}>
            {markers.map((marker) => (
              <li key={marker.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={marker.done}
                    onChange={() =>
                      void onSave(
                        (entries ?? []).map((entry) =>
                          entry.id === marker.id ? { ...marker, done: !marker.done } : entry,
                        ),
                      )
                    }
                  />
                  {marker.name}
                </label>{" "}
                · {(marker.x * 100).toFixed(2)}%, {(marker.y * 100).toFixed(2)}%{" "}
                <button type="button" className="btn" onClick={() => onDelete(marker.id)}>
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>{t("tools.mapBackup")}</p>
    </section>
  )
}
