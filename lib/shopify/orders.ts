/**
 * Shopify Admin GraphQL mutations for orders. Keep one helper per logical
 * action; map our REST-style numeric `shopify_order_id` to the GraphQL GID.
 */
import { env } from '@/lib/env';

import { shopifyGraphQL } from './client';

interface UserError {
  field?: string[] | null;
  message: string;
}

interface TagsMutationResult {
  tagsAdd?: { node: { id: string } | null; userErrors: UserError[] };
  tagsRemove?: { node: { id: string } | null; userErrors: UserError[] };
}

const TAGS_ADD = /* GraphQL */ `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

const TAGS_REMOVE = /* GraphQL */ `
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

function orderGid(shopifyOrderId: string): string {
  return `gid://shopify/Order/${shopifyOrderId}`;
}

export class ShopifyTagPushError extends Error {
  constructor(message: string, public readonly userErrors?: UserError[]) {
    super(message);
    this.name = 'ShopifyTagPushError';
  }
}

export async function addShopifyOrderTags(
  shopifyOrderId: string,
  tags: string[],
): Promise<void> {
  if (tags.length === 0) return;
  if (env.MOCK_SHOPIFY) {
    console.warn(`[shopify:mock] tagsAdd order=${shopifyOrderId} tags=${tags.join(',')}`);
    return;
  }
  const result = await shopifyGraphQL<TagsMutationResult>(TAGS_ADD, {
    id: orderGid(shopifyOrderId),
    tags,
  });
  const errs = result.tagsAdd?.userErrors ?? [];
  if (errs.length > 0) {
    throw new ShopifyTagPushError(`tagsAdd: ${errs.map((e) => e.message).join('; ')}`, errs);
  }
}

export async function removeShopifyOrderTags(
  shopifyOrderId: string,
  tags: string[],
): Promise<void> {
  if (tags.length === 0) return;
  if (env.MOCK_SHOPIFY) {
    console.warn(`[shopify:mock] tagsRemove order=${shopifyOrderId} tags=${tags.join(',')}`);
    return;
  }
  const result = await shopifyGraphQL<TagsMutationResult>(TAGS_REMOVE, {
    id: orderGid(shopifyOrderId),
    tags,
  });
  const errs = result.tagsRemove?.userErrors ?? [];
  if (errs.length > 0) {
    throw new ShopifyTagPushError(`tagsRemove: ${errs.map((e) => e.message).join('; ')}`, errs);
  }
}
