import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { CourseProgress, LessonProgress } from '../types/course';
import { COURSE_MODULES, TOTAL_LESSONS, lessonKey } from '../data/course-data';
import { fetchServerProgress, saveServerProgress } from '../lib/api';

const COMPLETION_THRESHOLD = 0.9;

function storageKey(contactId: string): string {
  return `lp_progress_${contactId}`;
}

function loadProgress(contactId: string): CourseProgress {
  try {
    const raw = localStorage.getItem(storageKey(contactId));
    if (raw) {
      return JSON.parse(raw) as CourseProgress;
    }
  } catch {
    // Corrupted data — start fresh
  }
  return { lessons: {}, lastLessonPath: null };
}

function saveLocalProgress(contactId: string, progress: CourseProgress): void {
  localStorage.setItem(storageKey(contactId), JSON.stringify(progress));
}

// Merge server + local: completed lessons from either source are kept;
// for watched-seconds, take the higher value so progress is never lost.
function mergeProgress(local: CourseProgress, server: CourseProgress): CourseProgress {
  const merged: CourseProgress['lessons'] = { ...local.lessons };
  for (const [key, serverLesson] of Object.entries(server.lessons)) {
    const localLesson = merged[key];
    if (!localLesson) {
      merged[key] = serverLesson;
    } else {
      merged[key] = {
        completed: localLesson.completed || serverLesson.completed,
        lastWatchedAt: Math.max(localLesson.lastWatchedAt ?? 0, serverLesson.lastWatchedAt ?? 0),
        watchedSeconds: Math.max(localLesson.watchedSeconds ?? 0, serverLesson.watchedSeconds ?? 0),
      };
    }
  }
  return {
    lessons: merged,
    lastLessonPath: server.lastLessonPath || local.lastLessonPath,
  };
}

export function useCourseProgress() {
  const { contactId } = useAuth();
  const [progress, setProgress] = useState<CourseProgress>(() =>
    contactId ? loadProgress(contactId) : { lessons: {}, lastLessonPath: null },
  );
  const syncedRef = useRef(false);

  // On mount: pull server progress and merge with localStorage
  useEffect(() => {
    if (!contactId || syncedRef.current) return;
    syncedRef.current = true;

    fetchServerProgress()
      .then(({ progress: serverProgress }) => {
        if (!serverProgress) return;
        setProgress((local) => {
          const merged = mergeProgress(local, serverProgress);
          saveLocalProgress(contactId, merged);
          return merged;
        });
      })
      .catch(() => {
        // Server unavailable — localStorage is the source of truth
      });
  }, [contactId]);

  const persistProgress = useCallback(
    (contactId: string, updated: CourseProgress) => {
      saveLocalProgress(contactId, updated);
      saveServerProgress(updated).catch(() => {
        // Fire-and-forget — localStorage already has the write
      });
    },
    [],
  );

  const updateWatchedSeconds = useCallback(
    (moduleSlug: string, lessonSlug: string, seconds: number, videoDuration: number) => {
      if (!contactId) return;

      setProgress((prev) => {
        const key = lessonKey(moduleSlug, lessonSlug);
        const existing = prev.lessons[key];
        const isCompleted =
          existing?.completed || (videoDuration > 0 && seconds / videoDuration >= COMPLETION_THRESHOLD);

        const updatedLesson: LessonProgress = {
          completed: isCompleted,
          lastWatchedAt: Date.now(),
          watchedSeconds: seconds,
        };

        const updated: CourseProgress = {
          lessons: { ...prev.lessons, [key]: updatedLesson },
          lastLessonPath: `${moduleSlug}/${lessonSlug}`,
        };

        persistProgress(contactId, updated);
        return updated;
      });
    },
    [contactId, persistProgress],
  );

  const markComplete = useCallback(
    (moduleSlug: string, lessonSlug: string) => {
      if (!contactId) return;

      setProgress((prev) => {
        const key = lessonKey(moduleSlug, lessonSlug);
        const existing = prev.lessons[key];

        const updatedLesson: LessonProgress = {
          completed: true,
          lastWatchedAt: Date.now(),
          watchedSeconds: existing?.watchedSeconds ?? 0,
        };

        const updated: CourseProgress = {
          lessons: { ...prev.lessons, [key]: updatedLesson },
          lastLessonPath: `${moduleSlug}/${lessonSlug}`,
        };

        persistProgress(contactId, updated);
        return updated;
      });
    },
    [contactId, persistProgress],
  );

  const getLessonProgress = useCallback(
    (moduleSlug: string, lessonSlug: string): LessonProgress | null => {
      return progress.lessons[lessonKey(moduleSlug, lessonSlug)] ?? null;
    },
    [progress],
  );

  const getModuleProgress = useCallback(
    (moduleSlug: string): { completed: number; total: number } => {
      const mod = COURSE_MODULES.find((m) => m.slug === moduleSlug);
      if (!mod) return { completed: 0, total: 0 };

      const completed = mod.lessons.filter(
        (l) => progress.lessons[lessonKey(moduleSlug, l.slug)]?.completed,
      ).length;

      return { completed, total: mod.lessons.length };
    },
    [progress],
  );

  const getOverallProgress = useCallback((): { completed: number; total: number; percent: number } => {
    const completed = Object.values(progress.lessons).filter((l) => l.completed).length;
    const percent = TOTAL_LESSONS > 0 ? Math.round((completed / TOTAL_LESSONS) * 100) : 0;
    return { completed, total: TOTAL_LESSONS, percent };
  }, [progress]);

  return {
    progress,
    updateWatchedSeconds,
    markComplete,
    getLessonProgress,
    getModuleProgress,
    getOverallProgress,
  };
}
