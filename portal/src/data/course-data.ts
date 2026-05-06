import type { Module } from '../types/course';
import { MODULE_META, LESSON_NOTES } from './course-content';


const RAW_MODULES: readonly Module[] = [
  {
    slug: 'welcome',
    title: 'Welcome',
    lessons: [
      { slug: 'welcome', title: 'Welcome to Living Practice', streamUid: '9072ff146ba6434f9463ae78c6616e3d', durationSeconds: 0 },
    ],
  },
  {
    slug: 'suspension-squat',
    title: 'Suspension Squat',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '2eb92bec4f85c30fec3f0fa9f5052b91', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '1022e2214396e2ec2a718586e5a2905d', durationSeconds: 0 },
      { slug: 'part-1-resting-squat-hang', title: 'Part 1: Resting Squat Hang', streamUid: 'f43e8a6d090d079747616bcf73073762', durationSeconds: 0 },
      { slug: 'variation-1-discussion', title: 'Variation 1 Discussion', streamUid: 'c18bfa2bd8813d3b3879496bb7f2899b', durationSeconds: 0 },
      { slug: 'variation-2-discussion', title: 'Variation 2 Discussion', streamUid: '0466d8d33b3820305dddb51b4d511237', durationSeconds: 0 },
      { slug: 'part-2-angled-hang', title: 'Part 2: Angled Hang', streamUid: '700d3f1157a71d878ccf4c4467c20094', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: 'cc8788b5f08b33365eff055561e9a5c0', durationSeconds: 0 },
    ],
  },
  {
    slug: 'hand-balancer',
    title: 'Hand Balancer',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: 'cc46f2cce812ed653bf9b9f0718c7f29', durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', streamUid: '8e8d1092cfa166678fe53f2e2101f853', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: 'd7c15a67069c13432ce051547df949da', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: 'f38a9d8fa23489edbeed71c9fd4a6d57', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '33347530aa67a830189a770e696bc118', durationSeconds: 0 },
    ],
  },
  {
    slug: 'power-posture',
    title: 'Power Posture',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '73d1386ebc6d9cb8515512c83fb4bc45', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '5f609196d62bd37b218694f461bf02a5', durationSeconds: 0 },
      { slug: 'exercise-walkthrough', title: 'Exercise Walkthrough', streamUid: '4d071513aba2f577e90163a9e3b76aa8', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: '7480aa9bc0b21b8c3471d57b6d933db2', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: 'a71b38eacad119f7c4c8fd1ccdee2c29', durationSeconds: 0 },
    ],
  },
  {
    slug: 'vertical-drop',
    title: 'Vertical Drop',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '8b491ef3f167c7e549236b661f600c2b', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: 'b80eaad96560f678936a914447973169', durationSeconds: 0 },
      { slug: 'exercise-demo-front', title: 'Exercise Demo (Front View)', streamUid: '2255f0549d01eaddd087c37113399b94', durationSeconds: 0 },
      { slug: 'exercise-demo-side', title: 'Exercise Demo (Side View)', streamUid: '3512bd3d83774f805521d22f7788cf9a', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '66d200012c7d0a28afe072dacb6c2ab6', durationSeconds: 0 },
      { slug: 'exercise-demo-side-2', title: 'Exercise Demo (Side View 2)', streamUid: '42440b6d5bfdeca836f9435f4d5aff11', durationSeconds: 0 },
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
      { slug: 'passive-bridge-discussion', title: 'Discussion', streamUid: 'd560ddb3d30e58abe4650caa9deb7834', durationSeconds: 0 },
      { slug: 'passive-bridge-tips', title: 'Tips and Common Mistakes', streamUid: '12285692fd950a93a36e7c3882449294', durationSeconds: 0 },
      // — Active Bridge —
      { slug: 'active-bridge-discussion', title: 'Discussion', streamUid: 'cec6d1f41b6c50f9e2f8931b6860c96e', durationSeconds: 0, section: 'Active Bridge' },
      { slug: 'active-bridge-demo', title: 'Exercise Demo', streamUid: 'f7968f788b7bf7faccdd2e48c01963c7', durationSeconds: 0 },
      { slug: 'active-bridge-tips', title: 'Tips and Common Mistakes', streamUid: 'c5c7512a653f51a387e4bab928eb0213', durationSeconds: 0 },
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
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: 'df628660172fcf87b23bdb423d7cf8a3', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '500e32bad2f2f24f5da94ffe9533e35b', durationSeconds: 0 },
    ],
  },
  {
    slug: 'spring-step',
    title: 'Spring Step',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '81f81f1e2ba133f8a8bc77b4f1c82dc9', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: '4ed5d525e48ce96aeb2f2952cc22f069', durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', streamUid: '2421cdaec0261b4c6be62512a9e3c89a', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: '5b24c3a7c9441d36ecc26efda91c1777', durationSeconds: 0 },
      { slug: 'exercise-demo-side', title: 'Exercise Demo (Side View)', streamUid: '02567f6f485f13ccefe63fd639c0e286', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '1a906349dc24329f5405c1ca509f6a80', durationSeconds: 0 },
    ],
  },
  {
    slug: 'elbow-reset',
    title: 'Elbow Reset',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: 'f54d41daf6f7bccdacd62b7f925f91b4', durationSeconds: 0 },
      { slug: 'why-this-is-so-important', title: 'Why This Is So Important', streamUid: 'db4acff9d24069c3f93dfe47f9d71bec', durationSeconds: 0 },
      { slug: 'exercise-demo', title: 'Exercise Demo', streamUid: '51c16e8785685be0fe10718b2c3ae9f4', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '9653726e75f9100b35eab938bfe0d4b4', durationSeconds: 0 },
    ],
  },
  {
    slug: 'jaw-align',
    title: 'Jaw Align',
    lessons: [
      { slug: 'introduction', title: 'Introduction', streamUid: '03b019c671250816970c2eb846975063', durationSeconds: 0 },
      { slug: 'technical-terms', title: 'Technical Terms', streamUid: 'e22125faa4cfd9b1be117acf0ed6a249', durationSeconds: 0 },
      { slug: 'jaw-align-exercise', title: 'Jaw Align Exercise', streamUid: 'de9f0388d4c9e987d30ede97eedc84a2', durationSeconds: 0 },
      { slug: 'tips', title: 'Tips and Common Mistakes', streamUid: '9aa43a9b12d103ce39c14714dfddb0b4', durationSeconds: 0 },
    ],
  },
  {
    slug: 'putting-it-all-together',
    title: 'Putting It All Together',
    lessons: [
      { slug: 'putting-it-all-together', title: 'Putting It All Together', streamUid: '2d1a00aab8152413d8cbdbde107b7351', durationSeconds: 0 },
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
