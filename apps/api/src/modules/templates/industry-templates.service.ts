import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

interface TemplateVariable {
  name: string;
  type: 'text' | 'multiline' | 'select' | 'number' | 'date';
  required: boolean;
  default?: any;
  options?: string[];
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

interface IndustryTemplate {
  id: string;
  title: string;
  description: string;
  industry: string;
  category: string;
  content: string;
  variables: TemplateVariable[];
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number; // minutes
  compliance?: string[]; // HIPAA, GDPR, SOX, etc.
}

@Injectable()
export class IndustryTemplatesService {
  private readonly logger = new Logger(IndustryTemplatesService.name);

  constructor(private prisma: PrismaService) {}

  private readonly healthcareTemplates: IndustryTemplate[] = [
    {
      id: 'healthcare-patient-summary',
      title: 'Patient Medical Summary Generator',
      description: 'Creates comprehensive patient summaries from medical records with HIPAA compliance',
      industry: 'healthcare',
      category: 'documentation',
      content: `You are a medical documentation specialist creating a comprehensive patient summary. Follow HIPAA guidelines and use appropriate medical terminology.

**PATIENT INFORMATION:**
- Name: {{PATIENT_NAME}}
- Age: {{PATIENT_AGE}}
- MRN: {{PATIENT_ID}}
- Date of Service: {{SERVICE_DATE}}

**CHIEF COMPLAINT:**
{{CHIEF_COMPLAINT}}

**MEDICAL HISTORY:**
{{MEDICAL_HISTORY}}

**CURRENT MEDICATIONS:**
{{MEDICATIONS}}

**RECENT LAB RESULTS:**
{{LAB_RESULTS}}

**VITAL SIGNS:**
{{VITALS}}

**ASSESSMENT & PLAN:**
{{ASSESSMENT_PLAN}}

Please generate a comprehensive patient summary that includes:

1. **Executive Summary** (2-3 sentences highlighting key medical issues)
2. **Active Problems List** (prioritized by urgency)
3. **Medication Review** 
   - Current medications with dosages
   - Potential drug interactions
   - Adherence concerns
4. **Recent Results Summary**
   - Laboratory values with reference ranges
   - Imaging findings
   - Critical values flagged
5. **Risk Stratification**
   - Current risk factors
   - Preventive care needs
   - Fall risk assessment
6. **Care Coordination**
   - Upcoming appointments
   - Referrals needed
   - Follow-up requirements
7. **Patient Education Topics**
   - Disease management
   - Medication compliance
   - Lifestyle modifications

**COMPLIANCE REQUIREMENTS:**
- Maintain patient confidentiality
- Use appropriate ICD-10 codes where applicable
- Flag any critical values or urgent issues
- Ensure clinical accuracy and completeness
- Format for electronic health record integration

**OUTPUT FORMAT:**
Structure the summary with clear headings, bullet points for readability, and highlight any urgent items requiring immediate attention.`,
      variables: [
        { name: 'PATIENT_NAME', type: 'text', required: true },
        { name: 'PATIENT_AGE', type: 'number', required: true },
        { name: 'PATIENT_ID', type: 'text', required: true },
        { name: 'SERVICE_DATE', type: 'date', required: true },
        { name: 'CHIEF_COMPLAINT', type: 'multiline', required: true },
        { name: 'MEDICAL_HISTORY', type: 'multiline', required: false },
        { name: 'MEDICATIONS', type: 'multiline', required: true },
        { name: 'LAB_RESULTS', type: 'multiline', required: false },
        { name: 'VITALS', type: 'multiline', required: true },
        { name: 'ASSESSMENT_PLAN', type: 'multiline', required: false }
      ],
      tags: ['medical', 'documentation', 'patient-care', 'summary'],
      difficulty: 'intermediate',
      estimatedTime: 15,
      compliance: ['HIPAA']
    },
    {
      id: 'healthcare-differential-diagnosis',
      title: 'Differential Diagnosis Assistant',
      description: 'Generates comprehensive differential diagnoses based on clinical presentation',
      industry: 'healthcare',
      category: 'clinical-decision',
      content: `You are an experienced diagnostician providing clinical decision support. Analyze the presenting symptoms and generate a comprehensive differential diagnosis.

**PATIENT DEMOGRAPHICS:**
- Age: {{AGE}}
- Sex: {{SEX}}
- Chief Complaint: {{CHIEF_COMPLAINT}}

**HISTORY OF PRESENT ILLNESS:**
{{HPI}}

**PAST MEDICAL HISTORY:**
{{PMH}}

**MEDICATIONS:**
{{MEDICATIONS}}

**SOCIAL HISTORY:**
{{SOCIAL_HISTORY}}

**FAMILY HISTORY:**
{{FAMILY_HISTORY}}

**REVIEW OF SYSTEMS:**
{{ROS}}

**PHYSICAL EXAMINATION:**
{{PHYSICAL_EXAM}}

**INITIAL DIAGNOSTIC TESTS:**
{{DIAGNOSTIC_TESTS}}

Generate a comprehensive differential diagnosis that includes:

1. **Primary Differential Diagnoses** (ranked by likelihood)
   For each diagnosis, provide:
   - Clinical reasoning and likelihood assessment
   - Supporting clinical findings
   - Findings that argue against the diagnosis
   - Recommended diagnostic tests to confirm/exclude

2. **Red Flag Assessment**
   - Life-threatening conditions to rule out immediately
   - Time-sensitive diagnoses requiring urgent workup
   - Critical interventions needed

3. **Diagnostic Workup Plan**
   - Laboratory tests recommended
   - Imaging studies indicated
   - Specialist consultations needed
   - Timeline for follow-up

4. **Risk Stratification**
   - High-risk features present
   - Need for admission vs. outpatient management
   - Monitoring requirements

5. **Clinical Pearls**
   - Key diagnostic features to watch for
   - Common mimics or alternative presentations
   - Pitfalls to avoid

**IMPORTANT:** This analysis is for educational and clinical decision support only. Always correlate with clinical judgment and current evidence-based guidelines.`,
      variables: [
        { name: 'AGE', type: 'number', required: true },
        { name: 'SEX', type: 'select', options: ['Male', 'Female', 'Other'], required: true },
        { name: 'CHIEF_COMPLAINT', type: 'multiline', required: true },
        { name: 'HPI', type: 'multiline', required: true },
        { name: 'PMH', type: 'multiline', required: false },
        { name: 'MEDICATIONS', type: 'multiline', required: false },
        { name: 'SOCIAL_HISTORY', type: 'multiline', required: false },
        { name: 'FAMILY_HISTORY', type: 'multiline', required: false },
        { name: 'ROS', type: 'multiline', required: false },
        { name: 'PHYSICAL_EXAM', type: 'multiline', required: true },
        { name: 'DIAGNOSTIC_TESTS', type: 'multiline', required: false }
      ],
      tags: ['diagnosis', 'clinical-reasoning', 'decision-support'],
      difficulty: 'advanced',
      estimatedTime: 20,
      compliance: ['HIPAA']
    }
  ];

