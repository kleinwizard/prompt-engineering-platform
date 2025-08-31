export interface CommunityPost {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  authorId: string;
  likes: number;
  views: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunityComment {
  id: string;
  postId: string;
  content: string;
  authorId: string;
  parentId?: string;
  likes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunityStats {
  totalPosts: number;
  totalComments: number;
  activeUsers: number;
  topCategories: Array<{ category: string; count: number }>;
}

export interface CommunityFeed {
  posts: CommunityPost[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
}

export interface UserProfile {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
  reputation: number;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  joinedAt: Date;
}

export interface UserFollowing {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: Date;
}

export interface CommentWithReplies extends CommunityComment {
  replies: CommunityComment[];
  author: UserProfile;
}

export interface ReputationScore {
  userId: string;
  score: number;
  breakdown: {
    posts: number;
    comments: number;
    likes: number;
    helpful: number;
  };
}

export interface ContentRecommendation {
  contentId: string;
  contentType: 'post' | 'comment';
  title: string;
  reason: string;
  relevanceScore: number;
}

export interface TrendingContent {
  posts: Array<CommunityPost & { trendScore: number }>;
  tags: Array<{ tag: string; count: number }>;
  categories: Array<{ category: string; count: number }>;
}