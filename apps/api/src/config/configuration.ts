export const configuration = () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  
  // Database
  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production',
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  // JWT
  jwt: {
    secret: process.env.NODE_ENV === 'production' 
      ? (() => {
          if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required in production environment');
          }
          return process.env.JWT_SECRET;
        })()
      : process.env.JWT_SECRET || 'development-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.NODE_ENV === 'production'
      ? (() => {
          if (!process.env.JWT_REFRESH_SECRET) {
            throw new Error('JWT_REFRESH_SECRET is required in production environment');
          }
          return process.env.JWT_REFRESH_SECRET;
        })()
      : process.env.JWT_REFRESH_SECRET || 'development-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // Encryption
  encryption: {
    key: process.env.NODE_ENV === 'production'
      ? (() => {
          if (!process.env.ENCRYPTION_KEY) {
            throw new Error('ENCRYPTION_KEY is required in production environment');
          }
          return process.env.ENCRYPTION_KEY;
        })()
      : process.env.ENCRYPTION_KEY || require('crypto').randomBytes(32).toString('hex'),
    algorithm: 'aes-256-gcm',
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
  },

  // Rate limiting
  throttle: {
    shortLimit: parseInt(process.env.THROTTLE_SHORT_LIMIT || '10', 10),
    mediumLimit: parseInt(process.env.THROTTLE_MEDIUM_LIMIT || '50', 10),
    longLimit: parseInt(process.env.THROTTLE_LONG_LIMIT || '100', 10),
  },

  // File storage
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local', // 'local' | 's3' | 'minio'
    local: {
      uploadPath: process.env.LOCAL_UPLOAD_PATH || './uploads',
    },
    s3: {
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    minio: {
      endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      bucket: process.env.MINIO_BUCKET || 'prompt-platform',
    },
  },

  // Email
  email: {
    provider: process.env.EMAIL_PROVIDER || 'smtp', // 'smtp' | 'sendgrid' | 'ses'
    smtp: {
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY,
      from: process.env.SENDGRID_FROM_EMAIL,
    },
    ses: {
      region: process.env.SES_REGION || 'us-east-1',
      accessKeyId: process.env.SES_ACCESS_KEY_ID,
      secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
      from: process.env.SES_FROM_EMAIL,
    },
  },

  // Search
  elasticsearch: {
    node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    auth: process.env.ELASTICSEARCH_AUTH
      ? {
          username: process.env.ELASTICSEARCH_USERNAME,
          password: process.env.ELASTICSEARCH_PASSWORD,
        }
      : undefined,
  },

  // LLM Providers
  llm: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORGANIZATION,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    google: {
      apiKey: process.env.GOOGLE_API_KEY,
    },
    azure: {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-01',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    },
  },

  // Analytics
  analytics: {
    enabled: process.env.ANALYTICS_ENABLED === 'true',
    provider: process.env.ANALYTICS_PROVIDER || 'internal', // 'internal' | 'mixpanel' | 'amplitude'
    mixpanel: {
      token: process.env.MIXPANEL_TOKEN,
    },
    amplitude: {
      apiKey: process.env.AMPLITUDE_API_KEY,
    },
  },

  // Monitoring
  monitoring: {
    sentry: {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
    },
    prometheus: {
      enabled: process.env.PROMETHEUS_ENABLED === 'true',
      port: parseInt(process.env.PROMETHEUS_PORT || '9090', 10),
    },
  },

  // Feature flags
  features: {
    registration: process.env.FEATURE_REGISTRATION !== 'false',
    socialLogin: process.env.FEATURE_SOCIAL_LOGIN === 'true',
    teamFeatures: process.env.FEATURE_TEAMS !== 'false',
    realTimeCollaboration: process.env.FEATURE_REALTIME === 'true',
    aiCoaching: process.env.FEATURE_AI_COACHING !== 'false',
  },
});