  private readonly legalTemplates: IndustryTemplate[] = [
    {
      id: 'legal-contract-review',
      title: 'Legal Contract Review & Risk Analysis',
      description: 'Comprehensive contract review with risk assessment and negotiation recommendations',
      industry: 'legal',
      category: 'contract-analysis',
      content: `You are an experienced contract attorney conducting a thorough contract review. Provide comprehensive analysis with practical recommendations.

**CONTRACT DETAILS:**
- Contract Type: {{CONTRACT_TYPE}}
- Parties: {{PARTIES}}
- Jurisdiction: {{JURISDICTION}}
- Industry/Sector: {{INDUSTRY}}
- Contract Value: {{CONTRACT_VALUE}}
- Term Duration: {{TERM_DURATION}}

**CONTRACT CONTENT:**
{{CONTRACT_TEXT}}

**SPECIFIC REVIEW FOCUS:**
{{REVIEW_FOCUS}}

Provide a comprehensive contract analysis including:

1. **EXECUTIVE SUMMARY**
   - Contract overview and purpose
   - Key business terms summary
   - Overall risk assessment (Low/Medium/High)
   - Critical action items requiring immediate attention

2. **KEY TERMS ANALYSIS**
   - Payment terms and conditions
   - Performance obligations and deliverables
   - Duration, renewal, and termination provisions
   - Intellectual property rights
   - Limitation of liability and indemnification
   - Dispute resolution mechanisms

3. **RISK ASSESSMENT**
   **High-Risk Issues (RED FLAGS):**
   - Unlimited liability exposure
   - Broad indemnification obligations
   - Inadequate termination rights
   - Problematic governing law/jurisdiction clauses
   
   **Medium-Risk Issues (YELLOW FLAGS):**
   - Ambiguous performance standards
   - Insufficient intellectual property protections
   - Weak confidentiality provisions
   
   **Areas of Concern:**
   - Missing standard protective clauses
   - Vague or undefined terms
   - Imbalanced risk allocation

4. **LEGAL COMPLIANCE REVIEW**
   - Applicable regulatory requirements
   - Industry-specific compliance issues
   - Data protection and privacy considerations
   - Employment law implications (if applicable)

5. **NEGOTIATION RECOMMENDATIONS**
   **Critical Must-Have Changes:**
   - Essential protective clauses to add
   - Liability caps and limitations
   - Termination rights and procedures
   
   **Preferred Improvements:**
   - Enhanced IP protections
   - Better dispute resolution terms
   - Clarified performance standards
   
   **Nice-to-Have Additions:**
   - Additional warranties
   - Extended confidentiality periods

6. **MARKET COMPARISON**
   - How terms compare to industry standards
   - Unusual or non-standard provisions
   - Favorable vs. unfavorable terms assessment

7. **IMPLEMENTATION CONSIDERATIONS**
   - Internal approvals required
   - Compliance monitoring needs
   - Record-keeping requirements
   - Performance tracking recommendations

**DISCLAIMER:** This analysis is for informational purposes only and does not constitute legal advice. Consult with qualified legal counsel before making final decisions.`,
      variables: [
        { 
          name: 'CONTRACT_TYPE', 
          type: 'select', 
          options: ['Employment', 'Service Agreement', 'NDA', 'Purchase Agreement', 'Lease', 'Partnership', 'Licensing', 'Distribution', 'Consulting'],
          required: true 
        },
        { name: 'PARTIES', type: 'multiline', required: true },
        { name: 'JURISDICTION', type: 'text', required: true },
        { name: 'INDUSTRY', type: 'text', required: true },
        { name: 'CONTRACT_VALUE', type: 'text', required: false },
        { name: 'TERM_DURATION', type: 'text', required: false },
        { name: 'CONTRACT_TEXT', type: 'multiline', required: true, validation: { maxLength: 50000 } },
        { name: 'REVIEW_FOCUS', type: 'multiline', required: false }
      ],
      tags: ['contract', 'legal-review', 'risk-analysis', 'negotiation'],
      difficulty: 'advanced',
      estimatedTime: 30,
      compliance: []
    }
  ];

