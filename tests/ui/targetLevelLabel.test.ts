import { describe, expect, it } from "vitest"
import { targetLevelLabel } from "../../src/ui/features/gear/shared/targetLevelLabel"

describe("targetLevelLabel", () => {
  it("names the level used by a different-level benchmark", () => {
    expect(targetLevelLabel("FP", 96, 100)).toBe("FP → lv100")
    expect(targetLevelLabel("Max (94%)", 96, 105)).toBe("Max (94%) → lv105")
  })

  it("keeps the label at the piece's own level", () => {
    expect(targetLevelLabel("FP", 100, 100)).toBe("FP")
  })

  it("supports pending and older worker responses without level metadata", () => {
    expect(targetLevelLabel("Max (94%)", 96, undefined)).toBe("Max (94%)")
  })
})
