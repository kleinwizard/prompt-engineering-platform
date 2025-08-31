import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

export interface RegionConfig {
  id: string;
  name: string;
  code: string; // us-east-1, eu-west-1, ap-south-1
  location: string;
  dataCenter: string;
  compliance: string[]; // GDPR, HIPAA, SOX, etc.
  database: {
    connectionString: string;
    readReplicas?: string[];
    backupRegion?: string;
  };
  storage: {
    provider: 'aws' | 'gcp' | 'azure';
    bucket: string;
    endpoint: string;
    credentials: any;
  };
  latency: {
    tier: 'low' | 'medium' | 'high';
    averageMs: number;
  };
  isActive: boolean;
  capacity: {
    maxTenants: number;
    currentTenants: number;
    storageLimit: number; // GB
    storageUsed: number; // GB
  };
}

export interface TenantRegionMapping {
  tenantId: string;
  primaryRegion: string;
  backupRegions: string[];
  dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
  complianceRequirements: string[];
  dataTypes: string[];
  migrationHistory: DataMigration[];
  lastValidated: Date;
}

export interface DataMigration {
  id: string;
  tenantId: string;
  fromRegion: string;
  toRegion: string;
  dataTypes: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  progress: number; // 0-100
  estimatedSize: number; // bytes
  actualSize?: number; // bytes
  validationResults?: {
    checksumValid: boolean;
    recordCount: number;
    errors: string[];
  };
  approvals: {
    requestedBy: string;
    approvedBy?: string;
    approvedAt?: Date;
    reason: string;
  };
}

export interface DataGovernancePolicy {
  id: string;
  tenantId?: string; // null for global policies
  name: string;
  description: string;
  rules: DataGovernanceRule[];
  enforcementLevel: 'advisory' | 'warning' | 'blocking';
  complianceFramework: string[];
  isActive: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DataGovernanceRule {
  id: string;
  type: 'residency' | 'retention' | 'access' | 'encryption' | 'transfer';
  condition: {
    dataType?: string[];
    userRole?: string[];
    region?: string[];
    classification?: string[];
  };
  action: {
    allow: boolean;
    requireApproval?: boolean;
    requireEncryption?: boolean;
    allowedRegions?: string[];
    blockedRegions?: string[];
    maxRetentionDays?: number;
  };
  priority: number;
  rationale: string;
}

@Injectable()
export class DataResidencyService {
  private readonly logger = new Logger(DataResidencyService.name);
  private regionClients: Map<string, PrismaClient> = new Map();

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService
  ) {
    this.initializeRegionClients();
  }

  private async initializeRegionClients() {
    const regions = await this.getActiveRegions();
    
    for (const region of regions) {
      try {
        const client = new PrismaClient({
          datasources: {
            db: { url: region.database.connectionString }
          }
        });
        
        await client.$connect();
        this.regionClients.set(region.id, client);
        
        this.logger.log(`Connected to region: ${region.name} (${region.code})`);
      } catch (error) {
        this.logger.error(`Failed to connect to region ${region.name}:`, error);
      }
    }
  }

