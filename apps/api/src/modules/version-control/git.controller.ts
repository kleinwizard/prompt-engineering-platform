import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GitService } from './git.service';

interface CreateRepositoryDto {
  name: string;
  description?: string;
  initialPrompt?: string;
  isPublic?: boolean;
}

interface CreateBranchDto {
  name: string;
  sourceBranch?: string;
  description?: string;
}

interface CommitDto {
  message: string;
  content: string;
}

interface MergeDto {
  sourceBranch: string;
  targetBranch: string;
  message?: string;
}

interface TagDto {
  name: string;
  commitId: string;
  message?: string;
}

@Controller('git')
@UseGuards(JwtAuthGuard)
export class GitController {
  constructor(private gitService: GitService) {}

  // Repository management
  @Post('repositories')
  async createRepository(@Request() req, @Body() dto: CreateRepositoryDto) {
    return this.gitService.createRepository(
      req.user.id,
      dto.name,
      dto.description,
      dto.initialPrompt,
      dto.isPublic
    );
  }

  @Get('repositories/:id')
  async getRepository(@Param('id') repoId: string, @Request() req) {
    return this.gitService.getRepository(repoId, req.user.id);
  }

  @Delete('repositories/:id')
  async deleteRepository(@Param('id') repoId: string, @Request() req) {
    await this.gitService.deleteRepository(repoId, req.user.id);
    return { success: true, message: 'Repository deleted' };
  }

  @Post('repositories/:id/fork')
  async forkRepository(
    @Param('id') repoId: string,
    @Request() req,
    @Body('name') newName?: string
  ) {
    return this.gitService.forkRepository(repoId, req.user.id, newName);
  }

  // Branch management
  @Get('repositories/:id/branches')
  async getBranches(@Param('id') repoId: string, @Request() req) {
    const branches = await this.gitService.getBranches(repoId, req.user.id);
    return { branches };
  }

  @Post('repositories/:id/branches')
  async createBranch(
    @Param('id') repoId: string,
    @Request() req,
    @Body() dto: CreateBranchDto
  ) {
    return this.gitService.createBranch(repoId, req.user.id, dto);
  }

  @Delete('repositories/:id/branches/:branch')
  async deleteBranch(
    @Param('id') repoId: string,
    @Param('branch') branchName: string,
    @Request() req
  ) {
    await this.gitService.deleteBranch(repoId, branchName, req.user.id);
    return { success: true, message: `Branch '${branchName}' deleted` };
  }

  // Commit operations
  @Post('repositories/:id/commits')
  async createCommit(
    @Param('id') repoId: string,
    @Query('branch') branch: string = 'main',
    @Request() req,
    @Body() dto: CommitDto
  ) {
    return this.gitService.commit(repoId, branch, {
      message: dto.message,
      content: dto.content,
      authorId: req.user.id
    });
  }

  @Get('repositories/:id/commits')
  async getCommitHistory(
    @Param('id') repoId: string,
    @Query('branch') branch?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.gitService.getCommitHistory(
      repoId,
      branch,
      limit ? parseInt(limit) : undefined,
      offset ? parseInt(offset) : undefined
    );
  }

  @Get('repositories/:id/commits/:commitId')
  async getCommit(
    @Param('id') repoId: string,
    @Param('commitId') commitId: string
  ) {
    // Implementation would return specific commit details
    return { commitId, details: 'Commit details...' };
  }

  @Get('repositories/:id/commits/:commitId/diff')
  async getCommitDiff(
    @Param('id') repoId: string,
    @Param('commitId') commitId: string,
    @Query('compare') compareWith?: string
  ) {
    return this.gitService.getDiff(commitId, compareWith);
  }

  // Merge operations
  @Post('repositories/:id/merge')
  async merge(
    @Param('id') repoId: string,
    @Request() req,
    @Body() dto: MergeDto
  ) {
    return this.gitService.merge(
      repoId,
      dto.sourceBranch,
      dto.targetBranch,
      req.user.id,
      dto.message
    );
  }

  @Post('repositories/:id/cherry-pick')
  async cherryPick(
    @Param('id') repoId: string,
    @Request() req,
    @Body() dto: {
      commitId: string;
      targetBranch: string;
    }
  ) {
    return this.gitService.cherryPick(
      repoId,
      dto.commitId,
      dto.targetBranch,
      req.user.id
    );
  }

