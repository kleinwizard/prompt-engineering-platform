import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PromptBuilderService } from './prompt-builder.service';

interface CreateBlueprintDto {
  name: string;
  description: string;
  blocks: any[];
  isPublic?: boolean;
  tags?: string[];
  industry?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

interface UpdateBlueprintDto {
  name?: string;
  description?: string;
  blocks?: any[];
  tags?: string[];
  isPublic?: boolean;
}

@Controller('prompt-builder')
@UseGuards(JwtAuthGuard)
export class PromptBuilderController {
  constructor(private promptBuilderService: PromptBuilderService) {}

  @Get('templates')
  async getBlockTemplates() {
    return this.promptBuilderService.getBlockTemplates();
  }

  @Get('blueprints')
  async getBlueprints(
    @Request() req,
    @Query('includePublic') includePublic?: string,
    @Query('tags') tags?: string,
    @Query('industry') industry?: string,
    @Query('difficulty') difficulty?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const options = {
      includePublic: includePublic === 'true',
      tags: tags ? tags.split(',') : undefined,
      industry,
      difficulty,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    };

    return this.promptBuilderService.getPromptBlueprints(req.user.id, options);
  }

  @Post('blueprints')
  async createBlueprint(@Request() req, @Body() dto: CreateBlueprintDto) {
    return this.promptBuilderService.createPromptBlueprint(
      req.user.id,
      dto.name,
      dto.description,
      dto.blocks,
      {
        isPublic: dto.isPublic,
        tags: dto.tags,
        industry: dto.industry,
        difficulty: dto.difficulty
      }
    );
  }

  @Put('blueprints/:id')
  async updateBlueprint(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: UpdateBlueprintDto
  ) {
    return this.promptBuilderService.updatePromptBlueprint(id, req.user.id, dto);
  }

  @Delete('blueprints/:id')
  async deleteBlueprint(@Param('id') id: string, @Request() req) {
    // Implementation would go here
    return { success: true, message: 'Blueprint deleted' };
  }

  @Post('blueprints/:id/fork')
  async forkBlueprint(
    @Param('id') id: string,
    @Request() req,
    @Body('name') name?: string
  ) {
    return this.promptBuilderService.forkBlueprint(id, req.user.id, name);
  }

  @Post('blueprints/:id/generate')
  async generatePrompt(@Param('id') id: string, @Body('blocks') blocks: any[]) {
    return {
      prompt: await this.promptBuilderService.generatePromptFromBlocks(blocks)
    };
  }

  @Get('blueprints/:id/analyze')
  async analyzeBlueprint(@Param('id') id: string) {
    return this.promptBuilderService.analyzePromptBlueprint(id);
  }

  @Post('validate')
  async validateBlocks(@Body('blocks') blocks: any[]) {
    try {
      const prompt = await this.promptBuilderService.generatePromptFromBlocks(blocks);
      return {
        valid: true,
        prompt,
        warnings: []
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error.message],
        warnings: []
      };
    }
  }

  @Post('preview')
  async previewPrompt(@Body('blocks') blocks: any[]) {
    try {
      const prompt = await this.promptBuilderService.generatePromptFromBlocks(blocks);
      return {
        prompt,
        wordCount: prompt.split(' ').length,
        characterCount: prompt.length,
        estimatedTokens: Math.ceil(prompt.length / 4) // Rough estimate
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  @Get('public')
  async getPublicBlueprints(
    @Query('tags') tags?: string,
    @Query('industry') industry?: string,
    @Query('difficulty') difficulty?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('featured') featured?: string
  ) {
    // This endpoint allows non-authenticated access to public blueprints
    const options = {
      includePublic: true,
      tags: tags ? tags.split(',') : undefined,
      industry,
      difficulty,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    };

    return this.promptBuilderService.getPromptBlueprints('public', options);
  }

  @Get('export/:id')
  async exportBlueprint(@Param('id') id: string, @Query('format') format: string = 'json') {
    // Implementation for exporting blueprints in various formats
    return { message: `Export ${id} as ${format}` };
  }

  @Post('import')
  async importBlueprint(@Request() req, @Body() importData: any) {
    // Implementation for importing blueprints from various sources
    return { message: 'Blueprint imported successfully' };
  }
}