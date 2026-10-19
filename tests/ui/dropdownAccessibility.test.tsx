import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { MultiSelect } from "../../src/ui/components/select/MultiSelect"

describe("permanent option picker accessibility", () => {
  it("exposes the active keyboard option and its selected state while retaining trigger focus", () => {
    function Harness() {
      const [selected, setSelected] = useState<string[]>([])
      return (
        <MultiSelect
          label="Permanent buffs"
          options={[
            { id: "first", label: "First" },
            { id: "second", label: "Second" },
          ]}
          selected={selected}
          onChange={setSelected}
        />
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole("combobox", { name: "Permanent buffs" })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const list = screen.getByRole("listbox", { name: "Permanent buffs" })
    expect(trigger).toHaveAttribute("aria-controls", list.id)
    expect(document.getElementById(trigger.getAttribute("aria-activedescendant")!)).toBe(
      screen.getByRole("option", { name: "First" }),
    )
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const second = screen.getByRole("option", { name: "Second" })
    expect(trigger).toHaveAttribute("aria-activedescendant", second.id)
    fireEvent.keyDown(trigger, { key: " " })
    expect(second).toHaveAttribute("aria-selected", "true")
    expect(trigger).toHaveFocus()
    fireEvent.keyDown(trigger, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(trigger).not.toHaveAttribute("aria-activedescendant")
  })
})
