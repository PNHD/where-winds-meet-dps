# Best Build contract

- Evaluate complete eight-slot builds through the existing derived-input and DPS
  engine behavior. Keep the active profile's rotation and set choices; never infer
  per-piece set membership that inventory does not record.
- Centralize search ceilings in `BEST_BUILD_LIMITS`. Exhaustively evaluate spaces
  of at most 1,024 combinations. Use deterministic complete-build beam neighbours
  above that ceiling: width 16, at most 8 rounds and 4,096 unique evaluations.
- Label every bounded-search result **Approximate**. Never claim a global optimum
  for it. Include the current complete build among its candidates.
- Break equal-score ties by code-point item-ID order in the canonical slot order.
  Keep results independent of inventory ordering.
- Yield every 16 evaluations to receive worker cancellation. Use the shared worker
  client; never shard a complete-build search into independent slot optimizations.
- Exclude and count malformed candidates. Return explicit errors for missing
  required slots, duplicate IDs, invalid equipped references or unavailable engine
  evaluation. Never silently resolve ambiguous item identity.
- Never mutate Inputs while searching. Show current/proposed DPS, delta, all eight
  selected pieces and search metadata before exposing **Equip Best Build**.
- Equip only on that explicit action. Invalidate replies and previews after changes
  to profile, inventory or rotation, cancellation, or abandonment of the search.
