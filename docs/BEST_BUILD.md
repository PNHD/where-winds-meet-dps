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
- Analyze next-action advice on the proposed equipment, retaining all active
  configuration and rotation context. Reuse Retunement legality, weighted pools,
  roll outcomes and attempt limits; never maintain a second legality model.
- Recommend only positive legal next Retunements. Rank by maximum-roll modeled
  gain; identify that roll assumption, keep draw and conditional improve chances
  distinct, and label any probability-weighted expectation as this target's
  contribution per draw, never the whole draw's gain or a guaranteed gain.
  Leave unavailable probabilities unknown.
- Preserve heirloom guidance. Protect existing heirlooms and exclude relayed or
  exhausted single-attempt pieces from actionable upgrade recommendations.
- Keep advice within the search request's worker, cancellation and source-key
  lifecycle. Never mutate gear or retain advice after material inputs change.
- Compare slot alternatives only with the other seven proposed slots fixed.
  Label the signed selected-minus-replacement gap as local sensitivity, never as
  independent slot optimality; an approximate result may have a negative gap.
