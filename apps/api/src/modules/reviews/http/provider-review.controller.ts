import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { ProviderReviewListResponse } from '@mentor/api-contracts';

import { ReviewService } from '../application/review.service';
import { toProviderReviewListResponse } from './review.mapper';
import { translate } from './review-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ProviderReviewsQueryDto } from './dto/review.dto';

/**
 * `GET /providers/:id/reviews` (`specs/05-api-spec.md` §Reviews).
 *
 * Public and read-only: only a discoverable provider has a public review page,
 * and moderation-hidden content never appears.
 */
@Controller('providers')
export class ProviderReviewController {
  constructor(@Inject(ReviewService) private readonly reviews: ReviewService) {}

  @Get(':id/reviews')
  async list(
    @Param('id') id: string,
    @Query() query: ProviderReviewsQueryDto,
  ): Promise<ProviderReviewListResponse> {
    return translate(async () =>
      toProviderReviewListResponse(
        await this.reviews.listProviderReviews(id, {
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  }
}
