export function timingMargin(
  windowMs: number,
  recoveryMs: number,
  startupMs: number,
  latencyAllowanceMs: number,
  uncertaintyMs: number,
): number | null {
  const values = [windowMs, recoveryMs, startupMs, latencyAllowanceMs, uncertaintyMs]
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 60_000)) return null
  return windowMs - recoveryMs - startupMs - latencyAllowanceMs - uncertaintyMs
}

export function signatureColors(
  text: string,
  start: string,
  end: string,
): { text: string; color: string }[] {
  if (!/^#[\da-f]{6}$/i.test(start) || !/^#[\da-f]{6}$/i.test(end)) return []
  const graphemes = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
  ].map((part) => part.segment)
  if (graphemes.length > 120) return []
  const from = [1, 3, 5].map((offset) => parseInt(start.slice(offset, offset + 2), 16))
  const to = [1, 3, 5].map((offset) => parseInt(end.slice(offset, offset + 2), 16))
  return graphemes.map((text, index) => ({
    text,
    color:
      "#" +
      from
        .map((value, channel) =>
          Math.round(value + ((to[channel] - value) * index) / Math.max(1, graphemes.length - 1))
            .toString(16)
            .padStart(2, "0"),
        )
        .join(""),
  }))
}

export function latencySummary(samples: number[], failed: number) {
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2
    : null
  const variation =
    samples.length < 2
      ? null
      : samples.slice(1).reduce((sum, value, index) => sum + Math.abs(value - samples[index]), 0) /
        (samples.length - 1)
  return { samples, failed, median, variation }
}

export async function measureBrowserLatency(signal: AbortSignal) {
  const samples: number[] = []
  let failed = 0
  for (let index = 0; index < 8 && !signal.aborted; index++) {
    const start = performance.now()
    try {
      const response = await fetch(
        `/latency-probe.txt?sample=${index}-${Math.random().toString(36).slice(2)}`,
        {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          mode: "same-origin",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        },
      )
      if (!response.ok) throw new Error("HTTP probe failed")
      await response.arrayBuffer()
      samples.push(performance.now() - start)
    } catch {
      if (!signal.aborted) failed++
    }
  }
  return { ...latencySummary(samples, failed), cancelled: signal.aborted }
}
