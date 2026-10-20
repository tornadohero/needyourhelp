import type {
  AvailabilitySlotResponse,
  ProviderDetailResponse,
  ProviderSearchItemResponse,
  ReviewResponse,
  ServiceResponse,
} from '@mentor/api-contracts';

import { formatDateTime, formatDuration, formatMoney } from './format';

/**
 * Provider view models (T030).
 *
 * Everything here is built **field by field** from the public contract: no ORM
 * row is rendered, and a field the public DTO does not carry (owner user id,
 * approval status, `searchable`, capability status, internal restriction scope)
 * cannot reach a screen (`AGENTS.md` §10, `specs/07`, `specs/10`).
 *
 * Money is only formatted, never computed (`AGENTS.md` §8).
 */

export interface ProviderRowView {
  id: string;
  name: string;
  headline: string;
  cityText: string;
  ratingText: string;
  completedText: string;
  fromPriceText: string;
}

export function describeSearchItem(item: ProviderSearchItemResponse): ProviderRowView {
  return {
    id: item.id,
    name: item.publicName,
    headline: item.headline ?? '',
    cityText: item.cityCode ?? '未标注城市',
    ratingText:
      item.ratingCount > 0 && item.ratingAvg !== null
        ? `${item.ratingAvg.toFixed(1)} 分 · ${item.ratingCount} 条`
        : '暂无评价',
    completedText: `${item.completedOrderCount} 次完成`,
    // The cheapest published service, as the server calculated it.
    fromPriceText:
      item.minPriceMinor === null ? '暂无在售服务' : `${formatMoney(item.minPriceMinor)} 起`,
  };
}

export interface ServiceRowView {
  id: string;
  title: string;
  description: string;
  durationText: string;
  priceText: string;
  deliveryText: string;
}

export function describeService(service: ServiceResponse): ServiceRowView {
  return {
    id: service.id,
    title: service.title,
    description: service.description ?? '',
    durationText: formatDuration(service.durationMinutes),
    priceText: formatMoney(service.priceMinor),
    deliveryText: service.deliveryMode,
  };
}

export interface ProviderDetailView {
  id: string;
  name: string;
  headline: string;
  bio: string;
  cityText: string;
  ratingText: string;
  completedText: string;
  services: ServiceRowView[];
  serviceCount: number;
}

export function describeProviderDetail(detail: ProviderDetailResponse): ProviderDetailView {
  return {
    id: detail.id,
    name: detail.publicName,
    headline: detail.headline ?? '',
    bio: detail.bio ?? '',
    cityText: detail.cityCode ?? '未标注城市',
    ratingText:
      detail.ratingCount > 0 && detail.ratingAvg !== null
        ? `${detail.ratingAvg.toFixed(1)} 分 · ${detail.ratingCount} 条`
        : '暂无评价',
    completedText: `${detail.completedOrderCount} 次完成`,
    // Published services only: the server already filtered the rest.
    services: detail.services.map(describeService),
    serviceCount: detail.services.length,
  };
}

export interface ReviewRowView {
  id: string;
  ratingText: string;
  content: string;
  createdText: string;
}

export function describeReview(review: ReviewResponse): ReviewRowView {
  return {
    id: review.id,
    ratingText: `${review.rating} 星`,
    // A hidden review is `content: null` server-side (`specs/01` §Review);
    // nothing is shown in its place, and the row is not invented.
    content: review.content ?? '',
    createdText: formatDateTime(review.createdAt),
  };
}

export interface SlotRowView {
  id: string;
  rangeText: string;
}

export function describeSlot(slot: AvailabilitySlotResponse): SlotRowView {
  return {
    id: slot.id,
    rangeText: `${formatDateTime(slot.startAt)} – ${formatDateTime(slot.endAt)}`,
  };
}
