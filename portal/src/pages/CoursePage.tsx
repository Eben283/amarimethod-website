import { useCallback, useRef } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, List, Wrench, Clock } from 'lucide-react';
import PortalNav from '../components/PortalNav';
import CourseGuard from '../components/course/CourseGuard';
import CourseSidebar from '../components/course/CourseSidebar';
import VideoPlayer from '../components/course/VideoPlayer';
import LessonNav from '../components/course/LessonNav';
import CourseProgressBar from '../components/course/CourseProgressBar';
import { useCourseProgress } from '../hooks/useCourseProgress';
import { useClientData } from '../hooks/useClientData';
import { findLesson, COURSE_MODULES, getAllLessons } from '../data/course-data';

/** Landing page at /practice — redirect to last-watched or first lesson */
export function CourseIndex() {
  const { progress } = useCourseProgress();

  const target = progress.lastLessonPath
    ? `/practice/${progress.lastLessonPath}`
    : `/practice/${COURSE_MODULES[0].slug}/${COURSE_MODULES[0].lessons[0].slug}`;

  return (
    <CourseGuard>
      <Navigate to={target} replace />
    </CourseGuard>
  );
}

/** Lesson player page at /practice/:moduleSlug/:lessonSlug */
export default function CoursePage() {
  const { moduleSlug, lessonSlug } = useParams<{ moduleSlug: string; lessonSlug: string }>();
  const navigate = useNavigate();
  const { data } = useClientData();
  const {
    progress,
    updateWatchedSeconds,
    getModuleProgress,
    getOverallProgress,
    getLessonProgress,
  } = useCourseProgress();

  // Throttle time updates to every 5 seconds
  const lastSaveRef = useRef(0);

  const handleTimeUpdate = useCallback(
    (currentSeconds: number, duration: number) => {
      if (!moduleSlug || !lessonSlug) return;

      const now = Date.now();
      if (now - lastSaveRef.current < 5000) return;
      lastSaveRef.current = now;

      updateWatchedSeconds(moduleSlug, lessonSlug, currentSeconds, duration);
    },
    [moduleSlug, lessonSlug, updateWatchedSeconds],
  );

  if (!moduleSlug || !lessonSlug) {
    return <Navigate to="/practice" replace />;
  }

  const found = findLesson(moduleSlug, lessonSlug);
  if (!found) {
    return <Navigate to="/practice" replace />;
  }

  const { module: currentModule, lesson: currentLesson } = found;
  const allLessons = getAllLessons();
  const globalIndex = allLessons.findIndex(
    (l) => l.moduleSlug === moduleSlug && l.lesson.slug === lessonSlug,
  );
  const lessonNumber =
    currentModule.lessons.findIndex((l) => l.slug === lessonSlug) + 1;

  const lessonProg = getLessonProgress(moduleSlug, lessonSlug);
  const overallProgress = getOverallProgress();
  const firstName = data?.client.firstName || data?.client.lastName;

  return (
    <CourseGuard>
      <PortalNav firstName={firstName} />

      <main className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-10 py-6">
        {/* Back link — visible on all sizes */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-amari-text-muted hover:text-amari-charcoal transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar — hidden on mobile at lesson view, shown on desktop */}
          <div className="hidden md:block">
            <CourseSidebar
              progress={progress}
              overallProgress={overallProgress}
              getModuleProgress={getModuleProgress}
              currentModuleSlug={moduleSlug}
              currentLessonSlug={lessonSlug}
            />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Mobile: back to modules + progress */}
            <div className="md:hidden mb-4">
              <button
                onClick={() => navigate('/practice/modules')}
                className="flex items-center gap-1.5 text-xs text-amari-text-muted hover:text-amari-charcoal transition-colors mb-3"
              >
                <List className="w-3.5 h-3.5" />
                All Modules
              </button>
              <CourseProgressBar
                completed={overallProgress.completed}
                total={overallProgress.total}
                size="sm"
                showLabel={false}
              />
            </div>

            {/* Module + lesson header */}
            <div className="mb-4">
              <p className="text-xs text-amari-text-muted font-sans uppercase tracking-widest mb-1">
                {currentModule.title} &middot; Lesson {lessonNumber} of{' '}
                {currentModule.lessons.length}
              </p>
              <h1 className="font-serif text-xl sm:text-2xl font-bold text-amari-charcoal">
                {currentLesson.title}
              </h1>
            </div>

            {/* Video player */}
            <VideoPlayer
              streamUid={currentLesson.streamUid}
              initialSeconds={lessonProg?.watchedSeconds ?? 0}
              onTimeUpdate={handleTimeUpdate}
            />

            {/* Equipment & guidance — shown on first lesson of each module */}
            {lessonNumber === 1 && (currentModule.equipment || currentModule.guidance) && (
              <div className="mt-5 p-4 rounded-lg bg-amari-light-sand border border-amari-border">
                {currentModule.equipment && currentModule.equipment.length > 0 && (
                  <div className="mb-3">
                    <h3 className="flex items-center gap-1.5 text-xs font-sans font-semibold uppercase tracking-widest text-amari-charcoal mb-2">
                      <Wrench className="w-3.5 h-3.5" />
                      Equipment
                    </h3>
                    <ul className="space-y-1">
                      {currentModule.equipment.map((item, i) => (
                        <li key={i} className="text-sm text-amari-text-secondary font-sans flex items-start gap-2">
                          <span className="text-amari-accent-warm mt-0.5">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {currentModule.guidance && (
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-sans font-semibold uppercase tracking-widest text-amari-charcoal mb-1">
                      <Clock className="w-3.5 h-3.5" />
                      Recommended Practice
                    </h3>
                    <p className="text-sm text-amari-text-secondary font-sans">{currentModule.guidance}</p>
                  </div>
                )}
              </div>
            )}

            {/* Lesson notes — key takeaways from the video */}
            {currentLesson.notes && currentLesson.notes.length > 0 && (
              <div className="mt-5 p-4 rounded-lg border border-amari-border">
                <h3 className="text-xs font-sans font-semibold uppercase tracking-widest text-amari-charcoal mb-2">
                  Key Takeaways
                </h3>
                <ul className="space-y-1.5">
                  {currentLesson.notes.map((note, i) => (
                    <li key={i} className="text-sm text-amari-text-secondary font-sans flex items-start gap-2">
                      <span className="text-amari-accent-warm mt-0.5">•</span>
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Nav buttons */}
            <LessonNav moduleSlug={moduleSlug} lessonSlug={lessonSlug} />

            {/* Lesson position indicator */}
            <p className="text-center text-[11px] text-amari-text-muted mt-3 font-sans">
              Lesson {globalIndex + 1} of {allLessons.length}
            </p>
          </div>
        </div>
      </main>
    </CourseGuard>
  );
}
