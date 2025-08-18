import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

interface CommitData {
  message: string;
  content: string;
  authorId: string;
  parentIds?: string[];
}

interface BranchData {
  name: string;
  sourceBranch?: string;
  description?: string;
}

interface MergeResult {
  success: boolean;
  commitId?: string;
  conflicts?: ConflictInfo[];
  resolution?: string;
}

interface ConflictInfo {
  type: 'content' | 'structure' | 'variable';
  description: string;
  sourceLine: number;
  targetLine: number;
  sourceContent: string;
  targetContent: string;
  suggestedResolution: string;
}

interface Diff {
  additions: DiffHunk[];
  deletions: DiffHunk[];
  modifications: DiffHunk[];
  hunks: DiffHunk[];
  stats: {
    addedLines: number;
    deletedLines: number;
    changedLines: number;
  };
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'added' | 'deleted' | 'unchanged' | 'modified';
  content: string;
  lineNumber: number;
}

interface BlameInfo {
  line: number;
  content: string;
  commit: {
    id: string;
    message: string;
    timestamp: Date;
  };
  author: {
    id: string;
    username: string;
  };
}

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(private prisma: PrismaService) {}

  async createRepository(
    userId: string,
    name: string,
    description?: string,
    initialPrompt?: string,
    isPublic = false
  ) {
    this.logger.log(`Creating repository: ${name} for user ${userId}`);

    const repo = await this.prisma.promptRepository.create({
      data: {
        name,
        description,
        userId,
        isPublic,
        defaultBranch: 'main',
        branches: {
          create: {
            name: 'main',
            protected: true,
            description: 'Main branch'
          }
        }
      },
      include: {
        branches: true
      }
    });

    // Create initial commit if prompt provided
    if (initialPrompt) {
      await this.commit(repo.id, 'main', {
        message: 'Initial commit',
        content: initialPrompt,
        authorId: userId
      });
    }

    this.logger.log(`Repository created: ${repo.id}`);
    return repo;
  }

  async getRepository(repoId: string, userId?: string) {
    const repo = await this.prisma.promptRepository.findUnique({
      where: { id: repoId },
      include: {
        user: {
          select: { id: true, username: true, avatar: true }
        },
        branches: {
          orderBy: { createdAt: 'asc' }
        },
        _count: {
          select: {
            commits: true,
            branches: true,
            forks: true,
            stars: true
          }
        }
      }
    });

    if (!repo) {
      throw new NotFoundException('Repository not found');
    }

    // Check access permissions
    if (!repo.isPublic && repo.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    return repo;
  }

  async createBranch(repoId: string, userId: string, data: BranchData) {
    // Verify repository access
    const repo = await this.getRepository(repoId, userId);

    // Get source branch (default to main)
    const sourceBranchName = data.sourceBranch || repo.defaultBranch;
    const sourceBranch = await this.prisma.promptBranch.findUnique({
      where: { 
        repositoryId_name: { 
          repositoryId: repoId, 
          name: sourceBranchName 
        } 
      }
    });

    if (!sourceBranch) {
      throw new BadRequestException(`Source branch '${sourceBranchName}' not found`);
    }

    // Check if branch name already exists
    const existingBranch = await this.prisma.promptBranch.findUnique({
      where: { 
        repositoryId_name: { 
          repositoryId: repoId, 
          name: data.name 
        } 
      }
    });

    if (existingBranch) {
      throw new BadRequestException(`Branch '${data.name}' already exists`);
    }

    // Create new branch
    const branch = await this.prisma.promptBranch.create({
      data: {
        repositoryId: repoId,
        name: data.name,
        description: data.description,
        headCommitId: sourceBranch.headCommitId,
        protected: false
      }
    });

    this.logger.log(`Branch created: ${data.name} from ${sourceBranchName}`);
    return branch;
  }

  async commit(repoId: string, branchName: string, data: CommitData) {
    // Get repository and branch
    const [repo, branch] = await Promise.all([
      this.getRepository(repoId, data.authorId),
      this.getBranch(repoId, branchName)
    ]);

    // Get current head commit
    const currentHead = branch.headCommitId ? 
      await this.prisma.promptCommit.findUnique({
        where: { id: branch.headCommitId }
      }) : null;

    // Calculate diff
    const diff = this.calculateDiff(
      currentHead?.content || '',
      data.content
    );

    // Generate commit hash
    const hash = this.generateCommitHash({
      content: data.content,
      message: data.message,
      authorId: data.authorId,
      parentId: currentHead?.id,
      timestamp: new Date()
    });

    // Create commit
    const commit = await this.prisma.promptCommit.create({
      data: {
        repositoryId: repoId,
        message: data.message,
        content: data.content,
        diff,
        parentIds: currentHead ? [currentHead.id] : [],
        authorId: data.authorId,
        hash,
        timestamp: new Date()
      }
    });

    // Update branch head
    await this.prisma.promptBranch.update({
      where: { id: branch.id },
      data: { headCommitId: commit.id }
    });

    // Update repository stats
    await this.prisma.promptRepository.update({
      where: { id: repoId },
      data: { 
        updatedAt: new Date(),
        totalCommits: { increment: 1 }
      }
    });

    this.logger.log(`Commit created: ${hash} on branch ${branchName}`);
    return commit;
  }

  async merge(
    repoId: string,
    sourceBranch: string,
    targetBranch: string,
    userId: string,
    message?: string
  ): Promise<MergeResult> {
    // Get branches
    const [source, target] = await Promise.all([
      this.getBranchWithCommits(repoId, sourceBranch),
      this.getBranchWithCommits(repoId, targetBranch)
    ]);

    if (!source.headCommitId || !target.headCommitId) {
      throw new BadRequestException('Cannot merge branches without commits');
    }

    // Find common ancestor
    const commonAncestor = await this.findCommonAncestor(
      source.headCommitId,
      target.headCommitId
    );

    // Get head commits
    const [sourceCommit, targetCommit] = await Promise.all([
      this.prisma.promptCommit.findUnique({ where: { id: source.headCommitId } }),
      this.prisma.promptCommit.findUnique({ where: { id: target.headCommitId } })
    ]);

    // Check for conflicts
    const conflicts = this.detectConflicts(
      sourceCommit!.content,
      targetCommit!.content,
      commonAncestor?.content || ''
    );

    if (conflicts.length > 0) {
      return {
        success: false,
        conflicts,
        resolution: await this.suggestConflictResolution(conflicts)
      };
    }

    // Perform three-way merge
    const mergedContent = this.threeWayMerge(
      commonAncestor?.content || '',
      sourceCommit!.content,
      targetCommit!.content
    );

    // Create merge commit
    const mergeCommit = await this.commit(repoId, targetBranch, {
      message: message || `Merge branch '${sourceBranch}' into ${targetBranch}`,
      content: mergedContent,
      authorId: userId,
      parentIds: [sourceCommit!.id, targetCommit!.id]
    });

    return {
      success: true,
      commitId: mergeCommit.id
    };
  }

  async cherryPick(
    repoId: string,
    commitId: string,
    targetBranch: string,
    userId: string
  ) {
    const [commit, branch] = await Promise.all([
      this.prisma.promptCommit.findUnique({
        where: { id: commitId },
        include: {
          parent: true
        }
      }),
      this.getBranchWithCommits(repoId, targetBranch)
    ]);

    if (!commit) {
      throw new NotFoundException('Commit not found');
    }

    // Get target head
    const targetHead = branch.headCommitId ? 
      await this.prisma.promptCommit.findUnique({
        where: { id: branch.headCommitId }
      }) : null;

    if (!targetHead) {
      throw new BadRequestException('Cannot cherry-pick to empty branch');
    }

    // Apply commit changes to target
    const cherryPickedContent = this.applyPatch(
      targetHead.content,
      commit.diff as Diff
    );

    // Create cherry-pick commit
    return this.commit(repoId, targetBranch, {
      message: `Cherry-pick: ${commit.message}`,
      content: cherryPickedContent,
      authorId: userId
    });
  }

  async revert(
    repoId: string,
    commitId: string,
    branchName: string,
    userId: string
  ) {
    const commit = await this.prisma.promptCommit.findUnique({
      where: { id: commitId }
    });

    if (!commit) {
      throw new NotFoundException('Commit not found');
    }

    // Find parent commit
    const parentId = commit.parentIds?.[0];
    if (!parentId) {
      throw new BadRequestException('Cannot revert initial commit');
    }

    const parentCommit = await this.prisma.promptCommit.findUnique({
      where: { id: parentId }
    });

    // Create revert commit with parent content
    return this.commit(repoId, branchName, {
      message: `Revert "${commit.message}"`,
      content: parentCommit!.content,
      authorId: userId
    });
  }

  async tag(
    repoId: string,
    name: string,
    commitId: string,
    userId: string,
    message?: string
  ) {
    // Verify commit exists
    const commit = await this.prisma.promptCommit.findUnique({
      where: { id: commitId }
    });

    if (!commit) {
      throw new NotFoundException('Commit not found');
    }

    // Create tag
    const tag = await this.prisma.promptTag.create({
      data: {
        repositoryId: repoId,
        name,
        commitId,
        message,
        createdBy: userId
      }
    });

    return tag;
  }

  async blame(repoId: string, branchName: string): Promise<BlameInfo[]> {
    const branch = await this.getBranch(repoId, branchName);
    
    if (!branch.headCommitId) {
      return [];
    }

    const headCommit = await this.prisma.promptCommit.findUnique({
      where: { id: branch.headCommitId },
      include: {
        author: {
          select: { id: true, username: true }
        }
      }
    });

    if (!headCommit) {
      return [];
    }

    const lines = headCommit.content.split('\n');
    const blameInfo: BlameInfo[] = [];

    // For simplicity, attribute all lines to the head commit
    // In a full implementation, you would trace each line's history
    for (let i = 0; i < lines.length; i++) {
      blameInfo.push({
        line: i + 1,
        content: lines[i],
        commit: {
          id: headCommit.id,
          message: headCommit.message,
          timestamp: headCommit.timestamp
        },
        author: headCommit.author
      });
    }

    return blameInfo;
  }

  async getCommitHistory(
    repoId: string,
    branchName?: string,
    limit = 50,
    offset = 0
  ) {
    const where: any = { repositoryId: repoId };

    if (branchName) {
      const branch = await this.getBranch(repoId, branchName);
      if (branch.headCommitId) {
        // Get commits reachable from this branch head
        const reachableCommits = await this.getReachableCommits(branch.headCommitId);
        where.id = { in: reachableCommits };
      }
    }

    const commits = await this.prisma.promptCommit.findMany({
      where,
      include: {
        author: {
          select: { id: true, username: true, avatar: true }
        }
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset
    });

    return commits;
  }

  async getDiff(commitId1: string, commitId2?: string): Promise<Diff> {
    const commit1 = await this.prisma.promptCommit.findUnique({
      where: { id: commitId1 }
    });

    if (!commit1) {
      throw new NotFoundException('Commit not found');
    }

    let content1 = commit1.content;
    let content2 = '';

    if (commitId2) {
      const commit2 = await this.prisma.promptCommit.findUnique({
        where: { id: commitId2 }
      });
      if (!commit2) {
        throw new NotFoundException('Second commit not found');
      }
      content2 = commit2.content;
    } else if (commit1.parentIds?.length) {
      const parent = await this.prisma.promptCommit.findUnique({
        where: { id: commit1.parentIds[0] }
      });
      content2 = parent?.content || '';
    }

    return this.calculateDiff(content2, content1);
  }

  async forkRepository(repoId: string, userId: string, newName?: string) {
    const originalRepo = await this.getRepository(repoId);
    
    // Create fork
    const fork = await this.prisma.promptRepository.create({
      data: {
        name: newName || `${originalRepo.name}-fork`,
        description: `Fork of ${originalRepo.name}`,
        userId,
        isPublic: false,
        defaultBranch: originalRepo.defaultBranch,
        parentId: repoId
      }
    });

    // Copy all branches and commits
    await this.copyRepositoryContent(repoId, fork.id);

    // Update fork count
    await this.prisma.promptRepository.update({
      where: { id: repoId },
      data: { forks: { increment: 1 } }
    });

    return fork;
  }

  // Helper methods

  private async getBranch(repoId: string, branchName: string) {
    const branch = await this.prisma.promptBranch.findUnique({
      where: { 
        repositoryId_name: { 
          repositoryId: repoId, 
          name: branchName 
        } 
      }
    });

    if (!branch) {
      throw new NotFoundException(`Branch '${branchName}' not found`);
    }

    return branch;
  }

  private async getBranchWithCommits(repoId: string, branchName: string) {
    return this.getBranch(repoId, branchName);
  }

  private generateCommitHash(data: any): string {
    const content = JSON.stringify({
      content: data.content,
      message: data.message,
      authorId: data.authorId,
      parentId: data.parentId,
      timestamp: data.timestamp.toISOString()
    });

    return crypto.createHash('sha1').update(content).digest('hex');
  }

  private calculateDiff(oldContent: string, newContent: string): Diff {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    const diff = this.myersDiff(oldLines, newLines);
    
    return {
      additions: diff.additions,
      deletions: diff.deletions,
      modifications: diff.modifications,
      hunks: diff.hunks,
      stats: {
        addedLines: diff.additions.reduce((sum, hunk) => sum + hunk.lines.length, 0),
        deletedLines: diff.deletions.reduce((sum, hunk) => sum + hunk.lines.length, 0),
        changedLines: diff.modifications.reduce((sum, hunk) => sum + hunk.lines.length, 0)
      }
    };
  }

  private myersDiff(oldLines: string[], newLines: string[]): Diff {
    // Simplified Myers diff algorithm implementation
    const additions: DiffHunk[] = [];
    const deletions: DiffHunk[] = [];
    const modifications: DiffHunk[] = [];
    const hunks: DiffHunk[] = [];

    let oldIndex = 0;
    let newIndex = 0;

    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      if (oldIndex >= oldLines.length) {
        // Rest are additions
        const hunk: DiffHunk = {
          oldStart: oldIndex,
          oldLines: 0,
          newStart: newIndex,
          newLines: newLines.length - newIndex,
          lines: newLines.slice(newIndex).map((content, i) => ({
            type: 'added' as const,
            content,
            lineNumber: newIndex + i + 1
          }))
        };
        additions.push(hunk);
        hunks.push(hunk);
        break;
      } else if (newIndex >= newLines.length) {
        // Rest are deletions
        const hunk: DiffHunk = {
          oldStart: oldIndex,
          oldLines: oldLines.length - oldIndex,
          newStart: newIndex,
          newLines: 0,
          lines: oldLines.slice(oldIndex).map((content, i) => ({
            type: 'deleted' as const,
            content,
            lineNumber: oldIndex + i + 1
          }))
        };
        deletions.push(hunk);
        hunks.push(hunk);
        break;
      } else if (oldLines[oldIndex] === newLines[newIndex]) {
        // Lines are the same
        oldIndex++;
        newIndex++;
      } else {
        // Lines differ - create modification hunk
        const hunk: DiffHunk = {
          oldStart: oldIndex,
          oldLines: 1,
          newStart: newIndex,
          newLines: 1,
          lines: [
            {
              type: 'deleted',
              content: oldLines[oldIndex],
              lineNumber: oldIndex + 1
            },
            {
              type: 'added',
              content: newLines[newIndex],
              lineNumber: newIndex + 1
            }
          ]
        };
        modifications.push(hunk);
        hunks.push(hunk);
        oldIndex++;
        newIndex++;
      }
    }

    return { additions, deletions, modifications, hunks };
  }

  private async findCommonAncestor(commitId1: string, commitId2: string) {
    // Simplified common ancestor finding
    // In a full implementation, you would use a more sophisticated algorithm
    const commit1History = await this.getCommitAncestors(commitId1);
    const commit2History = await this.getCommitAncestors(commitId2);

    const ancestors1 = new Set(commit1History.map(c => c.id));
    
    for (const commit of commit2History) {
      if (ancestors1.has(commit.id)) {
        return commit;
      }
    }

    return null;
  }

  private async getCommitAncestors(commitId: string) {
    const ancestors = [];
    let currentId = commitId;

    while (currentId) {
      const commit = await this.prisma.promptCommit.findUnique({
        where: { id: currentId }
      });

      if (!commit) break;

      ancestors.push(commit);
      currentId = commit.parentIds?.[0] || null;
    }

    return ancestors;
  }

  private detectConflicts(
    sourceContent: string,
    targetContent: string,
    baseContent: string
  ): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];

    // Simple conflict detection based on content differences
    const sourceLines = sourceContent.split('\n');
    const targetLines = targetContent.split('\n');
    const baseLines = baseContent.split('\n');

    const maxLines = Math.max(sourceLines.length, targetLines.length, baseLines.length);

    for (let i = 0; i < maxLines; i++) {
      const sourceLine = sourceLines[i] || '';
      const targetLine = targetLines[i] || '';
      const baseLine = baseLines[i] || '';

      if (sourceLine !== targetLine && sourceLine !== baseLine && targetLine !== baseLine) {
        conflicts.push({
          type: 'content',
          description: `Conflicting changes at line ${i + 1}`,
          sourceLine: i + 1,
          targetLine: i + 1,
          sourceContent: sourceLine,
          targetContent: targetLine,
          suggestedResolution: this.suggestLineResolution(sourceLine, targetLine, baseLine)
        });
      }
    }

    return conflicts;
  }

  private suggestLineResolution(sourceLine: string, targetLine: string, baseLine: string): string {
    // Simple resolution suggestion
    if (sourceLine.length > targetLine.length) {
      return sourceLine; // Prefer longer version
    } else if (targetLine.length > sourceLine.length) {
      return targetLine;
    } else {
      return `${sourceLine} ${targetLine}`; // Combine both
    }
  }

  private async suggestConflictResolution(conflicts: ConflictInfo[]): Promise<string> {
    return conflicts.map(conflict => 
      `Line ${conflict.sourceLine}: ${conflict.suggestedResolution}`
    ).join('\n');
  }

  private threeWayMerge(base: string, source: string, target: string): string {
    // Simplified three-way merge
    // In a real implementation, you would use a more sophisticated algorithm
    
    if (source === target) {
      return source; // No conflicts
    }

    if (source === base) {
      return target; // Only target changed
    }

    if (target === base) {
      return source; // Only source changed
    }

    // Both changed - simple concatenation for now
    return `${source}\n\n--- MERGED CONTENT ---\n\n${target}`;
  }

  private applyPatch(content: string, diff: Diff): string {
    // Apply diff hunks to content
    let result = content;
    const lines = result.split('\n');

    // Apply additions and modifications
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'added') {
          lines.splice(line.lineNumber - 1, 0, line.content);
        } else if (line.type === 'modified') {
          lines[line.lineNumber - 1] = line.content;
        }
      }
    }

    return lines.join('\n');
  }

  private async getReachableCommits(headCommitId: string): Promise<string[]> {
    const reachable: string[] = [];
    const visited = new Set<string>();
    const queue = [headCommitId];

    while (queue.length > 0) {
      const commitId = queue.shift()!;
      if (visited.has(commitId)) continue;

      visited.add(commitId);
      reachable.push(commitId);

      const commit = await this.prisma.promptCommit.findUnique({
        where: { id: commitId }
      });

      if (commit?.parentIds) {
        queue.push(...commit.parentIds);
      }
    }

    return reachable;
  }

  private async copyRepositoryContent(sourceRepoId: string, targetRepoId: string) {
    // Copy all branches and commits from source to target repository
    const branches = await this.prisma.promptBranch.findMany({
      where: { repositoryId: sourceRepoId }
    });

    const commits = await this.prisma.promptCommit.findMany({
      where: { repositoryId: sourceRepoId }
    });

    // Copy commits first
    for (const commit of commits) {
      await this.prisma.promptCommit.create({
        data: {
          ...commit,
          id: undefined, // Let Prisma generate new ID
          repositoryId: targetRepoId
        }
      });
    }

    // Copy branches
    for (const branch of branches) {
      await this.prisma.promptBranch.create({
        data: {
          ...branch,
          id: undefined, // Let Prisma generate new ID
          repositoryId: targetRepoId
        }
      });
    }
  }
}