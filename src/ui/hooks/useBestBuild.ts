import { BEST_BUILD_LIMITS } from "../../engine/bestBuildSelection"
import { useEffect, useMemo, useState } from "react"
import type { Inputs } from "../../engine/types"
import {
  cancelDpsWorkerRequest,
  postToDpsWorker,
  retainedResponse,
  subscribeToDpsWorker,
} from "./dpsWorkerClient"
import { useDpsWorkerPending } from "./useDpsWorkerPending"

export function useBestBuild(
  inputs: Inputs,
  profileId?: string,
  evaluationLimit: number = BEST_BUILD_LIMITS.evaluations,
) {
  const sourceKey = useMemo(
    () => JSON.stringify({ profileId, inputs, evaluationLimit }),
    [profileId, inputs, evaluationLimit],
  )
  const [response, setResponse] = useState(() => retainedResponse("bestBuild"))
  const isPending = useDpsWorkerPending("bestBuild")
  useEffect(() => subscribeToDpsWorker("bestBuild", setResponse), [])
  useEffect(() => {
    cancelDpsWorkerRequest("bestBuild")
  }, [sourceKey])
  const result =
    !isPending && response?.sourceKey === sourceKey && retainedResponse("bestBuild") === response
      ? response.result
      : null
  return {
    sourceKey,
    result,
    isPending,
    start() {
      setResponse(null)
      postToDpsWorker({ kind: "bestBuild", inputs, sourceKey, evaluationLimit })
    },
    cancel() {
      setResponse(null)
      cancelDpsWorkerRequest("bestBuild")
    },
  }
}
