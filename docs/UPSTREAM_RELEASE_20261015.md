# Qualified upstream integration, 2026-10-15

PNHD baseline: immutable Git tree `f2269f409296ec22a73fd9a83442669dca5ce81b`, combining the open PNH-10 and PNH-16 changes locally. This is a selective adaptation, not an upgrade to all of upstream v0.8.0.

## Source and license

Source A: [M1zuke/where-winds-meet-dps](https://github.com/M1zuke/where-winds-meet-dps/tree/a7b3671af205d61143f83c353f4d75d5cbae5234), pinned `a7b3671af205d61143f83c353f4d75d5cbae5234`, MIT. The repository's existing MIT license and M1zuke copyright notice are retained.

Source B: [greydust/where-builds-meet](https://github.com/greydust/where-builds-meet/tree/f9454dee3a2e7c80e01b6dd7aabc60c5ba54a1c3), pinned `f9454dee3a2e7c80e01b6dd7aabc60c5ba54a1c3`, GPL-3.0. Commit/license metadata is a research reference only. No Source B code, fixtures, assets or probability tables are incorporated.

## Adopted compatible changes

- `065501dfe652cab9d85fd73273903f31c1c468b3`: display the actual evaluation level beside Max (94%), FP and FP(E) when it differs from the piece's stored level. The worker reports the chosen evaluation level from the same Retune/relay calculation; no DPS formula or stored piece level changes. Adapted to preserve the existing `getFTPiece(): GearPiece` and numeric `ftDpsWhenEquipped()` APIs. Optional worker metadata supports older responses and existing clients. Source A's level-label helper and explanatory locale text are retained.
- `55fe87ac39ff0517b9a12ba9ae1ba279c6a086ac`, standardized-encounter portion only: a custom Graduation build uses its class's shipped standard on the same rotation, or the first available class standard. Custom gear words, target counts, selected rotation, inputs and stored profile format remain unchanged. This stabilizes custom benchmark comparisons without changing the profile's active-rotation DPS outside Graduation rating.

## Deferred with reasons

- Numeric fresh-Tune UI from `a51d41a6462e381452e3840866ac1dd7154d7550` and related `497751862e9379c3f50970aaf70fb40dd99e5c6a`: the published weighted model is not verified Global T96 game RNG evidence. Existing planner fresh-Tune odds and expected stochastic spend remain UNKNOWN/null. Existing modeled Retune calculations are not promoted to proof of fresh-Tune odds.
- Dynamic Qi replay from the remainder of `55fe87ac...` and `4d031722a959e7a92551e8d8b58670c3c97fe1b2`: requires the upstream damage-driven Qi simulator, its timeline/engine options and event tape. This baseline uses the existing fixed Qi-window model. Copying only the replay call would be incorrect; introducing that engine dependency chain is outside this compatible delta. Qi and rotation calculations therefore retain the PNHD baseline behavior, with no new game-accuracy claim.
- The wider rotation, distance, ping/FPS, weapon-slot and class-math changes across the 82 commits: coupled engine, skill-data and profile migrations require a separate coherent integration and review. No unrelated classes, generated registries or blanket data replacement are imported.
- Defensive word/pool expansion `7e610e880ef3187c93e6f3f81c05fe2fb974ded7`: coupled new stat IDs, import/OCR mapping, level ceilings, first-line pools and derived HP/defense calculation are deferred together. Do not take only a subset of those source tables and silently change Retune legality or stored-word interpretation.
- Upstream test-timeout increases: not adopted. Complete existing assertions, default timeouts, retries, concurrency and CI remain unchanged.

## Safety and compatibility

No persistent schema, storage keys, migrations, IDs, inventory, equipped gear, rolled values or custom rotations are changed. Existing profile migration tests remain in the complete suite; real production-origin backup/migration checks run privately outside Git. No private profile fixtures are added here.

PNHD's aggregate eight-slot budget and multi-action KEEP/REPLACE/RETUNE/FARM planner, cross-slot compensation, Stat Lab, canonical DPS engine and worker are retained. The unchanged Umbra fixture remains 31/40 covered with nine deficits. Source A's probability model alone does not qualify fresh Global T96 odds or stochastic spending estimates.
