import { afterAll, expect, it, vi } from "vitest"
import { parseRunSeed } from "../../src/engine/dpsWorker"

const pageMessage = vi.hoisted(() => {
  const previous = window.onmessage
  const handler = vi.fn()
  window.onmessage = handler
  return { previous, handler }
})

afterAll(() => {
  window.onmessage = pageMessage.previous
})

it("keeps the page message handler when worker helpers are imported on Window", () => {
  expect(parseRunSeed).toBeTypeOf("function")
  expect(window.onmessage).toBe(pageMessage.handler)
})
