'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { uploadFile } from '@/lib/uploads/client-upload';

import { submitQcAction } from './qc-actions';

export interface QcFormItem {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  mockupThumbnailViewUrl: string | null;
  /** Existing QC photo key from DB (server-rendered signed URL pair below). */
  existingQcPhotoKey: string | null;
  existingQcPhotoUrl: string | null;
  existingQcStatus: 'passed' | 'failed' | null;
  existingQcFailureReason: string | null;
}

interface ItemState {
  itemId: string;
  /** Key to persist on submit. Initially the DB key (if any); replaced by
   *  new uploads. Empty string = no photo. */
  photoKey: string;
  /** URL to *display* — DB signed URL OR a local blob URL after upload. */
  photoViewUrl: string;
  /** True if photoKey came from this session's upload (vs DB). Used so the
   *  "Replace" link works correctly. */
  photoIsNew: boolean;
  qcStatus: 'passed' | 'failed' | null;
  qcFailReason: string;
  uploading: boolean;
  progress: number | null;
  uploadError: string | null;
}

function initialState(item: QcFormItem): ItemState {
  return {
    itemId: item.id,
    photoKey: item.existingQcPhotoKey ?? '',
    photoViewUrl: item.existingQcPhotoUrl ?? '',
    photoIsNew: false,
    qcStatus: item.existingQcStatus,
    qcFailReason: item.existingQcFailureReason ?? '',
    uploading: false,
    progress: null,
    uploadError: null,
  };
}

