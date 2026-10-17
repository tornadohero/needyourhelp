import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { CreateReviewInput, Review } from '../domain/review.model';
import type { ReviewRepository } from '../domain/review.repository';
import { PUBLIC_REVIEW_STATUSES } from '../domain/review-policy';

/** Prisma adapter for {@link ReviewRepository}. */
@Injectable()
export class PrismaReviewRepository implements ReviewRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateReviewInput): Promise<Review> {
    const row = await this.prisma.review.create({
      data: {
        orderId: input.orderId,
        reviewerUserId: input.reviewerUserId,
        revieweeUserId: input.revieweeUserId,
        rating: input.rating,
        content: input.content,
        // Published by default; moderation may hide it later (`specs/01`).
        status: 'PUBLISHED',
      },
    });
    return mapReview(row);
  }

  async findById(id: string): Promise<Review | null> {
    const row = await this.prisma.review.findUnique({ where: { id } });
    return row ? mapReview(row) : null;
  }

  async findByOrderAndReviewer(
    orderId: string,
    reviewerUserId: string,
    revieweeUserId: string,
  ): Promise<Review | null> {
    const row = await this.prisma.review.findUnique({
      where: { orderId_reviewerUserId_revieweeUserId: { orderId, reviewerUserId, revieweeUserId } },
    });
    return row ? mapReview(row) : null;
  }

  async listByOrder(orderId: string): Promise<Review[]> {
    const rows = await this.prisma.review.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapReview);
  }

  async listByReviewee(
    revieweeUserId: string,
    options: { skip: number; take: number },
  ): Promise<{ items: Review[]; total: number }> {
    const where = {
      revieweeUserId,
      // Hidden content never reaches a public page, but the row stays.
      status: { in: [...PUBLIC_REVIEW_STATUSES] },
    };
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
      }),
      this.prisma.review.count({ where }),
    ]);
    return { items: rows.map(mapReview), total };
  }

  async setStatus(id: string, status: Review['status']): Promise<Review> {
    const row = await this.prisma.review.update({ where: { id }, data: { status } });
    return mapReview(row);
  }
}

type ReviewRow = {
  id: string;
  orderId: string;
  reviewerUserId: string;
  revieweeUserId: string;
  rating: number;
  content: string | null;
  status: Review['status'];
  createdAt: Date;
  updatedAt: Date;
};

function mapReview(row: ReviewRow): Review {
  return {
    id: row.id,
    orderId: row.orderId,
    reviewerUserId: row.reviewerUserId,
    revieweeUserId: row.revieweeUserId,
    rating: row.rating,
    content: row.content,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
