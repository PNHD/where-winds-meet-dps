import { useEffect, useMemo, useState } from "react"
import type { Inputs } from "../../engine/types"
import type { StatChange } from "../../engine/statLab"
import {
  cancelDpsWorkerRequest,
  postToDpsWorker,
  retainedResponse,
  subscribeToDpsWorker,
} from "./dpsWorkerClient"
import { useDpsWorkerPending } from "./useDpsWorkerPending"

export function useStatLab(inputs: Inputs, changes: StatChange[], profileId?: string) {
  const sourceKey = useMemo(
    () => JSON.stringify({ profileId, inputs, changes }),
    [profileId, inputs, changes],
  )
  const [response, setResponse] = useState(() => retainedResponse("statLab"))
  const isPending = useDpsWorkerPending("statLab")
  useEffect(() => subscribeToDpsWorker("statLab", setResponse), [])
  useEffect(() => {
    postToDpsWorker({ kind: "statLab", inputs, changes, sourceKey })
  }, [inputs, changes, sourceKey])
  const result =
    response?.sourceKey === sourceKey && retainedResponse("statLab") === response
      ? response.result
      : null
  return {
    result,
    isPending,
    cancel() {
      setResponse(null)
      cancelDpsWorkerRequest("statLab")
    },
    retry() {
      postToDpsWorker({ kind: "statLab", inputs, changes, sourceKey })
    },
  }
}