export function QcForm({ orderId, items }: { orderId: string; items: QcFormItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [states, setStates] = useState<ItemState[]>(() => items.map(initialState));

  function patch(itemId: string, p: Partial<ItemState>) {
    setStates((prev) => prev.map((s) => (s.itemId === itemId ? { ...s, ...p } : s)));
  }

  const reviewed = states.filter((s) => s.qcStatus !== null).length;
  const total = states.length;

  const validity = states.map((s) => {
    if (s.qcStatus === 'passed' && !s.photoKey) return 'photo';
    if (s.qcStatus === 'failed' && s.qcFailReason.trim().length === 0) return 'reason';
    if (s.qcStatus === null) return 'unreviewed';
    return 'ok' as const;
  });
  const canSubmit =
    reviewed === total && validity.every((v) => v === 'ok') && !pending;

  function handleSubmit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await submitQcAction({
        orderId,
        items: states.map((s) => ({
          orderItemId: s.itemId,
          qcStatus: s.qcStatus as 'passed' | 'failed',
          qcPhotoKey: s.photoKey || null,
          qcFailureReason: s.qcStatus === 'failed' ? s.qcFailReason.trim() : null,
        })),
      });
      if (result.ok) {
        toast.success(result.message);
        router.push('/orders/qc');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div>
      <ul className="space-y-4 pb-32">
        {items.map((item) => {
          const state = states.find((s) => s.itemId === item.id)!;
          return (
            <li key={item.id}>
              <ItemCard
                item={item}
                state={state}
                onPatch={(p) => patch(item.id, p)}
                disabled={pending}
              />
            </li>
          );
        })}
      </ul>

      {/* Sticky bottom action bar — thumb-reachable on mobile, fixed across
          full viewport width (escapes the container constraint). */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="container mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {reviewed} of {total} reviewed
          </span>
          <Button onClick={handleSubmit} disabled={!canSubmit} size="lg" className="min-h-[48px]">
            {pending ? 'Saving…' : 'Save QC'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Per-item card ──────────────────────────────────────────────────────── */

function ItemCard({
  item,
  state,
  onPatch,
  disabled,
}: {
  item: QcFormItem;
  state: ItemState;
  onPatch: (p: Partial<ItemState>) => void;
  disabled: boolean;
}) {
  const passDisabled = !state.photoKey;
  const passSelected = state.qcStatus === 'passed';
  const failSelected = state.qcStatus === 'failed';

  return (
    <Card
      className={cn(
        passSelected && 'border-primary/50 bg-primary/5',
        failSelected && 'border-destructive/50 bg-destructive/5',
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="truncate leading-tight">
            {item.title}
            {item.variantTitle && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {item.variantTitle}
              </span>
            )}
            {item.quantity > 1 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">× {item.quantity}</span>
            )}
          </span>
          <StatusBadge status={state.qcStatus} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mockup reference */}
        <div>
          <Label className="text-xs text-muted-foreground">Reference (from production)</Label>
          <div className="mt-1 overflow-hidden rounded-md border bg-muted">
            {item.mockupThumbnailViewUrl ? (
              <a
                href={item.mockupThumbnailViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.mockupThumbnailViewUrl}
                  alt={`Reference for ${item.title}`}
                  className="max-h-56 w-full object-contain"
                />
              </a>
            ) : (
              <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                No reference thumbnail
              </div>
            )}
          </div>
        </div>

        {/* QC photo */}
        <PhotoSlot state={state} onPatch={onPatch} disabled={disabled} orderItemId={item.id} />

        {/* Pass / Fail */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            size="lg"
            variant={passSelected ? 'default' : 'outline'}
            className="min-h-[48px]"
            disabled={passDisabled || disabled}
            onClick={() => onPatch({ qcStatus: 'passed' })}
            aria-pressed={passSelected}
          >
            {passSelected ? '✓ Pass' : 'Pass'}
          </Button>
          <Button
            type="button"
            size="lg"
            variant={failSelected ? 'destructive' : 'outline'}
            className={cn('min-h-[48px]', !failSelected && 'border-destructive/30 text-destructive hover:bg-destructive/10')}
            disabled={disabled}
            onClick={() => onPatch({ qcStatus: 'failed' })}
            aria-pressed={failSelected}
          >
            {failSelected ? '✕ Fail' : 'Fail'}
          </Button>
        </div>

        {passDisabled && state.qcStatus !== 'failed' && (
          <p className="text-xs text-muted-foreground">
            Take a QC photo before marking this item as passed.
          </p>
        )}

        {/* Fail reason */}
        {failSelected && (
          <div className="grid gap-1.5">
            <Label htmlFor={`reason-${item.id}`}>Reason for failure *</Label>
            <Textarea
              id={`reason-${item.id}`}
              value={state.qcFailReason}
              onChange={(e) => onPatch({ qcFailReason: e.target.value })}
              placeholder="What's wrong — be specific. Production reads this."
              rows={3}
              disabled={disabled}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── QC photo slot (capture / upload / preview / replace) ───────────────── */

function PhotoSlot({
  state,
  onPatch,
  disabled,
  orderItemId,
}: {
  state: ItemState;
  onPatch: (p: Partial<ItemState>) => void;
  disabled: boolean;
  orderItemId: string;
}) {
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting the same file

    // Generate an instant local preview so the QC employee sees their shot
    // before R2 acks. We swap to the signed URL only on a fresh page load.
    const localUrl = URL.createObjectURL(file);
    onPatch({ uploading: true, progress: 0, uploadError: null });

    try {
      const { key } = await uploadFile({
        kind: 'qc-photo',
        orderItemId,
        file,
        // Force JPEG MIME so the signed URL is consistent — phone cameras
        // sometimes give us "image/jpg" or nothing.
        contentType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        onProgress: (pct) => onPatch({ progress: pct }),
      });
      onPatch({
        photoKey: key,
        photoViewUrl: localUrl,
        photoIsNew: true,
        uploading: false,
        progress: null,
      });
    } catch (err) {
      URL.revokeObjectURL(localUrl);
      onPatch({
        uploading: false,
        progress: null,
        uploadError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function clear() {
    if (state.photoIsNew && state.photoViewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.photoViewUrl);
    }
    onPatch({ photoKey: '', photoViewUrl: '', photoIsNew: false, uploadError: null });
  }

  return (
    <div>
      <Label className="text-xs text-muted-foreground">QC photo *</Label>
      {state.photoKey ? (
        <div className="mt-1 space-y-2">
          <div className="overflow-hidden rounded-md border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.photoViewUrl}
              alt="QC photo"
              className="max-h-72 w-full object-contain"
            />
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={disabled || state.uploading}
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            Replace photo
          </button>
        </div>
      ) : state.uploading ? (
        <div className="mt-1 rounded-md border border-dashed px-3 py-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span>Uploading…</span>
            <span className="font-mono text-xs">{Math.round(state.progress ?? 0)}%</span>
          </div>
          <Progress value={state.progress ?? 0} />
        </div>
      ) : (
        <Input
          type="file"
          accept="image/*"
          capture="environment"
          className="mt-1"
          onChange={handleFile}
          disabled={disabled}
        />
      )}
      {state.uploadError && <p className="mt-1 text-xs text-destructive">{state.uploadError}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: 'passed' | 'failed' | null }) {
  if (status === 'passed') {
    return (
      <Badge variant="secondary" className="bg-primary/15 text-primary">
        Pass
      </Badge>
    );
  }
  if (status === 'failed') {
    return <Badge variant="destructive">Fail</Badge>;
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Awaiting
    </Badge>
  );
}
