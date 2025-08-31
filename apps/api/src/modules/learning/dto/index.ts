export interface CreateLearningPathDto {
  title: string;
  name: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedHours: number;
  estimatedTime: number;
  prerequisites?: string[];
  skills: string[];
  lessons?: Array<{
    title: string;
    content: string;
    type: string;
    duration: number;
    order: number;
  }>;
}

export interface UpdateLearningPathDto {
  title?: string;
  name?: string;
  description?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  estimatedHours?: number;
  prerequisites?: string[];
  skills?: string[];
}

export interface CreateLessonDto {
  title: string;
  description: string;
  content: string;
  type: 'video' | 'text' | 'interactive' | 'quiz';
  duration: number;
  order: number;
  skillId?: string;
  exercises?: Array<{
    type: string;
    question: string;
    options?: string[];
    answer: any;
  }>;
  quiz?: {
    questions: Array<{
      question: string;
      type: 'multiple_choice' | 'text' | 'code';
      options?: string[];
      correctAnswer: any;
      points: number;
    }>;
    passingScore: number;
  };
  prerequisites?: string[];
}

export interface EnrollmentDto {
  learningPathId: string;
}

export interface CompleteUserLessonDto {
  lessonId: string;
  timeSpent?: number;
  notes?: string;
}

export interface QuizSubmissionDto {
  quizId: string;
  answers: Record<string, any>;
  timeSpent?: number;
}