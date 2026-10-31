// One visual contract is shared by the deterministic brief, optional compiler,
// planner, and renderer. It preserves authored designs without inventing holders,
// camera positions, or real-world dimensions for fantasy subjects.
export const PAGE_VISUAL_INTEGRITY_RULES: readonly string[] = [
  'Honor registered types: character, nonhuman, or object. Objects have no human anatomy or body language unless explicitly authored.',
  'Preserve reference silhouettes, component counts, proportions, connections, materials, colors, and details. Rotate and foreshorten the same design; keep rigid parts aligned and let flexible or articulated parts move only as constructed.',
  'Reference framing, display poses, backgrounds, and crop sizes do not define scene placement or world scale.',
  'Place objects through authored holder/use/support/contact relationships, not independent screen zones or facing. Preserve explicit composition placement; do not invent a holder or force unheld objects into hands.',
  'Keep the correct user and object connected: natural grips on intended contact surfaces, coherent fingers/palms, part axes, and occlusion. No floating grips or body-object fusion.',
  'Subjects at comparable depth have plausible size relationships, respecting authored heights, anatomy, and dimensions. Foreground enlargement must follow perspective and foreshortening, not arbitrary resizing.',
  'Keep world-scale relationships across panels; camera distance, pose, and crop may change apparent size. Separate reference crops do not imply equal heights.',
  'Explicit authored giants, miniatures, fantasy anatomy, transformations, and selected-state changes override everyday scale and base-design defaults.',
];

export const PAGE_VISUAL_INTEGRITY_POLICY: string = PAGE_VISUAL_INTEGRITY_RULES.join(' ');
