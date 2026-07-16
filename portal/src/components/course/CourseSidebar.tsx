import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, CheckCircle2, Circle, PlayCircle } from 'lucide-react';
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
    <aside className="w-full md:w-[280px] flex-shrink-0">
      <div className="portal-card p-4 sticky top-20">
        {/* Overall progress */}
        <div className="mb-4">
          <h3 className="font-sans font-semibold text-xs uppercase tracking-widest text-amari-text-muted mb-2">
            Overall Progress
          </h3>
          <CourseProgressBar
            completed={overallProgress.completed}
            total={overallProgress.total}
          />
        </div>

        {/* Module list */}
        <nav className="space-y-1 max-h-[calc(100vh-240px)] overflow-y-auto">
          {COURSE_MODULES.map((mod) => {
            const isExpanded = expandedModules.has(mod.slug);
            const modProgress = getModuleProgress(mod.slug);
            const isModuleComplete = modProgress.completed === modProgress.total;

            return (
              <div key={mod.slug}>
                <button
                  onClick={() => toggleModule(mod.slug)}
                  className="flex items-center gap-2 w-full text-left py-2 px-2 rounded-[2px] hover:bg-amari-light-sand transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-amari-text-muted flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-amari-text-muted flex-shrink-0" />
                  )}
                  <span
                    className={`text-sm font-sans font-medium truncate ${
                      isModuleComplete ? 'text-amari-accent-warm' : 'text-amari-charcoal'
                    }`}
                  >
                    {mod.title}
                  </span>
                  <span className="text-[10px] text-amari-text-muted ml-auto flex-shrink-0">
                    {modProgress.completed}/{modProgress.total}
                  </span>
                </button>

                {isExpanded && (
                  <ul className="ml-4 pl-2 border-l border-amari-border space-y-0.5">
                    {mod.lessons.map((lesson) => {
                      const key = lessonKey(mod.slug, lesson.slug);
                      const isCompleted = progress.lessons[key]?.completed ?? false;
                      const isCurrent =
                        mod.slug === currentModuleSlug && lesson.slug === currentLessonSlug;

                      return (
                        <li key={lesson.slug}>
                          {lesson.section && (
                            <p className="text-[10px] uppercase tracking-widest text-amari-text-muted font-sans font-semibold mt-2 mb-1 px-2">
                              {lesson.section}
                            </p>
                          )}
                          <button
                            onClick={() => navigate(`/practice/${mod.slug}/${lesson.slug}`)}
                            className={`flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-[2px] text-xs font-sans transition-colors ${
                              isCurrent
                                ? 'bg-amari-accent-warm-light text-amari-charcoal font-semibold'
                                : 'text-amari-text-secondary hover:bg-amari-light-sand'
                            }`}
                          >
                            {isCompleted ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-amari-accent-warm flex-shrink-0" />
                            ) : isCurrent ? (
                              <PlayCircle className="w-3.5 h-3.5 text-amari-accent-warm flex-shrink-0" />
                            ) : (
                              <Circle className="w-3.5 h-3.5 text-amari-text-muted flex-shrink-0" />
                            )}
                            <span className="truncate">{lesson.title}</span>
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
