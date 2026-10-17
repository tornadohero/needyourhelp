import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';
import { FEATURE_FLAG_REPOSITORY } from '../../platform/domain/feature-flag.repository';
import type { FeatureFlagRepository } from '../../platform/domain/feature-flag.repository';
import { FEATURE_FLAGS } from '../../platform/infrastructure/prisma-feature-flag.repository';
import { providerNotFound } from '../../provider/domain/provider.errors';
import { assertProviderId, normalizeSearchQuery } from '../domain/discovery-policy';
import type { RawProviderSearchQuery } from '../domain/discovery-policy';
import { PROVIDER_DIRECTORY } from '../domain/provider-directory';
import type { ProviderDirectory } from '../domain/provider-directory';
import type { ProviderDetail, ProviderSearchResult } from '../domain/provider-search.model';

/**
 * Public discovery (`specs/05-api-spec.md` §Provider,
 * `specs/07-permission-spec.md`: "User can read public provider profiles").
 *
 * Everything here is a read: the directory decides who is discoverable, the HTTP
 * mappers decide what is public. The service only normalizes the query and
 * applies the feature flags (`AGENTS.md` §6).
 */
@Injectable()
export class ProviderDiscoveryService {
  constructor(
    @Inject(PROVIDER_DIRECTORY) private readonly directory: ProviderDirectory,
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepository,
    // Analytics is a side effect, never a dependency: a context can run without
    // a pipeline, and unit tests do (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /** `GET /providers`. */
  async search(raw: RawProviderSearchQuery = {}): Promise<ProviderSearchResult> {
    const query = normalizeSearchQuery(raw);

    // A flagged-off marketplace has no listing at all (`AGENTS.md` §7).
    if (query.domain === 'CAREER' && !(await this.isCareerEnabled())) {
      return { hits: [], total: 0, page: query.page, pageSize: query.pageSize };
    }

    const page = await this.directory.search(query);

    await this.analytics?.track({
      name: 'provider_list_viewed',
      providerId: null,
      props: { result_count: page.total },
    });

    return { ...page, page: query.page, pageSize: query.pageSize };
  }

  /** `GET /providers/:id`. */
  async getDetail(providerId: string): Promise<ProviderDetail> {
    return this.findVisible(providerId);
  }

  /** `GET /providers/:id/services`: published services only. */
  async listServices(providerId: string): Promise<ProviderDetail> {
    return this.findVisible(providerId);
  }

  /**
   * The single read path of the detail routes.
   *
   * An unknown id and a provider that is not discoverable are the same answer
   * for a public caller: `NOT_FOUND`. Nothing about why it is hidden leaks
   * (`specs/13-security-spec.md`).
   */
  private async findVisible(providerId: string): Promise<ProviderDetail> {
    assertProviderId(providerId);

    const detail = await this.directory.findDiscoverable(providerId);
    if (!detail) {
      throw providerNotFound('Provider not found.');
    }

    if (detail.provider.providerType === 'CAREER' && !(await this.isCareerEnabled())) {
      throw providerNotFound('Provider not found.');
    }

    await this.analytics?.track({
      name: 'provider_detail_viewed',
      providerId: detail.provider.id,
      props: { service_count: detail.services.length },
    });

    return detail;
  }

  private async isCareerEnabled(): Promise<boolean> {
    return this.flags.isEnabled(FEATURE_FLAGS.careerMarketplace);
  }
}
