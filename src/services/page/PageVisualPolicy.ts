// One visual contract is shared by the deterministic brief, optional compiler,
// planner, and renderer. It preserves authored designs without inventing holders,
// camera positions, or real-world dimensions for fantasy subjects.
export const PAGE_VISUAL_INTEGRITY_RULES: readonly string[] = [
  'Use registered character/nonhuman/object types; no human anatomy or body language for objects unless authored.',
  'Preserve reference silhouettes, part counts, proportions, connections, materials/colors/details. Rotate or foreshorten without redesign; keep rigid axes aligned and let flexible/articulated parts move as built.',
  'Reference crops, display poses and backgrounds imply neither scene placement nor world size.',
  'Use authored holder/use/support/contact and explicit composition, not separate object screen zones/facing; do not invent a holder or put unheld objects in hands.',
  'Keep the correct subject and object connected at intended contact surfaces with natural grips, coherent fingers/palms, axes and occlusion; no floating grips/body fusion.',
  'Subjects at comparable depth have plausible size relationships, respecting authored heights, anatomy, and dimensions. Foreground enlargement must follow perspective and foreshortening, not arbitrary resizing.',
  'Keep world scale across panels; camera, pose and crop change apparent size, not true dimensions. Reference crops do not imply equal heights.',
  'Explicit authored giants, miniatures, fantasy anatomy, transformations and selected-state changes override everyday scale/base design.',
];

export const PAGE_VISUAL_INTEGRITY_POLICY: string = PAGE_VISUAL_INTEGRITY_RULES.join(' ');
