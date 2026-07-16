import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ChevronRight } from 'lucide-react';
import PortalNav from '../components/PortalNav';
import CourseGuard from '../components/course/CourseGuard';
import CourseProgressBar from '../components/course/CourseProgressBar';
import { useCourseProgress } from '../hooks/useCourseProgress';
import { useClientData } from '../hooks/useClientData';
import { COURSE_MODULES, lessonKey } from '../data/course-data';
import type { CourseProgress } from '../types/course';
import { useState } from 'react';

/** Mobile-friendly module list with expandable lessons */
export default function CourseModulesPage() {
  const navigate = useNavigate();
  const { data } = useClientData();
  const { progress, getModuleProgress, getOverallProgress } = useCourseProgress();
  const overallProgress = getOverallProgress();
  const firstName = data?.client.firstName || data?.client.lastName;

  return (
    <CourseGuard>
      <PortalNav firstName={firstName} />

      <main className="max-w-2xl mx-auto px-4 sm:px-8 py-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-amari-text-muted hover:text-amari-charcoal transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <h1 className="font-serif text-2xl font-medium text-amari-charcoal mb-2 tracking-tight">
          Living Practice
        </h1>

        <div className="mb-6">
          <CourseProgressBar
            completed={overallProgress.completed}
            total={overallProgress.total}
          />
        </div>

        <div className="space-y-2">
          {COURSE_MODULES.map((mod) => (
            <ModuleAccordion
              key={mod.slug}
              module={mod}
              progress={progress}
              moduleProgress={getModuleProgress(mod.slug)}
            />
          ))}
        </div>
      </main>
    </CourseGuard>
  );
}

function ModuleAccordion({
  module: mod,
  progress,
  moduleProgress,
}: {
  readonly module: (typeof COURSE_MODULES)[number];
  readonly progress: CourseProgress;
  readonly moduleProgress: { completed: number; total: number };
}) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const isComplete = moduleProgress.completed === moduleProgress.total;

  return (
    <div className="portal-card p-0 overflow-hidden">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-3 w-full text-left p-4"
      >
        <div
          className={`w-8 h-8 rounded-[2px] flex items-center justify-center flex-shrink-0 ${
            isComplete ? 'bg-amari-accent-warm/10' : 'bg-amari-light-sand'
          }`}
        >
          {isComplete ? (
            <CheckCircle2 className="w-4 h-4 text-amari-accent-warm" />
          ) : (
            <ChevronRight
              className={`w-4 h-4 text-amari-text-muted transition-transform ${
                isOpen ? 'rotate-90' : ''
              }`}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-sans font-semibold text-sm text-amari-charcoal truncate">
            {mod.title}
          </h3>
          <p className="text-[11px] text-amari-text-muted">
            {moduleProgress.completed} of {moduleProgress.total} complete
          </p>
        </div>
      </button>

      {isOpen && (
        <ul className="border-t border-amari-border">
          {mod.lessons.map((lesson) => {
            const key = lessonKey(mod.slug, lesson.slug);
            const isCompleted = progress.lessons[key]?.completed ?? false;

            return (
              <li key={lesson.slug} className="border-b border-amari-border last:border-b-0">
                {lesson.section && (
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10px] uppercase tracking-widest text-amari-text-muted font-sans font-semibold">
                      {lesson.section}
                    </p>
                  </div>
                )}
                <button
                  onClick={() => navigate(`/practice/${mod.slug}/${lesson.slug}`)}
                  className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-amari-light-sand transition-colors"
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-amari-accent-warm flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-amari-border flex-shrink-0" />
                  )}
                  <span className="text-sm text-amari-text-secondary font-sans">
                    {lesson.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
