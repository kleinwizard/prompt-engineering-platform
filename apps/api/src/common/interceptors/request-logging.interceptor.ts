import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { RequestWithId } from '../middleware/request-id.middleware';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();
    
    const { method, url, ip, headers } = request;
    const requestId = request.id;
    const userAgent = headers['user-agent'] || 'Unknown';
    
    // Log incoming request
    this.logger.log(
      `[${requestId}] ${method} ${url} - ${ip} - ${userAgent}`,
      'Request'
    );

    return next.handle().pipe(
      tap((data) => {
        const responseTime = Date.now() - startTime;
        const statusCode = response.statusCode;
        
        // Log successful response
        this.logger.log(
          `[${requestId}] ${method} ${url} - ${statusCode} - ${responseTime}ms`,
          'Response'
        );
        
        // Track performance metrics
        if (responseTime > 1000) {
          this.logger.warn(
            `[${requestId}] Slow request: ${method} ${url} took ${responseTime}ms`,
            'Performance'
          );
        }
      }),
      catchError((error) => {
        const responseTime = Date.now() - startTime;
        const statusCode = error.status || 500;
        
        // Log error response
        this.logger.error(
          `[${requestId}] ${method} ${url} - ${statusCode} - ${responseTime}ms - ${error.message}`,
          error.stack,
          'ErrorResponse'
        );
        
        throw error;
      })
    );
  }
}