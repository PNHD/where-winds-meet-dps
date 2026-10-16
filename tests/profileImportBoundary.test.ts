import { expect, it } from "vitest"
import { exportProfile, importProfile, MAX_PROFILE_IMPORT_CHARS } from "../src/storage"
import { defaultInputs } from "../src/engine/defaults"

it("rejects oversized and prototype-shaped input before hydration without storage writes", () => {
  const before = JSON.stringify(localStorage)
  expect(() => importProfile(" ".repeat(MAX_PROFILE_IMPORT_CHARS + 1))).toThrow(/limit/)
  for (const key of ["__proto__", "constructor", "prototype"]) {
    expect(() => importProfile(`{"nested":{"${key}":{}}}`)).toThrow(/unsafe/)
  }
  expect(JSON.stringify(localStorage)).toBe(before)
})

it("retains the existing versioned profile export and collision-safe import", () => {
  const profile = { id: "original", name: "Owned profile", inputs: structuredClone(defaultInputs) }
  const result = importProfile(exportProfile(profile))
  expect(result.id).not.toBe(profile.id)
  expect(result.name).toBe(profile.name)
  expect(result.inputs.classId).toBe(profile.inputs.classId)
})
