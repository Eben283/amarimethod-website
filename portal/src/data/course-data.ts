import type { Module } from '../types/course';
import { MODULE_META, LESSON_NOTES } from './course-content';


const RAW_MODULES: readonly Module[] = [
  {
    slug: 'welcome',
    title: 'Welcome',
    lessons: [
      { slug: 'welcome', title: 'Welcome to Living Practice', streamUid: '87085455880352aa68600d76ea1a19d9', durationSeconds: 0 },
    ],
  },
  {
    slug: 'suspension-squat',
    title: 'Suspension Squat',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: 'e595c55c38ca264d4bb26b2e7f67cacb', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '72617e409914d70a8be0fb6db2a5ad7b', durationSeconds: 0 },
      { slug: 'part-1-resting-squat-hang', title: 'Part 1: Resting Squat Hang', streamUid: 'eecacafa525616f8d40e569ecfc3fb6e', durationSeconds: 0 },
      { slug: 'variation-1-discussion', title: 'Variation 1 Discussion', streamUid: '0c633e6b8a15b93b9d3ef2910b6387dd', durationSeconds: 0 },
      { slug: 'variation-2-discussion', title: 'Variation 2 Discussion', streamUid: 'a5b630e79ac68b5a9add05ae1014effc', durationSeconds: 0 },
      { slug: 'part-2-angled-hang', title: 'Part 2: Angled Hang', streamUid: 'b48e1e693110d8ac0320dcee784d4c10', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '5a4d365381287e1828477cb8fe522632', durationSeconds: 0 },
    ],
  },
  {
    slug: 'hand-balancer',
    title: 'Hand Balancer',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '7afa436ea0fb8137d4f623290c718b41', durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', streamUid: 'dedf9c3b0242a029d62d3bbb13086e31', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: 'bc8e2b9e6f49e57cae738df301a649c1', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: '1fe752ff13110d9c4a3eed3ef5beddc8', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '8c24f9dd5618482be4840e4e16027826', durationSeconds: 0 },
    ],
  },
  {
    slug: 'power-posture',
    title: 'Power Posture',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '2491af277c64db960b48618997b8dc9e', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '5f609196d62bd37b218694f461bf02a5', durationSeconds: 0 },
      { slug: 'exercise-walkthrough', title: 'Exercise Walkthrough', streamUid: '30188ad7d4b0dd8a50c8e718429d86bf', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: '5767901d22851f42fc47d5846a022a07', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: 'a5b93c664a083fad287cf1fce542d0e5', durationSeconds: 0 },
    ],
  },
  {
    slug: 'vertical-drop',
    title: 'Vertical Drop',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '9aa7afbadae91c721855743c13e3cf89', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '2ef76c1b6fb7c088ab8fe88ef47a0730', durationSeconds: 0 },
      { slug: 'exercise-demo-front', title: 'Exercise Demo (Front View)', streamUid: '2255f0549d01eaddd087c37113399b94', durationSeconds: 0 },
      { slug: 'exercise-demo-side', title: 'Exercise Demo (Side View)', streamUid: '2cec770415f0144c8f610e3119cbc136', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: 'c465f07b8a985a9ab8aa46d8e20ccfcf', durationSeconds: 0 },
      { slug: 'exercise-demo-side-2', title: 'Exercise Demo (Side View 2)', streamUid: 'e37256861c1b54b95cd7109d08b00372', durationSeconds: 0 },
    ],
  },
  {
    slug: 'bridge-variations',
    title: 'Bridge Variations',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: 'e4c278ada192821ace87525d5d956dbf', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: 'd1e3046ff55f65a45948a255c32fe061', durationSeconds: 0 },
      // — Passive Bridge —
      { slug: 'passive-bridge-demo', title: 'Exercise Demo', streamUid: 'e606cb1767d01a3409aab42afad27020', durationSeconds: 0, section: 'Passive Bridge' },
      { slug: 'passive-bridge-discussion', title: 'Discussion', streamUid: '41053816b4fd6a11c2c68446c10e31b3', durationSeconds: 0 },
      { slug: 'passive-bridge-tips', title: 'Tips and Common Mistakes', streamUid: '12285692fd950a93a36e7c3882449294', durationSeconds: 0 },
      // — Active Bridge —
      { slug: 'active-bridge-discussion', title: 'Discussion', streamUid: 'cec6d1f41b6c50f9e2f8931b6860c96e', durationSeconds: 0, section: 'Active Bridge' },
      { slug: 'active-bridge-demo', title: 'Exercise Demo', streamUid: 'f7968f788b7bf7faccdd2e48c01963c7', durationSeconds: 0 },
      { slug: 'active-bridge-tips', title: 'Tips and Common Mistakes', streamUid: '0127a201001a7111bcb6c4902bd54b1f', durationSeconds: 0 },
      { slug: 'active-vs-passive-guide', title: 'Active vs Passive Bridge Guide', streamUid: 'aaf082935b4d485aaf66555be695f400', durationSeconds: 0 },
    ],
  },
  {
    slug: 'spinal-wave',
    title: 'Spinal Wave',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '6b4dcb8c91e883f5bf666610e7c26965', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '8fb4726004932639a2995cb8e630fd3b', durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', streamUid: '267ad380f3c6ae378f276a5e8d0a2be7', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: '7c2a69556c0ff40fc1b78a30b33e72db', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '6d3f5f841f5f061b33c315fee0c8058c', durationSeconds: 0 },
    ],
  },
  {
    slug: 'spring-step',
    title: 'Spring Step',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: 'b7f786d30705a597ea79f0e300b24dd0', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '4ed5d525e48ce96aeb2f2952cc22f069', durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', streamUid: 'c24678d5812206abdec3a2c37c827cc2', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: '5b24c3a7c9441d36ecc26efda91c1777', durationSeconds: 0 },
      { slug: 'exercise-demo-side', title: 'Exercise Demo (Side View)', streamUid: 'b8fc5c9ea82a99248a8d8fc29282f4bf', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '11f825dbaa2da7a36fb01419c6c42b25', durationSeconds: 0 },
    ],
  },
  {
    slug: 'elbow-reset',
    title: 'Elbow Reset',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: 'd996c4f0f533fd6f881256ee5dd8e900', durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', streamUid: '8254d3f4cf75660d6caece004a61b462', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: '61754020c950c339f565f9f82090a5e6', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '8b4a7b72399f4154e77ca32f5be1f8a2', durationSeconds: 0 },
    ],
  },
  {
    slug: 'jaw-align',
    title: 'Jaw Align',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '6928c0d8a22d555dbd81d64d0b2c6c63', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '6db5a7168f1da69246458e893f2736fd', durationSeconds: 0 },
      { slug: 'jaw-align-exercise', title: 'Jaw Align Exercise', streamUid: 'de9f0388d4c9e987d30ede97eedc84a2', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '8f8be16b7da402fd32b58d52ddb2353a', durationSeconds: 0 },
    ],
  },
  {
    slug: 'putting-it-all-together',
    title: 'Putting It All Together',
    lessons: [
      { slug: 'putting-it-all-together', title: 'Putting It All Together', streamUid: 'c1c19751b6415e986559b3432a199f85', durationSeconds: 0 },
    ],
  },
] as const;

