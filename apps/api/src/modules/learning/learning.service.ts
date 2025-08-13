import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { SkillsService } from '../skills/skills.service';
import {
  CreateLearningPathDto,
  UpdateLearningPathDto,
  CreateLessonDto,
  UpdateLessonDto,
  EnrollInPathDto,
  CompleteUserLessonDto,
  QuizSubmissionDto,
} from './dto';
import {
  LearningPathWithProgress,
  LessonWithProgress,
  LearningPathRecommendation,
  LearningAnalytics,
  SpacedRepetitionSchedule,
  QuizResult,
  LearningPathStats,
} from './interfaces';

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  // Spaced repetition algorithm (SM-2 based)
  private readonly minInterval = 1; // days
  private readonly maxInterval = 365; // days
  private readonly easinessFactor = {
    min: 1.3,
    max: 2.5,
    default: 2.5,
  };

  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
    private skillsService: SkillsService,
    private eventEmitter: EventEmitter2,
  ) {}

  async createLearningPath(createPathDto: CreateLearningPathDto): Promise<LearningPathWithProgress> {
    const {
      name,
      description,
      difficulty = 'beginner',
      estimatedTime,
      prerequisites,
      lessons = [],
    } = createPathDto;

    const path = await this.prisma.$transaction(async (tx) => {
      const newPath = await tx.learningPath.create({
        data: {
          name,
          slug: this.generateSlug(name),
          description,
          difficulty,
          estimatedTime,
          prerequisites: prerequisites || [],
          isPublished: false,
        },
      });

      // Create lessons if provided
      if (lessons.length > 0) {
        await Promise.all(
          lessons.map((lesson, index) =>
            tx.lesson.create({
              data: {
                pathId: newPath.id,
                skillId: lesson.skillId,
                title: lesson.title,
                slug: this.generateSlug(lesson.title),
                description: lesson.description,
                content: lesson.content,
                type: lesson.type || 'text',
                duration: lesson.duration || 10,
                order: lesson.order ?? index + 1,
                exercises: lesson.exercises || [],
                quiz: lesson.quiz || {},
                prerequisites: lesson.prerequisites || [],
              },
            })
          )
        );
      }

      return tx.learningPath.findUnique({
        where: { id: newPath.id },
        include: {
          lessons: {
            orderBy: { order: 'asc' },
            include: {
              skill: {
                select: { name: true, category: true },
              },
            },
          },
          _count: {
            select: {
              users: true,
              lessons: true,
            },
          },
        },
      });
    });

    this.logger.log(`Learning path created: ${path.name} (${path.id})`);

    // Emit path created event
    this.eventEmitter.emit('learningPath.created', {
      pathId: path.id,
      name: path.name,
      difficulty: path.difficulty,
    });

    return this.enrichPathWithProgress(path, null);
  }

  async updateLearningPath(
    pathId: string,
    updatePathDto: UpdateLearningPathDto,
  ): Promise<LearningPathWithProgress> {
    const existingPath = await this.prisma.learningPath.findUnique({
      where: { id: pathId },
    });

    if (!existingPath) {
      throw new NotFoundException('Learning path not found');
    }

    const updatedPath = await this.prisma.learningPath.update({
      where: { id: pathId },
      data: {
        ...updatePathDto,
        slug: updatePathDto.name ? this.generateSlug(updatePathDto.name) : undefined,
      },
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          include: {
            skill: {
              select: { name: true, category: true },
            },
          },
        },
        _count: {
          select: {
            users: true,
            lessons: true,
          },
        },
      },
    });

    this.logger.log(`Learning path updated: ${pathId}`);

    return this.enrichPathWithProgress(updatedPath, null);
  }

  async getLearningPath(pathId: string, userId?: string): Promise<LearningPathWithProgress> {
    const path = await this.prisma.learningPath.findUnique({
      where: { id: pathId },
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          include: {
            skill: {
              select: { name: true, category: true },
            },
            progress: userId ? {
              where: { userId },
            } : false,
          },
        },
        users: userId ? {
          where: { userId },
        } : false,
        _count: {
          select: {
            users: true,
            lessons: true,
          },
        },
      },
    });

    if (!path) {
      throw new NotFoundException('Learning path not found');
    }

    if (!path.isPublished && !userId) {
      throw new ForbiddenException('Learning path is not published');
    }

    return this.enrichPathWithProgress(path, userId);
  }

  async getLearningPaths(userId?: string, filters?: {
    difficulty?: string;
    category?: string;
    enrolled?: boolean;
    completed?: boolean;
  }): Promise<LearningPathWithProgress[]> {
    const where: any = {
      isPublished: true,
      AND: [
        filters?.difficulty ? { difficulty: filters.difficulty } : {},
        filters?.category ? { 
          lessons: { 
            some: { 
              skill: { 
                category: filters.category 
              } 
            } 
          } 
        } : {},
        filters?.enrolled && userId ? {
          users: { some: { userId } }
        } : {},
      ].filter(Boolean),
    };

    const paths = await this.prisma.learningPath.findMany({
      where,
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          include: {
            skill: {
              select: { name: true, category: true },
            },
            progress: userId ? {
              where: { userId },
            } : false,
          },
        },
        users: userId ? {
          where: { userId },
        } : false,
        _count: {
          select: {
            users: true,
            lessons: true,
          },
        },
      },
      orderBy: [
        { enrolledCount: 'desc' },
        { rating: 'desc' },
      ],
    });

    let filteredPaths = paths;

    // Additional filtering for completed paths
    if (filters?.completed && userId) {
      filteredPaths = [];
      for (const path of paths) {
        const enriched = await this.enrichPathWithProgress(path, userId);
        if (enriched.progress?.status === 'completed') {
          filteredPaths.push(path);
        }
      }
    }

    return Promise.all(
      filteredPaths.map(path => this.enrichPathWithProgress(path, userId))
    );
  }

  async enrollInLearningPath(userId: string, pathId: string, enrollDto?: EnrollInPathDto): Promise<void> {
    const path = await this.prisma.learningPath.findUnique({
      where: { id: pathId },
      include: { lessons: true },
    });

    if (!path) {
      throw new NotFoundException('Learning path not found');
    }

    if (!path.isPublished) {
      throw new ForbiddenException('Learning path is not available for enrollment');
    }

    // Check prerequisites
    if (path.prerequisites.length > 0 && userId) {
      const userSkills = await this.prisma.userSkills.findUnique({
        where: { userId },
      });

      const hasPrerequisites = this.checkPrerequisites(path.prerequisites, userSkills);
      if (!hasPrerequisites) {
        throw new BadRequestException(`Prerequisites not met: ${path.prerequisites.join(', ')}`);
      }
    }

    // Check if already enrolled
    const existingEnrollment = await this.prisma.userLearningPath.findUnique({
      where: {
        userId_pathId: { userId, pathId },
      },
    });

    if (existingEnrollment) {
      throw new BadRequestException('Already enrolled in this learning path');
    }

    await this.prisma.$transaction(async (tx) => {
      // Create enrollment
      await tx.userLearningPath.create({
        data: {
          userId,
          pathId,
          status: 'enrolled',
          progress: 0,
        },
      });

      // Initialize lesson progress records
      for (const lesson of path.lessons) {
        await tx.lessonProgress.create({
          data: {
            userId,
            lessonId: lesson.id,
            status: 'not_started',
            progress: 0,
            difficulty: this.easinessFactor.default,
            interval: this.minInterval,
          },
        });
      }

      // Update enrollment count
      await tx.learningPath.update({
        where: { id: pathId },
        data: {
          enrolledCount: { increment: 1 },
        },
      });
    });

    // Award points for enrollment
    await this.gamificationService.awardPoints(userId, 'lesson_started', {
      pathId,
      pathName: path.name,
    });

    // Emit enrollment event
    this.eventEmitter.emit('learningPath.enrolled', {
      userId,
      pathId,
      pathName: path.name,
    });

    this.logger.log(`User ${userId} enrolled in learning path ${pathId}`);
  }

  async createLesson(pathId: string, createLessonDto: CreateLessonDto): Promise<LessonWithProgress> {
    const path = await this.prisma.learningPath.findUnique({
      where: { id: pathId },
    });

    if (!path) {
      throw new NotFoundException('Learning path not found');
    }

    const lesson = await this.prisma.lesson.create({
      data: {
        pathId,
        skillId: createLessonDto.skillId,
        title: createLessonDto.title,
        slug: this.generateSlug(createLessonDto.title),
        description: createLessonDto.description,
        content: createLessonDto.content,
        type: createLessonDto.type || 'text',
        duration: createLessonDto.duration || 10,
        order: createLessonDto.order || await this.getNextLessonOrder(pathId),
        exercises: createLessonDto.exercises || [],
        quiz: createLessonDto.quiz || {},
        prerequisites: createLessonDto.prerequisites || [],
      },
      include: {
        path: {
          select: { name: true },
        },
        skill: {
          select: { name: true, category: true },
        },
      },
    });

    // Create progress records for enrolled users
    const enrolledUsers = await this.prisma.userLearningPath.findMany({
      where: { pathId },
      select: { userId: true },
    });

    if (enrolledUsers.length > 0) {
      await this.prisma.lessonProgress.createMany({
        data: enrolledUsers.map(user => ({
          userId: user.userId,
          lessonId: lesson.id,
          status: 'not_started',
          progress: 0,
          difficulty: this.easinessFactor.default,
          interval: this.minInterval,
        })),
        skipDuplicates: true,
      });
    }

    this.logger.log(`Lesson created: ${lesson.title} in path ${pathId}`);

    return this.enrichLessonWithProgress(lesson, null);
  }

  async getLesson(lessonId: string, userId?: string): Promise<LessonWithProgress> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        path: {
          select: { id: true, name: true, isPublished: true },
        },
        skill: {
          select: { name: true, category: true },
        },
        progress: userId ? {
          where: { userId },
        } : false,
      },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    if (!lesson.path.isPublished && !userId) {
      throw new ForbiddenException('Lesson is not available');
    }

    // Check if user is enrolled in the path
    if (userId) {
      const enrollment = await this.prisma.userLearningPath.findUnique({
        where: {
          userId_pathId: { userId, pathId: lesson.path.id },
        },
      });

      if (!enrollment) {
        throw new ForbiddenException('Must be enrolled in the learning path to access this lesson');
      }
    }

    return this.enrichLessonWithProgress(lesson, userId);
  }

  async startLesson(userId: string, lessonId: string): Promise<void> {
    const lesson = await this.getLesson(lessonId, userId);

    if (lesson.progress?.status !== 'not_started') {
      return; // Already started
    }

    await this.prisma.lessonProgress.update({
      where: {
        userId_lessonId: { userId, lessonId },
      },
      data: {
        status: 'in_progress',
        startedAt: new Date(),
      },
    });

    // Update learning path progress
    await this.updateLearningPathProgress(userId, lesson.path.id);

    // Emit lesson started event
    this.eventEmitter.emit('lesson.started', {
      userId,
      lessonId,
      lessonTitle: lesson.title,
      pathId: lesson.path.id,
    });
  }

  async completeLesson(
    userId: string,
    lessonId: string,
    completionDto: CompleteUserLessonDto,
  ): Promise<{ progress: any; pointsAwarded: number; achievements: any[] }> {
    const lesson = await this.getLesson(lessonId, userId);

    if (lesson.progress?.status === 'completed') {
      throw new BadRequestException('Lesson already completed');
    }

    const { timeSpent, quizScore, exercises } = completionDto;

    const result = await this.prisma.$transaction(async (tx) => {
      // Update lesson progress
      const updatedProgress = await tx.lessonProgress.update({
        where: {
          userId_lessonId: { userId, lessonId },
        },
        data: {
          status: 'completed',
          progress: 100,
          score: quizScore,
          timeSpent: timeSpent || 0,
          completedAt: new Date(),
          reviewCount: { increment: 1 },
          nextReview: this.calculateNextReview(this.minInterval, this.easinessFactor.default),
        },
      });

      // Update learning path progress
      await this.updateLearningPathProgress(userId, lesson.path.id);

      return updatedProgress;
    });

    // Award points for completion
    const pointsAwarded = this.calculateLessonPoints(lesson, quizScore, timeSpent);
    await this.gamificationService.awardPoints(userId, 'lesson_completed', {
      lessonId,
      lessonTitle: lesson.title,
      pathId: lesson.path.id,
      score: quizScore,
      pointsAwarded,
    });

    // Check for achievements
    const achievements = await this.checkLearningAchievements(userId, lesson.path.id);

    // Emit lesson completed event
    this.eventEmitter.emit('lesson.completed', {
      userId,
      lessonId,
      lessonTitle: lesson.title,
      pathId: lesson.path.id,
      score: quizScore,
      timeSpent,
    });

    this.logger.log(`User ${userId} completed lesson ${lessonId} with score ${quizScore}`);

    return {
      progress: result,
      pointsAwarded,
      achievements,
    };
  }

  async submitQuiz(userId: string, lessonId: string, quizDto: QuizSubmissionDto): Promise<QuizResult> {
    const lesson = await this.getLesson(lessonId, userId);

    if (!lesson.quiz || Object.keys(lesson.quiz).length === 0) {
      throw new BadRequestException('Lesson does not have a quiz');
    }

    const { answers } = quizDto;
    const quiz = lesson.quiz as any;

    // Grade the quiz
    let correctAnswers = 0;
    const feedback = [];

    quiz.questions.forEach((question, index) => {
      const userAnswer = answers[index];
      const isCorrect = this.gradeAnswer(question, userAnswer);

      if (isCorrect) {
        correctAnswers++;
      }

      feedback.push({
        questionIndex: index,
        question: question.text,
        userAnswer,
        correctAnswer: question.correctAnswer || question.answers?.find(a => a.correct)?.text,
        isCorrect,
        explanation: question.explanation,
      });
    });

    const score = Math.round((correctAnswers / quiz.questions.length) * 100);
    const passed = score >= (quiz.passingScore || 70);

    // Save quiz result
    const quizResult = {
      userId,
      lessonId,
      answers,
      score,
      correctAnswers,
      totalQuestions: quiz.questions.length,
      passed,
      feedback,
      submittedAt: new Date(),
    };

    // Update lesson progress with quiz score
    await this.prisma.lessonProgress.update({
      where: {
        userId_lessonId: { userId, lessonId },
      },
      data: {
        score,
      },
    });

    // Award points for quiz attempt
    await this.gamificationService.awardPoints(userId, 'quiz_passed', {
      lessonId,
      score,
      passed,
    });

    this.logger.log(`User ${userId} completed quiz for lesson ${lessonId} with score ${score}%`);

    return quizResult;
  }

  async getLearningAnalytics(userId: string): Promise<LearningAnalytics> {
    const [enrollments, completedLessons, quizScores, streakData] = await Promise.all([
      this.prisma.userLearningPath.findMany({
        where: { userId },
        include: {
          path: {
            select: {
              name: true,
              difficulty: true,
              lessons: { select: { id: true } },
            },
          },
        },
      }),
      this.prisma.lessonProgress.findMany({
        where: { userId, status: 'completed' },
        include: {
          lesson: {
            select: {
              title: true,
              duration: true,
              skill: { select: { category: true } },
            },
          },
        },
        orderBy: { completedAt: 'desc' },
      }),
      this.prisma.lessonProgress.aggregate({
        where: { userId, score: { not: null } },
        _avg: { score: true },
        _max: { score: true },
        _min: { score: true },
      }),
      this.calculateLearningStreak(userId),
    ]);

    // Calculate learning statistics
    const totalEnrolled = enrollments.length;
    const completedPaths = enrollments.filter(e => e.status === 'completed').length;
    const inProgressPaths = enrollments.filter(e => e.status === 'in_progress').length;
    const totalLessonsCompleted = completedLessons.length;

    // Calculate time spent
    const totalTimeSpent = completedLessons.reduce((total, lesson) => total + (lesson.timeSpent || 0), 0);
    const averageTimePerLesson = totalLessonsCompleted > 0 ? totalTimeSpent / totalLessonsCompleted : 0;

    // Category breakdown
    const categoryStats = completedLessons.reduce((acc, lesson) => {
      const category = lesson.lesson.skill?.category || 'General';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    // Learning velocity (lessons per week)
    const recentLessons = completedLessons.filter(lesson => 
      lesson.completedAt && 
      lesson.completedAt > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
    );
    const learningVelocity = (recentLessons.length / 30) * 7; // lessons per week

    return {
      totalPathsEnrolled: totalEnrolled,
      completedPaths,
      inProgressPaths,
      totalLessonsCompleted,
      totalTimeSpent,
      averageTimePerLesson,
      averageQuizScore: quizScores._avg.score || 0,
      highestQuizScore: quizScores._max.score || 0,
      lowestQuizScore: quizScores._min.score || 0,
      currentStreak: streakData.current,
      longestStreak: streakData.longest,
      categoryBreakdown: Object.entries(categoryStats).map(([category, count]) => ({
        category,
        lessonsCompleted: count,
      })),
      learningVelocity,
      recentActivity: completedLessons.slice(0, 10).map(lesson => ({
        lessonTitle: lesson.lesson.title,
        completedAt: lesson.completedAt,
        timeSpent: lesson.timeSpent,
        score: lesson.score,
      })),
    };
  }

  async getSpacedRepetitionSchedule(userId: string): Promise<SpacedRepetitionSchedule[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lessonsForReview = await this.prisma.lessonProgress.findMany({
      where: {
        userId,
        status: 'completed',
        nextReview: { lte: today },
      },
      include: {
        lesson: {
          select: {
            id: true,
            title: true,
            path: { select: { name: true } },
            skill: { select: { name: true, category: true } },
          },
        },
      },
      orderBy: { nextReview: 'asc' },
      take: 20,
    });

    return lessonsForReview.map(progress => ({
      lessonId: progress.lessonId,
      lessonTitle: progress.lesson.title,
      pathName: progress.lesson.path.name,
      skillName: progress.lesson.skill?.name,
      skillCategory: progress.lesson.skill?.category,
      reviewCount: progress.reviewCount,
      difficulty: progress.difficulty,
      nextReviewDate: progress.nextReview,
      interval: progress.interval,
      priority: this.calculateReviewPriority(progress),
    }));
  }

  async performSpacedRepetitionReview(
    userId: string,
    lessonId: string,
    performance: number, // 0-3 scale: 0=fail, 1=hard, 2=good, 3=easy
  ): Promise<void> {
    const progress = await this.prisma.lessonProgress.findUnique({
      where: {
        userId_lessonId: { userId, lessonId },
      },
    });

    if (!progress) {
      throw new NotFoundException('Lesson progress not found');
    }

    // Calculate new interval and difficulty using SM-2 algorithm
    const { interval, difficulty } = this.calculateSpacedRepetition(
      progress.interval,
      progress.difficulty,
      performance
    );

    // Update progress
    await this.prisma.lessonProgress.update({
      where: {
        userId_lessonId: { userId, lessonId },
      },
      data: {
        reviewCount: { increment: 1 },
        difficulty,
        interval,
        nextReview: this.calculateNextReview(interval, difficulty),
      },
    });

    // Award points for review
    await this.gamificationService.awardPoints(userId, 'lesson_reviewed', {
      lessonId,
      performance,
      reviewCount: progress.reviewCount + 1,
    });

    this.logger.log(`User ${userId} reviewed lesson ${lessonId} with performance ${performance}`);
  }

  async getLearningRecommendations(userId: string): Promise<LearningPathRecommendation[]> {
    // Get user's skill profile and learning history
    const [userSkills, completedLessons, enrolledPaths] = await Promise.all([
      this.prisma.userSkills.findUnique({ where: { userId } }),
      this.prisma.lessonProgress.findMany({
        where: { userId, status: 'completed' },
        include: {
          lesson: {
            include: {
              skill: true,
            },
          },
        },
      }),
      this.prisma.userLearningPath.findMany({
        where: { userId },
        include: { path: true },
      }),
    ]);

    // Identify skill gaps and interests
    const weakSkills = this.identifyWeakSkills(userSkills);
    const interests = this.identifyLearningInterests(completedLessons);
    const completedPathIds = enrolledPaths
      .filter(e => e.status === 'completed')
      .map(e => e.pathId);

    // Find relevant learning paths
    const availablePaths = await this.prisma.learningPath.findMany({
      where: {
        isPublished: true,
        id: { notIn: enrolledPaths.map(e => e.pathId) },
        lessons: {
          some: {
            skill: {
              OR: [
                { category: { in: weakSkills.map(s => s.category) } },
                { category: { in: interests } },
              ],
            },
          },
        },
      },
      include: {
        lessons: {
          include: {
            skill: true,
          },
        },
        _count: {
          select: { users: true },
        },
      },
      take: 20,
    });

    // Score and rank recommendations
    const recommendations = availablePaths
      .map(path => {
        let score = 0;

        // Skill gap alignment
        const pathSkills = path.lessons.map(l => l.skill).filter(Boolean);
        const relevantSkills = pathSkills.filter(skill => 
          weakSkills.some(weak => weak.category === skill.category)
        );
        score += relevantSkills.length * 20;

        // Interest alignment
        const interestMatch = pathSkills.some(skill => interests.includes(skill.category));
        if (interestMatch) score += 30;

        // Difficulty appropriateness
        const appropriateDifficulty = this.isAppropriatePathDifficulty(path.difficulty, userSkills?.overallScore || 0);
        if (appropriateDifficulty) score += 25;

        // Popularity bonus
        score += Math.min(path._count.users * 2, 20);

        return {
          path: this.enrichPathWithProgress(path, null),
          score,
          reason: this.generateRecommendationReason(path, relevantSkills, interestMatch),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return recommendations;
  }

  private async enrichPathWithProgress(path: any, userId: string | null): Promise<LearningPathWithProgress> {
    let progress = null;
    let nextLesson = null;

    if (userId && path.users?.length > 0) {
      const enrollment = path.users[0];
      
      // Calculate detailed progress
      const totalLessons = path.lessons?.length || 0;
      const completedLessons = path.lessons?.filter(lesson => 
        lesson.progress?.some(p => p.status === 'completed')
      ).length || 0;

      progress = {
        status: enrollment.status,
        progress: totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0,
        enrolledAt: enrollment.enrolledAt,
        startedAt: enrollment.startedAt,
        completedAt: enrollment.completedAt,
        lessonsCompleted: completedLessons,
        totalLessons,
      };

      // Find next lesson
      const inProgressLesson = path.lessons?.find(lesson => 
        lesson.progress?.some(p => p.status === 'in_progress')
      );
      
      if (!inProgressLesson) {
        nextLesson = path.lessons?.find(lesson => 
          lesson.progress?.some(p => p.status === 'not_started')
        );
      } else {
        nextLesson = inProgressLesson;
      }
    }

    return {
      ...path,
      progress,
      nextLesson,
      completionRate: path._count?.users > 0 
        ? ((await this.getCompletedEnrollments(path.id)) / path._count.users) * 100 
        : 0,
      averageRating: path.rating || 0,
      totalEnrolled: path._count?.users || 0,
      skillsTargeted: this.extractSkillsFromPath(path),
    };
  }

  private async enrichLessonWithProgress(lesson: any, userId: string | null): Promise<LessonWithProgress> {
    let progress = null;

    if (userId && lesson.progress?.length > 0) {
      progress = lesson.progress[0];
    }

    return {
      ...lesson,
      progress,
      isLocked: userId ? await this.isLessonLocked(userId, lesson.id) : false,
      prerequisites: lesson.prerequisites || [],
      estimatedDifficulty: this.calculateLessonDifficulty(lesson),
    };
  }

  private async updateLearningPathProgress(userId: string, pathId: string): Promise<void> {
    const [enrollment, lessons] = await Promise.all([
      this.prisma.userLearningPath.findUnique({
        where: { userId_pathId: { userId, pathId } },
      }),
      this.prisma.lesson.findMany({
        where: { pathId },
        include: {
          progress: {
            where: { userId },
          },
        },
      }),
    ]);

    if (!enrollment) return;

    const totalLessons = lessons.length;
    const completedLessons = lessons.filter(lesson => 
      lesson.progress.some(p => p.status === 'completed')
    ).length;

    const progressPercentage = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
    let status = enrollment.status;

    if (completedLessons === 0 && enrollment.status === 'enrolled') {
      status = 'enrolled';
    } else if (completedLessons > 0 && completedLessons < totalLessons) {
      status = 'in_progress';
    } else if (completedLessons === totalLessons) {
      status = 'completed';
    }

    await this.prisma.userLearningPath.update({
      where: { userId_pathId: { userId, pathId } },
      data: {
        status,
        progress: progressPercentage,
        startedAt: status === 'in_progress' && !enrollment.startedAt ? new Date() : enrollment.startedAt,
        completedAt: status === 'completed' ? new Date() : null,
      },
    });

    // Award points for path completion
    if (status === 'completed' && enrollment.status !== 'completed') {
      await this.gamificationService.awardPoints(userId, 'path_completed', {
        pathId,
        totalLessons,
      });
    }
  }

  private async getNextLessonOrder(pathId: string): Promise<number> {
    const lastLesson = await this.prisma.lesson.findFirst({
      where: { pathId },
      orderBy: { order: 'desc' },
    });

    return (lastLesson?.order || 0) + 1;
  }

  private checkPrerequisites(prerequisites: string[], userSkills: any): boolean {
    if (!prerequisites.length) return true;
    if (!userSkills) return false;

    // Simple check - in a full implementation, this would be more sophisticated
    return userSkills.overallScore >= 30; // Basic skill threshold
  }

  private calculateLessonPoints(lesson: any, quizScore?: number, timeSpent?: number): number {
    let points = 15; // Base points

    // Difficulty bonus
    const difficultyMultipliers = { beginner: 1, intermediate: 1.5, advanced: 2 };
    const pathDifficulty = lesson.path?.difficulty || 'beginner';
    points *= difficultyMultipliers[pathDifficulty] || 1;

    // Quiz score bonus
    if (quizScore) {
      points += Math.round(quizScore / 10); // 1-10 bonus points based on score
    }

    // Time efficiency bonus (if completed faster than estimated)
    if (timeSpent && lesson.duration) {
      const efficiency = lesson.duration / (timeSpent / 60000); // minutes
      if (efficiency > 1) {
        points += Math.min(5, Math.round(efficiency));
      }
    }

    return Math.round(points);
  }

  private async checkLearningAchievements(userId: string, pathId: string): Promise<any[]> {
    // This would check for various learning achievements
    const achievements = [];

    // Check for first lesson completion, streak achievements, etc.
    const completedLessonsCount = await this.prisma.lessonProgress.count({
      where: { userId, status: 'completed' },
    });

    if (completedLessonsCount === 1) {
      achievements.push({ type: 'first_lesson', title: 'First Lesson Complete!' });
    }

    if ([10, 25, 50, 100].includes(completedLessonsCount)) {
      achievements.push({ 
        type: 'milestone', 
        title: `${completedLessonsCount} Lessons Completed!` 
      });
    }

    return achievements;
  }

  private gradeAnswer(question: any, userAnswer: any): boolean {
    switch (question.type) {
      case 'multiple-choice':
        return question.correctAnswer === userAnswer;
      case 'true-false':
        return question.correctAnswer === userAnswer;
      case 'text':
        // Simple text matching - in production, this would be more sophisticated
        return question.correctAnswer?.toLowerCase() === userAnswer?.toLowerCase();
      default:
        return false;
    }
  }

  private async calculateLearningStreak(userId: string): Promise<{ current: number; longest: number }> {
    const completedLessons = await this.prisma.lessonProgress.findMany({
      where: { userId, status: 'completed', completedAt: { not: null } },
      select: { completedAt: true },
      orderBy: { completedAt: 'desc' },
    });

    if (completedLessons.length === 0) {
      return { current: 0, longest: 0 };
    }

    // Calculate current streak
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 1;
    
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Check if there's activity today or yesterday for current streak
    const mostRecentDate = completedLessons[0].completedAt;
    const daysDifference = Math.floor((today.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDifference <= 1) {
      currentStreak = 1;
      
      // Calculate current streak
      for (let i = 1; i < completedLessons.length; i++) {
        const prevDate = completedLessons[i - 1].completedAt;
        const currDate = completedLessons[i].completedAt;
        const diff = Math.floor((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diff <= 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    // Calculate longest streak
    for (let i = 1; i < completedLessons.length; i++) {
      const prevDate = completedLessons[i - 1].completedAt;
      const currDate = completedLessons[i].completedAt;
      const diff = Math.floor((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diff <= 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, tempStreak);

    return { current: currentStreak, longest: longestStreak };
  }

  private calculateNextReview(interval: number, difficulty: number): Date {
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);
    return nextReview;
  }

  private calculateReviewPriority(progress: any): 'high' | 'medium' | 'low' {
    const daysPastDue = Math.floor(
      (new Date().getTime() - progress.nextReview.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysPastDue > 7) return 'high';
    if (daysPastDue > 3) return 'medium';
    return 'low';
  }

  private calculateSpacedRepetition(
    currentInterval: number,
    currentDifficulty: number,
    performance: number
  ): { interval: number; difficulty: number } {
    // SM-2 algorithm implementation
    let newDifficulty = Math.max(
      this.easinessFactor.min,
      currentDifficulty + (0.1 - (3 - performance) * (0.08 + (3 - performance) * 0.02))
    );

    let newInterval: number;
    if (performance < 2) {
      // Poor performance, reset interval
      newInterval = this.minInterval;
    } else {
      // Good performance, increase interval
      newInterval = Math.min(
        this.maxInterval,
        Math.round(currentInterval * newDifficulty)
      );
    }

    return { interval: newInterval, difficulty: newDifficulty };
  }

  private identifyWeakSkills(userSkills: any): any[] {
    if (!userSkills) return [];

    const skills = [
      { category: 'Specificity', score: userSkills.specificity },
      { category: 'Constraints', score: userSkills.constraints },
      { category: 'Structure', score: userSkills.structure },
      { category: 'Role Definition', score: userSkills.roleDefinition },
      { category: 'Output Format', score: userSkills.outputFormat },
      { category: 'Verification', score: userSkills.verification },
      { category: 'Safety', score: userSkills.safety },
    ];

    return skills.filter(skill => skill.score < 50).slice(0, 3);
  }

  private identifyLearningInterests(completedLessons: any[]): string[] {
    const categories = completedLessons
      .map(lesson => lesson.lesson.skill?.category)
      .filter(Boolean);

    const categoryCount = categories.reduce((acc, category) => {
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(categoryCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([category]) => category);
  }

  private isAppropriatePathDifficulty(pathDifficulty: string, userScore: number): boolean {
    const difficultyRanges = {
      beginner: { min: 0, max: 40 },
      intermediate: { min: 30, max: 70 },
      advanced: { min: 60, max: 100 },
    };

    const range = difficultyRanges[pathDifficulty];
    return range ? userScore >= range.min && userScore <= range.max : false;
  }

  private generateRecommendationReason(path: any, relevantSkills: any[], interestMatch: boolean): string {
    const reasons = [];

    if (relevantSkills.length > 0) {
      reasons.push(`targets your weak skills (${relevantSkills.map(s => s.name).join(', ')})`);
    }
    if (interestMatch) {
      reasons.push('matches your learning interests');
    }
    if (path._count?.users > 100) {
      reasons.push('popular among learners');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'recommended for your level';
  }

  private async getCompletedEnrollments(pathId: string): Promise<number> {
    return this.prisma.userLearningPath.count({
      where: { pathId, status: 'completed' },
    });
  }

  private extractSkillsFromPath(path: any): string[] {
    if (!path.lessons) return [];
    
    const skills = new Set();
    path.lessons.forEach(lesson => {
      if (lesson.skill) {
        skills.add(lesson.skill.name);
      }
    });
    
    return Array.from(skills);
  }

  private async isLessonLocked(userId: string, lessonId: string): Promise<boolean> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { prerequisites: true, order: true, pathId: true },
    });

    if (!lesson || !lesson.prerequisites.length) return false;

    // Check if prerequisite lessons are completed
    const completedLessons = await this.prisma.lessonProgress.findMany({
      where: {
        userId,
        status: 'completed',
        lesson: {
          pathId: lesson.pathId,
          order: { lt: lesson.order },
        },
      },
    });

    // Simple check: if there are prerequisites and not all previous lessons are completed
    const requiredPreviousLessons = lesson.order - 1;
    return completedLessons.length < requiredPreviousLessons;
  }

  private calculateLessonDifficulty(lesson: any): number {
    let difficulty = 50; // Base difficulty

    // Content length factor
    const contentLength = lesson.content?.length || 0;
    difficulty += Math.min(contentLength / 1000, 30);

    // Quiz complexity
    if (lesson.quiz && lesson.quiz.questions) {
      difficulty += lesson.quiz.questions.length * 2;
    }

    // Exercise complexity
    if (lesson.exercises && lesson.exercises.length > 0) {
      difficulty += lesson.exercises.length * 5;
    }

    return Math.min(100, Math.round(difficulty));
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}