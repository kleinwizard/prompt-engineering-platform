import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Strategy as SamlStrategy } from 'passport-saml';
import { Strategy as OIDCStrategy } from 'passport-oidc';
import * as ldap from 'ldapjs';

interface SAMLConfig {
  entryPoint: string;
  issuer: string;
  callbackUrl: string;
  certificate: string;
  signatureAlgorithm?: string;
  identifierFormat?: string;
  wantAssertionsSigned?: boolean;
  wantAuthnResponseSigned?: boolean;
  attributeMapping?: {
    email: string;
    firstName: string;
    lastName: string;
    groups?: string;
  };
}

interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationURL: string;
  tokenURL: string;
  userInfoURL: string;
  callbackURL: string;
  scope: string[];
  attributeMapping?: {
    email: string;
    firstName: string;
    lastName: string;
    groups?: string;
  };
}

interface LDAPConfig {
  url: string;
  bindDN: string;
  bindPassword: string;
  searchBase: string;
  searchFilter: string;
  attributes: string[];
  tlsOptions?: {
    rejectUnauthorized: boolean;
    ca?: string[];
  };
  groupSearchBase?: string;
  groupSearchFilter?: string;
}

interface SSOUser {
  email: string;
  firstName: string;
  lastName: string;
  groups?: string[];
  attributes?: Record<string, any>;
  provider: 'saml' | 'oidc' | 'ldap';
  tenantId: string;
}

@Injectable()
export class SSOService {
  private readonly logger = new Logger(SSOService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService
  ) {}

  async configureSAML(tenantId: string, config: SAMLConfig): Promise<SamlStrategy> {
    this.logger.log(`Configuring SAML for tenant: ${tenantId}`);

    // Validate configuration
    this.validateSAMLConfig(config);

    // Create SAML strategy
    const samlStrategy = new SamlStrategy({
      callbackUrl: config.callbackUrl,
      entryPoint: config.entryPoint,
      issuer: config.issuer,
      cert: config.certificate,
      identifierFormat: config.identifierFormat || 'urn:oasis:names:tc:SAML:2.0:nameid-format:email',
      signatureAlgorithm: config.signatureAlgorithm || 'sha256',
      wantAssertionsSigned: config.wantAssertionsSigned !== false,
      wantAuthnResponseSigned: config.wantAuthnResponseSigned !== false,
      validateInResponseTo: true,
      passReqToCallback: true
    }, async (req: any, profile: any, done: any) => {
      try {
        const user = await this.processSAMLUser(profile, tenantId, config.attributeMapping);
        done(null, user);
      } catch (error) {
        done(error, null);
      }
    });

    // Store configuration
    await this.storeSSOConfiguration(tenantId, 'saml', config);

    this.logger.log(`SAML configured successfully for tenant: ${tenantId}`);
    return samlStrategy;
  }

  async configureOIDC(tenantId: string, config: OIDCConfig): Promise<OIDCStrategy> {
    this.logger.log(`Configuring OIDC for tenant: ${tenantId}`);

    // Validate configuration
    this.validateOIDCConfig(config);

    // Create OIDC strategy
    const oidcStrategy = new OIDCStrategy({
      issuer: config.issuer,
      authorizationURL: config.authorizationURL,
      tokenURL: config.tokenURL,
      userInfoURL: config.userInfoURL,
      clientID: config.clientId,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackURL,
      scope: config.scope.join(' ')
    }, async (issuer: string, sub: string, profile: any, accessToken: string, refreshToken: string, done: any) => {
      try {
        const user = await this.processOIDCUser(profile, tenantId, config.attributeMapping);
        done(null, user);
      } catch (error) {
        done(error, null);
      }
    });

    // Store configuration
    await this.storeSSOConfiguration(tenantId, 'oidc', config);

    this.logger.log(`OIDC configured successfully for tenant: ${tenantId}`);
    return oidcStrategy;
  }

