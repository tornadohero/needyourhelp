import type { MentorContext } from '../app-context';
import { ROUTES, fillPath } from '../core/routes';
import { describeOrder } from '../core/order-view';
import type { OrderRowView } from '../core/order-view';
import {
  applicationRequest,
  describeProviderDesk,
  describeServiceRow,
  describeSlotRow,
  describeVerificationCase,
} from '../core/provider-desk';
import type {
  CreateApplicationBody,
  ProviderApplicationInput,
  ProviderDeskView,
  ServiceManageRowView,
  SlotManageRowView,
  VerificationRowView,
} from '../core/provider-desk';
import { serviceRequest } from '../core/service-form';
import type { CreateServiceBody, ServiceDraft } from '../core/service-form';
import type {
  AvailabilityListResponse,
  AvailabilitySlotResponse,
  MyVerificationResponse,
  OrderResponse,
  ProviderProfileResponse,
  ProviderServiceListResponse,
  ServiceResponse,
} from '@mentor/api-contracts';

/**
 * Provider desk use cases (T032).
 *
 * Everything here is the provider acting on their **own** record, behind the
 * session: no user id is sent, no approval status is written, and `searchable`
 * is never touched — publishing is a command and the server owns the gate
 * (`specs/01-business-rules.md` §Provider approval, `AGENTS.md` §7).
 *
 * A conflict (an overlapping slot, an unapproved provider) is answered by the
 * server and shown as the server's words: the client does not pre-empt the rule,
 * because a rule re-implemented on the client is a rule that will drift.
 */

const PROVIDER_TYPE = 'TUTORING';

/** `GET /providers/me` — the provider record as the platform sees it. */
export async function myProviderProfile(context: MentorContext): Promise<ProviderDeskView> {
  const profile = await context.session.withSession((accessToken) =>
    context.client.get<ProviderProfileResponse>(ROUTES.providerMe, {
      accessToken,
      query: { providerType: PROVIDER_TYPE },
    }),
  );
  return describeProviderDesk(profile);
}

/** `GET /verification/me` — only the provider's own cases. */
export async function myVerification(context: MentorContext): Promise<VerificationRowView[]> {
  const response = await context.session.withSession((accessToken) =>
    context.client.get<MyVerificationResponse>(ROUTES.verificationMe, { accessToken }),
  );
  return response.cases.map(describeVerificationCase);
}

/**
 * `POST /providers/applications`.
 *
 * The body is built by `applicationRequest()`: display fields and the tutoring
 * identities the provider claims, nothing else.
 */
export async function applyAsProvider(
  context: MentorContext,
  input: ProviderApplicationInput,
): Promise<ProviderDeskView> {
  const body: CreateApplicationBody = applicationRequest(input);
  const profile = await context.session.withSession((accessToken) =>
    context.client.post<ProviderProfileResponse>(ROUTES.providerApplications, {
      accessToken,
      body,
    }),
  );
  return describeProviderDesk(profile);
}

/** `POST /providers/me/submit` — hand the record to a reviewer (200, a command). */
export async function submitApplication(context: MentorContext): Promise<ProviderDeskView> {
  const profile = await context.session.withSession((accessToken) =>
    context.client.post<ProviderProfileResponse>(ROUTES.providerSubmit, {
      accessToken,
      query: { providerType: PROVIDER_TYPE },
    }),
  );
  return describeProviderDesk(profile);
}

/** `GET /providers/me/services` — drafts and published alike, as the owner sees them. */
export async function listMyServices(context: MentorContext): Promise<ServiceManageRowView[]> {
  const list = await context.session.withSession((accessToken) =>
    context.client.get<ProviderServiceListResponse>(ROUTES.providerMyServices, {
      accessToken,
      query: { providerType: PROVIDER_TYPE },
    }),
  );
  return list.items.map(describeServiceRow);
}

