import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { defaultInputs } from "../../src/engine/defaults"
import { EMPTY_EQUIPPED, emptyGearWords, type GearPiece } from "../../src/engine/types"
import { exportProfile, importProfile } from "../../src/storage"
import { equippedShare } from "../../src/ui/features/profile/profile-share-preview/equippedShare"
import { ProfileSharePreview } from "../../src/ui/features/profile/profile-share-preview/ProfileSharePreview"
import { I18nProvider } from "../../src/i18n/I18nProvider"

it("omits spare inventory and known private labels/notes, remaps equipped IDs and leaves the source unchanged", () => {
  const piece: GearPiece = {
    id: "private-item",
    slot: "helm",
    level: 96,
    rarity: "legendary",
    minPhys: 0,
    maxPhys: 0,
    hp: 0,
    physDef: 0,
    words: emptyGearWords(),
    attunement: "",
    attunementValue: 0,
    relayed: false,
    label: "Private label",
    note: "Private note",
  }
  const profile = {
    id: "private-profile",
    name: "Private name",
    inputs: {
      ...structuredClone(defaultInputs),
      inventory: [piece, { ...piece, id: "private-spare" }],
      equipped: { ...EMPTY_EQUIPPED, helm: piece.id },
    },
  }
  const before = structuredClone(profile),
    shared = equippedShare(profile, "Shared test")
  expect(profile).toEqual(before)
  expect(shared.inputs.inventory).toHaveLength(1)
  expect(shared.inputs.inventory[0]).not.toHaveProperty("label")
  expect(shared.inputs.inventory[0]).not.toHaveProperty("note")
  expect(shared.inputs.equipped.helm).toBe(shared.inputs.inventory[0].id)
  const text = exportProfile(shared)
  expect(text).not.toMatch(
    /private-item|private-spare|private-profile|Private name|Private label|Private note/,
  )
  const imported = importProfile(text)
  expect(imported.inputs.equipped.helm).toBe(imported.inputs.inventory[0].id)
  expect(imported.inputs.inventory[0].words).toEqual(piece.words)
})

it("requires explicit file review before download and invalidates consent when the name changes", () => {
  const onDownload = vi.fn(),
    onClose = vi.fn()
  render(
    <I18nProvider>
      <ProfileSharePreview
        profile={{ id: "test", name: "Private name", inputs: structuredClone(defaultInputs) }}
        onDownload={onDownload}
        onClose={onClose}
      />
    </I18nProvider>,
  )
  const button = screen.getByRole("button", { name: "Download reviewed build" })
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByRole("checkbox"))
  fireEvent.click(button)
  expect(onDownload).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText("Public build name"), { target: { value: "Renamed" } })
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