  async configureLDAP(tenantId: string, config: LDAPConfig): Promise<void> {
    this.logger.log(`Configuring LDAP for tenant: ${tenantId}`);

    // Validate configuration by testing connection
    await this.testLDAPConnection(config);

    // Store configuration
    await this.storeSSOConfiguration(tenantId, 'ldap', config);

    this.logger.log(`LDAP configured successfully for tenant: ${tenantId}`);
  }

  async authenticateLDAP(tenantId: string, username: string, password: string): Promise<SSOUser> {
    const config = await this.getSSOConfiguration(tenantId, 'ldap') as LDAPConfig;
    
    if (!config) {
      throw new BadRequestException('LDAP not configured for this tenant');
    }

    // Create LDAP client
    const client = ldap.createClient({
      url: config.url,
      tlsOptions: config.tlsOptions
    });

    try {
      // Bind with service account
      await new Promise((resolve, reject) => {
        client.bind(config.bindDN, config.bindPassword, (err) => {
          if (err) reject(err);
          else resolve(null);
        });
      });

      // Search for user
      const searchFilter = config.searchFilter.replace('{{username}}', username);
      const searchResult = await new Promise<any>((resolve, reject) => {
        client.search(config.searchBase, {
          filter: searchFilter,
          attributes: config.attributes,
          scope: 'sub'
        }, (err, res) => {
          if (err) {
            reject(err);
            return;
          }

          const entries: any[] = [];
          res.on('searchEntry', (entry) => {
            entries.push(entry.object);
          });

          res.on('end', () => {
            resolve(entries[0] || null);
          });

          res.on('error', reject);
        });
      });

      if (!searchResult) {
        throw new BadRequestException('User not found');
      }

      // Authenticate user
      await new Promise((resolve, reject) => {
        client.bind(searchResult.dn, password, (err) => {
          if (err) reject(new BadRequestException('Invalid credentials'));
          else resolve(null);
        });
      });

      // Get user groups if configured
      let groups: string[] = [];
      if (config.groupSearchBase && config.groupSearchFilter) {
        groups = await this.getUserGroups(client, config, searchResult.dn);
      }

      return {
        email: searchResult.mail || searchResult.email,
        firstName: searchResult.givenName || searchResult.firstName || '',
        lastName: searchResult.sn || searchResult.lastName || '',
        groups,
        attributes: searchResult,
        provider: 'ldap',
        tenantId
      };

    } finally {
      client.unbind();
    }
  }

  async getSSOConfiguration(tenantId: string, type: 'saml' | 'oidc' | 'ldap') {
    const config = await this.prisma.ssoConfiguration.findFirst({
      where: {
        tenantId,
        type,
        enabled: true
      }
    });

    return config?.configuration || null;
  }

  async updateSSOConfiguration(
    tenantId: string,
    type: 'saml' | 'oidc' | 'ldap',
    config: any
  ) {
    // Validate based on type
    switch (type) {
      case 'saml':
        this.validateSAMLConfig(config);
        break;
      case 'oidc':
        this.validateOIDCConfig(config);
        break;
      case 'ldap':
        await this.testLDAPConnection(config);
        break;
    }

    // Update configuration
    await this.prisma.ssoConfiguration.upsert({
      where: {
        tenantId_type: {
          tenantId,
          type
        }
      },
      update: {
        configuration: config,
        updatedAt: new Date()
      },
      create: {
        tenantId,
        type,
        configuration: config,
        enabled: true
      }
    });

    this.logger.log(`SSO configuration updated for tenant: ${tenantId}, type: ${type}`);
  }

  async enableSSO(tenantId: string, type: 'saml' | 'oidc' | 'ldap') {
    await this.prisma.ssoConfiguration.updateMany({
      where: { tenantId, type },
      data: { enabled: true }
    });
  }

  async disableSSO(tenantId: string, type: 'saml' | 'oidc' | 'ldap') {
    await this.prisma.ssoConfiguration.updateMany({
      where: { tenantId, type },
      data: { enabled: false }
    });
  }