  async getActiveRegions(): Promise<RegionConfig[]> {
    // In production, this would come from configuration or database
    return [
      {
        id: 'us-east-1',
        name: 'US East (N. Virginia)',
        code: 'us-east-1',
        location: 'United States',
        dataCenter: 'AWS US-East-1',
        compliance: ['SOX', 'CCPA', 'NIST'],
        database: {
          connectionString: this.configService.get('DATABASE_US_EAST'),
          readReplicas: ['us-east-1a', 'us-east-1b'],
          backupRegion: 'us-west-2'
        },
        storage: {
          provider: 'aws',
          bucket: 'prompt-platform-us-east-1',
          endpoint: 's3.us-east-1.amazonaws.com',
          credentials: {}
        },
        latency: { tier: 'low', averageMs: 15 },
        isActive: true,
        capacity: {
          maxTenants: 10000,
          currentTenants: 2500,
          storageLimit: 100000,
          storageUsed: 45000
        }
      },
      {
        id: 'eu-west-1',
        name: 'EU West (Ireland)',
        code: 'eu-west-1',
        location: 'European Union',
        dataCenter: 'AWS EU-West-1',
        compliance: ['GDPR', 'ISO27001', 'SOC2'],
        database: {
          connectionString: this.configService.get('DATABASE_EU_WEST'),
          readReplicas: ['eu-west-1a', 'eu-west-1b'],
          backupRegion: 'eu-central-1'
        },
        storage: {
          provider: 'aws',
          bucket: 'prompt-platform-eu-west-1',
          endpoint: 's3.eu-west-1.amazonaws.com',
          credentials: {}
        },
        latency: { tier: 'medium', averageMs: 25 },
        isActive: true,
        capacity: {
          maxTenants: 8000,
          currentTenants: 1800,
          storageLimit: 80000,
          storageUsed: 32000
        }
      },
      {
        id: 'ap-south-1',
        name: 'Asia Pacific (Mumbai)',
        code: 'ap-south-1',
        location: 'India',
        dataCenter: 'AWS AP-South-1',
        compliance: ['PDPA', 'ISO27001'],
        database: {
          connectionString: this.configService.get('DATABASE_AP_SOUTH'),
          readReplicas: ['ap-south-1a'],
          backupRegion: 'ap-southeast-1'
        },
        storage: {
          provider: 'aws',
          bucket: 'prompt-platform-ap-south-1',
          endpoint: 's3.ap-south-1.amazonaws.com',
          credentials: {}
        },
        latency: { tier: 'medium', averageMs: 35 },
        isActive: true,
        capacity: {
          maxTenants: 5000,
          currentTenants: 800,
          storageLimit: 50000,
          storageUsed: 15000
        }
      }
    ];
  }

  async routeRequest(tenantId: string, operation: string, data?: any): Promise<any> {
    // Get tenant's region mapping
    const mapping = await this.getTenantRegionMapping(tenantId);
    
    if (!mapping) {
      throw new BadRequestException(`No region mapping found for tenant: ${tenantId}`);
    }

    // Validate data governance policies
    await this.validateDataGovernance(tenantId, operation, data, mapping.primaryRegion);

    // Get regional client
    const client = this.regionClients.get(mapping.primaryRegion);
    
    if (!client) {
      throw new BadRequestException(`Region client not available: ${mapping.primaryRegion}`);
    }

    // Execute operation in appropriate region
    return this.executeInRegion(client, operation, data, mapping);
  }

  async getTenantRegionMapping(tenantId: string): Promise<TenantRegionMapping | null> {
    const mapping = await this.prisma.tenantRegionMapping.findUnique({
      where: { tenantId },
      include: {
        migrationHistory: {
          orderBy: { startedAt: 'desc' },
          take: 10
        }
      }
    });

    return mapping as TenantRegionMapping | null;
  }

  async setTenantRegion(
    tenantId: string,
    primaryRegion: string,
    backupRegions: string[] = [],
    dataClassification: TenantRegionMapping['dataClassification'] = 'internal',
    complianceRequirements: string[] = []
  ): Promise<TenantRegionMapping> {
    // Validate region exists and is active
    const regions = await this.getActiveRegions();
    const primaryRegionConfig = regions.find(r => r.id === primaryRegion);
    
    if (!primaryRegionConfig) {
      throw new BadRequestException(`Invalid primary region: ${primaryRegion}`);
    }

    // Check capacity
    if (primaryRegionConfig.capacity.currentTenants >= primaryRegionConfig.capacity.maxTenants) {
      throw new BadRequestException(`Region ${primaryRegion} is at capacity`);
    }

    // Validate compliance requirements match region capabilities
    const missingCompliance = complianceRequirements.filter(
      req => !primaryRegionConfig.compliance.includes(req)
    );
    
    if (missingCompliance.length > 0) {
      throw new BadRequestException(
        `Region ${primaryRegion} does not support required compliance: ${missingCompliance.join(', ')}`
      );
    }

    // Create or update mapping
    const mapping = await this.prisma.tenantRegionMapping.upsert({
      where: { tenantId },
      update: {
        primaryRegion,
        backupRegions,
        dataClassification,
        complianceRequirements,
        lastValidated: new Date()
      },
      create: {
        tenantId,
        primaryRegion,
        backupRegions,
        dataClassification,
        complianceRequirements,
        dataTypes: ['prompts', 'templates', 'user_data'],
        migrationHistory: [],
        lastValidated: new Date()
      }
    });

    // Update region capacity
    await this.updateRegionCapacity(primaryRegion, 1);

    this.logger.log(`Tenant ${tenantId} assigned to region ${primaryRegion}`);
    return mapping as TenantRegionMapping;
  }

