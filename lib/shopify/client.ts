/**
 * Shopify Admin GraphQL client. Outbound calls only — webhooks come in as
 * REST-format JSON which is handled by the route handlers directly.
 *
 * No retries here yet. Add when we have real call sites (tag sync in 1.12,
 * backfill in 4.10). Shopify returns rate-limit info in `extensions.cost`;
 * we'll wire that in when we need it.
 */
import { env } from '@/lib/env';

const API_VERSION = '2025-10';

export class ShopifyAPIError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ShopifyAPIError';
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: string[]; extensions?: unknown }>;
  extensions?: Record<string, unknown>;
}

/**
 * Run a GraphQL query/mutation against the Shopify Admin API.
 *
 * Throws ShopifyAPIError on HTTP failure or top-level GraphQL errors. Per-field
 * `userErrors` (Shopify's domain validation pattern) are still in `data` — the
 * caller must check them.
 */
export async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!env.SHOPIFY_STORE_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error('Shopify credentials not configured (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN)');
  }

  const url = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<unreadable>');
    throw new ShopifyAPIError(res.status, text, `Shopify HTTP ${res.status}`);
  }

  const body = (await res.json()) as GraphQLResponse<T>;

  if (body.errors?.length) {
    throw new ShopifyAPIError(200, body.errors, `Shopify GraphQL: ${body.errors[0]!.message}`);
  }

  if (!body.data) {
    throw new ShopifyAPIError(200, body, 'Shopify GraphQL: empty data');
  }

  return body.data;
}
