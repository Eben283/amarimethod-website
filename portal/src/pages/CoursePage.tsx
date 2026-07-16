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
      <div className="lp-shell">
        <PortalNav firstName={firstName} hasLivingPractice />

        <div className="lp-wrap">
          <button type="button" onClick={() => navigate('/')} className="lp-back">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>

          <div className="lp-layout">
            <div className="hidden md:block">
              <CourseSidebar
                progress={progress}
                overallProgress={overallProgress}
                getModuleProgress={getModuleProgress}
                currentModuleSlug={moduleSlug}
                currentLessonSlug={lessonSlug}
              />
            </div>

            <div className="lp-main">
              <div className="md:hidden" style={{ marginBottom: '1.25rem' }}>
                <button
                  type="button"
                  onClick={() => navigate('/practice/modules')}
                  className="lp-back"
                  style={{ marginBottom: '12px' }}
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

              <p className="lp-eyebrow mute lp-lesson-meta">
                {currentModule.title} · Lesson {lessonNumber} of{' '}
                {currentModule.lessons.length}
              </p>
              <h1 className="lp-lesson-title">{currentLesson.title}</h1>

              <VideoPlayer
                streamUid={currentLesson.streamUid}
                initialSeconds={lessonProg?.watchedSeconds ?? 0}
                onTimeUpdate={handleTimeUpdate}
              />

              {lessonNumber === 1 && (currentModule.equipment || currentModule.guidance) && (
                <div className="lp-panel">
                  {currentModule.equipment && currentModule.equipment.length > 0 && (
                    <div style={{ marginBottom: currentModule.guidance ? '1rem' : 0 }}>
                      <h3>
                        <Wrench className="w-3.5 h-3.5" />
                        Equipment
                      </h3>
                      <ul>
                        {currentModule.equipment.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentModule.guidance && (
                    <div>
                      <h3>
                        <Clock className="w-3.5 h-3.5" />
                        Recommended Practice
                      </h3>
                      <p>{currentModule.guidance}</p>
                    </div>
                  )}
                </div>
              )}

              {currentLesson.notes && currentLesson.notes.length > 0 && (
                <div className="lp-panel">
                  <h3>Key Takeaways</h3>
                  <ul>
                    {currentLesson.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              <LessonNav moduleSlug={moduleSlug} lessonSlug={lessonSlug} />

              <p className="lp-footer-meta">
                Lesson {globalIndex + 1} of {allLessons.length}
              </p>
            </div>
          </div>
        </div>
      </div>
    </CourseGuard>
  );
}
