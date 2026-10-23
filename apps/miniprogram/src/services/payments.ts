import type { MentorContext } from '../app-context';
import { ROUTES, fillPath } from '../core/routes';
import {
  describePaymentSession,
  describePaymentStatus,
  outcomeOf,
  wechatPaymentParams,
} from '../core/payment';
import type { PaymentOutcome, PaymentSessionView, PaymentStatusView } from '../core/payment';
import type { PaymentSessionResponse, PaymentStatusResponse } from '@mentor/api-contracts';

/**
 * Payment use cases (T035b / FE-35).
 *
 * The client asks for a session, hands the provider's own parameters to WeChat,
 * and then **asks the server what happened**. It never decides that an order is
 * paid, and it never sends an amount: both are the platform's job
 * (`specs/08-payment-and-settlement.md`).
 *
 * One seam exists for local development only: with the `MOCK` provider there is
 * no real gateway to call back, so {@link simulateGatewayCallback} plays the
 * provider. It refuses to run for any other provider, so it cannot become a
 * production path.
 */
export async function createPaymentSession(
  context: MentorContext,
  orderId: string,
): Promise<{
  session: PaymentSessionResponse;
  view: PaymentSessionView;
  payParams: ReturnType<typeof wechatPaymentParams>;
}> {
  const session = await context.session.withSession((accessToken) =>
    context.client.post<PaymentSessionResponse>(fillPath(ROUTES.paymentSession, { id: orderId }), {
      accessToken,
    }),
  );

  return {
    session,
    view: describePaymentSession(session),
    payParams: wechatPaymentParams(session.params),
  };
}

export async function readPaymentStatus(
  context: MentorContext,
  orderId: string,
): Promise<{ status: PaymentStatusResponse; view: PaymentStatusView }> {
  const status = await context.session.withSession((accessToken) =>
    context.client.get<PaymentStatusResponse>(fillPath(ROUTES.paymentStatus, { id: orderId }), {
      accessToken,
    }),
  );
  return { status, view: describePaymentStatus(status) };
}

export interface PaymentPollOptions {
  /** How many times to ask before giving up; the answer is still "pending". */
  attempts?: number;
  intervalMs?: number;
  /** Injected so a test does not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after each poll: a screen wants to show progress, not a spinner. */
  onPoll?: (attempt: number, view: PaymentStatusView) => void;
}

/**
 * Ask the server until it knows.
 *
 * Polling stops the moment the payment leaves `PENDING` in either direction; a
 * timeout is not a failure, it is "the server still does not know", and the
 * screen says exactly that instead of guessing.
 */
export async function waitForPayment(
  context: MentorContext,
  orderId: string,
  options: PaymentPollOptions = {},
): Promise<{ outcome: PaymentOutcome; view: PaymentStatusView; polls: number }> {
  const attempts = options.attempts ?? 10;
  const intervalMs = options.intervalMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;

  let last: PaymentStatusView | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { view } = await readPaymentStatus(context, orderId);
    last = view;
    options.onPoll?.(attempt, view);

    if (view.outcome !== 'pending') {
      return { outcome: view.outcome, view, polls: attempt };
    }

    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }

  return { outcome: 'pending', view: last as PaymentStatusView, polls: attempts };
}

/**
 * Play the gateway — local `MOCK` provider only.
 *
 * With the mock adapter nobody calls the notification route, so the order would
 * sit unpaid forever. This posts exactly what a gateway would post, and only
 * when the session says the provider is `MOCK`; with `WECHAT` the notification
 * needs a real signature, so the call would be refused anyway — and the client
 * does not pretend otherwise.
 */
export async function simulateGatewayCallback(
  context: MentorContext,
  session: PaymentSessionResponse,
): Promise<{ applied: boolean; orderStatus: string }> {
  if (session.provider !== 'MOCK') {
    throw new Error('The mock callback is only available with the MOCK provider.');
  }
  if (session.providerTransactionId === null) {
    throw new Error('The session has no provider transaction to confirm.');
  }

  const response = await context.client.post<{
    applied: boolean;
    orderStatus: string;
  }>(ROUTES.paymentNotify, {
    body: {
      orderNo: session.orderNo,
      providerTransactionId: session.providerTransactionId,
      // The platform's own amount: a client-supplied one would be rejected.
      amountMinor: session.amountMinor,
      status: 'SUCCEEDED',
    },
  });

  return { applied: response.applied, orderStatus: response.orderStatus };
}

/** The outcome of a status the screen already has. */
export { outcomeOf };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
