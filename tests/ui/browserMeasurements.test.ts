import { afterEach, expect, it, vi } from "vitest"
import {
  latencySummary,
  measureBrowserLatency,
  signatureColors,
  timingMargin,
} from "../../src/ui/features/tools/browserMeasurements"

afterEach(() => vi.restoreAllMocks())
it("keeps empty or invalid timing inputs unknown and treats the exact boundary as zero margin", () => {
  expect(timingMargin(NaN, 0, 0, 0, 0)).toBeNull()
  expect(timingMargin(1000, -1, 1, 0, 0)).toBeNull()
  expect(timingMargin(60_001, 0, 0, 0, 0)).toBeNull()
  expect(timingMargin(1000, 200, 500, 200, 100)).toBe(0)
  expect(timingMargin(1000, 100, 500, 50, 50)).toBe(300)
})
it("generates exact RGB endpoints while keeping Unicode graphemes and literal markup intact", () => {
  expect(signatureColors("AB", "#000000", "#ffffff")).toEqual([
    { text: "A", color: "#000000" },
    { text: "B", color: "#ffffff" },
  ])
  const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}"
  expect(signatureColors(family, "#112233", "#ffffff")).toEqual([
    { text: family, color: "#112233" },
  ])
  expect(
    signatureColors("<img>", "#000000", "#ffffff")
      .map((part) => part.text)
      .join(""),
  ).toBe("<img>")
  expect(signatureColors("x".repeat(121), "#000000", "#ffffff")).toEqual([])
  expect(signatureColors("x", "url(unsafe)", "#ffffff")).toEqual([])
})
it("computes median and adjacent variation without sorting away sample order", () => {
  expect(latencySummary([30, 10, 20, 100], 2)).toMatchObject({
    median: 25,
    variation: 110 / 3,
    failed: 2,
    samples: [30, 10, 20, 100],
  })
  expect(latencySummary([], 8)).toMatchObject({ median: null, variation: null })
  expect(latencySummary([3], 0).variation).toBeNull()
})
it("makes only eight bounded same-origin credential-free requests and retains failures", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(5) } as Response)
  fetcher.mockRejectedValueOnce(new Error("offline"))
  const result = await measureBrowserLatency(new AbortController().signal)
  expect(fetcher).toHaveBeenCalledTimes(8)
  expect(result).toMatchObject({ failed: 1, cancelled: false })
  expect(result.samples).toHaveLength(7)
  for (const [url, options] of fetcher.mock.calls) {
    expect(url).toMatch(/^\/latency-probe.txt\?sample=/)
    expect(options).toMatchObject({
      credentials: "omit",
      redirect: "error",
      mode: "same-origin",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    })
  }
})
it("cancels an in-flight probe and starts no later requests", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
  )
  const controller = new AbortController(),
    pending = measureBrowserLatency(controller.signal)
  controller.abort()
  expect(await pending).toMatchObject({ cancelled: true, failed: 0, samples: [] })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
