# Amari photo library — deduped index

63 files live in `amari-photos/`. Distinct, publishable images are far fewer.
This is the culled map: pull headers from **KEEP**, break up text with **ACCENT**,
never publish **SOURCE-ONLY** or **RETIRE**. Non-destructive — nothing moved, so
existing mockup references still resolve. Updated 2026-07-12.

Legend: KEEP = strong, distinct, publishable · ACCENT = macro/texture, dividers &
pull-quote backgrounds only · SOURCE-ONLY = refine input, not a final image ·
RETIRE = exact duplicate or AI-look, do not use.

---

## KEEP — headers (18 distinct portraits)
All landscape ~1600×1194. This is the backbone. Filename encodes subject + demographic.

| File | Depicts | Natural use |
|---|---|---|
| `hero-home-cedar-woman.jpg` | woman, cedar wall, wide 1600×873 | home hero |
| `conditions-hub-man-blk49.jpg` | Black man reaching up, cedar wall | conditions hub / hero |
| `chronic-pain-woman-asn61.jpg` | older Asian woman | chronic-pain / stories |
| `firstvisit-doorway-woman-wht48.jpg` | woman in doorway | first-visit hero |
| `hip-woman-wht60.jpg` | woman | hip condition |
| `journal-woman-asn37.jpg` | Asian woman, hand on wall, green top | journal hero |
| `knee-man-his44.jpg` | Hispanic man | knee condition |
| `living-practice-woman-asn35.jpg` | Asian woman | in-person / living-practice |
| `neck-man-asn47.jpg` | Asian man | neck condition |
| `pricing-man-wht54.jpg` | man | pricing / sessions |
| `sciatica-man-wht50.jpg` | man | sciatica condition |
| `tmj-woman-asn39.jpg` | Asian woman | TMJ / jaw condition |
| `virtual-hero-man-asn43.jpg` | Asian man at desk | virtual-sessions hero |
| `virtual-logistics-woman-wht50.jpg` | woman | virtual logistics band |
| `inperson-logistics-woman-wht45.jpg` | woman | in-person logistics band |
| `partner-woman-his41.jpg` | Hispanic woman | partner page |
| `partner-movement-man-his52.jpg` | Hispanic man | partner page |
| `partner-yoga-woman-wht38.jpg` | woman | partner page |
| `black-woman38-window-seat.jpg` | Black woman, window seat | home band / accent |
| `black-man42-room-roller.jpg` | Black man, room + roller | how-it-works hero |
| `hip-woman-wht60-doorway.jpg` | woman in doorway (depth) | hip condition hero |
| `knee-man-his44-window.jpg` | Hispanic man by window | knee condition hero |
| `partner-coach.jpg` `partner-trainer.jpg` | partner tiles (1400×1045) | partner grid |

## KEEP — movement (real Course Video frames, people doing the method)
| File | Depicts |
|---|---|
| `journal-base/jh-spinal-wave-refined.jpg` | spinal wave, refined |
| `journal-base/jh-spring-step.jpg` | spring step |
| `journal-base/jh-vertical-drop.jpg` | vertical drop (legacy weak lean) |
| `journal-base/base-vertical-drop-6s.jpg` | vertical drop core front ~6s |
| `journal-base/base-vertical-drop-side-6s.jpg` | vertical drop side lean ~6s |

## KEEP — refined condition heroes (clean outputs of the refine pass)
| File | Depicts |
|---|---|
| `condition-base/knee-refined.jpg` | knee refine |
| `condition-base/lower-back-refined.jpg` | lower-back refine |
| `condition-base/shoulder-refined.jpg` | shoulder refine |

## KEEP? — testimonial avatars (verify these are real, not AI placeholders)
| File | Note |
|---|---|
| `avatars/avatar-elise.jpg` | pending: source a REAL Elise photo |
| `avatars/avatar-tyler.jpg` | pending: source a REAL Tyler photo |

---

## ACCENT — finished detail crops (6) — dividers & pull-quote backgrounds
`detail-crops/hand-mug-table.jpg` · `hand-reaching-open.jpg` · `jaw-neck-profile.jpg` ·
`neck-jaw-glance.jpg` · `open-collar-collarbone.jpg` · `shoulder-forearm-gym.jpg`

## ACCENT — texture macros (10) — material/surface fills only
`materials/denim-rust-cuff.jpg` · `hand-cedar-grain.jpg` · `hand-handrail-grip.jpg` ·
`jaw-neck-soft.jpg` · `linen-bedding.jpg` · `linen-sleeve-fold.jpg` · `merino-forest.jpg` ·
`silk-oxblood.jpg` · `velvet-teal.jpg` · `wood-floor-grain.jpg`

---

## SOURCE-ONLY — refine inputs, never publish as-is
These are the raw frames the refines were built from. Several are near-identical
(the man-on-the-floor-over-roller cluster, the standing-on-beam cluster). Keep for
re-refining; do not wire into pages.

- `condition-base/`: `hip.jpg` `knee.jpg` `lower-back.jpg` `lowerback-hands-support.jpg` `neck.jpg` `shoulder.jpg`
- `detail-base/`: `04-forearm-twist-elbow-reset.jpg` `05-nape-of-neck.jpg` `07-hand-rail.jpg` `08-shoulder-settling-floor.jpg` `09-lowback-roller.jpg` `10-hands-near-sacrum.jpg` `11-hip-crease-bridge.jpg` `12-knees-shins-step.jpg` `14-heel-drop-step.jpg` `15-hand-foam-roller-macro.jpg`
- `journal-base/jh-spinal-wave.jpg` (superseded by `-refined`)

## RETIRE — exact duplicates / do not use
- `materials/living-practice-woman-alt45.jpg` — byte-identical to `inperson-logistics-woman-wht45.jpg`
- `materials/living-practice-woman-alt50.jpg` — byte-identical to `virtual-logistics-woman-wht50.jpg`
- (outside this folder) `mockup-assets/real/hands-on-rings-landscape.jpg` — AI-look, retired site-wide 2026-07-12

### Exact-dup file chains (informational — intentional base-frame copies)
`condition-base/shoulder.jpg` = `detail-base/05-nape-of-neck.jpg` ·
`condition-base/knee.jpg` = `detail-base/12-knees-shins-step.jpg` ·
`condition-base/lower-back.jpg` = `detail-base/09-lowback-roller.jpg` = `detail-base/15-hand-foam-roller-macro.jpg` ·
`condition-base/hip.jpg` = `detail-base/11-hip-crease-bridge.jpg` ·
`condition-base/neck.jpg` = `detail-base/07-hand-rail.jpg`

---

## The gap this exposes
~26 header-worthy images (18 portraits + 3 movement + 3 refined + a couple stills
from `mockup-assets/real/`) against ~156 journal slots. Heavy repetition on the
journal is structural until a per-article header batch is generated. See the journal
mockup de-dup and the shots-todo worklist.

## Firefly keeps wired 2026-07-15
- `images/v6/real/{passive-bridge,active-bridge,elbow-reset,hand-balancer,putting-it-all-together,spring-step,vertical-drop}.jpg` from Drive Firefly outputs
- `journal-base/jh-vertical-drop.jpg`, `jh-spring-step.jpg` replaced with Firefly keeps
- `detail-crops/hand-reaching-open.jpg` cropped from hand-reaching generate
- Suspension hang full frame NOT wired (crop-only asset saved at `detail-crops/suspension-hang-arms-crop.jpg` unused)
