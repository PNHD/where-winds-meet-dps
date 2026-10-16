import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { ColorLab } from "../../src/ui/features/tools/color-lab/ColorLab"
import { TimingLab } from "../../src/ui/features/tools/timing-lab/TimingLab"

it("renders signature input as literal text and exposes the palette without HTML injection", () => {
  const { container } = render(
    <I18nProvider>
      <ColorLab />
    </I18nProvider>,
  )
  fireEvent.change(screen.getByLabelText("Signature text"), { target: { value: "<img src=x>" } })
  expect(screen.getByLabelText("Colored signature preview").textContent).toBe("<img src=x>")
  expect(container.querySelector("img")).toBeNull()
  expect(
    (screen.getByLabelText("Hex palette and literal text") as HTMLTextAreaElement).value,
  ).toContain("#D8B070")
})

it("leaves missing timing data unknown and computes only the entered local budget", () => {
  render(
    <I18nProvider>
      <TimingLab />
    </I18nProvider>,
  )
  expect(screen.getByRole("status").textContent).toMatch(/Enter all five/)
  const labels = [
    "Observed control window (ms)",
    "Remaining recovery after impact (ms)",
    "Next move time to impact (ms)",
    "User latency allowance (ms)",
    "Measurement uncertainty (ms)",
  ]
  labels.forEach((label, index) =>
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: [1000, 200, 500, 100, 100][index] },
    }),
  )
  expect(screen.getByRole("status").textContent).toMatch(/100.0 ms/)
  expect(screen.getByRole("status").textContent).toMatch(/verify in game/)
  fireEvent.change(screen.getByLabelText(labels[0]), { target: { value: "" } })
  expect(screen.getByRole("status").textContent).toMatch(/Enter all five/)
})
