import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { ConfirmProvider } from "../../src/ui/components/confirm-dialog/ConfirmDialog"
import { ToolsTab } from "../../src/ui/features/tools/tools-tab/ToolsTab"
import { TOOLKIT_KEY, parseJournal } from "../../src/ui/features/tools/toolkitJournal"

beforeEach(() => localStorage.clear())
function open() {
  return render(
    <I18nProvider>
      <ConfirmProvider>
        <ToolsTab />
      </ConfirmProvider>
    </I18nProvider>,
  )
}

it("shows eleven paths while leaving calculator storage and the active profile alone", () => {
  localStorage.setItem("wwm.profiles", "private sentinel")
  open()
  expect(
    screen.getByRole("region", { name: "Eleven-path coverage" }).querySelectorAll("li"),
  ).toHaveLength(11)
  expect(screen.getAllByText("DATA_NEEDED · DPS_UNAVAILABLE")).toHaveLength(6)
  expect(localStorage.getItem("wwm.profiles")).toBe("private sentinel")
  expect(localStorage.getItem(TOOLKIT_KEY)).toBeNull()
})

it("saves a personal deadline and keeps it across remounts", () => {
  const view = open()
  fireEvent.change(screen.getByLabelText("Label, banner or opponent alias"), {
    target: { value: "GvG warmup" },
  })
  fireEvent.change(screen.getByLabelText("Minutes from now"), { target: { value: "1" } })
  fireEvent.click(screen.getByRole("button", { name: "Save personal record" }))
  const entries = parseJournal(localStorage.getItem(TOOLKIT_KEY)!)
  expect(entries).toHaveLength(1)
  expect(entries[0].kind).toBe("timer")
  view.unmount()
  open()
  expect(screen.getByText("GvG warmup")).toBeTruthy()
})

it("keeps corrupt journal bytes instead of overwriting them", () => {
  localStorage.setItem(TOOLKIT_KEY, "{broken")
  open()
  expect(screen.getByRole("alert").textContent).toMatch(/not been overwritten/)
  expect(screen.getByRole("button", { name: "Save personal record" })).toBeDisabled()
  expect(localStorage.getItem(TOOLKIT_KEY)).toBe("{broken")
})

it("counts manual pulls without implying odds or touching equipment", () => {
  open()
  fireEvent.click(screen.getByRole("combobox", { name: "Record type" }))
  fireEvent.mouseDown(screen.getByRole("option", { name: /Manual pull counter/ }))
  fireEvent.change(screen.getByLabelText("Label, banner or opponent alias"), {
    target: { value: "Personal banner" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save personal record" }))
  fireEvent.click(screen.getByRole("button", { name: "Record one pull" }))
  expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)[0]).toMatchObject({
    kind: "pity",
    count: 1,
  })
  fireEvent.click(screen.getByRole("button", { name: "Undo one pull" }))
  expect(parseJournal(localStorage.getItem(TOOLKIT_KEY)!)[0]).toMatchObject({ count: 0 })
  expect(screen.getByRole("button", { name: "Undo one pull" })).toBeDisabled()
})
