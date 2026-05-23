'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { uploadFile } from '@/lib/uploads/client-upload';

import { replaceMockupAction } from './replace-actions';

type Reason = 'customer_requested_change' | 'design_error' | 'file_corruption' | 'other';

const REASON_LABELS: Record<Reason, string> = {
  customer_requested_change: 'Customer requested change',
  design_error: 'Design error',
  file_corruption: 'File corruption',
  other: 'Other',
};

interface UploadedFile {
  key: string;
  filename: string;
}

export function ReplaceMockupDialog({
  orderItemId,
  orderItemTitle,
}: {
  orderItemId: string;
  orderItemTitle: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // Closing — let the body unmount, which resets local state.
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Replace mockup
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <DialogBody
            orderItemId={orderItemId}
            orderItemTitle={orderItemTitle}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  orderItemId,
  orderItemTitle,
  onDone,
}: {
  orderItemId: string;
  orderItemTitle: string;
  onDone: () => void;
}) {
  const [source, setSource] = useState<UploadedFile | null>(null);
  const [thumb, setThumb] = useState<UploadedFile | null>(null);
  const [reason, setReason] = useState<Reason | ''>('');
  const [notes, setNotes] = useState('');
  const [notify, setNotify] = useState(true);
  const [pending, startTransition] = useTransition();

  const sourceReplaced = !!source;
  const thumbReplaced = !!thumb;
  const customerRequested = reason === 'customer_requested_change';
  const showNotifyOption = sourceReplaced && customerRequested;
  const canSubmit = (sourceReplaced || thumbReplaced) && !!reason && !pending;

  function handleSubmit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await replaceMockupAction({
        orderItemId,
        newSourceKey: source?.key ?? null,
        newThumbnailKey: thumb?.key ?? null,
        reason: reason as Reason,
        notes: notes.trim() || undefined,
        notifyCustomer: showNotifyOption ? notify : false,
      });
      if (result.ok) {
        toast.success('Mockup replaced');
        onDone();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Replace mockup</DialogTitle>
        <DialogDescription className="truncate">{orderItemTitle}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ReplaceSlot
            label="New PSD (≤ 1000 MB)"
            kind="mockup-source"
            orderItemId={orderItemId}
            value={source}
            onChange={setSource}
            forceContentType="application/octet-stream"
            accept=".psd,application/octet-stream"
            disabled={pending}
          />
          <ReplaceSlot
            label="New thumbnail (≤ 5 MB)"
            kind="mockup-thumbnail"
            orderItemId={orderItemId}
            value={thumb}
            onChange={setThumb}
            accept="image/png,image/jpeg,image/webp"
            disabled={pending}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Upload one or both. The previous URLs are saved to{' '}
          <code>mockup_history</code> before being replaced.
        </p>

        <div className="grid gap-1.5">
          <Label htmlFor="replace-reason">Reason</Label>
          <Select
            value={reason}
            onValueChange={(v) => setReason(v as Reason)}
            disabled={pending}
          >
            <SelectTrigger id="replace-reason">
              <SelectValue placeholder="Pick a reason" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(REASON_LABELS) as Reason[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {REASON_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="replace-notes">Notes (optional)</Label>
          <Textarea
            id="replace-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What changed? Anything QC should know."
            rows={2}
            disabled={pending}
          />
        </div>

        {showNotifyOption && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <Checkbox
              id="replace-notify"
              checked={notify}
              onCheckedChange={(c) => setNotify(c === true)}
              disabled={pending}
            />
            <Label htmlFor="replace-notify" className="text-sm font-normal">
              Send <code>mockup_updated</code> WhatsApp to customer
            </Label>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {pending ? 'Replacing…' : 'Replace'}
        </Button>
      </DialogFooter>
    </>
  );
}

/* ── Reusable upload slot (local to this dialog) ────────────────────────── */

function ReplaceSlot(props: {
  label: string;
  kind: 'mockup-source' | 'mockup-thumbnail';
  orderItemId: string;
  value: UploadedFile | null;
  onChange: (next: UploadedFile | null) => void;
  forceContentType?: string;
  accept: string;
  disabled: boolean;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploading = progress !== null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting the same file

    setError(null);
    setProgress(0);
    try {
      const { key } = await uploadFile({
        kind: props.kind,
        orderItemId: props.orderItemId,
        file,
        contentType: props.forceContentType,
        onProgress: setProgress,
      });
      props.onChange({ key, filename: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{props.label}</Label>
      {props.value ? (
        <div className="flex items-center justify-between rounded-md border bg-secondary/30 px-3 py-2 text-sm">
          <span className="truncate">
            <span className="mr-2 text-primary">✓</span>
            {props.value.filename}
          </span>
          <button
            type="button"
            onClick={() => props.onChange(null)}
            disabled={props.disabled}
            className="ml-3 shrink-0 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      ) : uploading ? (
        <div className="rounded-md border border-dashed px-3 py-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span>Uploading…</span>
            <span className="font-mono text-xs">{Math.round(progress ?? 0)}%</span>
          </div>
          <Progress value={progress ?? 0} />
        </div>
      ) : (
        <Input type="file" accept={props.accept} onChange={handleFile} disabled={props.disabled} />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