  @Post('repositories/:id/revert')
  async revert(
    @Param('id') repoId: string,
    @Request() req,
    @Body() dto: {
      commitId: string;
      branch: string;
    }
  ) {
    return this.gitService.revert(
      repoId,
      dto.commitId,
      dto.branch,
      req.user.id
    );
  }

  // Tag operations
  @Get('repositories/:id/tags')
  async getTags(@Param('id') repoId: string) {
    // Implementation would return all tags for the repository
    return { tags: [] };
  }

  @Post('repositories/:id/tags')
  async createTag(
    @Param('id') repoId: string,
    @Request() req,
    @Body() dto: TagDto
  ) {
    return this.gitService.tag(
      repoId,
      dto.name,
      dto.commitId,
      req.user.id,
      dto.message
    );
  }

  @Delete('repositories/:id/tags/:tag')
  async deleteTag(
    @Param('id') repoId: string,
    @Param('tag') tagName: string,
    @Request() req
  ) {
    // Implementation would verify permissions and delete tag
    return { success: true, message: `Tag '${tagName}' deleted` };
  }

  // Advanced operations
  @Get('repositories/:id/blame')
  async blame(
    @Param('id') repoId: string,
    @Query('branch') branch: string = 'main'
  ) {
    return this.gitService.blame(repoId, branch);
  }

  @Get('repositories/:id/log')
  async getLog(
    @Param('id') repoId: string,
    @Query('branch') branch?: string,
    @Query('author') author?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.gitService.getCommitLog(repoId, {
      branch,
      author,
      since,
      until,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0
    });
  }

  @Get('repositories/:id/graph')
  async getCommitGraph(@Param('id') repoId: string) {
    // Implementation would return commit graph visualization data
    return {
      nodes: [],
      edges: [],
      branches: []
    };
  }

  @Post('repositories/:id/squash')
  async squashCommits(
    @Param('id') repoId: string,
    @Request() req,
    @Body() dto: {
      commitIds: string[];
      message: string;
      branch: string;
    }
  ) {
    // Implementation would squash multiple commits into one
    return {
      success: true,
      newCommitId: 'squashed-commit-id',
      squashedCommits: dto.commitIds
    };
  }

  @Post('repositories/:id/rebase')
  async rebase(
    @Param('id') repoId: string,
    @Request() req,
    @Body() dto: {
      branch: string;
      onto: string;
      interactive?: boolean;
    }
  ) {
    // Implementation would perform rebase operation
    return {
      success: true,
      rebasedCommits: [],
      conflicts: []
    };
  }

  // Collaboration features
  @Get('repositories/:id/contributors')
  async getContributors(@Param('id') repoId: string) {
    // Implementation would return repository contributors
    return {
      contributors: []
    };
  }

  @Get('repositories/:id/activity')
  async getActivity(
    @Param('id') repoId: string,
    @Query('since') since?: string,
    @Query('until') until?: string
  ) {
    // Implementation would return repository activity feed
    return {
      activity: [],
      summary: {
        commits: 0,
        branches: 0,
        contributors: 0
      }
    };
  }

  @Get('repositories/:id/stats')
  async getRepositoryStats(@Param('id') repoId: string) {
    // Implementation would return comprehensive repository statistics
    return {
      commits: {
        total: 0,
        thisWeek: 0,
        thisMonth: 0
      },
      contributors: {
        total: 0,
        active: 0
      },
      codeChurn: {
        additions: 0,
        deletions: 0,
        files: 0
      },
      branches: {
        total: 0,
        active: 0,
        stale: 0
      }
    };
  }

  // Repository comparison
  @Get('repositories/:id/compare/:base...:head')
  async compareRefs(
    @Param('id') repoId: string,
    @Param('base') base: string,
    @Param('head') head: string
  ) {
    // Implementation would compare two refs (branches, commits, tags)
    return {
      base,
      head,
      ahead: 0,
      behind: 0,
      diff: {}
    };
  }

  // Search and discovery
  @Get('repositories/search')
  async searchRepositories(
    @Query('q') query: string,
    @Query('language') language?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    // Implementation would search public repositories
    return {
      query,
      repositories: [],
      total: 0
    };
  }

  @Get('repositories/:id/search')
  async searchInRepository(
    @Param('id') repoId: string,
    @Query('q') query: string,
    @Query('type') type?: 'commits' | 'content',
    @Query('branch') branch?: string
  ) {
    // Implementation would search within a specific repository
    return {
      query,
      type,
      results: []
    };
  }
}