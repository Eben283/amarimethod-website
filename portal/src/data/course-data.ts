import type { Module } from '../types/course';

// CDN base for all course videos hosted in GHL Media Storage
const CDN = 'https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media';


export const COURSE_MODULES: readonly Module[] = [
  {
    slug: 'welcome',
    title: 'Welcome',
    lessons: [
      { slug: 'welcome', title: 'Welcome to Living Practice', videoUrl: `${CDN}/69c1db5f95218924f26fdfb7.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'suspension-squat',
    title: 'Suspension Squat',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c30417fe4d0d2993d4f411.mp4`, durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', videoUrl: `${CDN}/69c30417cf4f9a6dd6151a7d.mp4`, durationSeconds: 0 },
      { slug: 'part-1-resting-squat-hang', title: 'Part 1: Resting Squat Hang', videoUrl: `${CDN}/69c30417eaed06728aa7e41b.mp4`, durationSeconds: 0 },
      { slug: 'variation-1-discussion', title: 'Variation 1 Discussion', videoUrl: `${CDN}/69c30417eaed06fb5fa7e417.mp4`, durationSeconds: 0 },
      { slug: 'variation-2-discussion', title: 'Variation 2 Discussion', videoUrl: `${CDN}/69c30417cf4f9ad080151a7e.mp4`, durationSeconds: 0 },
      { slug: 'part-2-angled-hang', title: 'Part 2: Angled Hang', videoUrl: `${CDN}/69c304174d943dd0d1970b5f.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c304175108035396d898ec.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'hand-balancer',
    title: 'Hand Balancer',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c305e33ab4d91e7fc7763d.mp4`, durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', videoUrl: `${CDN}/69c305e3cf4f9a6422155bc0.mp4`, durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', videoUrl: `${CDN}/69c305e3bbd71968bf0c1afd.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', videoUrl: `${CDN}/69c305e33ab4d93736c7763e.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c305e351080364c8d8db95.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'power-posture',
    title: 'Power Posture',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c306b5f5a389ab2aa4c3a0.mp4`, durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', videoUrl: `${CDN}/69c306b5cf4f9ab0a0157c59.mp4`, durationSeconds: 0 },
      { slug: 'exercise-walkthrough', title: 'Exercise Walkthrough', videoUrl: `${CDN}/69c306b6f9ac780b0f586e7f.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', videoUrl: `${CDN}/69c306b57fba4bae43d2b291.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c306b53ab4d925c4c794c1.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'vertical-drop',
    title: 'Vertical Drop',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c3070f39e3091064741010.mp4`, durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', videoUrl: `${CDN}/69c3070f5108031abbd904c8.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo-front', title: 'Exercise Demo (Front View)', videoUrl: `${CDN}/69c3070ffe4d0d1600d55ffb.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo-side', title: 'Exercise Demo (Side View)', videoUrl: `${CDN}/69c3070f8694e658a4ebfd2b.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c3070f3ec9e803d78e5b16.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo-side-2', title: 'Exercise Demo (Side View 2)', videoUrl: `${CDN}/69c3070fbbd719ab090c44f0.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'passive-bridge',
    title: 'Passive Bridge',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c307643ec9e8047a8e62f1.mp4`, durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', videoUrl: `${CDN}/69c30764bbd719b2660c4cee.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', videoUrl: `${CDN}/69c30764cf4f9a6d64158fd6.mp4`, durationSeconds: 0 },
      { slug: 'discussion', title: 'Discussion', videoUrl: `${CDN}/69c30764f9ac78710958809c.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c30764fe4d0d3fcbd568ae.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'active-bridge',
    title: 'Active Bridge',
    lessons: [
      { slug: 'discussion', title: 'Discussion', videoUrl: `${CDN}/69c30764eaed06570fa85743.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', videoUrl: `${CDN}/69c30764510803387ad90d1a.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c33128eaed06392cad7fc5.mp4`, durationSeconds: 0 },
      { slug: 'active-vs-passive-guide', title: 'Active vs Passive Bridge Guide', videoUrl: `${CDN}/69c30765bbd7198da70c4d09.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'spinal-wave',
    title: 'Spinal Wave',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c30c3bfe4d0d3ac8d60938.mp4`, durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', videoUrl: `${CDN}/69c30c3bfe4d0d58a1d6093a.mp4`, durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', videoUrl: `${CDN}/69c30c3bfe4d0db00fd60939.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', videoUrl: `${CDN}/69c30c3b4d943d309c98216b.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c30c3b3ab4d98236c8480e.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'spring-step',
    title: 'Spring Step',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c30d0ef5a3893acea59684.mp4`, durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', videoUrl: `${CDN}/69c30d0eeaed0669bca91834.mp4`, durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', videoUrl: `${CDN}/69c30d0e39e309ebe374dd17.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', videoUrl: `${CDN}/69c30d0efe4d0d3133d628ce.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo-side', title: 'Exercise Demo (Side View)', videoUrl: `${CDN}/69c30d0eeaed063fe5a91830.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c30d0e6bd30f253a315910.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'elbow-reset',
    title: 'Elbow Reset',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c30e9b6bd30ff0fd318d61.mp4`, durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', videoUrl: `${CDN}/69c30e9b6bd30f0799318d60.mp4`, durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', videoUrl: `${CDN}/69c30e9b7fba4b1389d3ba4a.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c30e9bcf4f9a922b168722.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'jaw-align',
    title: 'Jaw Align',
    lessons: [
      { slug: 'introduction', title: 'Introduction', videoUrl: `${CDN}/69c30ef239e30976d275222d.mp4`, durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', videoUrl: `${CDN}/69c30ef23ab4d90c83c8ac4f.mp4`, durationSeconds: 0 },
      { slug: 'jaw-align-exercise', title: 'Jaw Align Exercise', videoUrl: `${CDN}/69c30ef2510803598cda150d.mp4`, durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', videoUrl: `${CDN}/69c30ef251080347cdda14f8.mp4`, durationSeconds: 0 },
    ],
  },
  {
    slug: 'putting-it-all-together',
    title: 'Putting It All Together',
    lessons: [
      { slug: 'putting-it-all-together', title: 'Putting It All Together', videoUrl: `${CDN}/69c30f53fe4d0d0af8d67881.mp4`, durationSeconds: 0 },
    ],
  },
] as const;

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
