export interface CreateUserDto {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface UpdateUserDto {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface UpdatePreferencesDto {
  theme?: 'light' | 'dark';
  notifications?: {
    email: boolean;
    push: boolean;
    inApp: boolean;
  };
  privacy?: {
    profileVisible: boolean;
    activityVisible: boolean;
  };
}

export interface UpdateUserProfileDto {
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatar?: string;
  location?: string;
  website?: string;
  socialLinks?: Record<string, string>;
}

export interface DeactivateAccountDto {
  reason: string;
  feedback?: string;
  deleteData?: boolean;
}

export interface UserSearchDto {
  query?: string;
  skills?: string[];
  location?: string;
  sortBy?: 'relevance' | 'reputation' | 'activity';
  page?: number;
  limit?: number;
}