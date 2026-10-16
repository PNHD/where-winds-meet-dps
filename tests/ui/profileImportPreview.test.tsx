import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { I18nProvider } from "../../src/i18n/I18nProvider"
import { ProfilePanel } from "../../src/ui/features/profile/profile-panel/ProfilePanel"
import { defaultInputs } from "../../src/engine/defaults"
import { exportProfile } from "../../src/storage"

vi.mock("../../src/ui/hooks/useProfileMetrics", () => ({
  useProfileMetrics: () => ({ metricsByProfileId: {}, isPending: false }),
}))

it("previews a profile without writing it, cancels safely and adds only after consent", async () => {
  const onImport = vi.fn()
  const profile = { id: "source", name: "Private build", inputs: structuredClone(defaultInputs) }
  const { container } = render(
    <I18nProvider>
      <ProfilePanel
        profiles={[profile]}
        activeId="source"
        customSkills={[]}
        customBuffs={[]}
        customDebuffs={[]}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onImport={onImport}
      />
    </I18nProvider>,
  )
  const file = { size: 2000, text: async () => exportProfile(profile) }
  const upload = () =>
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  upload()
  await screen.findByRole("region", { name: "Import preview" })
  expect(onImport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.queryByRole("region", { name: "Import preview" })).toBeNull()
  expect(onImport).not.toHaveBeenCalled()
  upload()
  await screen.findByRole("region", { name: "Import preview" })
  fireEvent.click(screen.getByRole("button", { name: "Add as a new profile" }))
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
  expect(onImport.mock.calls[0][0].id).not.toBe(profile.id)
  expect(onImport.mock.calls[0][0].name).toBe(profile.name)
})

it("ignores superseded reads and does not resurrect a cancelled preview", async () => {
  const profile = { id: "source", name: "Existing build", inputs: structuredClone(defaultInputs) }
  const onImport = vi.fn()
  const { container } = render(
    <I18nProvider>
      <ProfilePanel
        profiles={[profile]}
        activeId="source"
        customSkills={[]}
        customBuffs={[]}
        customDebuffs={[]}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onImport={onImport}
      />
    </I18nProvider>,
  )
  let finish!: (text: string) => void
  const slow = new Promise<string>((resolve) => {
    finish = resolve
  })
  const upload = (text: () => Promise<string>) =>
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [{ size: 1000, text }] },
    })
  upload(() => slow)
  upload(async () => exportProfile({ ...profile, name: "Newer build" }))
  await screen.findByRole("region", { name: "Import preview" })
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await act(async () => {
    finish(exportProfile({ ...profile, name: "Obsolete build" }))
    await slow
  })
  expect(screen.queryByRole("region", { name: "Import preview" })).toBeNull()
  expect(onImport).not.toHaveBeenCalled()
})
