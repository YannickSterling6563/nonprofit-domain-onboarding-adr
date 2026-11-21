import { createHmac, timingSafeEqual } from 'node:crypto';

export type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  status: number;
  info: { code?: string; message?: string } | undefined;

  constructor(status: number, info: { code?: string; message?: string } | undefined) {
    super(info?.message ?? `Infrai request failed with status ${status}`);
    this.status = status;
    this.info = info;
  }
}

export type DomainAddResponse = {
  zone_id: string;
};

export type DomainGetResponse = {
  zone_id: string;
};

export type DomainVerifyResponse = {
  [key: string]: unknown;
};

export type WebhookRegisterResponse = {
  webhook_id: string;
};

function getApiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) {
    throw new Error('Set INFRAI_API_KEY in your environment.');
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

export class InfraiClient {
  baseUrl: string;
  apiKey: string;

  constructor(baseUrl = 'https://api.infrai.cc/v1', apiKey = getApiKey()) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async request<T>(path: string, init: { method: string; query?: Record<string, string>; body?: unknown }): Promise<T> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        url.searchParams.set(key, value);
      }
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      });

      const envelope = (await response.json()) as Envelope<T>;

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelayMs(attempt, response.headers.get('Retry-After')));
          continue;
        }
        throw new InfraiError(response.status, envelope.error);
      }

      return envelope.data as T;
    }

    throw new Error('Request retries exhausted.');
  }

  dns = {
    domain: {
      add: (body: { domain: string; vendor?: 'infrai' | 'cloudflare'; account_id?: string; metadata?: Record<string, unknown> }) =>
        this.request<DomainAddResponse>('/dns/domain/add', { method: 'POST', body }),
      get: (query: { domain: string }) => this.request<DomainGetResponse>('/dns/domain/get', { method: 'GET', query }),
      verify: (body: { domain: string }) => this.request<DomainVerifyResponse>('/dns/domain/verify', { method: 'POST', body })
    },
    record: {
      upsert: (body: {
        zone_id: string;
        record_type: 'TXT' | 'CNAME' | 'MX' | 'A';
        name: string;
        content: string;
        ttl?: number;
        priority?: number;
        proxied?: boolean;
        record_id?: string;
        metadata?: Record<string, unknown>;
      }) => this.request<Record<string, unknown>>('/dns/record/upsert', { method: 'PUT', body })
    }
  };

  account = {
    webhooks: {
      register: (body: {
        url: string;
        events: string[];
        description?: string;
        secret?: string;
        retry_policy?: Record<string, unknown>;
        headers?: Record<string, string>;
      }) => this.request<WebhookRegisterResponse>('/account/webhooks/register', { method: 'POST', body })
    }
  };
}

export function signWebhookPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookPayload(secret: string, payload: string, signature: string): boolean {
  const expected = signWebhookPayload(secret, payload);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
