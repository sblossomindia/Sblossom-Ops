'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { uploadFile } from '@/lib/uploads/client-upload';

import { submitOrderForProduction, type SubmitPayload } from './actions';

interface ItemProps {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
}

interface OrderProps {
  id: string;
  shopifyOrderNumber: string;
  totalAmount: string | null;
}

interface ItemState {
  orderItemId: string;
  sourceKey: string;
  sourceFilename: string;
  thumbnailKey: string;
  thumbnailFilename: string;
  namesText: string;
  customizationNotes: string;
  sourceProgress: number | null;
  thumbProgress: number | null;
  sourceError: string | null;
  thumbError: string | null;
}

function initialItemState(item: ItemProps): ItemState {
  return {
    orderItemId: item.id,
    sourceKey: '',
    sourceFilename: '',
    thumbnailKey: '',
    thumbnailFilename: '',
    namesText: '',
    customizationNotes: '',
    sourceProgress: null,
    thumbProgress: null,
    sourceError: null,
    thumbError: null,
  };
}

export function OrderForm({ order, items }: { order: OrderProps; items: ItemProps[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [itemStates, setItemStates] = useState<ItemState[]>(() => items.map(initialItemState));
  const [paymentMode, setPaymentMode] = useState<'prepaid' | 'cod'>('prepaid');
  const [codAmount, setCodAmount] = useState<string>(order.totalAmount ?? '');

  function patchItem(orderItemId: string, patch: Partial<ItemState>) {
    setItemStates((prev) =>
      prev.map((s) => (s.orderItemId === orderItemId ? { ...s, ...patch } : s)),
    );
  }

  const completeness = useMemo(() => {
    const done = itemStates.filter(
      (s) => s.sourceKey && s.thumbnailKey && s.namesText.trim().length > 0,
    ).length;
    return { done, total: itemStates.length };
  }, [itemStates]);

  const codValid = paymentMode !== 'cod' || (codAmount && parseFloat(codAmount) > 0);
  const isComplete = completeness.done === completeness.total && codValid;

  function handleSubmit() {
    if (!isComplete || pending) return;

    const payload: SubmitPayload = {
      orderId: order.id,
      paymentMode,
      codAmount: paymentMode === 'cod' ? codAmount : undefined,
      items: itemStates.map((s) => ({
        orderItemId: s.orderItemId,
        mockupSourceKey: s.sourceKey,
        mockupThumbnailKey: s.thumbnailKey,
        namesText: s.namesText.trim(),
        customizationNotes: s.customizationNotes.trim() || undefined,
      })),
    };

    startTransition(async () => {
      const result = await submitOrderForProduction(payload);
      if (result.ok) {
        toast.success(`#${order.shopifyOrderNumber} moved to In Production`);
        router.push('/orders/new');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Line items</h2>
        <div className="space-y-4">
          {items.map((item) => {
            const state = itemStates.find((s) => s.orderItemId === item.id)!;
            return (
              <ItemCard
                key={item.id}
                item={item}
                state={state}
                onPatch={(patch) => patchItem(item.id, patch)}
                disabled={pending}
              />
            );
          })}
        </div>
      </section>

      <PaymentSection
        mode={paymentMode}
        codAmount={codAmount}
        onModeChange={setPaymentMode}
        onCodAmountChange={setCodAmount}
        disabled={pending}
      />

      <div className="flex items-center justify-between border-t pt-4">
        <div className="text-sm text-muted-foreground">
          {completeness.done} of {completeness.total} items ready
          {paymentMode === 'cod' && !codValid && ' · COD amount missing'}
        </div>
        <Button onClick={handleSubmit} disabled={!isComplete || pending} size="lg">
          {pending ? 'Submitting…' : 'Move to In Production'}
        </Button>
      </div>
    </div>
  );
}

/* ── Item card ──────────────────────────────────────────────────────────── */

function ItemCard({
  item,
  state,
  onPatch,
  disabled,
}: {
  item: ItemProps;
  state: ItemState;
  onPatch: (patch: Partial<ItemState>) => void;
  disabled: boolean;
}) {
  const itemComplete =
    state.sourceKey && state.thumbnailKey && state.namesText.trim().length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>
            {item.title}
            {item.variantTitle && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {item.variantTitle}
              </span>
            )}
            {item.quantity > 1 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                × {item.quantity}
              </span>
            )}
          </span>
          {itemComplete ? (
            <Badge variant="secondary" className="bg-primary/15 text-primary">
              Ready
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Incomplete
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FileSlot
            label="PSD source (≤ 1000 MB)"
            kind="mockup-source"
            orderItemId={item.id}
            currentKey={state.sourceKey}
            currentFilename={state.sourceFilename}
            progress={state.sourceProgress}
            error={state.sourceError}
            // Force application/octet-stream for PSDs — browsers don't agree
            // on a MIME type and the signed URL must match what we PUT with.
            forceContentType="application/octet-stream"
            accept=".psd,application/octet-stream"
            disabled={disabled}
            onProgress={(pct) => onPatch({ sourceProgress: pct })}
            onUploaded={(key, filename) =>
              onPatch({ sourceKey: key, sourceFilename: filename, sourceProgress: null, sourceError: null })
            }
            onError={(message) => onPatch({ sourceError: message, sourceProgress: null })}
            onClear={() =>
              onPatch({ sourceKey: '', sourceFilename: '', sourceProgress: null, sourceError: null })
            }
          />
          <FileSlot
            label="Thumbnail (≤ 5 MB)"
            kind="mockup-thumbnail"
            orderItemId={item.id}
            currentKey={state.thumbnailKey}
            currentFilename={state.thumbnailFilename}
            progress={state.thumbProgress}
            error={state.thumbError}
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled}
            onProgress={(pct) => onPatch({ thumbProgress: pct })}
            onUploaded={(key, filename) =>
              onPatch({
                thumbnailKey: key,
                thumbnailFilename: filename,
                thumbProgress: null,
                thumbError: null,
              })
            }
            onError={(message) => onPatch({ thumbError: message, thumbProgress: null })}
            onClear={() =>
              onPatch({
                thumbnailKey: '',
                thumbnailFilename: '',
                thumbProgress: null,
                thumbError: null,
              })
            }
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`names-${item.id}`}>Names *</Label>
          <Input
            id={`names-${item.id}`}
            value={state.namesText}
            onChange={(e) => onPatch({ namesText: e.target.value })}
            placeholder="e.g. Sharma Family"
            disabled={disabled}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`notes-${item.id}`}>Customization notes</Label>
          <Textarea
            id={`notes-${item.id}`}
            value={state.customizationNotes}
            onChange={(e) => onPatch({ customizationNotes: e.target.value })}
            placeholder="Cursive font, special placement, etc. (optional)"
            rows={2}
            disabled={disabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ── File slot (upload + progress + replace) ────────────────────────────── */

function FileSlot(props: {
  label: string;
  kind: 'mockup-source' | 'mockup-thumbnail';
  orderItemId: string;
  currentKey: string;
  currentFilename: string;
  progress: number | null;
  error: string | null;
  forceContentType?: string;
  accept: string;
  disabled: boolean;
  onProgress: (pct: number) => void;
  onUploaded: (key: string, filename: string) => void;
  onError: (message: string) => void;
  onClear: () => void;
}) {
  const uploading = props.progress !== null;
  const hasFile = !!props.currentKey;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // reset the input so re-selecting the same file fires onChange again
    e.target.value = '';

    props.onProgress(0);
    try {
      const { key } = await uploadFile({
        kind: props.kind,
        orderItemId: props.orderItemId,
        file,
        contentType: props.forceContentType,
        onProgress: (pct) => props.onProgress(pct),
      });
      props.onUploaded(key, file.name);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{props.label}</Label>

      {hasFile ? (
        <div className="flex items-center justify-between rounded-md border bg-secondary/30 px-3 py-2 text-sm">
          <span className="truncate">
            <span className="mr-2 text-primary">✓</span>
            {props.currentFilename || 'Uploaded'}
          </span>
          <button
            type="button"
            onClick={props.onClear}
            disabled={props.disabled}
            className="ml-3 shrink-0 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            Replace
          </button>
        </div>
      ) : uploading ? (
        <div className="rounded-md border border-dashed px-3 py-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span>Uploading…</span>
            <span className="font-mono text-xs">{Math.round(props.progress ?? 0)}%</span>
          </div>
          <Progress value={props.progress ?? 0} />
        </div>
      ) : (
        <Input
          type="file"
          accept={props.accept}
          onChange={handleFile}
          disabled={props.disabled}
        />
      )}

      {props.error && <p className="text-xs text-destructive">{props.error}</p>}
    </div>
  );
}

/* ── Payment section ────────────────────────────────────────────────────── */

function PaymentSection({
  mode,
  codAmount,
  onModeChange,
  onCodAmountChange,
  disabled,
}: {
  mode: 'prepaid' | 'cod';
  codAmount: string;
  onModeChange: (mode: 'prepaid' | 'cod') => void;
  onCodAmountChange: (amount: string) => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={mode}
          onValueChange={(v) => onModeChange(v as 'prepaid' | 'cod')}
          disabled={disabled}
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="prepaid" id="pm-prepaid" />
            <Label htmlFor="pm-prepaid" className="font-normal">
              Prepaid
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="cod" id="pm-cod" />
            <Label htmlFor="pm-cod" className="font-normal">
              Cash on Delivery
            </Label>
          </div>
        </RadioGroup>

        {mode === 'cod' && (
          <div className="grid max-w-xs gap-1.5">
            <Label htmlFor="cod-amount">COD amount (₹)</Label>
            <Input
              id="cod-amount"
              type="number"
              min="1"
              step="0.01"
              value={codAmount}
              onChange={(e) => onCodAmountChange(e.target.value)}
              disabled={disabled}
              placeholder="0.00"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
