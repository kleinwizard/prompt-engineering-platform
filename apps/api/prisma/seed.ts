import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create initial badges
  const badges = [
    {
      name: 'Welcome',
      slug: 'welcome',
      description: 'Welcome to the Prompt Engineering Platform!',
      icon: '🎉',
      category: 'welcome',
      rarity: 'common',
      points: 50,
    },
    {
      name: 'Email Verified',
      slug: 'email-verified',
      description: 'Successfully verified email address',
      icon: '✅',
      category: 'verification',
      rarity: 'common',
      points: 25,
    },
    {
      name: 'First Prompt',
      slug: 'first-prompt',
      description: 'Created your first prompt',
      icon: '🚀',
      category: 'milestone',
      rarity: 'common',
      points: 50,
    },
    {
      name: 'Novice',
      slug: 'novice',
      description: 'Reached level 5',
      icon: '🌟',
      category: 'level',
      rarity: 'common',
      points: 100,
    },
    {
      name: 'Week Streak',
      slug: 'week-streak',
      description: 'Maintained a 7-day activity streak',
      icon: '🔥',
      category: 'engagement',
      rarity: 'uncommon',
      points: 150,
    },
    {
      name: 'Template Master',
      slug: 'template-master',
      description: 'Created 10 public templates',
      icon: '📝',
      category: 'creation',
      rarity: 'rare',
      points: 300,
    },
    {
      name: 'Challenge Champion',
      slug: 'challenge-champion',
      description: 'Won 5 challenges',
      icon: '🏆',
      category: 'competition',
      rarity: 'epic',
      points: 500,
    },
  ];

  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { slug: badge.slug },
      update: {},
      create: badge,
    });
  }

  console.log('✅ Created badges');

  // Create initial skills
  const skills = [
    {
      name: 'Specificity',
      slug: 'specificity',
      description: 'Ability to create clear, specific, and unambiguous prompts',
      category: 'core',
      icon: '🎯',
    },
    {
      name: 'Constraints',
      slug: 'constraints',
      description: 'Skill in defining effective constraints and requirements',
      category: 'core',
      icon: '⚖️',
    },
    {
      name: 'Structure',
      slug: 'structure',
      description: 'Proficiency in organizing prompts with clear structure',
      category: 'core',
      icon: '🏗️',
    },
    {
      name: 'Role Definition',
      slug: 'role-definition',
      description: 'Expertise in defining appropriate roles and personas',
      category: 'advanced',
      icon: '🎭',
    },
    {
      name: 'Output Format',
      slug: 'output-format',
      description: 'Skill in specifying desired output formats',
      category: 'technical',
      icon: '📋',
    },
  ];

  for (const skill of skills) {
    await prisma.skill.upsert({
      where: { slug: skill.slug },
      update: {},
      create: skill,
    });
  }

  console.log('✅ Created skills');

  // Create sample learning paths
  const learningPaths = [
    {
      name: 'Prompt Engineering Fundamentals',
      slug: 'fundamentals',
      description: 'Learn the core principles of effective prompt engineering',
      difficulty: 'beginner',
      estimatedTime: 120, // minutes
      isPublished: true,
    },
    {
      name: 'Advanced Prompt Techniques',
      slug: 'advanced-techniques',
      description: 'Master sophisticated prompting strategies and methodologies',
      difficulty: 'advanced',
      estimatedTime: 240,
      isPublished: true,
    },
    {
      name: 'Domain-Specific Prompting',
      slug: 'domain-specific',
      description: 'Learn to create prompts for specific domains and use cases',
      difficulty: 'intermediate',
      estimatedTime: 180,
      isPublished: true,
    },
  ];

  for (const path of learningPaths) {
    await prisma.learningPath.upsert({
      where: { slug: path.slug },
      update: {},
      create: path,
    });
  }

  console.log('✅ Created learning paths');

  // Create sample lessons
  const fundamentalsPath = await prisma.learningPath.findUnique({
    where: { slug: 'fundamentals' },
  });

  if (fundamentalsPath) {
    const lessons = [
      {
        pathId: fundamentalsPath.id,
        title: 'What is Prompt Engineering?',
        slug: 'what-is-prompt-engineering',
        description: 'Introduction to prompt engineering concepts',
        content: `# What is Prompt Engineering?

Prompt engineering is the practice of designing and optimizing text prompts to effectively communicate with AI language models. It involves crafting inputs that guide AI systems to produce desired outputs.

## Key Principles

1. **Clarity**: Be clear and specific about what you want
2. **Context**: Provide necessary background information  
3. **Structure**: Organize your prompt logically
4. **Examples**: Use examples when helpful

## Why It Matters

Effective prompt engineering can dramatically improve:
- Response quality
- Task completion accuracy  
- Consistency of outputs
- Efficiency of interactions`,
        type: 'text',
        duration: 15,
        order: 1,
      },
      {
        pathId: fundamentalsPath.id,
        title: 'The Anatomy of a Good Prompt',
        slug: 'anatomy-of-good-prompt',
        description: 'Understanding the components of effective prompts',
        content: `# The Anatomy of a Good Prompt

Every effective prompt typically contains several key components:

## 1. Role/Persona
Define who the AI should act as:
- "You are an expert data scientist..."
- "Act as a professional copywriter..."

## 2. Task Description
Clearly state what you want:
- "Analyze this data and identify trends"
- "Write a compelling product description"

## 3. Context/Background
Provide necessary information:
- Industry context
- Target audience
- Constraints

## 4. Format Specification
Define how you want the output:
- "Provide a bulleted list"
- "Format as JSON"
- "Write in paragraph form"

## 5. Examples (Optional)
Show the desired style or format when helpful.`,
        type: 'text',
        duration: 20,
        order: 2,
      },
    ];

    for (const lesson of lessons) {
      await prisma.lesson.upsert({
        where: { pathId_slug: { pathId: lesson.pathId, slug: lesson.slug } },
        update: {},
        create: lesson,
      });
    }
  }

  console.log('✅ Created sample lessons');

  // Create sample templates
  const templates = [
    {
      title: 'Blog Post Writer',
      description: 'Template for creating engaging blog posts',
      category: 'content',
      difficulty: 'beginner',
      content: `You are an expert content writer specializing in {{INDUSTRY}} with over 10 years of experience.

**Task**: Write a comprehensive blog post about {{TOPIC}}.

**Requirements**:
- Target audience: {{AUDIENCE}}
- Tone: {{TONE}}
- Word count: {{WORD_COUNT}} words
- Include practical examples and actionable insights

**Structure**:
1. Compelling headline
2. Hook introduction
3. Main content with subheadings
4. Conclusion with call-to-action

**Additional context**: {{CONTEXT}}

Please ensure the content is engaging, well-researched, and provides real value to the reader.`,
      variables: [
        { name: 'INDUSTRY', description: 'Industry or niche focus' },
        { name: 'TOPIC', description: 'Main topic of the blog post' },
        { name: 'AUDIENCE', description: 'Target audience description' },
        { name: 'TONE', description: 'Desired tone (professional, casual, etc.)' },
        { name: 'WORD_COUNT', description: 'Approximate word count' },
        { name: 'CONTEXT', description: 'Additional context or requirements' },
      ],
      isPublic: true,
      isOfficial: true,
    },
    {
      title: 'Code Reviewer',
      description: 'Template for comprehensive code reviews',
      category: 'development',
      difficulty: 'intermediate',
      content: `You are a senior software engineer with expertise in {{LANGUAGE}} and best practices for clean, maintainable code.

**Task**: Review the following code and provide detailed feedback.

**Code to Review**:
\`\`\`{{LANGUAGE}}
{{CODE}}
\`\`\`

**Review Criteria**:
1. Code quality and readability
2. Performance implications
3. Security considerations
4. Best practices adherence
5. Potential bugs or issues

**Context**: {{CONTEXT}}

**Output Format**:
- Overall assessment (1-5 stars)
- Strengths identified
- Issues found with severity levels
- Specific recommendations for improvement
- Refactored code examples where applicable

Please be constructive and educational in your feedback.`,
      variables: [
        { name: 'LANGUAGE', description: 'Programming language' },
        { name: 'CODE', description: 'Code to be reviewed' },
        { name: 'CONTEXT', description: 'Project context and requirements' },
      ],
      isPublic: true,
      isOfficial: true,
    },
    {
      title: 'Data Analyst',
      description: 'Template for data analysis and insights',
      category: 'analytics',
      difficulty: 'advanced',
      content: `You are an experienced data analyst with expertise in {{DOMAIN}} analytics and statistical interpretation.

**Task**: Analyze the provided data and extract meaningful insights.

**Data**:
{{DATA}}

**Analysis Objectives**:
{{OBJECTIVES}}

**Specific Questions to Address**:
{{QUESTIONS}}

**Requirements**:
1. Identify key patterns and trends
2. Perform relevant statistical analysis
3. Highlight any anomalies or outliers
4. Provide actionable business recommendations
5. Include confidence levels for your findings

**Output Structure**:
1. Executive Summary
2. Methodology
3. Key Findings
4. Statistical Analysis
5. Recommendations
6. Next Steps

**Context**: {{CONTEXT}}

Please use clear visualizations concepts and explain your reasoning for non-technical stakeholders.`,
      variables: [
        { name: 'DOMAIN', description: 'Domain expertise (e.g., marketing, finance)' },
        { name: 'DATA', description: 'Data to be analyzed' },
        { name: 'OBJECTIVES', description: 'Analysis objectives' },
        { name: 'QUESTIONS', description: 'Specific questions to answer' },
        { name: 'CONTEXT', description: 'Business context' },
      ],
      isPublic: true,
      isOfficial: true,
    },
  ];

  // Create a system user for official templates
  const systemUser = await prisma.user.upsert({
    where: { email: 'system@prompt-platform.com' },
    update: {},
    create: {
      email: 'system@prompt-platform.com',
      username: 'system',
      passwordHash: await bcrypt.hash('system-no-login', 12),
      firstName: 'System',
      lastName: 'Account',
      emailVerified: new Date(),
    },
  });

  for (const template of templates) {
    await prisma.template.create({
      data: {
        ...template,
        userId: systemUser.id,
        variables: JSON.stringify(template.variables),
      },
    });
  }

  console.log('✅ Created sample templates');

  // Create sample challenges
  const challenges = [
    {
      title: 'Daily Writing Challenge',
      slug: 'daily-writing-challenge',
      description: 'Create the most engaging prompt for creative writing',
      type: 'daily',
      category: 'creativity',
      difficulty: 'medium',
      prompt: 'Create a prompt that will generate a compelling short story about time travel with a twist ending.',
      requirements: {
        wordCount: { min: 50, max: 200 },
        mustInclude: ['character development', 'plot twist', 'time travel mechanics'],
      },
      rubric: {
        creativity: { weight: 30, description: 'Originality and creative approach' },
        clarity: { weight: 25, description: 'Clear and specific instructions' },
        effectiveness: { weight: 25, description: 'Likely to produce good results' },
        structure: { weight: 20, description: 'Well-organized prompt structure' },
      },
      startDate: new Date(),
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      points: 100,
      isActive: true,
      isFeatured: true,
    },
    {
      title: 'Technical Documentation Master',
      slug: 'technical-documentation-master',
      description: 'Best prompt for generating clear technical documentation',
      type: 'weekly',
      category: 'technical',
      difficulty: 'advanced',
      prompt: 'Design a prompt that will generate comprehensive API documentation for a REST endpoint, including examples, error handling, and best practices.',
      requirements: {
        wordCount: { min: 100, max: 300 },
        mustInclude: ['API structure', 'examples', 'error handling', 'authentication'],
      },
      rubric: {
        completeness: { weight: 35, description: 'Covers all required elements' },
        accuracy: { weight: 25, description: 'Technically accurate instructions' },
        usability: { weight: 25, description: 'Easy to follow and implement' },
        professionalism: { weight: 15, description: 'Professional tone and structure' },
      },
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      points: 250,
      isActive: true,
    },
  ];

  for (const challenge of challenges) {
    await prisma.challenge.create({
      data: {
        ...challenge,
        requirements: JSON.stringify(challenge.requirements),
        rubric: JSON.stringify(challenge.rubric),
      },
    });
  }

  console.log('✅ Created sample challenges');

  // Create demo user (optional - for development)
  if (process.env.NODE_ENV === 'development') {
    const demoUser = await prisma.user.upsert({
      where: { email: 'demo@promptplatform.com' },
      update: {},
      create: {
        email: 'demo@promptplatform.com',
        username: 'demo_user',
        passwordHash: await bcrypt.hash('Demo123!', 12),
        firstName: 'Demo',
        lastName: 'User',
        emailVerified: new Date(),
        preferences: {
          create: {
            theme: 'dark',
            language: 'en',
            emailNotifications: true,
            aiCoachingEnabled: true,
          },
        },
        profile: {
          create: {
            totalPoints: 1250,
            weeklyPoints: 350,
            monthlyPoints: 850,
            level: 8,
            experience: 1250,
            currentStreak: 5,
            longestStreak: 12,
            promptsCreated: 25,
            templatesCreated: 3,
            challengesWon: 2,
            lessonsCompleted: 8,
          },
        },
        skills: {
          create: {
            specificity: 75,
            constraints: 68,
            structure: 82,
            roleDefinition: 71,
            outputFormat: 79,
            verification: 65,
            safety: 88,
            overallScore: 75.4,
            assessmentCount: 12,
            lastAssessment: new Date(),
          },
        },
      },
    });

    // Award some badges to demo user
    const welcomeBadge = await prisma.badge.findUnique({ where: { slug: 'welcome' } });
    const firstPromptBadge = await prisma.badge.findUnique({ where: { slug: 'first-prompt' } });
    const emailVerifiedBadge = await prisma.badge.findUnique({ where: { slug: 'email-verified' } });

    if (welcomeBadge) {
      await prisma.userBadge.upsert({
        where: { userId_badgeId: { userId: demoUser.id, badgeId: welcomeBadge.id } },
        update: {},
        create: { userId: demoUser.id, badgeId: welcomeBadge.id },
      });
    }

    if (firstPromptBadge) {
      await prisma.userBadge.upsert({
        where: { userId_badgeId: { userId: demoUser.id, badgeId: firstPromptBadge.id } },
        update: {},
        create: { userId: demoUser.id, badgeId: firstPromptBadge.id },
      });
    }

    if (emailVerifiedBadge) {
      await prisma.userBadge.upsert({
        where: { userId_badgeId: { userId: demoUser.id, badgeId: emailVerifiedBadge.id } },
        update: {},
        create: { userId: demoUser.id, badgeId: emailVerifiedBadge.id },
      });
    }

    console.log('✅ Created demo user');
  }

  console.log('🎉 Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });