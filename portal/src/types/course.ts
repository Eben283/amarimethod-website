export interface Lesson {
  readonly slug: string;
  readonly title: string;
  readonly videoUrl: string;
  readonly durationSeconds: number;
  /** Optional section label — renders a divider/heading before this lesson */
  readonly section?: string;
}

export interface Module {
  readonly slug: string;
  readonly title: string;
  readonly lessons: readonly Lesson[];
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
