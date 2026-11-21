import { verifyWebhookPayload } from './infrai_client.ts';

export type VerificationWebhookEvent = {
  webhookId: string;
  domain: string;
  status: 'verified';
};

export function applyVerificationWebhook(input: {
  rawBody: string;
  signature: string;
  secret: string;
}): VerificationWebhookEvent {
  const valid = verifyWebhookPayload(input.secret, input.rawBody, input.signature);
  if (!valid) {
    throw new Error('Invalid webhook signature.');
  }

  const parsed = JSON.parse(input.rawBody) as VerificationWebhookEvent;
  if (!parsed.webhookId) {
    throw new Error('Webhook delivery is missing webhookId.');
  }

  return parsed;
}
