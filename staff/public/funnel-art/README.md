# Funnel woodland — painted art layers

Drop the generated PNGs into THIS folder with these exact filenames. The Funnel
page (`src/pages/FunnelPage.tsx`) probes for each at runtime and upgrades from
its built-in SVG stand-ins automatically — no code change needed. Rebuild
(`npx vite build`) so they're copied into `dist/staff/funnel-art/`.

**Global style for every asset:** warm folk-storybook (Rebecca Green / Carson
Ellis), gouache texture, thin hand-inked edges (#332B26), soft warm light from
upper-left, TRANSPARENT background, no text/watermark, PNG with alpha, sRGB.
Palette anchors: paper #FBF6EE · ink #2C2738 · radish #C8475A · radish leaves
#7BA05B · bear #6E5038 · trunk #6B5640 · leaf/moss #566B4C · green #5C8A6A ·
basket #B0884E · gold #E8B84B · ember #EBA584 · rust #C9805A.

| file | size (px) | subject |
|---|---|---|
| `bear-ladle.png` | 760×760 | Friendly round brown bear (#6E5038, muzzle #caa987), 3/4 view facing LEFT, both paws tipping a wooden ladle (handle #8a6a3e) pouring 2–3 small radishes down to the lower-left. Kind sleepy face. |
| `tree-trunk.png` | 640×1500 | Tall hollow tree trunk shaped like a gentle funnel: wide dark knothole MOUTH at the very top (hollow #4a3826), trunk tapering from ~85% canvas width at top to ~38% at bottom, bark #6B5640, moss tufts on the mouth rim, slight root flare at base. Centered, near-symmetric. |
| `pool-bowl.png` | 640×280 | One shallow carved-wood basin seen slightly from above (elliptical), rim #8a6a3e, inside glowing warm water (#EBA584→#E8B84B), a little moss on the left rim. Centered. |
| `rabbit-hop.png` | 380×380 | Small cream rabbit mid-hop, side profile facing RIGHT, ears swept back, inner-ear blush #EBA584. |
| `rabbit-sit.png` | 380×380 | Same rabbit sitting upright, ears tall, facing RIGHT. |
| `hedgehog-basket.png` | 620×460 | Proud little hedgehog (#7a5c43, quills #5a4029) standing to the RIGHT of a woven basket (#B0884E, weave #8a6a35) heaped with radishes, facing LEFT toward it. |
| `radish.png` | 180×200 | One plump radish #C8475A with white tip and 3 leaves #7BA05B, slight tilt. |
| `leaf.png` | 150×150 | Single painterly leaf #566B4C, lighter vein, slight curl. |
| `ground-bank.png` | 1280×420 | Soft grassy bank strip (#566B4C→#5C8A6A with warm paper highlights, a few tiny gold/maroon wildflowers), fading to transparent at the TOP edge, full-bleed at bottom. |

Display sizes are ~half these pixels (retina 2×). After dropping files in,
consider `cwebp -q 82` → same name `.png` kept for simplicity, or just compress
the PNGs (target <120KB each).
