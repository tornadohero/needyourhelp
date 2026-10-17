import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { REVIEW_RATING_MAX, REVIEW_RATING_MIN } from '@mentor/api-contracts';

import { MAX_REVIEW_CONTENT_LENGTH, MAX_REVIEW_PAGE_SIZE } from '../../domain/review-policy';

/** `POST /orders/:id/reviews`. */
export class CreateReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(REVIEW_RATING_MIN)
  @Max(REVIEW_RATING_MAX)
  readonly rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REVIEW_CONTENT_LENGTH)
  readonly content?: string;
}

/** `GET /providers/:id/reviews`. */
export class ProviderReviewsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_REVIEW_PAGE_SIZE)
  readonly pageSize?: number;
}
