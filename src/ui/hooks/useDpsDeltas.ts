import { useEffect, useMemo, useState } from "react"
import type { Inputs } from "../../engine/types"
import type { DpsDelta } from "../../engine/dpsWorker"
import { postToDpsWorker, retainedResponse, subscribeToDpsWorker } from "./dpsWorkerClient"
import { useDpsWorkerPending } from "./useDpsWorkerPending"

export type DpsDeltaMap = Record<string, DpsDelta | undefined>

export interface DpsDeltasResult {
  deltas: DpsDeltaMap
  isPending: boolean
}

const EMPTY_DELTAS: DpsDeltaMap = {}

export function useDpsDeltas(
  inputs: Inputs,
  baselineDps: number,
  pieceIds?: readonly string[],
): DpsDeltasResult {
  const ids = useMemo(
    () => pieceIds ?? inputs.inventory.map((piece) => piece.id),
    [pieceIds, inputs.inventory],
  )
  const [deltas, setDeltas] = useState<DpsDeltaMap>(
    () => retainedResponse("dpsDeltas")?.deltas ?? EMPTY_DELTAS,
  )
  const isPending = useDpsWorkerPending("dpsDeltas")

  const hasCandidates = ids.length > 0

  useEffect(() => {
    if (!hasCandidates) return
    return subscribeToDpsWorker("dpsDeltas", ({ deltas: next }) => setDeltas(next))
  }, [hasCandidates])

  useEffect(() => {
    if (!hasCandidates) return
    postToDpsWorker({
      kind: "dpsDeltas",
      inputs,
      baselineDps,
      pieceIds: [...ids],
    })
  }, [inputs, baselineDps, hasCandidates, ids])

  if (!hasCandidates) return { deltas: EMPTY_DELTAS, isPending: false }
  return { deltas, isPending }
}
