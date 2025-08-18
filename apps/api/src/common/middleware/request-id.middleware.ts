import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface RequestWithId extends Request {
  id: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction) {
    // Check if request ID is already set (from load balancer or proxy)
    const existingId = req.headers['x-request-id'] as string;
    
    // Generate new ID if not present
    const requestId = existingId || uuidv4();
    
    // Set request ID on request object
    req.id = requestId;
    
    // Set response header for tracing
    res.setHeader('X-Request-ID', requestId);
    
    // Add to response locals for access in other middleware/controllers
    res.locals.requestId = requestId;
    
    next();
  }
}