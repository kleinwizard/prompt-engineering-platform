import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as sharp from 'sharp';

interface UploadOptions {
  allowedTypes?: string[];
  maxSize?: number;
  resize?: {
    width?: number;
    height?: number;
    quality?: number;
  };
  generateThumbnail?: boolean;
  bucket?: string;
  acl?: 'private' | 'public-read' | 'public-read-write';
}

interface FileMetadata {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  bucket: string;
  key: string;
  hash: string;
  uploadedBy: string;
  uploadedAt: Date;
  expiresAt?: Date;
}

interface StorageStats {
  totalFiles: number;
  totalSize: number;
  usageByType: Record<string, { count: number; size: number }>;
  usageByUser: Record<string, { count: number; size: number }>;
  monthlyUploads: Array<{ month: string; count: number; size: number }>;
}

interface ImageProcessingOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
  fit?: 'contain' | 'cover' | 'fill' | 'inside' | 'outside';
  background?: string;
  grayscale?: boolean;
  blur?: number;
  sharpen?: boolean;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly uploadPath: string;
  private readonly publicPath: string;
  private readonly maxFileSize: number;
  private readonly allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  private readonly allowedDocumentTypes = ['application/pdf', 'text/plain', 'text/markdown'];

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.uploadPath = this.configService.get('UPLOAD_PATH', './uploads');
    this.publicPath = this.configService.get('PUBLIC_PATH', '/uploads');
    this.maxFileSize = this.configService.get('MAX_FILE_SIZE', 50 * 1024 * 1024); // 50MB

    // Ensure upload directories exist
    this.ensureDirectories();
  }

  async uploadFile(
    file: Buffer | string,
    originalName: string,
    mimeType: string,
    userId: string,
    options: UploadOptions = {},
  ): Promise<FileMetadata> {
    const {
      allowedTypes = [...this.allowedImageTypes, ...this.allowedDocumentTypes],
      maxSize = this.maxFileSize,
      resize,
      generateThumbnail = false,
      bucket = 'default',
      acl = 'private',
    } = options;

    // Validate file type
    if (!allowedTypes.includes(mimeType)) {
      throw new BadRequestException(`File type ${mimeType} is not allowed`);
    }

    // Parse file data
    let fileBuffer: Buffer;
    if (typeof file === 'string') {
      // Handle base64 data
      const base64Data = file.replace(/^data:[^;]+;base64,/, '');
      fileBuffer = Buffer.from(base64Data, 'base64');
    } else {
      fileBuffer = file;
    }

    // Validate file size
    if (fileBuffer.length > maxSize) {
      throw new BadRequestException(`File size exceeds limit of ${maxSize} bytes`);
    }

    // Generate file hash for deduplication
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // Check for existing file with same hash
    const existingFile = await this.prisma.file.findUnique({
      where: { hash },
    });

    if (existingFile) {
      // Return existing file metadata
      return this.formatFileMetadata(existingFile);
    }

    // Generate unique filename
    const extension = path.extname(originalName) || this.getExtensionFromMimeType(mimeType);
    const filename = `${crypto.randomUUID()}${extension}`;
    const key = `${bucket}/${filename}`;
    const filePath = path.join(this.uploadPath, bucket, filename);

    // Process image if needed
    let processedBuffer = fileBuffer;
    let thumbnailBuffer: Buffer | null = null;

    if (this.isImage(mimeType)) {
      if (resize) {
        processedBuffer = await this.processImage(fileBuffer, resize);
      }

      if (generateThumbnail) {
        thumbnailBuffer = await this.generateThumbnail(fileBuffer);
      }
    }

    // Ensure bucket directory exists
    await this.ensureBucketDirectory(bucket);

    // Save main file
    await fs.writeFile(filePath, processedBuffer);
    
    // Save thumbnail if generated
    let thumbnailKey: string | null = null;
    if (thumbnailBuffer) {
      const thumbnailFilename = `thumb_${filename}`;
      thumbnailKey = `${bucket}/${thumbnailFilename}`;
      const thumbnailPath = path.join(this.uploadPath, bucket, thumbnailFilename);
      await fs.writeFile(thumbnailPath, thumbnailBuffer);
    }

    // Save metadata to database
    const fileRecord = await this.prisma.file.create({
      data: {
        filename,
        originalName,
        mimeType,
        size: processedBuffer.length,
        bucket,
        key,
        hash,
        thumbnailKey,
        uploadedBy: userId,
        acl,
        metadata: {
          originalSize: fileBuffer.length,
          processed: resize ? true : false,
          processingOptions: resize || null,
        },
      },
    });

    // Track analytics
    await this.trackStorageAnalytics('file.uploaded', {
      userId,
      fileId: fileRecord.id,
      mimeType,
      size: processedBuffer.length,
      bucket,
      processed: !!resize,
    });

    this.logger.log(`File uploaded: ${filename} by user ${userId}`);

    return this.formatFileMetadata(fileRecord);
  }

  async uploadBase64Image(
    base64Data: string,
    key: string,
    userId?: string,
    options: ImageProcessingOptions = {},
  ): Promise<string> {
    // Extract mime type and data
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new BadRequestException('Invalid base64 image data');
    }

    const mimeType = matches[1];
    const imageData = matches[2];

    if (!this.isImage(mimeType)) {
      throw new BadRequestException('Invalid image type');
    }

    const buffer = Buffer.from(imageData, 'base64');
    
    // Process image with options
    const processedBuffer = await this.processImage(buffer, options);

    // Generate filename from key
    const extension = this.getExtensionFromMimeType(mimeType);
    const filename = `${key}${extension}`;
    const bucket = 'images';
    const filePath = path.join(this.uploadPath, bucket, filename);

    // Ensure directory exists
    await this.ensureBucketDirectory(bucket);

    // Save file
    await fs.writeFile(filePath, processedBuffer);

    // Generate URL
    const url = `${this.publicPath}/${bucket}/${filename}`;

    // Save metadata if userId provided
    if (userId) {
      const hash = crypto.createHash('sha256').update(processedBuffer).digest('hex');
      
      await this.prisma.file.create({
        data: {
          filename,
          originalName: filename,
          mimeType,
          size: processedBuffer.length,
          bucket,
          key: `${bucket}/${filename}`,
          hash,
          uploadedBy: userId,
          acl: 'public-read',
          metadata: {
            originalSize: buffer.length,
            processed: true,
            processingOptions: options,
          },
        },
      });

      // Track analytics
      await this.trackStorageAnalytics('image.base64_uploaded', {
        userId,
        key,
        size: processedBuffer.length,
        mimeType,
      });
    }

    this.logger.log(`Base64 image uploaded: ${filename}`);
    
    return url;
  }

  async getFile(fileId: string, userId?: string): Promise<FileMetadata> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new BadRequestException('File not found');
    }

    // Check access permissions
    if (file.acl === 'private' && file.uploadedBy !== userId) {
      throw new BadRequestException('Access denied');
    }

    // Track file access
    if (userId) {
      await this.trackStorageAnalytics('file.accessed', {
        userId,
        fileId,
        mimeType: file.mimeType,
      });
    }

    return this.formatFileMetadata(file);
  }

  async getFileBuffer(fileId: string, userId?: string): Promise<Buffer> {
    const fileMetadata = await this.getFile(fileId, userId);
    const filePath = path.join(this.uploadPath, fileMetadata.bucket, fileMetadata.filename);
    
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      this.logger.error(`Failed to read file: ${filePath}`, error);
      throw new BadRequestException('File not accessible');
    }
  }

  async deleteFile(fileId: string, userId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new BadRequestException('File not found');
    }

    if (file.uploadedBy !== userId) {
      throw new BadRequestException('Access denied');
    }

    // Delete physical files
    const filePath = path.join(this.uploadPath, file.bucket, file.filename);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      this.logger.warn(`Failed to delete file: ${filePath}`, error);
    }

    // Delete thumbnail if exists
    if (file.thumbnailKey) {
      const thumbnailPath = path.join(this.uploadPath, file.bucket, `thumb_${file.filename}`);
      try {
        await fs.unlink(thumbnailPath);
      } catch (error) {
        this.logger.warn(`Failed to delete thumbnail: ${thumbnailPath}`, error);
      }
    }

    // Delete from database
    await this.prisma.file.delete({
      where: { id: fileId },
    });

    // Track analytics
    await this.trackStorageAnalytics('file.deleted', {
      userId,
      fileId,
      mimeType: file.mimeType,
      size: file.size,
    });

    this.logger.log(`File deleted: ${file.filename} by user ${userId}`);
  }

  async getUserFiles(
    userId: string,
    page = 1,
    limit = 20,
    mimeTypeFilter?: string,
  ): Promise<{
    files: FileMetadata[];
    total: number;
    totalSize: number;
  }> {
    const skip = (page - 1) * limit;
    
    const where = {
      uploadedBy: userId,
      ...(mimeTypeFilter ? { mimeType: { startsWith: mimeTypeFilter } } : {}),
    };

    const [files, total, aggregation] = await Promise.all([
      this.prisma.file.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.file.count({ where }),
      this.prisma.file.aggregate({
        where,
        _sum: { size: true },
      }),
    ]);

    return {
      files: files.map(file => this.formatFileMetadata(file)),
      total,
      totalSize: aggregation._sum.size || 0,
    };
  }

  async getStorageStats(userId?: string): Promise<StorageStats> {
    const where = userId ? { uploadedBy: userId } : {};

    const [files, aggregation] = await Promise.all([
      this.prisma.file.findMany({
        where,
        select: {
          mimeType: true,
          size: true,
          uploadedBy: true,
          createdAt: true,
        },
      }),
      this.prisma.file.aggregate({
        where,
        _count: { id: true },
        _sum: { size: true },
      }),
    ]);

    // Group by type
    const usageByType = files.reduce((acc, file) => {
      const type = file.mimeType.split('/')[0]; // Get main type (image, application, etc.)
      if (!acc[type]) {
        acc[type] = { count: 0, size: 0 };
      }
      acc[type].count++;
      acc[type].size += file.size;
      return acc;
    }, {} as Record<string, { count: number; size: number }>);

    // Group by user (only if not filtering by user)
    const usageByUser = userId ? {} : files.reduce((acc, file) => {
      if (!acc[file.uploadedBy]) {
        acc[file.uploadedBy] = { count: 0, size: 0 };
      }
      acc[file.uploadedBy].count++;
      acc[file.uploadedBy].size += file.size;
      return acc;
    }, {} as Record<string, { count: number; size: number }>);

    // Group by month
    const monthlyUploads = files.reduce((acc, file) => {
      const month = file.createdAt.toISOString().slice(0, 7); // YYYY-MM format
      const existing = acc.find(item => item.month === month);
      if (existing) {
        existing.count++;
        existing.size += file.size;
      } else {
        acc.push({ month, count: 1, size: file.size });
      }
      return acc;
    }, [] as Array<{ month: string; count: number; size: number }>);

    return {
      totalFiles: aggregation._count.id,
      totalSize: aggregation._sum.size || 0,
      usageByType,
      usageByUser,
      monthlyUploads: monthlyUploads.sort((a, b) => b.month.localeCompare(a.month)),
    };
  }

  async cleanupExpiredFiles(): Promise<number> {
    const expiredFiles = await this.prisma.file.findMany({
      where: {
        expiresAt: { lte: new Date() },
      },
    });

    let deletedCount = 0;

    for (const file of expiredFiles) {
      try {
        const filePath = path.join(this.uploadPath, file.bucket, file.filename);
        await fs.unlink(filePath);

        if (file.thumbnailKey) {
          const thumbnailPath = path.join(this.uploadPath, file.bucket, `thumb_${file.filename}`);
          await fs.unlink(thumbnailPath).catch(() => {}); // Ignore thumbnail deletion errors
        }

        await this.prisma.file.delete({ where: { id: file.id } });
        deletedCount++;
      } catch (error) {
        this.logger.error(`Failed to delete expired file ${file.id}`, error);
      }
    }

    this.logger.log(`Cleaned up ${deletedCount} expired files`);
    return deletedCount;
  }

  async processImage(buffer: Buffer, options: ImageProcessingOptions): Promise<Buffer> {
    let processor = sharp(buffer);

    // Resize
    if (options.width || options.height) {
      processor = processor.resize(options.width, options.height, {
        fit: options.fit || 'contain',
        background: options.background || { r: 255, g: 255, b: 255, alpha: 1 },
      });
    }

    // Format conversion
    if (options.format) {
      switch (options.format) {
        case 'jpeg':
          processor = processor.jpeg({ quality: options.quality || 85 });
          break;
        case 'png':
          processor = processor.png({ quality: options.quality || 85 });
          break;
        case 'webp':
          processor = processor.webp({ quality: options.quality || 85 });
          break;
      }
    }

    // Effects
    if (options.grayscale) {
      processor = processor.grayscale();
    }

    if (options.blur) {
      processor = processor.blur(options.blur);
    }

    if (options.sharpen) {
      processor = processor.sharpen();
    }

    return processor.toBuffer();
  }

  async generateThumbnail(buffer: Buffer, size = 200): Promise<Buffer> {
    return sharp(buffer)
      .resize(size, size, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  async generateSignedUrl(fileId: string, expiresIn = 3600): Promise<string> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new BadRequestException('File not found');
    }

    // Check for cloud storage configuration
    const storageProvider = this.configService.get('STORAGE_PROVIDER', 'local');
    
    if (storageProvider === 'aws') {
      return this.generateAWSSignedUrl(file, expiresIn);
    } else if (storageProvider === 'azure') {
      return this.generateAzureSignedUrl(file, expiresIn);
    } else if (storageProvider === 'gcp') {
      return this.generateGCPSignedUrl(file, expiresIn);
    }

    // Fallback to local signed URL for development
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const signature = crypto
      .createHmac('sha256', this.configService.get('JWT_SECRET', 'fallback-secret'))
      .update(`${file.id}:${expires}`)
      .digest('hex');

    return `${this.publicPath}/signed/${file.id}?expires=${expires}&signature=${signature}`;
  }

  private async generateAWSSignedUrl(file: any, expiresIn: number): Promise<string> {
    // AWS S3 signed URL generation
    const AWS = await import('aws-sdk');
    const s3 = new AWS.S3({
      accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY'),
      region: this.configService.get('AWS_REGION', 'us-east-1'),
    });

    const params = {
      Bucket: this.configService.get('AWS_S3_BUCKET'),
      Key: file.key,
      Expires: expiresIn,
    };

    return s3.getSignedUrl('getObject', params);
  }

  private async generateAzureSignedUrl(file: any, expiresIn: number): Promise<string> {
    // Azure Blob Storage signed URL generation
    const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } = await import('@azure/storage-blob');
    
    const accountName = this.configService.get('AZURE_STORAGE_ACCOUNT_NAME');
    const accountKey = this.configService.get('AZURE_STORAGE_ACCOUNT_KEY');
    const containerName = this.configService.get('AZURE_STORAGE_CONTAINER');

    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      { accountName, accountKey }
    );

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(file.key);

    const sasOptions = {
      containerName,
      blobName: file.key,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn: new Date(Date.now() + expiresIn * 1000),
    };

    const sasToken = generateBlobSASQueryParameters(sasOptions, { accountName, accountKey }).toString();
    return `${blobClient.url}?${sasToken}`;
  }

  private async generateGCPSignedUrl(file: any, expiresIn: number): Promise<string> {
    // Google Cloud Storage signed URL generation
    const { Storage } = await import('@google-cloud/storage');
    
    const storage = new Storage({
      projectId: this.configService.get('GCP_PROJECT_ID'),
      keyFilename: this.configService.get('GCP_KEY_FILE'),
    });

    const bucket = storage.bucket(this.configService.get('GCP_STORAGE_BUCKET'));
    const file_ref = bucket.file(file.key);

    const [signedUrl] = await file_ref.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresIn * 1000,
    });

    return signedUrl;
  }

  // Private helper methods

  private async ensureDirectories(): Promise<void> {
    try {
      await fs.access(this.uploadPath);
    } catch {
      await fs.mkdir(this.uploadPath, { recursive: true });
    }

    // Create default buckets
    const defaultBuckets = ['default', 'images', 'documents', 'avatars', 'temp'];
    for (const bucket of defaultBuckets) {
      await this.ensureBucketDirectory(bucket);
    }
  }

  private async ensureBucketDirectory(bucket: string): Promise<void> {
    const bucketPath = path.join(this.uploadPath, bucket);
    try {
      await fs.access(bucketPath);
    } catch {
      await fs.mkdir(bucketPath, { recursive: true });
    }
  }

  private formatFileMetadata(file: any): FileMetadata {
    return {
      id: file.id,
      filename: file.filename,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      url: `${this.publicPath}/${file.bucket}/${file.filename}`,
      thumbnailUrl: file.thumbnailKey ? 
        `${this.publicPath}/${file.bucket}/thumb_${file.filename}` : undefined,
      bucket: file.bucket,
      key: file.key,
      hash: file.hash,
      uploadedBy: file.uploadedBy,
      uploadedAt: file.createdAt,
      expiresAt: file.expiresAt,
    };
  }

  private isImage(mimeType: string): boolean {
    return this.allowedImageTypes.includes(mimeType);
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const extensionMap = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/markdown': '.md',
    };

    return extensionMap[mimeType] || '.bin';
  }

  private async trackStorageAnalytics(event: string, data: any): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({
        data: {
          userId: data.userId,
          sessionId: 'storage-service',
          event,
          properties: data,
        },
      });
    } catch (error) {
      this.logger.warn('Failed to track storage analytics', error);
    }
  }
}