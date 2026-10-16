import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { MockWorker, STALE_INNER_WAY } = vi.hoisted(() => {
  class Mock {
    onmessage: ((event: { data: unknown }) => void) | null = null
    postMessage() {}
    terminate() {}
  }
  return { MockWorker: Mock, STALE_INNER_WAY: "frostCladNight" }
})

vi.mock("../../src/engine/dpsWorker?worker", () => ({ default: MockWorker }))

vi.mock("../../src/definitions/innerWays/registry", async (importOriginal) => {
  const registry = await importOriginal<typeof import("../../src/definitions/innerWays/registry")>()
  return {
    ...registry,
    innerWayDefinition: (id: string) => {
      const definition = registry.innerWayDefinition(id)
      return definition?.id === STALE_INNER_WAY
        ? { ...definition, confirmedBreakthrough: definition.confirmedBreakthrough - 1 }
        : definition
    },
  }
})

const { defaultInputs } = await import("../../src/engine/defaults")
const { loadProfiles, saveProfiles } = await import("../../src/storage")
const { BREAKTHROUGH_RELEASES } = await import("../../src/definitions/baseStats/breakthroughs")
const { App } = await import("../../src/app/App")

const LATEST_RELEASE = BREAKTHROUGH_RELEASES.reduce((latest, release) =>
  release.at > latest.at ? release : latest,
).at

const ASKED_CLASS = "Stonesplit Strength"
const CONFIRMED_CLASS = "Bellstrike Umbra"

function chooseClass(className: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: "Class" }))
  fireEvent.mouseDown(screen.getByRole("option", { name: new RegExp(className) }))
}

function expectNoPrompt(): void {
  expect(
    screen.queryByRole("dialog", { name: "New Breakthrough — Data Needed" }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole("timer")).not.toBeInTheDocument()
}

function storedData(): Record<string, string | null> {
  return Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key.startsWith("wwm."))
      .sort()
      .map((key) => [key, localStorage.getItem(key)]),
  )
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ""
  vi.useFakeTimers()
  vi.setSystemTime(LATEST_RELEASE)
  vi.spyOn(document, "hasFocus").mockReturnValue(true)
  saveProfiles({
    profiles: [
      { id: "only", name: "Only", inputs: { ...defaultInputs, classId: "stonesplitStrength" } },
      { id: "other", name: "Other", inputs: { ...defaultInputs, classId: "bellstrikeUmbra" } },
    ],
    activeId: "only",
  })
  localStorage.setItem("wwm.locale", "en")
  localStorage.setItem("wwm.lastSeenVersion", "0.7.3")
  localStorage.setItem("wwm.contributors", "[]")
  loadProfiles()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("automatic breakthrough data requests stay disabled", () => {
  it("opens a stale-data profile without a modal or fifteen-second hold", () => {
    const before = storedData()
    render(<App />)
    expectNoPrompt()
    act(() => {
      vi.advanceTimersByTime(16_000)
    })
    expectNoPrompt()
    expect(storedData()).toEqual(before)
  })

  it("stays disabled after the app is remounted from saved data", () => {
    const first = render(<App />)
    expectNoPrompt()
    first.unmount()
    render(<App />)
    expectNoPrompt()
  })

  it("does not open when changing classes, including returning to stale data", () => {
    render(<App />)
    chooseClass(CONFIRMED_CLASS)
    expectNoPrompt()
    chooseClass(ASKED_CLASS)
    expectNoPrompt()
  })

  it("stays disabled while navigating and switching saved profiles", () => {
    render(<App />)
    const before = JSON.parse(localStorage.getItem("wwm.profiles")!)
    fireEvent.click(screen.getByRole("tab", { name: "Profiles" }))
    fireEvent.click(
      screen.getAllByRole("button", { name: "Select" }).find((b) => !b.hasAttribute("disabled"))!,
    )
    expectNoPrompt()
    fireEvent.click(screen.getByRole("tab", { name: "Gear" }))
    expectNoPrompt()
    fireEvent.click(screen.getByRole("tab", { name: "Profiles" }))
    fireEvent.click(
      screen.getAllByRole("button", { name: "Select" }).find((b) => !b.hasAttribute("disabled"))!,
    )
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }))
    expectNoPrompt()
    expect(JSON.parse(localStorage.getItem("wwm.profiles")!)).toEqual(before)
  })
})
