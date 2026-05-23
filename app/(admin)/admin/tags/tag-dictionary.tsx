'use client';

import { Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import {
  createTagDefinitionAction,
  deleteTagDefinitionAction,
  updateTagDefinitionAction,
} from './actions';

export interface TagDictionaryRow {
  id: string;
  name: string;
  isCustomerVisibleDefault: boolean;
  usageCount: number;
}

export function TagDictionary({ initialRows }: { initialRows: TagDictionaryRow[] }) {
  const [draftName, setDraftName] = useState('');
  const [draftVisible, setDraftVisible] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    if (!draftName.trim() || pending) return;
    const name = draftName.trim();
    startTransition(async () => {
      const result = await createTagDefinitionAction({
        name,
        isCustomerVisibleDefault: draftVisible,
      });
      if (result.ok) {
        setDraftName('');
        setDraftVisible(false);
        toast.success(`Created “${name}”`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleToggleVisibility(row: TagDictionaryRow, next: boolean) {
    startTransition(async () => {
      const result = await updateTagDefinitionAction({
        id: row.id,
        isCustomerVisibleDefault: next,
      });
      if (!result.ok) toast.error(result.error);
    });
  }

  function handleDelete(row: TagDictionaryRow) {
    if (row.usageCount > 0) {
      if (
        !confirm(
          `“${row.name}” is attached to ${row.usageCount} order${
            row.usageCount === 1 ? '' : 's'
          }. Deleting only removes it from the dictionary — existing attachments stay. Continue?`,
        )
      ) {
        return;
      }
    }
    startTransition(async () => {
      const result = await deleteTagDefinitionAction({ id: row.id });
      if (result.ok) toast.success(`Removed “${row.name}”`);
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add a tag</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <Label htmlFor="new-tag-name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input
                id="new-tag-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. priority"
                maxLength={50}
                disabled={pending}
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id="new-tag-visible"
                checked={draftVisible}
                onCheckedChange={(c) => setDraftVisible(c === true)}
                disabled={pending}
              />
              <Label htmlFor="new-tag-visible" className="text-xs font-normal">
                Customer-visible by default
              </Label>
            </div>
            <Button type="submit" disabled={!draftName.trim() || pending} size="sm">
              {pending ? 'Saving…' : 'Create'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Dictionary list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Dictionary ({initialRows.length} tag{initialRows.length === 1 ? '' : 's'})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {initialRows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No tags defined yet. Tags also get created automatically when an employee adds a
              new name on an order.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Customer-visible default</th>
                  <th className="px-4 py-2 font-medium">Used by</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {initialRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={row.isCustomerVisibleDefault}
                        onCheckedChange={(c) => handleToggleVisibility(row, c)}
                        disabled={pending}
                        aria-label={`Toggle customer visibility for ${row.name}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.usageCount} order{row.usageCount === 1 ? '' : 's'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(row)}
                        disabled={pending}
                        aria-label={`Delete ${row.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Changing the customer-visible default only affects <em>new</em> tag attachments. Existing{' '}
        <code>order_tags</code> rows keep their per-row visibility flag.
      </p>
    </div>
  );
}
