import { Test, TestingModule } from '@nestjs/testing';
import { PromptsService } from './prompts.service';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GamificationService } from '../gamification/gamification.service';
import { SearchService } from '../search/search.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('PromptsService', () => {
  let service: PromptsService;
  let prismaService: jest.Mocked<PrismaService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptsService,
        {
          provide: PrismaService,
          useValue: {
            prompt: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            userProfile: {
              update: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: GamificationService,
          useValue: {
            awardPoints: jest.fn(),
          },
        },
        {
          provide: SearchService,
          useValue: {
            indexPrompt: jest.fn(),
            updatePromptIndex: jest.fn(),
            removePromptFromIndex: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PromptsService>(PromptsService);
    prismaService = module.get(PrismaService);
    eventEmitter = module.get(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPrompt', () => {
    it('should return a prompt when found and public', async () => {
      const mockPrompt = {
        id: '1',
        title: 'Test Prompt',
        content: 'Test content',
        isPublic: true,
        userId: 'user1',
        user: { username: 'testuser' },
        _count: { likes: 5, comments: 2 },
      };

      prismaService.prompt.findUnique.mockResolvedValue(mockPrompt);

      const result = await service.getPrompt('1');

      expect(result).toBeDefined();
      expect(result.id).toBe('1');
      expect(result.title).toBe('Test Prompt');
    });

    it('should throw NotFoundException when prompt not found', async () => {
      prismaService.prompt.findUnique.mockResolvedValue(null);

      await expect(service.getPrompt('1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when prompt is private and user is not owner', async () => {
      const mockPrompt = {
        id: '1',
        title: 'Private Prompt',
        content: 'Private content',
        isPublic: false,
        userId: 'user1',
      };

      prismaService.prompt.findUnique.mockResolvedValue(mockPrompt);

      await expect(service.getPrompt('1', 'user2')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createPrompt', () => {
    it('should create a new prompt successfully', async () => {
      const createPromptDto = {
        title: 'New Prompt',
        content: 'New content',
        category: 'business',
        isPublic: true,
      };

      const mockCreatedPrompt = {
        id: '1',
        ...createPromptDto,
        userId: 'user1',
        user: { username: 'testuser' },
        _count: { likes: 0, comments: 0 },
      };

      prismaService.$transaction.mockImplementation(async (callback) => {
        return callback(prismaService);
      });

      prismaService.prompt.create.mockResolvedValue(mockCreatedPrompt);

      const result = await service.createPrompt('user1', createPromptDto);

      expect(result).toBeDefined();
      expect(result.title).toBe('New Prompt');
      expect(eventEmitter.emit).toHaveBeenCalledWith('prompt.created', expect.any(Object));
    });
  });

  describe('updatePrompt', () => {
    it('should update prompt when user is owner', async () => {
      const existingPrompt = {
        id: '1',
        title: 'Old Title',
        userId: 'user1',
      };

      const updateData = {
        title: 'New Title',
        content: 'Updated content',
      };

      const updatedPrompt = {
        ...existingPrompt,
        ...updateData,
        user: { username: 'testuser' },
        _count: { likes: 0, comments: 0 },
      };

      prismaService.prompt.findUnique.mockResolvedValue(existingPrompt);
      prismaService.prompt.update.mockResolvedValue(updatedPrompt);

      const result = await service.updatePrompt('user1', '1', updateData);

      expect(result.title).toBe('New Title');
      expect(eventEmitter.emit).toHaveBeenCalledWith('prompt.updated', expect.any(Object));
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      const existingPrompt = {
        id: '1',
        title: 'Test Prompt',
        userId: 'user1',
      };

      prismaService.prompt.findUnique.mockResolvedValue(existingPrompt);

      await expect(
        service.updatePrompt('user2', '1', { title: 'New Title' })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deletePrompt', () => {
    it('should delete prompt when user is owner', async () => {
      const existingPrompt = {
        id: '1',
        title: 'Test Prompt',
        userId: 'user1',
      };

      prismaService.prompt.findUnique.mockResolvedValue(existingPrompt);
      prismaService.$transaction.mockImplementation(async (callback) => {
        return callback(prismaService);
      });

      await service.deletePrompt('user1', '1');

      expect(prismaService.prompt.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      const existingPrompt = {
        id: '1',
        title: 'Test Prompt',
        userId: 'user1',
      };

      prismaService.prompt.findUnique.mockResolvedValue(existingPrompt);

      await expect(service.deletePrompt('user2', '1')).rejects.toThrow(ForbiddenException);
    });
  });
});