  async migrateData(
    tenantId: string,
    fromRegion: string,
    toRegion: string,
    dataTypes: string[],
    requestedBy: string,
    reason: string
  ): Promise<DataMigration> {
    this.logger.log(`Initiating data migration for tenant ${tenantId}: ${fromRegion} -> ${toRegion}`);

    // Validate regions
    const regions = await this.getActiveRegions();
    const sourceRegion = regions.find(r => r.id === fromRegion);
    const targetRegion = regions.find(r => r.id === toRegion);

    if (!sourceRegion || !targetRegion) {
      throw new BadRequestException('Invalid source or target region');
    }

    // Check governance policies
    await this.validateMigrationCompliance(tenantId, fromRegion, toRegion, dataTypes);

    // Estimate data size
    const estimatedSize = await this.estimateDataSize(tenantId, dataTypes, fromRegion);

    // Create migration record
    const migration: DataMigration = {
      id: crypto.randomUUID(),
      tenantId,
      fromRegion,
      toRegion,
      dataTypes,
      status: 'pending',
      startedAt: new Date(),
      progress: 0,
      estimatedSize,
      approvals: {
        requestedBy,
        reason
      }
    };

    // Store migration record
    await this.prisma.dataMigration.create({
      data: migration
    });

    // Start migration process (async)
    this.executeMigration(migration).catch(error => {
      this.logger.error(`Migration failed: ${migration.id}`, error);
    });

    return migration;
  }

  async getMigrationStatus(migrationId: string): Promise<DataMigration> {
    const migration = await this.prisma.dataMigration.findUnique({
      where: { id: migrationId }
    });

    if (!migration) {
      throw new BadRequestException('Migration not found');
    }

    return migration as DataMigration;
  }