  async getSSOStatus(tenantId: string) {
    const configurations = await this.prisma.ssoConfiguration.findMany({
      where: { tenantId },
      select: {
        type: true,
        enabled: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return {
      configured: configurations.map(config => ({
        type: config.type,
        enabled: config.enabled,
        configuredAt: config.createdAt,
        lastUpdated: config.updatedAt
      })),
      available: ['saml', 'oidc', 'ldap'],
      defaultLoginMethod: await this.getDefaultLoginMethod(tenantId)
    };
  }

  async setDefaultLoginMethod(tenantId: string, method: 'local' | 'saml' | 'oidc' | 'ldap') {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { defaultLoginMethod: method }
    });
  }

  async getDefaultLoginMethod(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultLoginMethod: true }
    });

    return tenant?.defaultLoginMethod || 'local';
  }

  async mapUserAttributes(
    provider: 'saml' | 'oidc' | 'ldap',
    attributes: any,
    mapping?: any
  ): Promise<Partial<SSOUser>> {
    const defaultMappings = {
      saml: {
        email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
        firstName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
        lastName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
        groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'
      },
      oidc: {
        email: 'email',
        firstName: 'given_name',
        lastName: 'family_name',
        groups: 'groups'
      },
      ldap: {
        email: 'mail',
        firstName: 'givenName',
        lastName: 'sn',
        groups: 'memberOf'
      }
    };

    const actualMapping = { ...defaultMappings[provider], ...mapping };

    return {
      email: this.getAttributeValue(attributes, actualMapping.email),
      firstName: this.getAttributeValue(attributes, actualMapping.firstName),
      lastName: this.getAttributeValue(attributes, actualMapping.lastName),
      groups: this.getAttributeValue(attributes, actualMapping.groups, [])
    };
  }

  async provisionUser(ssoUser: SSOUser): Promise<any> {
    this.logger.log(`Provisioning SSO user: ${ssoUser.email}`);

    // Check if user already exists
    let user = await this.prisma.user.findUnique({
      where: { email: ssoUser.email }
    });

    if (user) {
      // Update existing user
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: ssoUser.firstName,
          lastName: ssoUser.lastName,
          lastLoginAt: new Date(),
          ssoProvider: ssoUser.provider,
          ssoAttributes: ssoUser.attributes
        }
      });
    } else {
      // Create new user
      user = await this.prisma.user.create({
        data: {
          email: ssoUser.email,
          username: this.generateUsername(ssoUser.email),
          firstName: ssoUser.firstName,
          lastName: ssoUser.lastName,
          emailVerified: true, // SSO users are pre-verified
          ssoProvider: ssoUser.provider,
          ssoAttributes: ssoUser.attributes,
          tenantId: ssoUser.tenantId
        }
      });
    }

    // Update group memberships
    if (ssoUser.groups?.length) {
      await this.updateUserGroups(user.id, ssoUser.groups, ssoUser.tenantId);
    }

    // Create SSO session
    await this.createSSOSession(user.id, ssoUser.provider, ssoUser.tenantId);

    return user;
  }

  // Private helper methods

  private validateSAMLConfig(config: SAMLConfig) {
    const required = ['entryPoint', 'issuer', 'certificate'];
    for (const field of required) {
      if (!config[field]) {
        throw new BadRequestException(`SAML configuration missing required field: ${field}`);
      }
    }
  }

  private validateOIDCConfig(config: OIDCConfig) {
    const required = ['issuer', 'clientId', 'clientSecret', 'authorizationURL', 'tokenURL'];
    for (const field of required) {
      if (!config[field]) {
        throw new BadRequestException(`OIDC configuration missing required field: ${field}`);
      }
    }
  }

  private async testLDAPConnection(config: LDAPConfig) {
    const client = ldap.createClient({
      url: config.url,
      tlsOptions: config.tlsOptions
    });

    try {
      await new Promise((resolve, reject) => {
        client.bind(config.bindDN, config.bindPassword, (err) => {
          if (err) reject(new BadRequestException('LDAP connection test failed: ' + err.message));
          else resolve(null);
        });
      });
    } finally {
      client.unbind();
    }
  }

  private async storeSSOConfiguration(tenantId: string, type: string, config: any) {
    await this.prisma.ssoConfiguration.upsert({
      where: {
        tenantId_type: {
          tenantId,
          type
        }
      },
      update: {
        configuration: config,
        enabled: true,
        updatedAt: new Date()
      },
      create: {
        tenantId,
        type,
        configuration: config,
        enabled: true
      }
    });
  }

  private async processSAMLUser(profile: any, tenantId: string, mapping?: any): Promise<SSOUser> {
    const mappedAttributes = await this.mapUserAttributes('saml', profile, mapping);
    
    return {
      email: mappedAttributes.email!,
      firstName: mappedAttributes.firstName || '',
      lastName: mappedAttributes.lastName || '',
      groups: mappedAttributes.groups || [],
      attributes: profile,
      provider: 'saml',
      tenantId
    };
  }

  private async processOIDCUser(profile: any, tenantId: string, mapping?: any): Promise<SSOUser> {
    const mappedAttributes = await this.mapUserAttributes('oidc', profile._json, mapping);
    
    return {
      email: mappedAttributes.email!,
      firstName: mappedAttributes.firstName || '',
      lastName: mappedAttributes.lastName || '',
      groups: mappedAttributes.groups || [],
      attributes: profile._json,
      provider: 'oidc',
      tenantId
    };
  }

  private async getUserGroups(client: any, config: LDAPConfig, userDN: string): Promise<string[]> {
    if (!config.groupSearchBase || !config.groupSearchFilter) {
      return [];
    }

    const searchFilter = config.groupSearchFilter.replace('{{userDN}}', userDN);
    
    return new Promise((resolve, reject) => {
      client.search(config.groupSearchBase, {
        filter: searchFilter,
        attributes: ['cn'],
        scope: 'sub'
      }, (err: any, res: any) => {
        if (err) {
          reject(err);
          return;
        }

        const groups: string[] = [];
        res.on('searchEntry', (entry: any) => {
          groups.push(entry.object.cn);
        });

        res.on('end', () => {
          resolve(groups);
        });

        res.on('error', reject);
      });
    });
  }

  private getAttributeValue(attributes: any, path: string, defaultValue?: any): any {
    if (!attributes || !path) return defaultValue;

    // Handle nested attributes
    const keys = path.split('.');
    let value = attributes;

    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) return defaultValue;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.length === 1 ? value[0] : value;
    }

    return value || defaultValue;
  }

  private generateUsername(email: string): string {
    const localPart = email.split('@')[0];
    return localPart.replace(/[^a-zA-Z0-9]/g, '') + Math.random().toString(36).substr(2, 4);
  }

  private async updateUserGroups(userId: string, groups: string[], tenantId: string) {
    // Remove existing group memberships
    await this.prisma.userGroup.deleteMany({
      where: { userId }
    });

    // Add new group memberships
    for (const groupName of groups) {
      // Find or create group
      const group = await this.prisma.group.upsert({
        where: {
          tenantId_name: {
            tenantId,
            name: groupName
          }
        },
        update: {},
        create: {
          tenantId,
          name: groupName,
          description: `Auto-created group from SSO: ${groupName}`,
          type: 'sso'
        }
      });

      // Add user to group
      await this.prisma.userGroup.create({
        data: {
          userId,
          groupId: group.id
        }
      });
    }
  }

  private async createSSOSession(userId: string, provider: string, tenantId: string) {
    await this.prisma.ssoSession.create({
      data: {
        userId,
        provider,
        tenantId,
        sessionId: this.generateSessionId(),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000) // 8 hours
      }
    });
  }

  private generateSessionId(): string {
    return 'sso_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  }
}