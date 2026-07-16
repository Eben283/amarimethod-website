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
      <div className="lp-shell">
        <PortalNav firstName={firstName} hasLivingPractice />

        <div className="lp-wrap" style={{ maxWidth: '42rem' }}>
          <button type="button" onClick={() => navigate('/')} className="lp-back">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>

          <p className="lp-page-kicker">Curriculum</p>
          <h1 className="lp-page-title">Living Practice</h1>

          <div style={{ marginBottom: '2rem' }}>
            <CourseProgressBar
              completed={overallProgress.completed}
              total={overallProgress.total}
            />
          </div>

          <div>
            {COURSE_MODULES.map((mod) => (
              <ModuleAccordion
                key={mod.slug}
                module={mod}
                progress={progress}
                moduleProgress={getModuleProgress(mod.slug)}
              />
            ))}
          </div>
        </div>
      </div>
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
    <div className="lp-mod-card">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="lp-mod-card-head"
      >
        <div
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            background: isComplete ? 'rgba(225,169,139,.18)' : 'var(--lp-cream-2, #F1E7DA)',
          }}
        >
          {isComplete ? (
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--lp-peach, #E1A98B)' }} />
          ) : (
            <ChevronRight
              className="w-4 h-4"
              style={{
                color: 'var(--lp-body, #5C554D)',
                transform: isOpen ? 'rotate(90deg)' : undefined,
                transition: 'transform .2s',
              }}
            />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{mod.title}</h3>
          <p>
            {moduleProgress.completed} of {moduleProgress.total} complete
          </p>
        </div>
      </button>

      {isOpen && (
        <div className="lp-mod-card-body">
          {mod.lessons.map((lesson) => {
            const key = lessonKey(mod.slug, lesson.slug);
            const isCompleted = progress.lessons[key]?.completed ?? false;

            return (
              <div key={lesson.slug}>
                {lesson.section && (
                  <p className="lp-section-label" style={{ padding: '14px 24px 0' }}>
                    {lesson.section}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/practice/${mod.slug}/${lesson.slug}`)}
                >
                  {isCompleted ? (
                    <CheckCircle2
                      className="w-4 h-4"
                      style={{ color: 'var(--lp-peach, #E1A98B)', flexShrink: 0 }}
                    />
                  ) : (
                    <span className="lp-dot" aria-hidden />
                  )}
                  <span>{lesson.title}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
