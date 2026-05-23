'use client';

import { X } from 'lucide-react';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { addOrderTagAction, removeOrderTagAction } from './tag-actions';

export interface TagChipProps {
  id: string;
  tagName: string;
  isCustomerVisible: boolean;
}

export interface TagDefinitionOption {
  name: string;
  isCustomerVisibleDefault: boolean;
}

export function TagChips({
  orderId,
  tags,
  definitions,
  canEdit,
}: {
  orderId: string;
  tags: TagChipProps[];
  definitions: TagDefinitionOption[];
  canEdit: boolean;
}) {
  const datalistId = useId();
  const [draft, setDraft] = useState('');
  const [visibleToCustomer, setVisibleToCustomer] = useState(false);
  const [pending, startTransition] = useTransition();

  // When the user picks an existing tag (typing the exact name) prefill the
  // visibility checkbox from the dictionary default.
  function handleDraftChange(next: string) {
    setDraft(next);
    const def = definitions.find((d) => d.name === next.trim());
    if (def) setVisibleToCustomer(def.isCustomerVisibleDefault);
  }

  function handleAdd() {
    if (!draft.trim() || pending) return;
    const name = draft.trim();
    startTransition(async () => {
      const result = await addOrderTagAction({
        orderId,
        tagName: name,
        isCustomerVisible: visibleToCustomer,
      });
      if (result.ok) {
        setDraft('');
        setVisibleToCustomer(false);
        toast.success(`Added “${name}”`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRemove(tagName: string) {
    if (pending) return;
    startTransition(async () => {
      const result = await removeOrderTagAction({ orderId, tagName });
      if (result.ok) toast.success(`Removed “${tagName}”`);
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-4">
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tags yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag.id}>
              <TagPill
                tag={tag}
                canRemove={canEdit && !pending}
                onRemove={() => handleRemove(tag.tagName)}
              />
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
          className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Label htmlFor={`tag-input-${orderId}`} className="text-xs text-muted-foreground">
              Add a tag
            </Label>
            <Input
              id={`tag-input-${orderId}`}
              list={datalistId}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              placeholder="e.g. priority, gift-wrap, vip"
              maxLength={50}
              disabled={pending}
            />
            <datalist id={datalistId}>
              {definitions.map((d) => (
                <option key={d.name} value={d.name} />
              ))}
            </datalist>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id={`visible-${orderId}`}
              checked={visibleToCustomer}
              onCheckedChange={(c) => setVisibleToCustomer(c === true)}
              disabled={pending}
            />
            <Label htmlFor={`visible-${orderId}`} className="text-xs font-normal">
              Show to customer
            </Label>
          </div>
          <Button type="submit" disabled={!draft.trim() || pending} size="sm">
            {pending ? 'Saving…' : 'Add'}
          </Button>
        </form>
      )}
    </div>
  );
}

function TagPill({
  tag,
  canRemove,
  onRemove,
}: {
  tag: TagChipProps;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const baseClass = 'inline-flex items-center gap-1';
  return tag.isCustomerVisible ? (
    <Badge variant="secondary" className={`${baseClass} bg-secondary text-secondary-foreground`}>
      <span>{tag.tagName}</span>
      {canRemove && <RemoveButton onClick={onRemove} label={tag.tagName} />}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className={`${baseClass} border-muted-foreground/30 text-muted-foreground`}
      title="Internal-only tag"
    >
      <span>{tag.tagName}</span>
      {canRemove && <RemoveButton onClick={onRemove} label={tag.tagName} />}
    </Badge>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove tag ${label}`}
      className="rounded-full p-0.5 hover:bg-foreground/10"
    >
      <X className="h-3 w-3" aria-hidden />
    </button>
  );
}
