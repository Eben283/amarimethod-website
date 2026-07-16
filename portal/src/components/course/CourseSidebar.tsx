import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COURSE_MODULES, lessonKey } from '../../data/course-data';
import type { CourseProgress } from '../../types/course';
import CourseProgressBar from './CourseProgressBar';

interface CourseSidebarProps {
  readonly progress: CourseProgress;
  readonly overallProgress: { completed: number; total: number; percent: number };
  readonly getModuleProgress: (slug: string) => { completed: number; total: number };
  readonly currentModuleSlug?: string;
  readonly currentLessonSlug?: string;
}

export default function CourseSidebar({
  progress,
  overallProgress,
  getModuleProgress,
  currentModuleSlug,
  currentLessonSlug,
}: CourseSidebarProps) {
  const navigate = useNavigate();

  // Expand the current module by default, collapse others
  const [expandedModules, setExpandedModules] = useState<ReadonlySet<string>>(
    () => new Set(currentModuleSlug ? [currentModuleSlug] : [COURSE_MODULES[0].slug]),
  );

  function toggleModule(slug: string) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }

  return (
    <aside className="lp-sidebar">
      <div className="lp-side-panel">
        <span className="lp-eyebrow">Overall Progress</span>
        <CourseProgressBar
          completed={overallProgress.completed}
          total={overallProgress.total}
        />

        <nav className="lp-mod-list" aria-label="Course modules">
          {COURSE_MODULES.map((mod) => {
            const isExpanded = expandedModules.has(mod.slug);
            const modProgress = getModuleProgress(mod.slug);
            const isModuleComplete = modProgress.completed === modProgress.total;

            return (
              <div key={mod.slug}>
                <button
                  type="button"
                  onClick={() => toggleModule(mod.slug)}
                  className={`lp-mod-btn${isModuleComplete ? ' is-done' : ''}`}
                  aria-expanded={isExpanded}
                >
                  <span className="lp-mod-title">{mod.title}</span>
                  <span className="lp-mod-count">
                    {modProgress.completed}/{modProgress.total}
                  </span>
                </button>

                {isExpanded && (
                  <ul className="lp-lesson-list">
                    {mod.lessons.map((lesson) => {
                      const key = lessonKey(mod.slug, lesson.slug);
                      const isCompleted = progress.lessons[key]?.completed ?? false;
                      const isCurrent =
                        mod.slug === currentModuleSlug && lesson.slug === currentLessonSlug;

                      return (
                        <li key={lesson.slug}>
                          {lesson.section && (
                            <p className="lp-section-label">{lesson.section}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => navigate(`/practice/${mod.slug}/${lesson.slug}`)}
                            className={[
                              'lp-lesson-btn',
                              isCurrent ? 'is-current' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <span
                              className={`lp-dot${isCompleted ? ' done' : ''}`}
                              aria-hidden
                            />
                            <span>{lesson.title}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
