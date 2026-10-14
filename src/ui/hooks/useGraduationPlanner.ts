import { useEffect, useMemo, useState, useRef } from "react"
import type { Inputs } from "../../engine/types"
import type { PlannerOptions } from "../../engine/graduationPlanner"
import {
  cancelDpsWorkerRequest,
  postToDpsWorker,
  retainedResponse,
  subscribeToDpsWorker,
} from "./dpsWorkerClient"
import { useDpsWorkerPending } from "./useDpsWorkerPending"

export function useGraduationPlanner(inputs: Inputs, options: PlannerOptions, profileId?: string) {
  const sourceKey = useMemo(
    () => JSON.stringify({ profileId, inputs, options }),
    [profileId, inputs, options],
  )
  const [response, setResponse] = useState(() => retainedResponse("graduationPlanner"))
  const isPending = useDpsWorkerPending("graduationPlanner")
  const requested = useRef(false)
  const previousSource = useRef<string | null>(null)
  useEffect(() => subscribeToDpsWorker("graduationPlanner", setResponse), [])
  useEffect(() => {
    if (previousSource.current === sourceKey) return
    previousSource.current = sourceKey
    cancelDpsWorkerRequest("graduationPlanner")
    if (requested.current)
      postToDpsWorker({ kind: "graduationPlanner", inputs, sourceKey, options })
  }, [sourceKey, inputs, options])
  const result =
    !isPending &&
    response?.sourceKey === sourceKey &&
    retainedResponse("graduationPlanner") === response
      ? response.result
      : null
  return {
    sourceKey,
    result,
    isPending,
    start() {
      requested.current = true
      setResponse(null)
      postToDpsWorker({ kind: "graduationPlanner", inputs, sourceKey, options })
    },
    cancel() {
      requested.current = false
      setResponse(null)
      cancelDpsWorkerRequest("graduationPlanner")
    },
  }
}
