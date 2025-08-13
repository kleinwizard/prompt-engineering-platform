import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestWithUser } from '../../modules/auth/interfaces';

export type Role = 'admin' | 'moderator' | 'user' | 'premium';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get user roles from user object or database
    // For now, we'll use a simple role determination based on user properties
    const userRoles = this.getUserRoles(user);

    const hasRole = requiredRoles.some(role => userRoles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }

  private getUserRoles(user: any): Role[] {
    const roles: Role[] = ['user'];

    // Add logic to determine user roles
    // This is a simplified example
    if (user.email?.includes('admin')) {
      roles.push('admin');
    }

    if (user.profile?.level >= 10) {
      roles.push('premium');
    }

    return roles;
  }
}