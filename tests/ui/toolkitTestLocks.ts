export function installTestLocks() {
  let tail = Promise.resolve<unknown>(undefined)
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, callback: () => unknown) => {
        const result = tail.then(callback)
        tail = result.catch(() => undefined)
        return result
      },
    },
  })
}
