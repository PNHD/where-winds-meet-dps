import type { StoredProfile } from "../../../../engine/types"
import { GEAR_SLOTS } from "../../../../engine/types"

export function equippedShare(profile: StoredProfile, name: string): StoredProfile {
  const shared = structuredClone(profile)
  shared.id = "shared-profile"
  shared.name = name.trim()
  const equippedIds = new Set(Object.values(shared.inputs.equipped))
  const idMap = new Map<string, string>()
  shared.inputs.inventory = shared.inputs.inventory
    .filter((piece) => equippedIds.has(piece.id))
    .map((piece, index) => {
      const id = `shared-item-${index + 1}`
      idMap.set(piece.id, id)
      delete piece.label
      delete piece.note
      return { ...piece, id }
    })
  for (const slot of GEAR_SLOTS)
    shared.inputs.equipped[slot] = idMap.get(shared.inputs.equipped[slot] ?? "") ?? null
  return shared
}