/** `POST /providers/me/services` — the provider's own price and duration. */
export async function createService(
  context: MentorContext,
  draft: ServiceDraft,
): Promise<ServiceManageRowView> {
  const body: CreateServiceBody = serviceRequest(draft);
  const service = await context.session.withSession((accessToken) =>
    context.client.post<ServiceResponse>(ROUTES.providerMyServices, {
      accessToken,
      query: { providerType: PROVIDER_TYPE },
      body,
    }),
  );
  return describeServiceRow(service);
}

/**
 * `POST /providers/me/services/:id/publish`.
 *
 * Refused while the provider is not approved; the screen shows the server's
 * answer rather than hiding the button, so the reason stays visible.
 */
export async function publishService(
  context: MentorContext,
  serviceId: string,
): Promise<ServiceManageRowView> {
  return command(context, ROUTES.providerServicePublish, serviceId);
}

export async function unpublishService(
  context: MentorContext,
  serviceId: string,
): Promise<ServiceManageRowView> {
  return command(context, ROUTES.providerServiceUnpublish, serviceId);
}

async function command(
  context: MentorContext,
  route: string,
  serviceId: string,
): Promise<ServiceManageRowView> {
  const service = await context.session.withSession((accessToken) =>
    context.client.post<ServiceResponse>(fillPath(route, { id: serviceId }), {
      accessToken,
      query: { providerType: PROVIDER_TYPE },
    }),
  );
  return describeServiceRow(service);
}

/**
 * `GET /providers/:id/availability` — the provider's own future windows.
 *
 * It is the public route: it answers open, bookable slots. A slot already taken
 * by a booking is not "offered" any more, and it lives on the order instead.
 */
export async function listMySlots(
  context: MentorContext,
  providerId: string,
): Promise<SlotManageRowView[]> {
  const list = await context.session.withSession((accessToken) =>
    context.client.get<AvailabilityListResponse>(
      fillPath(ROUTES.providerAvailability, { id: providerId }),
      { accessToken },
    ),
  );
  return list.items.map(describeSlotRow);
}

/**
 * `POST /providers/me/availability`.
 *
 * Overlaps are the server's rule (T011 owns the invariant); a refusal is shown,
 * not pre-checked.
 */
export async function createSlot(
  context: MentorContext,
  window: { startAt: string; endAt: string },
): Promise<AvailabilitySlotResponse> {
  return context.session.withSession((accessToken) =>
    context.client.post<AvailabilitySlotResponse>(ROUTES.providerMyAvailability, {
      accessToken,
      query: { providerType: PROVIDER_TYPE },
      body: window,
    }),
  );
}

/** `DELETE /providers/me/availability/:id` — only an own, still-open slot. */
export async function deleteSlot(context: MentorContext, slotId: string): Promise<boolean> {
  const response = await context.session.withSession((accessToken) =>
    context.client.delete<{ id: string; deleted: boolean }>(
      fillPath(ROUTES.providerSlot, { id: slotId }),
      { accessToken, query: { providerType: PROVIDER_TYPE } },
    ),
  );
  return response.deleted === true;
}

/**
 * The three provider commands (`specs/06` §Order).
 *
 * They are commands, not status writes, and each one can still be refused: a 409
 * means the order moved on, and the screen reloads.
 */
export async function confirmOrder(context: MentorContext, orderId: string): Promise<OrderRowView> {
  return orderCommand(context, ROUTES.orderConfirm, orderId);
}

export async function startOrder(context: MentorContext, orderId: string): Promise<OrderRowView> {
  return orderCommand(context, ROUTES.orderStart, orderId);
}

export async function completeOrder(
  context: MentorContext,
  orderId: string,
): Promise<OrderRowView> {
  return orderCommand(context, ROUTES.orderComplete, orderId);
}

async function orderCommand(
  context: MentorContext,
  route: string,
  orderId: string,
): Promise<OrderRowView> {
  const order = await context.session.withSession((accessToken) =>
    context.client.post<OrderResponse>(fillPath(route, { id: orderId }), { accessToken }),
  );
  return describeOrder(order);
}
