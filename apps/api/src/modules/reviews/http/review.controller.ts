import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { ReviewListResponse, ReviewResponse } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { ReviewService } from '../application/review.service';
import { toReviewListResponse, toReviewResponse } from './review.mapper';
import { translate } from './review-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateReviewDto } from './dto/review.dto';
import { RateLimit } from '../../../common/security/rate-limit.interceptor';

/**
 * Order review endpoints (`specs/05-api-spec.md` §Reviews).
 *
 * Eligibility is decided by the service: only a completed order may be reviewed,
 * only by its own parties, once per direction.
 */
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(@Inject(ReviewService) private readonly reviews: ReviewService) {}

  /** `POST /orders/:id/reviews` (201). */
  @RateLimit('reviews.create')
  @Post(':id/reviews')
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: CreateReviewDto,
  ): Promise<ReviewResponse> {
    return translate(async () =>
      toReviewResponse(
        await this.reviews.createReview(principal.userId, id, {
          rating: body.rating,
          content: body.content ?? null,
        }),
      ),
    );
  }

  /** `GET /orders/:id/reviews`. */
  @Get(':id/reviews')
  async list(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<ReviewListResponse> {
    return translate(async () =>
      toReviewListResponse(await this.reviews.listOrderReviews(principal.userId, id)),
    );
  }
}
