import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

interface ListingData {
  itemType: 'prompt' | 'template' | 'workflow';
  itemId: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  price: number;
  currency: string;
  licensingType: 'personal' | 'commercial' | 'enterprise';
  previewContent?: string;
}

interface PurchaseData {
  listingId: string;
  buyerId: string;
  licensingType: string;
  paymentMethod: string;
  billingAddress?: any;
}

interface PaymentResult {
  transactionId: string;
  amount: number;
  currency: string;
  method: string;
  status: 'pending' | 'completed' | 'failed';
  processorResponse?: any;
}

interface QualityCheck {
  passed: boolean;
  score: number;
  issues: string[];
  recommendations: string[];
}

interface MarketplaceStats {
  totalListings: number;
  activeListings: number;
  totalSales: number;
  totalRevenue: number;
  topCategories: Array<{ category: string; count: number }>;
  recentSales: any[];
}

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);
  
  // Platform fee (20% to platform, 80% to seller)
  private readonly PLATFORM_FEE_RATE = 0.20;

  constructor(private prisma: PrismaService) {}

  async createListing(userId: string, data: ListingData) {
    this.logger.log(`Creating marketplace listing for user ${userId}`);

    // Verify ownership of the item
    await this.validateOwnership(data.itemType, data.itemId, userId);

    // Perform quality check
    const qualityCheck = await this.performQualityCheck(data.itemType, data.itemId);
    if (!qualityCheck.passed) {
      throw new BadRequestException('Item does not meet marketplace quality standards', {
        cause: qualityCheck.issues
      });
    }

    // Create the listing
    const listing = await this.prisma.marketplaceListing.create({
      data: {
        sellerId: userId,
        itemType: data.itemType,
        itemId: data.itemId,
        title: data.title,
        description: data.description,
        category: data.category,
        tags: data.tags,
        price: data.price,
        currency: data.currency,
        licensingType: data.licensingType,
        previewContent: data.previewContent,
        qualityScore: qualityCheck.score,
        status: 'pending_review', // Requires manual review for new sellers
        metadata: {
          qualityCheck,
          submissionDate: new Date(),
          initialPrice: data.price
        }
      }
    });

    // Submit for review if seller doesn't have auto-approval
    const seller = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { marketplaceAutoApproval: true }
    });

    if (seller?.marketplaceAutoApproval) {
      await this.approveListing(listing.id, 'auto_approved');
    } else {
      await this.submitForReview(listing.id);
    }

    this.logger.log(`Listing created: ${listing.id}`);
    return listing;
  }

  async purchaseItem(data: PurchaseData): Promise<any> {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id: data.listingId },
      include: {
        seller: {
          select: { id: true, username: true, email: true }
        }
      }
    });

    if (!listing) {
      throw new NotFoundException('Listing not found');
    }

    if (listing.status !== 'active') {
      throw new BadRequestException('Listing is not available for purchase');
    }

    if (listing.sellerId === data.buyerId) {
      throw new BadRequestException('Cannot purchase your own listing');
    }

    // Check if user already owns this item
    const existingPurchase = await this.prisma.marketplacePurchase.findFirst({
      where: {
        listingId: data.listingId,
        buyerId: data.buyerId,
        licensingType: data.licensingType,
        status: 'completed'
      }
    });

    if (existingPurchase) {
      throw new BadRequestException('You already own this item with this license type');
    }

    // Calculate final price with any applicable discounts
    const finalPrice = this.calculatePrice(listing.price, data.licensingType);

    // Process payment
    const paymentResult = await this.processPayment({
      amount: finalPrice,
      currency: listing.currency,
      buyerId: data.buyerId,
      sellerId: listing.sellerId,
      description: `Purchase: ${listing.title}`,
      method: data.paymentMethod,
      billingAddress: data.billingAddress
    });

    if (paymentResult.status !== 'completed') {
      throw new BadRequestException('Payment processing failed');
    }

    // Create purchase record
    const purchase = await this.prisma.marketplacePurchase.create({
      data: {
        listingId: data.listingId,
        buyerId: data.buyerId,
        sellerId: listing.sellerId,
        price: finalPrice,
        currency: listing.currency,
        licensingType: data.licensingType,
        transactionId: paymentResult.transactionId,
        paymentMethod: data.paymentMethod,
        status: 'completed',
        metadata: {
          originalPrice: listing.price,
          discountApplied: listing.price - finalPrice,
          paymentProcessor: 'stripe', // or other processor
          billingAddress: data.billingAddress
        }
      }
    });

    // Update listing statistics
    await this.prisma.marketplaceListing.update({
      where: { id: data.listingId },
      data: {
        purchases: { increment: 1 },
        totalRevenue: { increment: finalPrice },
        lastSoldAt: new Date()
      }
    });

    // Distribute revenue
    await this.distributeRevenue(finalPrice, listing.sellerId, purchase.id);

    // Grant access to the purchased item
    await this.grantItemAccess(purchase.id, data.buyerId, listing);

    // Send notifications
    await this.sendPurchaseNotifications(listing, purchase);

    // Update marketplace analytics
    await this.updateMarketplaceAnalytics(listing, purchase);

    this.logger.log(`Purchase completed: ${purchase.id}`);
    return purchase;
  }

  async searchMarketplace(query: {
    search?: string;
    category?: string;
    tags?: string[];
    itemType?: string;
    minPrice?: number;
    maxPrice?: number;
    licensingType?: string;
    sortBy?: 'price' | 'popularity' | 'rating' | 'recent';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    userId?: string; // For personalized results
  }) {
    const filters: any = {
      status: 'active'
    };

    // Apply search filters
    if (query.search) {
      filters.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { tags: { hasSome: [query.search] } }
      ];
    }

    if (query.category) {
      filters.category = query.category;
    }

    if (query.tags?.length) {
      filters.tags = { hasSome: query.tags };
    }

    if (query.itemType) {
      filters.itemType = query.itemType;
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filters.price = {};
      if (query.minPrice !== undefined) filters.price.gte = query.minPrice;
      if (query.maxPrice !== undefined) filters.price.lte = query.maxPrice;
    }

    if (query.licensingType) {
      filters.licensingType = query.licensingType;
    }

    // Build order by clause
    const orderBy: any = {};
    switch (query.sortBy) {
      case 'price':
        orderBy.price = query.sortOrder || 'asc';
        break;
      case 'popularity':
        orderBy.purchases = query.sortOrder || 'desc';
        break;
      case 'rating':
        orderBy.rating = query.sortOrder || 'desc';
        break;
      case 'recent':
      default:
        orderBy.createdAt = query.sortOrder || 'desc';
        break;
    }

    // Execute search
    const [listings, total] = await Promise.all([
      this.prisma.marketplaceListing.findMany({
        where: filters,
        include: {
          seller: {
            select: { id: true, username: true, avatar: true, marketplaceRating: true }
          },
          _count: {
            select: { reviews: true, purchases: true }
          }
        },
        orderBy,
        take: query.limit || 20,
        skip: query.offset || 0
      }),
      this.prisma.marketplaceListing.count({ where: filters })
    ]);

    // Apply personalization if user ID provided
    let personalizedListings = listings;
    if (query.userId) {
      personalizedListings = await this.personalizeResults(listings, query.userId);
    }

    return {
      listings: personalizedListings,
      total,
      page: Math.floor((query.offset || 0) / (query.limit || 20)) + 1,
      limit: query.limit || 20,
      filters: query
    };
  }

  async getListing(listingId: string, userId?: string) {
    const listing = await this.prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      include: {
        seller: {
          select: { 
            id: true, 
            username: true, 
            avatar: true, 
            marketplaceRating: true,
            totalSales: true,
            joinedAt: true
          }
        },
        reviews: {
          include: {
            buyer: {
              select: { id: true, username: true, avatar: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        _count: {
          select: { reviews: true, purchases: true }
        }
      }
    });

    if (!listing) {
      throw new NotFoundException('Listing not found');
    }

    // Check if user has purchased this item
    let userPurchase = null;
    if (userId) {
      userPurchase = await this.prisma.marketplacePurchase.findFirst({
        where: {
          listingId,
          buyerId: userId,
          status: 'completed'
        }
      });
    }

    // Increment view count
    await this.prisma.marketplaceListing.update({
      where: { id: listingId },
      data: { views: { increment: 1 } }
    });

    // Get similar listings
    const similarListings = await this.getSimilarListings(listing);

    return {
      ...listing,
      userPurchase,
      similarListings,
      canPurchase: !userPurchase && listing.sellerId !== userId,
      fullContent: userPurchase ? await this.getFullContent(listing) : null
    };
  }

  async getMyListings(userId: string, status?: string) {
    const where: any = { sellerId: userId };
    if (status) {
      where.status = status;
    }

    return this.prisma.marketplaceListing.findMany({
      where,
      include: {
        _count: {
          select: { reviews: true, purchases: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getMyPurchases(userId: string) {
    return this.prisma.marketplacePurchase.findMany({
      where: { buyerId: userId },
      include: {
        listing: {
          include: {
            seller: {
              select: { id: true, username: true, avatar: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async addReview(
    listingId: string,
    buyerId: string,
    rating: number,
    comment?: string
  ) {
    // Verify purchase
    const purchase = await this.prisma.marketplacePurchase.findFirst({
      where: {
        listingId,
        buyerId,
        status: 'completed'
      }
    });

    if (!purchase) {
      throw new BadRequestException('You must purchase this item before reviewing it');
    }

    // Check if review already exists
    const existingReview = await this.prisma.marketplaceReview.findFirst({
      where: { listingId, buyerId }
    });

    if (existingReview) {
      throw new BadRequestException('You have already reviewed this item');
    }

    // Create review
    const review = await this.prisma.marketplaceReview.create({
      data: {
        listingId,
        buyerId,
        rating,
        comment,
        verified: true // Since we verified the purchase
      }
    });

    // Update listing rating
    await this.updateListingRating(listingId);

    return review;
  }

  async reportListing(
    listingId: string,
    reporterId: string,
    reason: string,
    description?: string
  ) {
    const report = await this.prisma.marketplaceReport.create({
      data: {
        listingId,
        reporterId,
        reason,
        description,
        status: 'pending'
      }
    });

    // Auto-suspend if multiple reports
    const reportCount = await this.prisma.marketplaceReport.count({
      where: { listingId, status: 'pending' }
    });

    if (reportCount >= 3) {
      await this.prisma.marketplaceListing.update({
        where: { id: listingId },
        data: { status: 'suspended' }
      });
    }

    return report;
  }

  async getMarketplaceStats(): Promise<MarketplaceStats> {
    const [
      totalListings,
      activeListings,
      totalSales,
      totalRevenue,
      categoryStats,
      recentSales
    ] = await Promise.all([
      this.prisma.marketplaceListing.count(),
      this.prisma.marketplaceListing.count({ where: { status: 'active' } }),
      this.prisma.marketplacePurchase.count({ where: { status: 'completed' } }),
      this.prisma.marketplacePurchase.aggregate({
        where: { status: 'completed' },
        _sum: { price: true }
      }),
      this.prisma.marketplaceListing.groupBy({
        by: ['category'],
        _count: { category: true },
        orderBy: { _count: { category: 'desc' } },
        take: 10
      }),
      this.prisma.marketplacePurchase.findMany({
        where: { status: 'completed' },
        include: {
          listing: { select: { title: true } },
          buyer: { select: { username: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    return {
      totalListings,
      activeListings,
      totalSales,
      totalRevenue: totalRevenue._sum.price || 0,
      topCategories: categoryStats.map(stat => ({
        category: stat.category,
        count: stat._count.category
      })),
      recentSales
    };
  }

  async withdrawEarnings(userId: string, amount: number, method: 'bank' | 'paypal') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { availableBalance: true, totalEarnings: true }
    });

    if (!user || user.availableBalance < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // Create withdrawal request
    const withdrawal = await this.prisma.withdrawalRequest.create({
      data: {
        userId,
        amount,
        method,
        status: 'pending',
        processingFee: amount * 0.025, // 2.5% processing fee
        netAmount: amount * 0.975
      }
    });

    // Update user balance
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        availableBalance: { decrement: amount },
        pendingWithdrawals: { increment: amount }
      }
    });

    // Process withdrawal (in production, integrate with payment processor)
    await this.processWithdrawal(withdrawal);

    return withdrawal;
  }

  // Private helper methods

  private async validateOwnership(itemType: string, itemId: string, userId: string) {
    let owned = false;

    switch (itemType) {
      case 'prompt':
        const prompt = await this.prisma.prompt.findFirst({
          where: { id: itemId, userId }
        });
        owned = !!prompt;
        break;
      case 'template':
        const template = await this.prisma.template.findFirst({
          where: { id: itemId, userId }
        });
        owned = !!template;
        break;
      case 'workflow':
        const workflow = await this.prisma.promptWorkflow.findFirst({
          where: { id: itemId, userId }
        });
        owned = !!workflow;
        break;
    }

    if (!owned) {
      throw new BadRequestException('You do not own this item');
    }
  }

  private async performQualityCheck(itemType: string, itemId: string): Promise<QualityCheck> {
    let score = 100;
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Get item content based on type
    let content = '';
    let metadata: any = {};

    switch (itemType) {
      case 'prompt':
        const prompt = await this.prisma.prompt.findUnique({ where: { id: itemId } });
        content = prompt?.content || '';
        metadata = { title: prompt?.title, tags: prompt?.tags };
        break;
      case 'template':
        const template = await this.prisma.template.findUnique({ where: { id: itemId } });
        content = template?.content || '';
        metadata = { name: template?.name, description: template?.description };
        break;
      case 'workflow':
        const workflow = await this.prisma.promptWorkflow.findUnique({ where: { id: itemId } });
        content = JSON.stringify(workflow?.nodes || []);
        metadata = { name: workflow?.name, description: workflow?.description };
        break;
    }

    // Check content length
    if (content.length < 50) {
      score -= 30;
      issues.push('Content too short');
    }

    // Check for meaningful title/description
    if (!metadata.title && !metadata.name) {
      score -= 20;
      issues.push('Missing title');
    }

    if (!metadata.description) {
      score -= 10;
      issues.push('Missing description');
    }

    // Check for appropriate tags
    if (!metadata.tags || metadata.tags.length === 0) {
      score -= 10;
      recommendations.push('Add relevant tags');
    }

    // Check for plagiarism (simplified)
    const similarity = await this.checkContentSimilarity(content);
    if (similarity > 0.8) {
      score -= 50;
      issues.push('Content appears to be duplicate or plagiarized');
    }

    return {
      passed: score >= 70 && issues.length === 0,
      score,
      issues,
      recommendations
    };
  }

  private async checkContentSimilarity(content: string): Promise<number> {
    // Simplified similarity check - in production, use proper plagiarism detection
    const existingContent = await this.prisma.marketplaceListing.findMany({
      where: { status: 'active' },
      select: { previewContent: true }
    });

    let maxSimilarity = 0;
    
    for (const listing of existingContent) {
      if (listing.previewContent) {
        const similarity = this.calculateJaccardSimilarity(
          content.toLowerCase(),
          listing.previewContent.toLowerCase()
        );
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }
    }

    return maxSimilarity;
  }

  private calculateJaccardSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\W+/));
    const words2 = new Set(text2.split(/\W+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  private calculatePrice(basePrice: number, licensingType: string): number {
    const multipliers = {
      personal: 1.0,
      commercial: 2.0,
      enterprise: 5.0
    };

    return basePrice * (multipliers[licensingType] || 1.0);
  }

  private async processPayment(data: any): Promise<PaymentResult> {
    // In production, integrate with Stripe, PayPal, or other payment processor
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Simulate payment processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      transactionId,
      amount: data.amount,
      currency: data.currency,
      method: data.method,
      status: 'completed',
      processorResponse: {
        processorTransactionId: transactionId,
        timestamp: new Date(),
        method: data.method
      }
    };
  }

  private async distributeRevenue(amount: number, sellerId: string, purchaseId: string) {
    const platformFee = amount * this.PLATFORM_FEE_RATE;
    const sellerRevenue = amount - platformFee;

    // Credit seller account
    await this.prisma.user.update({
      where: { id: sellerId },
      data: {
        totalEarnings: { increment: sellerRevenue },
        availableBalance: { increment: sellerRevenue }
      }
    });

    // Record revenue transaction
    await this.prisma.revenueTransaction.create({
      data: {
        userId: sellerId,
        purchaseId,
        amount: sellerRevenue,
        platformFee,
        type: 'marketplace_sale',
        status: 'completed'
      }
    });

    this.logger.log(`Revenue distributed: ${sellerRevenue} to seller ${sellerId}, ${platformFee} platform fee`);
  }

  private async grantItemAccess(purchaseId: string, buyerId: string, listing: any) {
    // Create access record
    await this.prisma.itemAccess.create({
      data: {
        userId: buyerId,
        itemType: listing.itemType,
        itemId: listing.itemId,
        purchaseId,
        licensingType: listing.licensingType,
        expiresAt: this.calculateAccessExpiry(listing.licensingType)
      }
    });
  }

  private calculateAccessExpiry(licensingType: string): Date | null {
    // Personal licenses don't expire, commercial expire in 2 years, enterprise in 5 years
    const expiry = {
      personal: null,
      commercial: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), // 2 years
      enterprise: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000)  // 5 years
    };

    return expiry[licensingType] || null;
  }

  private async sendPurchaseNotifications(listing: any, purchase: any) {
    // Send email to buyer
    // Send email to seller
    // Create in-app notifications
    this.logger.log(`Notifications sent for purchase ${purchase.id}`);
  }

  private async updateMarketplaceAnalytics(listing: any, purchase: any) {
    // Update marketplace-wide analytics
    await this.prisma.marketplaceAnalytics.upsert({
      where: { date: new Date().toISOString().split('T')[0] },
      update: {
        totalSales: { increment: 1 },
        totalRevenue: { increment: purchase.price }
      },
      create: {
        date: new Date().toISOString().split('T')[0],
        totalSales: 1,
        totalRevenue: purchase.price
      }
    });
  }

  private async personalizeResults(listings: any[], userId: string) {
    // Simple personalization based on user's past purchases and interests
    const userPurchases = await this.prisma.marketplacePurchase.findMany({
      where: { buyerId: userId },
      include: { listing: { select: { category: true, tags: true } } }
    });

    const userInterests = this.extractUserInterests(userPurchases);
    
    return listings.sort((a, b) => {
      const scoreA = this.calculatePersonalizationScore(a, userInterests);
      const scoreB = this.calculatePersonalizationScore(b, userInterests);
      return scoreB - scoreA;
    });
  }

  private extractUserInterests(purchases: any[]) {
    const categories = new Set<string>();
    const tags = new Set<string>();

    for (const purchase of purchases) {
      if (purchase.listing.category) {
        categories.add(purchase.listing.category);
      }
      if (purchase.listing.tags) {
        purchase.listing.tags.forEach((tag: string) => tags.add(tag));
      }
    }

    return { categories: Array.from(categories), tags: Array.from(tags) };
  }

  private calculatePersonalizationScore(listing: any, interests: any): number {
    let score = 0;

    if (interests.categories.includes(listing.category)) {
      score += 10;
    }

    const tagMatches = listing.tags.filter((tag: string) => interests.tags.includes(tag));
    score += tagMatches.length * 5;

    return score;
  }

  private async getSimilarListings(listing: any) {
    return this.prisma.marketplaceListing.findMany({
      where: {
        id: { not: listing.id },
        status: 'active',
        OR: [
          { category: listing.category },
          { tags: { hasSome: listing.tags } }
        ]
      },
      include: {
        seller: {
          select: { id: true, username: true, avatar: true }
        }
      },
      take: 5
    });
  }

  private async getFullContent(listing: any) {
    // Return full content based on item type
    switch (listing.itemType) {
      case 'prompt':
        return this.prisma.prompt.findUnique({
          where: { id: listing.itemId }
        });
      case 'template':
        return this.prisma.template.findUnique({
          where: { id: listing.itemId }
        });
      case 'workflow':
        return this.prisma.promptWorkflow.findUnique({
          where: { id: listing.itemId },
          include: { nodes: true, edges: true }
        });
      default:
        return null;
    }
  }

  private async updateListingRating(listingId: string) {
    const reviews = await this.prisma.marketplaceReview.findMany({
      where: { listingId },
      select: { rating: true }
    });

    if (reviews.length > 0) {
      const avgRating = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
      
      await this.prisma.marketplaceListing.update({
        where: { id: listingId },
        data: { 
          rating: avgRating,
          reviewCount: reviews.length
        }
      });
    }
  }

  private async submitForReview(listingId: string) {
    // Add listing to review queue
    await this.prisma.reviewQueue.create({
      data: {
        listingId,
        priority: 'normal',
        status: 'pending'
      }
    });
  }

  private async approveListing(listingId: string, approvalType: string) {
    await this.prisma.marketplaceListing.update({
      where: { id: listingId },
      data: { 
        status: 'active',
        approvedAt: new Date(),
        approvalType
      }
    });
  }

  private async processWithdrawal(withdrawal: any) {
    // In production, integrate with payment processor for payouts
    await new Promise(resolve => setTimeout(resolve, 2000));

    await this.prisma.withdrawalRequest.update({
      where: { id: withdrawal.id },
      data: {
        status: 'completed',
        processedAt: new Date()
      }
    });
  }
}