  private readonly educationTemplates: IndustryTemplate[] = [
    {
      id: 'education-lesson-plan',
      title: 'Comprehensive Lesson Plan Generator',
      description: 'Creates detailed, standards-aligned lesson plans with differentiation strategies',
      industry: 'education',
      category: 'curriculum-design',
      content: `You are an expert curriculum designer creating a comprehensive, engaging lesson plan. Design for diverse learning needs and modern pedagogical best practices.

**LESSON SPECIFICATIONS:**
- Subject: {{SUBJECT}}
- Grade Level: {{GRADE_LEVEL}}
- Topic/Unit: {{TOPIC}}
- Lesson Duration: {{DURATION}} minutes
- Class Size: {{CLASS_SIZE}} students
- Student Demographics: {{STUDENT_DEMOGRAPHICS}}

**CURRICULUM ALIGNMENT:**
- Learning Standards: {{STANDARDS}}
- Unit Essential Questions: {{ESSENTIAL_QUESTIONS}}
- Learning Objectives: {{LEARNING_OBJECTIVES}}

**CLASSROOM CONTEXT:**
- Available Technology: {{TECHNOLOGY}}
- Physical Space: {{CLASSROOM_SETUP}}
- Special Considerations: {{SPECIAL_CONSIDERATIONS}}

Create a comprehensive lesson plan with the following components:

## 1. LESSON OVERVIEW
- **Lesson Title:** [Creative, engaging title]
- **Big Idea:** [Central concept being taught]
- **Essential Question:** [Driving question for inquiry]
- **Learning Objectives:** (SMART format - Specific, Measurable, Achievable, Relevant, Time-bound)
- **Standards Alignment:** [Specific standards addressed]
- **Assessment Strategy:** [How learning will be measured]

## 2. PREREQUISITE KNOWLEDGE & SKILLS
- Prior learning students should have
- Vocabulary terms to review
- Concepts to activate

## 3. MATERIALS & RESOURCES
**Physical Materials:**
- Required supplies and equipment
- Handouts and worksheets
- Manipulatives or props

**Digital Resources:**
- Technology tools and platforms
- Online resources and links
- Multimedia content

**Differentiation Materials:**
- Support materials for struggling learners
- Extension materials for advanced students
- ELL supports and accommodations

## 4. LESSON STRUCTURE

### Opening Hook ({{HOOK_TIME}} minutes)
- **Attention Grabber:** [Engaging activity to start]
- **Prior Knowledge Activation:** [Connect to what students know]
- **Learning Objective Introduction:** [Share what students will learn]
- **Success Criteria:** [How students will know they've succeeded]

### Direct Instruction ({{INSTRUCTION_TIME}} minutes)
- **Key Concepts & Content:** [Core information to teach]
- **Teaching Strategies:** [Methods for presenting content]
- **Modeling & Demonstrations:** [Show, don't just tell]
- **Check for Understanding:** [Frequent comprehension checks]
- **Student Note-Taking Strategy:** [How students will capture learning]

### Guided Practice ({{GUIDED_TIME}} minutes)
- **Collaborative Activities:** [Structured group work]
- **Scaffolded Practice:** [Supported skill application]
- **Teacher Circulation & Support:** [How to monitor and assist]
- **Peer Learning Opportunities:** [Student-to-student interaction]

### Independent Practice ({{INDEPENDENT_TIME}} minutes)
- **Individual Application Tasks:** [Solo practice activities]
- **Choice Boards/Learning Stations:** [Differentiated options]
- **Self-Assessment Opportunities:** [Student reflection tools]
- **Progress Monitoring:** [How to track individual progress]

### Closure & Reflection ({{CLOSURE_TIME}} minutes)
- **Learning Summary:** [Recap key points]
- **Exit Ticket/Assessment:** [Quick comprehension check]
- **Preview Next Lesson:** [Build anticipation]
- **Homework Assignment:** [Meaningful practice or preparation]

## 5. DIFFERENTIATION STRATEGIES

### For Advanced Learners:
- Extension activities and challenges
- Leadership roles in group work
- Independent research opportunities
- Higher-order thinking questions

### For Struggling Students:
- Additional scaffolding and support
- Modified assignments
- Peer partnerships
- Visual aids and graphic organizers

### For English Language Learners:
- Vocabulary supports and translations
- Visual representations
- Collaborative grouping strategies
- Modified language complexity

### For Students with Special Needs:
- Accommodations as per IEP/504 plans
- Alternative assessment options
- Sensory considerations
- Assistive technology integration

## 6. ASSESSMENT METHODS

### Formative Assessment:
- Throughout lesson checks for understanding
- Student self-assessment tools
- Peer feedback opportunities
- Observation checklists

### Summative Assessment:
- End of lesson evaluation
- Performance task or product
- Traditional assessment (if appropriate)
- Portfolio evidence

### Assessment Rubric:
[Create specific rubric aligned to learning objectives]

## 7. HOMEWORK & EXTENSION
- **Tonight's Assignment:** [Specific, purposeful homework]
- **Family Engagement:** [How families can support learning]
- **Optional Extensions:** [For interested students]
- **Preparation for Next Lesson:** [What students need to know/bring]

## 8. TEACHER REFLECTION QUESTIONS
- What evidence showed students met the objectives?
- Which activities were most/least effective?
- What would you modify for next time?
- How did differentiation strategies work?
- What additional support do students need?

**PEDAGOGICAL NOTES:**
- Incorporate active learning strategies
- Ensure student voice and choice
- Build in movement and engagement
- Connect to real-world applications
- Foster critical thinking and creativity`,
      variables: [
        { name: 'SUBJECT', type: 'text', required: true },
        { 
          name: 'GRADE_LEVEL', 
          type: 'select', 
          options: ['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'College'],
          required: true 
        },
        { name: 'TOPIC', type: 'text', required: true },
        { name: 'DURATION', type: 'number', required: true },
        { name: 'CLASS_SIZE', type: 'number', required: true },
        { name: 'STUDENT_DEMOGRAPHICS', type: 'multiline', required: false },
        { name: 'STANDARDS', type: 'multiline', required: false },
        { name: 'ESSENTIAL_QUESTIONS', type: 'multiline', required: false },
        { name: 'LEARNING_OBJECTIVES', type: 'multiline', required: true },
        { name: 'TECHNOLOGY', type: 'text', required: false },
        { name: 'CLASSROOM_SETUP', type: 'text', required: false },
        { name: 'SPECIAL_CONSIDERATIONS', type: 'multiline', required: false },
        { name: 'HOOK_TIME', type: 'number', default: 5 },
        { name: 'INSTRUCTION_TIME', type: 'number', default: 15 },
        { name: 'GUIDED_TIME', type: 'number', default: 15 },
        { name: 'INDEPENDENT_TIME', type: 'number', default: 10 },
        { name: 'CLOSURE_TIME', type: 'number', default: 5 }
      ],
      tags: ['lesson-planning', 'curriculum', 'differentiation', 'standards-aligned'],
      difficulty: 'intermediate',
      estimatedTime: 25,
      compliance: []
    }
  ];

  private readonly financeTemplates: IndustryTemplate[] = [
    {
      id: 'finance-investment-analysis',
      title: 'Comprehensive Investment Analysis Report',
      description: 'Professional investment analysis with financial modeling and risk assessment',
      industry: 'finance',
      category: 'investment-analysis',
      content: `You are a senior financial analyst conducting comprehensive investment analysis. Provide institutional-quality analysis with detailed financial modeling.

**INVESTMENT OVERVIEW:**
- Company/Asset: {{COMPANY_NAME}}
- Industry/Sector: {{INDUSTRY}}
- Investment Type: {{INVESTMENT_TYPE}}
- Proposed Investment Amount: {{INVESTMENT_AMOUNT}}
- Investment Stage: {{INVESTMENT_STAGE}}
- Analysis Date: {{ANALYSIS_DATE}}

**FINANCIAL DATA:**
{{FINANCIAL_DATA}}

**MARKET INFORMATION:**
{{MARKET_DATA}}

**COMPETITIVE LANDSCAPE:**
{{COMPETITIVE_ANALYSIS}}

**MANAGEMENT TEAM:**
{{MANAGEMENT_INFO}}

**INVESTMENT THESIS:**
{{INVESTMENT_THESIS}}

Generate a comprehensive investment analysis report:

## 1. EXECUTIVE SUMMARY
- **Investment Recommendation:** [BUY/HOLD/SELL with confidence level]
- **Target Price/Valuation:** [12-month price target with methodology]
- **Key Investment Highlights:** [3-5 compelling reasons to invest]
- **Primary Risks:** [Top 3 risk factors to monitor]
- **Expected Return:** [IRR, multiple, timeframe]

## 2. COMPANY ANALYSIS

### Business Model Assessment
- Revenue streams and diversification
- Competitive positioning and moat analysis
- Unit economics and scalability
- Market opportunity (TAM/SAM/SOM)

### Operational Excellence
- Management quality and track record
- Operational efficiency metrics
- Growth strategy execution
- Capital allocation discipline

### Competitive Advantages
- Sustainable competitive moats
- Barriers to entry in market
- Network effects and switching costs
- Brand strength and customer loyalty

## 3. FINANCIAL ANALYSIS

### Historical Performance (3-5 years)
- Revenue growth trends and drivers
- Profitability analysis (gross, operating, net margins)
- Cash flow generation and quality
- Balance sheet strength and capital structure

### Financial Ratios Analysis
**Liquidity Ratios:**
- Current Ratio, Quick Ratio, Cash Ratio
- Analysis and peer comparison

**Leverage Ratios:**
- Debt-to-Equity, Interest Coverage, EBITDA/Interest
- Capital structure optimization assessment

**Efficiency Ratios:**
- Asset Turnover, Inventory Turnover, Receivables Turnover
- Working capital management evaluation

**Profitability Ratios:**
- ROE, ROA, ROIC, Gross/Operating/Net Margins
- DuPont analysis breakdown

### Cash Flow Analysis
- Operating cash flow sustainability
- Free cash flow calculation and trends
- Capital expenditure requirements
- Working capital dynamics

## 4. VALUATION ANALYSIS

### Discounted Cash Flow (DCF) Model
- 5-year financial projections with assumptions
- Terminal value calculation
- WACC computation and sensitivity analysis
- DCF valuation range and key drivers

### Relative Valuation
- Trading multiples (P/E, EV/EBITDA, EV/Sales)
- Peer group comparison analysis
- Transaction multiples from recent deals
- Sum-of-parts valuation (if applicable)

### Scenario Analysis
**Base Case:** [Most likely scenario with assumptions]
**Bull Case:** [Optimistic scenario with upside drivers]
**Bear Case:** [Pessimistic scenario with downside risks]

## 5. RISK ASSESSMENT

### Business & Operational Risks
- Industry cyclicality and market dynamics
- Regulatory and compliance risks
- Technology disruption threats
- Key person dependencies

### Financial Risks
- Liquidity and funding risks
- Credit and counterparty risks
- Interest rate and currency exposure
- Covenant compliance risks

### Market & Economic Risks
- Economic cycle sensitivity
- Interest rate environment impact
- Geopolitical risks
- Market volatility considerations

### ESG (Environmental, Social, Governance) Risks
- Environmental impact and sustainability
- Social responsibility and stakeholder relations
- Corporate governance quality
- Regulatory compliance and reputation risks

## 6. INVESTMENT RECOMMENDATION

### Recommendation Rationale
- Primary drivers supporting recommendation
- Catalyst timeline and value realization
- Risk-adjusted return expectations
- Portfolio fit and correlation analysis

### Key Performance Indicators to Monitor
- Financial metrics to track quarterly
- Operational KPIs for business health
- Market indicators for industry trends
- Trigger points for recommendation changes

### Exit Strategy Considerations
- Potential exit mechanisms and timing
- Liquidity options and market conditions
- Value maximization strategies
- Risk mitigation during holding period

## 7. IMPLEMENTATION CONSIDERATIONS

### Position Sizing Recommendations
- Appropriate allocation based on risk profile
- Diversification impact on portfolio
- Correlation with existing holdings
- Liquidity considerations

### Timing and Entry Strategy
- Market entry recommendations
- Dollar-cost averaging considerations
- Technical analysis factors
- Market timing risks

### Monitoring Framework
- Regular review schedule and triggers
- Key metrics dashboard
- Risk monitoring protocols
- Rebalancing guidelines

**DISCLAIMERS:**
- This analysis is for informational purposes only
- Past performance does not guarantee future results
- All investments carry risk of loss
- Consult qualified financial advisors before investing
- Forward-looking statements are subject to uncertainty`,
      variables: [
        { name: 'COMPANY_NAME', type: 'text', required: true },
        { name: 'INDUSTRY', type: 'text', required: true },
        { 
          name: 'INVESTMENT_TYPE', 
          type: 'select', 
          options: ['Equity', 'Debt', 'Convertible', 'Mezzanine', 'Real Estate', 'Private Equity', 'Venture Capital'],
          required: true 
        },
        { name: 'INVESTMENT_AMOUNT', type: 'text', required: true },
        { 
          name: 'INVESTMENT_STAGE', 
          type: 'select', 
          options: ['Seed', 'Series A', 'Series B', 'Growth', 'Late Stage', 'Buyout', 'Public Markets'],
          required: true 
        },
        { name: 'ANALYSIS_DATE', type: 'date', required: true },
        { name: 'FINANCIAL_DATA', type: 'multiline', required: true },
        { name: 'MARKET_DATA', type: 'multiline', required: true },
        { name: 'COMPETITIVE_ANALYSIS', type: 'multiline', required: false },
        { name: 'MANAGEMENT_INFO', type: 'multiline', required: true },
        { name: 'INVESTMENT_THESIS', type: 'multiline', required: true }
      ],
      tags: ['investment', 'financial-analysis', 'valuation', 'due-diligence'],
      difficulty: 'advanced',
      estimatedTime: 45,
      compliance: ['SOX', 'SEC']
    }
  ];

  async seedIndustryTemplates(): Promise<void> {
    this.logger.log('Seeding industry-specific templates...');

    const allTemplates = [
      ...this.healthcareTemplates,
      ...this.legalTemplates,
      ...this.educationTemplates,
      ...this.financeTemplates
    ];

    for (const template of allTemplates) {
      await this.createTemplate(template);
    }

    this.logger.log(`Seeded ${allTemplates.length} industry templates`);
  }

  private async createTemplate(templateData: IndustryTemplate): Promise<void> {
    try {
      await this.prisma.template.upsert({
        where: { id: templateData.id },
        update: {
          name: templateData.title,
          description: templateData.description,
          content: templateData.content,
          variables: templateData.variables,
          category: templateData.category,
          tags: templateData.tags,
          isPublic: true,
          industry: templateData.industry,
          difficulty: templateData.difficulty,
          estimatedUsageTime: templateData.estimatedTime,
          usageInstructions: `Industry: ${templateData.industry}\nCompliance: ${templateData.compliance?.join(', ') || 'None'}`
        },
        create: {
          id: templateData.id,
          userId: 'system', // System-generated templates
          name: templateData.title,
          description: templateData.description,
          content: templateData.content,
          variables: templateData.variables,
          category: templateData.category,
          tags: templateData.tags,
          isPublic: true,
          industry: templateData.industry,
          difficulty: templateData.difficulty,
          estimatedUsageTime: templateData.estimatedTime,
          usageInstructions: `Industry: ${templateData.industry}\nCompliance: ${templateData.compliance?.join(', ') || 'None'}`
        }
      });
    } catch (error) {
      this.logger.error(`Failed to create template ${templateData.id}:`, error);
    }
  }

  async getTemplatesByIndustry(industry: string): Promise<any[]> {
    return this.prisma.template.findMany({
      where: {
        industry,
        isPublic: true
      },
      include: {
        user: {
          select: { id: true, username: true, avatar: true }
        },
        ratings: {
          select: { rating: true }
        }
      },
      orderBy: { usageCount: 'desc' }
    });
  }

  async getIndustryCategories(): Promise<Record<string, string[]>> {
    const templates = await this.prisma.template.findMany({
      where: { 
        isPublic: true,
        industry: { not: null }
      },
      select: { industry: true, category: true },
      distinct: ['industry', 'category']
    });

    const categories: Record<string, string[]> = {};
    
    templates.forEach(template => {
      if (!categories[template.industry]) {
        categories[template.industry] = [];
      }
      if (!categories[template.industry].includes(template.category)) {
        categories[template.industry].push(template.category);
      }
    });

    return categories;
  }

  async searchIndustryTemplates(query: {
    industry?: string;
    category?: string;
    difficulty?: string;
    tags?: string[];
    search?: string;
  }): Promise<any[]> {
    const where: any = {
      isPublic: true,
      ...(query.industry && { industry: query.industry }),
      ...(query.category && { category: query.category }),
      ...(query.difficulty && { difficulty: query.difficulty }),
      ...(query.tags?.length && { 
        tags: { 
          hasSome: query.tags 
        } 
      }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { tags: { has: query.search } }
        ]
      })
    };

    return this.prisma.template.findMany({
      where,
      include: {
        user: {
          select: { id: true, username: true, avatar: true }
        },
        ratings: {
          select: { rating: true }
        }
      },
      orderBy: [
        { featured: 'desc' },
        { usageCount: 'desc' },
        { createdAt: 'desc' }
      ]
    });
  }
}