export interface LearningPath {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedHours: number;
  prerequisites: string[];
  skills: string[];
  enrollments: number;
  rating: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Lesson {
  id: string;
  learningPathId: string;
  title: string;
  content: string;
  type: 'video' | 'text' | 'interactive' | 'quiz';
  duration: number;
  order: number;
  completions: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LearningProgress {
  id: string;
  userId: string;
  learningPathId: string;
  currentLessonId?: string;
  completedLessons: string[];
  progress: number;
  startedAt: Date;
  completedAt?: Date;
}

export interface LessonWithProgress extends Lesson {
  progress: {
    isCompleted: boolean;
    timeSpent: number;
    score?: number;
  };
}

export interface LearningPathRecommendation {
  pathId: string;
  title: string;
  difficulty: string;
  reason: string;
  matchScore: number;
  estimatedHours: number;
}

export interface LearningAnalytics {
  userId: string;
  pathsEnrolled: number;
  pathsCompleted: number;
  totalTimeSpent: number;
  averageScore: number;
  skillsAcquired: string[];
  streakDays: number;
}

export interface SpacedRepetitionSchedule {
  id: string;
  userId: string;
  lessonId: string;
  nextReview: Date;
  interval: number;
  easiness: number;
  repetitions: number;
}

export interface QuizResult {
  id: string;
  quizId: string;
  userId: string;
  score: number;
  maxScore: number;
  passed: boolean;
  answers: Record<string, any>;
  timeSpent: number;
  completedAt: Date;
}