import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getAllLessons } from '../../data/course-data';

interface LessonNavProps {
  readonly moduleSlug: string;
  readonly lessonSlug: string;
}

export default function LessonNav({ moduleSlug, lessonSlug }: LessonNavProps) {
  const navigate = useNavigate();
  const allLessons = getAllLessons();

  const currentIndex = allLessons.findIndex(
    (l) => l.moduleSlug === moduleSlug && l.lesson.slug === lessonSlug,
  );

  const prev = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const next = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  return (
    <div className="lp-nav">
      {prev ? (
        <button
          type="button"
          onClick={() => navigate(`/practice/${prev.moduleSlug}/${prev.lesson.slug}`)}
          className="lp-btn lp-btn-outline"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </button>
      ) : (
        <div />
      )}

      {next ? (
        <button
          type="button"
          onClick={() => navigate(`/practice/${next.moduleSlug}/${next.lesson.slug}`)}
          className="lp-btn lp-btn-primary"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </button>
      ) : (
        <div />
      )}
    </div>
  );
}
