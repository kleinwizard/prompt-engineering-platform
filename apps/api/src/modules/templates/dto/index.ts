export interface CreateTemplateDto {
  name: string;
  title: string;
  description: string;
  content: string;
  category: string;
  subcategory?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  tags?: string[];
  variables?: string[];
  isPublic?: boolean;
}

export interface UpdateTemplateDto {
  name?: string;
  description?: string;
  content?: string;
  category?: string;
  tags?: string[];
  variables?: string[];
  isPublic?: boolean;
}

export interface CloneTemplateDto {
  name: string;
  description?: string;
}

export interface TemplateSearchDto {
  query?: string;
  category?: string;
  subcategory?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  tags?: string[];
  author?: string;
  sortBy?: 'relevance' | 'date' | 'popularity' | 'rating';
  page?: number;
  limit?: number;
}

export interface TemplateVariableDto {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  defaultValue?: any;
}

export interface TemplateVersionDto {
  content: string;
  changeNotes?: string;
  variables?: TemplateVariableDto[];
}