export interface CreatePostDto {
  title: string;
  content: string;
  category: string;
  tags?: string[];
}

export interface UpdatePostDto {
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
}

export interface CreateCommentDto {
  content: string;
  parentId?: string;
  promptId?: string;
  templateId?: string;
}

export interface UpdateCommentDto {
  content: string;
}

export interface FollowUserDto {
  userId: string;
}

export interface ReportContentDto {
  contentId: string;
  contentType: 'post' | 'comment';
  reason: string;
  description?: string;
  reportedUserId?: string;
  promptId?: string;
  templateId?: string;
  commentId?: string;
}

export interface CreateGroupDto {
  name: string;
  description: string;
  isPrivate?: boolean;
  tags?: string[];
}

export interface UpdateGroupDto {
  name?: string;
  description?: string;
  isPrivate?: boolean;
  tags?: string[];
}

export interface JoinGroupDto {
  groupId: string;
}

export interface VoteDto {
  voteType: 'up' | 'down';
}

export interface ShareContentDto {
  platform: 'twitter' | 'linkedin' | 'facebook' | 'reddit';
  message?: string;
}

export interface CommunitySearchDto {
  query?: string;
  type?: 'post' | 'comment' | 'user' | 'group';
  category?: string;
  tags?: string[];
  author?: string;
  sortBy?: 'relevance' | 'date' | 'popularity';
  page?: number;
  limit?: number;
}