/** Enrich modules with equipment, guidance, and lesson notes from transcripts */
export const COURSE_MODULES: readonly Module[] = RAW_MODULES.map((mod) => {
  const meta = MODULE_META[mod.slug] ?? {};
  return {
    ...mod,
    equipment: meta.equipment,
    guidance: meta.guidance,
    lessons: mod.lessons.map((lesson) => {
      const key = `${mod.slug}/${lesson.slug}`;
      const notes = LESSON_NOTES[key];
      return notes && notes.length > 0 ? { ...lesson, notes } : lesson;
    }),
  };
});

/** Total number of lessons across all modules */
export const TOTAL_LESSONS = COURSE_MODULES.reduce(
  (sum, mod) => sum + mod.lessons.length,
  0,
);

/** Get a flat list of all lessons with their module context */
export function getAllLessons(): readonly {
  readonly moduleSlug: string;
  readonly moduleTitle: string;
  readonly lesson: Module['lessons'][number];
  readonly globalIndex: number;
}[] {
  const result: {
    moduleSlug: string;
    moduleTitle: string;
    lesson: Module['lessons'][number];
    globalIndex: number;
  }[] = [];

  let index = 0;
  for (const mod of COURSE_MODULES) {
    for (const lesson of mod.lessons) {
      result.push({
        moduleSlug: mod.slug,
        moduleTitle: mod.title,
        lesson,
        globalIndex: index,
      });
      index++;
    }
  }

  return result;
}

/** Find a lesson by module + lesson slug */
export function findLesson(moduleSlug: string, lessonSlug: string) {
  const mod = COURSE_MODULES.find((m) => m.slug === moduleSlug);
  if (!mod) return null;

  const lesson = mod.lessons.find((l) => l.slug === lessonSlug);
  if (!lesson) return null;

  return { module: mod, lesson };
}

/** Build the lesson path key used for progress tracking */
export function lessonKey(moduleSlug: string, lessonSlug: string): string {
  return `${moduleSlug}/${lessonSlug}`;
}