  async createDataGovernancePolicy(policy: Omit<DataGovernancePolicy, 'id' | 'createdAt' | 'updatedAt'>): Promise<DataGovernancePolicy> {
    const policyRecord = await this.prisma.dataGovernancePolicy.create({
      data: {
        ...policy,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    this.logger.log(`Data governance policy created: ${policyRecord.id}`);
    return policyRecord as DataGovernancePolicy;
  }

  async getDataGovernancePolicies(tenantId?: string): Promise<DataGovernancePolicy[]> {
    const where = tenantId 
      ? { OR: [{ tenantId }, { tenantId: null }] } // Tenant-specific + global policies
      : { tenantId: null }; // Only global policies

    const policies = await this.prisma.dataGovernancePolicy.findMany({
      where: { ...where, isActive: true },
      orderBy: [
        { tenantId: 'desc' }, // Tenant-specific first
        { priority: 'desc' }
      ]
    });

    return policies as DataGovernancePolicy[];
  }

  async validateDataResidency(tenantId: string, dataType: string, region: string): Promise<{
    allowed: boolean;
    violations: string[];
    recommendations: string[];
  }> {
    const policies = await this.getDataGovernancePolicies(tenantId);
    const mapping = await this.getTenantRegionMapping(tenantId);
    
    const violations: string[] = [];
    const recommendations: string[] = [];

    // Check tenant region mapping
    if (mapping && mapping.primaryRegion !== region && !mapping.backupRegions.includes(region)) {
      violations.push(`Data for tenant ${tenantId} must reside in authorized regions`);
    }

    // Check governance policies
    for (const policy of policies) {
      for (const rule of policy.rules.filter(r => r.type === 'residency')) {
        if (this.ruleApplies(rule, { dataType, region, tenantId })) {
          if (!rule.action.allow) {
            violations.push(`Policy "${policy.name}" blocks ${dataType} in ${region}`);
          }
          
          if (rule.action.blockedRegions?.includes(region)) {
            violations.push(`Policy "${policy.name}" explicitly blocks region ${region}`);
          }
          
          if (rule.action.allowedRegions && !rule.action.allowedRegions.includes(region)) {
            violations.push(`Policy "${policy.name}" requires specific regions`);
            recommendations.push(`Move data to allowed regions: ${rule.action.allowedRegions.join(', ')}`);
          }
        }
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      recommendations
    };
  }

  async getRegionCompliance(regionId: string): Promise<{
    region: RegionConfig;
    compliance: {
      frameworks: string[];
      certifications: string[];
      auditStatus: string;
      lastAudit: Date;
      nextAudit: Date;
    };
    dataProtection: {
      encryptionAtRest: boolean;
      encryptionInTransit: boolean;
      keyManagement: string;
      backupEncryption: boolean;
    };
    access: {
      networkIsolation: boolean;
      accessLogging: boolean;
      adminAccess: string[];
      emergencyAccess: string;
    };
  }> {
    const regions = await this.getActiveRegions();
    const region = regions.find(r => r.id === regionId);

    if (!region) {
      throw new BadRequestException(`Region not found: ${regionId}`);
    }

    // Mock compliance data - in production, this would come from actual compliance systems
    return {
      region,
      compliance: {
        frameworks: region.compliance,
        certifications: ['SOC2 Type II', 'ISO27001', 'PCI DSS'],
        auditStatus: 'compliant',
        lastAudit: new Date('2024-01-15'),
        nextAudit: new Date('2024-07-15')
      },
      dataProtection: {
        encryptionAtRest: true,
        encryptionInTransit: true,
        keyManagement: 'AWS KMS',
        backupEncryption: true
      },
      access: {
        networkIsolation: true,
        accessLogging: true,
        adminAccess: ['ops-team@company.com'],
        emergencyAccess: 'break-glass-procedure'
      }
    };
  }

  async getDataMap(tenantId: string): Promise<{
    tenant: string;
    regions: Array<{
      region: string;
      dataTypes: string[];
      recordCounts: Record<string, number>;
      storageSize: number;
      lastSync: Date;
    }>;
    governance: {
      classification: string;
      policies: string[];
      complianceRequirements: string[];
    };
    flows: Array<{
      from: string;
      to: string;
      dataType: string;
      frequency: string;
      lastTransfer: Date;
    }>;
  }> {
    const mapping = await this.getTenantRegionMapping(tenantId);
    
    if (!mapping) {
      throw new BadRequestException(`No data map available for tenant: ${tenantId}`);
    }

    // Get data distribution across regions
    const regions = [mapping.primaryRegion, ...mapping.backupRegions];
    const regionData = [];

    for (const regionId of regions) {
      const client = this.regionClients.get(regionId);
      if (client) {
        const recordCounts = await this.getRegionRecordCounts(client, tenantId);
        const storageSize = await this.getRegionStorageSize(regionId, tenantId);
        
        regionData.push({
          region: regionId,
          dataTypes: mapping.dataTypes,
          recordCounts,
          storageSize,
          lastSync: new Date()
        });
      }
    }

    return {
      tenant: tenantId,
      regions: regionData,
      governance: {
        classification: mapping.dataClassification,
        policies: await this.getApplicablePolicyNames(tenantId),
        complianceRequirements: mapping.complianceRequirements
      },
      flows: [] // Would track data flows between regions
    };
  }

  // Private helper methods

  private async validateDataGovernance(
    tenantId: string,
    operation: string,
    data: any,
    region: string
  ): Promise<void> {
    const policies = await this.getDataGovernancePolicies(tenantId);
    
    for (const policy of policies) {
      for (const rule of policy.rules) {
        if (this.ruleApplies(rule, { operation, data, region, tenantId })) {
          if (!rule.action.allow) {
            if (policy.enforcementLevel === 'blocking') {
              throw new BadRequestException(`Operation blocked by policy: ${policy.name}`);
            } else {
              this.logger.warn(`Policy violation (${policy.enforcementLevel}): ${policy.name}`);
            }
          }
        }
      }
    }
  }

  private ruleApplies(rule: DataGovernanceRule, context: any): boolean {
    const { condition } = rule;
    
    if (condition.dataType && !condition.dataType.includes(context.dataType)) {
      return false;
    }
    
    if (condition.region && !condition.region.includes(context.region)) {
      return false;
    }
    
    // Add more condition checks as needed
    
    return true;
  }

  private async executeInRegion(
    client: PrismaClient,
    operation: string,
    data: any,
    mapping: TenantRegionMapping
  ): Promise<any> {
    try {
      // Route operation to appropriate region-specific method
      switch (operation) {
        case 'create_prompt':
          return await client.prompt.create({ data });
        case 'get_prompts':
          return await client.prompt.findMany({ where: { userId: data.userId } });
        case 'update_prompt':
          return await client.prompt.update({ where: { id: data.id }, data: data.updates });
        case 'delete_prompt':
          return await client.prompt.delete({ where: { id: data.id } });
        default:
          throw new BadRequestException(`Unsupported operation: ${operation}`);
      }
    } catch (error) {
      this.logger.error(`Region operation failed: ${operation}`, error);
      throw error;
    }
  }

  private async updateRegionCapacity(regionId: string, delta: number): Promise<void> {
    // In production, this would update actual region capacity tracking
    this.logger.debug(`Updating capacity for region ${regionId}: ${delta > 0 ? '+' : ''}${delta}`);
  }

  private async validateMigrationCompliance(
    tenantId: string,
    fromRegion: string,
    toRegion: string,
    dataTypes: string[]
  ): Promise<void> {
    const policies = await this.getDataGovernancePolicies(tenantId);
    
    for (const policy of policies) {
      for (const rule of policy.rules.filter(r => r.type === 'transfer')) {
        if (rule.action.blockedRegions?.includes(toRegion)) {
          throw new BadRequestException(`Migration to ${toRegion} blocked by policy: ${policy.name}`);
        }
        
        if (rule.action.requireApproval) {
          // In production, this would check for proper approvals
          this.logger.warn(`Migration requires approval per policy: ${policy.name}`);
        }
      }
    }
  }

  private async estimateDataSize(
    tenantId: string,
    dataTypes: string[],
    region: string
  ): Promise<number> {
    const client = this.regionClients.get(region);
    if (!client) return 0;

    // Estimate data size for migration
    let totalSize = 0;
    
    for (const dataType of dataTypes) {
      const count = await this.getDataTypeCount(client, tenantId, dataType);
      totalSize += count * this.getAverageRecordSize(dataType);
    }
    
    return totalSize;
  }

  private async getDataTypeCount(client: PrismaClient, tenantId: string, dataType: string): Promise<number> {
    switch (dataType) {
      case 'prompts':
        return await client.prompt.count({ where: { userId: tenantId } });
      case 'templates':
        return await client.template.count({ where: { userId: tenantId } });
      case 'user_data':
        return await client.user.count({ where: { tenantId } });
      default:
        return 0;
    }
  }

  private getAverageRecordSize(dataType: string): number {
    // Average record sizes in bytes
    const sizes = {
      prompts: 2048,
      templates: 4096,
      user_data: 1024,
      audit_logs: 512
    };
    
    return sizes[dataType] || 1024;
  }

  private async executeMigration(migration: DataMigration): Promise<void> {
    try {
      await this.prisma.dataMigration.update({
        where: { id: migration.id },
        data: { status: 'in_progress', progress: 0 }
      });

      const sourceClient = this.regionClients.get(migration.fromRegion);
      const targetClient = this.regionClients.get(migration.toRegion);

      if (!sourceClient || !targetClient) {
        throw new Error('Source or target region client not available');
      }

      let totalRecords = 0;
      let migratedRecords = 0;

      // Count total records to migrate
      for (const dataType of migration.dataTypes) {
        totalRecords += await this.getDataTypeCount(sourceClient, migration.tenantId, dataType);
      }

      // Migrate each data type
      for (const dataType of migration.dataTypes) {
        const records = await this.getDataTypeRecords(sourceClient, migration.tenantId, dataType);
        
        for (const record of records) {
          await this.migrateRecord(targetClient, dataType, record);
          migratedRecords++;
          
          const progress = Math.round((migratedRecords / totalRecords) * 100);
          
          if (progress % 10 === 0) { // Update progress every 10%
            await this.prisma.dataMigration.update({
              where: { id: migration.id },
              data: { progress }
            });
          }
        }
      }

      // Validate migration
      const validationResults = await this.validateMigration(migration, sourceClient, targetClient);

      // Complete migration
      await this.prisma.dataMigration.update({
        where: { id: migration.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: 100,
          actualSize: migration.estimatedSize, // Simplified
          validationResults
        }
      });

      // Update tenant region mapping
      await this.prisma.tenantRegionMapping.update({
        where: { tenantId: migration.tenantId },
        data: { primaryRegion: migration.toRegion }
      });

      this.logger.log(`Migration completed: ${migration.id}`);

    } catch (error) {
      await this.prisma.dataMigration.update({
        where: { id: migration.id },
        data: { 
          status: 'failed',
          validationResults: {
            checksumValid: false,
            recordCount: 0,
            errors: [error.message]
          }
        }
      });

      this.logger.error(`Migration failed: ${migration.id}`, error);
      throw error;
    }
  }

  private async getDataTypeRecords(client: PrismaClient, tenantId: string, dataType: string): Promise<any[]> {
    switch (dataType) {
      case 'prompts':
        return await client.prompt.findMany({ where: { userId: tenantId } });
      case 'templates':
        return await client.template.findMany({ where: { userId: tenantId } });
      case 'user_data':
        return await client.user.findMany({ where: { tenantId } });
      default:
        return [];
    }
  }

  private async migrateRecord(client: PrismaClient, dataType: string, record: any): Promise<void> {
    const { id, ...data } = record;
    
    switch (dataType) {
      case 'prompts':
        await client.prompt.create({ data });
        break;
      case 'templates':
        await client.template.create({ data });
        break;
      case 'user_data':
        await client.user.create({ data });
        break;
    }
  }

  private async validateMigration(
    migration: DataMigration,
    sourceClient: PrismaClient,
    targetClient: PrismaClient
  ): Promise<any> {
    const results = {
      checksumValid: true,
      recordCount: 0,
      errors: []
    };

    try {
      for (const dataType of migration.dataTypes) {
        const sourceCount = await this.getDataTypeCount(sourceClient, migration.tenantId, dataType);
        const targetCount = await this.getDataTypeCount(targetClient, migration.tenantId, dataType);
        
        if (sourceCount !== targetCount) {
          results.checksumValid = false;
          results.errors.push(`Record count mismatch for ${dataType}: ${sourceCount} vs ${targetCount}`);
        }
        
        results.recordCount += targetCount;
      }
    } catch (error) {
      results.checksumValid = false;
      results.errors.push(`Validation error: ${error.message}`);
    }

    return results;
  }

  private async getRegionRecordCounts(client: PrismaClient, tenantId: string): Promise<Record<string, number>> {
    const counts = {};
    
    try {
      counts['prompts'] = await client.prompt.count({ where: { userId: tenantId } });
      counts['templates'] = await client.template.count({ where: { userId: tenantId } });
      counts['workflows'] = await client.promptWorkflow.count({ where: { userId: tenantId } });
    } catch (error) {
      this.logger.error('Error getting region record counts:', error);
    }
    
    return counts;
  }

  private async getRegionStorageSize(regionId: string, tenantId: string): Promise<number> {
    // In production, this would query actual storage metrics
    return Math.floor(Math.random() * 10000000); // Mock data in bytes
  }

  private async getApplicablePolicyNames(tenantId: string): Promise<string[]> {
    const policies = await this.getDataGovernancePolicies(tenantId);
    return policies.map(p => p.name);
  }
}