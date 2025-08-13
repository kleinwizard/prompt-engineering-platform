import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'provision')
    .default('development'),
  PORT: Joi.number().default(3000),
  
  // Database
  DATABASE_URL: Joi.string().required(),
  
  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional(),
  REDIS_DB: Joi.number().default(0),
  
  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  
  // Encryption
  ENCRYPTION_KEY: Joi.string().length(64).hex().required(),
  
  // CORS
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  
  // Rate limiting
  THROTTLE_SHORT_LIMIT: Joi.number().default(10),
  THROTTLE_MEDIUM_LIMIT: Joi.number().default(50),
  THROTTLE_LONG_LIMIT: Joi.number().default(100),
  
  // Storage
  STORAGE_PROVIDER: Joi.string().valid('local', 's3', 'minio').default('local'),
  LOCAL_UPLOAD_PATH: Joi.string().default('./uploads'),
  S3_REGION: Joi.string().when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  S3_BUCKET: Joi.string().when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  S3_ACCESS_KEY_ID: Joi.string().when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  S3_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 's3',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  MINIO_ENDPOINT: Joi.string().default('http://localhost:9000'),
  MINIO_ACCESS_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 'minio',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  MINIO_SECRET_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 'minio',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  MINIO_BUCKET: Joi.string().default('prompt-platform'),
  
  // Email
  EMAIL_PROVIDER: Joi.string().valid('smtp', 'sendgrid', 'ses').default('smtp'),
  SMTP_HOST: Joi.string().default('localhost'),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SENDGRID_API_KEY: Joi.string().when('EMAIL_PROVIDER', {
    is: 'sendgrid',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  SENDGRID_FROM_EMAIL: Joi.string().email().when('EMAIL_PROVIDER', {
    is: 'sendgrid',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  SES_REGION: Joi.string().default('us-east-1'),
  SES_ACCESS_KEY_ID: Joi.string().when('EMAIL_PROVIDER', {
    is: 'ses',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  SES_SECRET_ACCESS_KEY: Joi.string().when('EMAIL_PROVIDER', {
    is: 'ses',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  SES_FROM_EMAIL: Joi.string().email().when('EMAIL_PROVIDER', {
    is: 'ses',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  
  // Search
  ELASTICSEARCH_URL: Joi.string().default('http://localhost:9200'),
  ELASTICSEARCH_AUTH: Joi.boolean().default(false),
  ELASTICSEARCH_USERNAME: Joi.string().optional(),
  ELASTICSEARCH_PASSWORD: Joi.string().optional(),
  
  // LLM Providers (at least one required)
  OPENAI_API_KEY: Joi.string().optional(),
  OPENAI_ORGANIZATION: Joi.string().optional(),
  ANTHROPIC_API_KEY: Joi.string().optional(),
  GOOGLE_API_KEY: Joi.string().optional(),
  AZURE_OPENAI_API_KEY: Joi.string().optional(),
  AZURE_OPENAI_ENDPOINT: Joi.string().optional(),
  AZURE_OPENAI_API_VERSION: Joi.string().default('2024-02-01'),
  OLLAMA_BASE_URL: Joi.string().default('http://localhost:11434'),
  
  // Analytics
  ANALYTICS_ENABLED: Joi.boolean().default(true),
  ANALYTICS_PROVIDER: Joi.string().valid('internal', 'mixpanel', 'amplitude').default('internal'),
  MIXPANEL_TOKEN: Joi.string().optional(),
  AMPLITUDE_API_KEY: Joi.string().optional(),
  
  // Monitoring
  SENTRY_DSN: Joi.string().optional(),
  PROMETHEUS_ENABLED: Joi.boolean().default(false),
  PROMETHEUS_PORT: Joi.number().default(9090),
  
  // Feature flags
  FEATURE_REGISTRATION: Joi.boolean().default(true),
  FEATURE_SOCIAL_LOGIN: Joi.boolean().default(false),
  FEATURE_TEAMS: Joi.boolean().default(true),
  FEATURE_REALTIME: Joi.boolean().default(true),
  FEATURE_AI_COACHING: Joi.boolean().default(true),
}).custom((obj, helpers) => {
  // Ensure at least one LLM provider is configured
  const llmProviders = [
    obj.OPENAI_API_KEY,
    obj.ANTHROPIC_API_KEY,
    obj.GOOGLE_API_KEY,
    obj.AZURE_OPENAI_API_KEY,
  ].filter(Boolean);
  
  if (llmProviders.length === 0 && obj.NODE_ENV === 'production') {
    return helpers.error('At least one LLM provider API key must be configured');
  }
  
  return obj;
});