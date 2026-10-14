import { defaultInputs } from "../../src/engine/defaults"
import { graduationInputs } from "../../src/engine/graduation"
import { gearWordMaxRoll } from "../../src/data/stats/statLines"
import { GEAR_SLOTS, type GearPiece, type GearWordId, type Inputs } from "../../src/engine/types"

export function syntheticGraduationInputs(): Inputs {
  const target = graduationInputs({
    ...defaultInputs,
    classId: "bellstrikeUmbra",
    breakthrough: 16,
    graduationBuildId: "graduation-bellstrikeUmbra-st-burst",
  })!
  const words: GearWordId[][] = [
    ["momentum", "momentum", "maxPhys", "maxFormless", "swordBoost"],
    ["maxPhys", "maxPhys", "power", "affinity", "maxFormless"],
    ["maxPhys", "maxPhys", "power", "allMartialBoost", "maxBellstrike"],
    ["maxPhys", "maxPhys", "affinity", "allMartialBoost", "minPhys"],
    ["affinity", "affinity", "maxPhys", "precision", "maxBellstrike"],
    ["affinity", "maxPhys", "momentum", "power", "maxBellstrike"],
    ["power", "maxPhys", "damageVsBoss", "momentum", "crit"],
    ["power", "power", "maxPhys", "damageVsBoss", "affinity"],
  ]
  const inventory = target.inventory.map((piece, index) => ({
    ...piece,
    id: `synthetic-${piece.slot}`,
    attunement: "",
    attunementValue: 0,
    words: words[index].map((word) => ({
      word,
      value: gearWordMaxRoll(word, piece.level) * 0.9,
      retuned: false,
    })) as GearPiece["words"],
  }))
  const totals: Partial<Record<GearWordId, number>> = {
    maxPhys: 827.7,
    power: 286.7,
    momentum: 189.3,
    affinity: 0.253,
    allMartialBoost: 0.062,
    swordBoost: 0.061,
    damageVsBoss: 0.062,
  }
  for (const [word, total] of Object.entries(totals)) {
    const lines = inventory.flatMap((piece) => piece.words).filter((entry) => entry.word === word)
    lines.forEach((entry) => {
      entry.value = total / lines.length
    })
  }
  const pendantAffinity = inventory[3].words[2]
  const affinityOthers = inventory
    .flatMap((piece) => piece.words)
    .filter((entry) => entry.word === "affinity" && entry !== pendantAffinity)
  pendantAffinity.value = 0.044
  affinityOthers.forEach((entry) => {
    entry.value = 0.209 / affinityOthers.length
  })
  return {
    ...target,
    inventory,
    equipped: Object.fromEntries(
      GEAR_SLOTS.map((slot) => [slot, `synthetic-${slot}`]),
    ) as Inputs["equipped"],
  }
}
