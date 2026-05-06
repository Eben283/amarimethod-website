export interface Lesson {
  readonly slug: string;
  readonly title: string;
  readonly streamUid: string;
  readonly durationSeconds: number;
  /** Optional section label — renders a divider/heading before this lesson */
  readonly section?: string;
  /** Key takeaways shown below the video — extracted verbatim from transcripts */
  readonly notes?: readonly string[];
}

export interface Module {
  readonly slug: string;
  readonly title: string;
  readonly lessons: readonly Lesson[];
  /** Equipment needed for this module */
  readonly equipment?: readonly string[];
  /** Recommended duration/frequency — verbatim from transcripts */
  readonly guidance?: string;
}

export interface LessonProgress {
  readonly completed: boolean;
  readonly lastWatchedAt: number;
  readonly watchedSeconds: number;
}

export interface CourseProgress {
  readonly lessons: Record<string, LessonProgress>;
  readonly lastLessonPath: string | null;
}

export interface DeviceSession {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly lastActive: number;
  readonly createdAt: number;
}
