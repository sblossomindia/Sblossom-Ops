'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

import { softDeleteOrderAction } from './delete-actions';

export function DeleteOrderButton({
  orderId,
  orderName,
}: {
  orderId: string;
  orderName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await softDeleteOrderAction({ orderId });
      if (result.ok) {
        toast.success(`${orderName} deleted from production`);
        router.push('/orders/in-production');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={pending}>
          Delete order
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {orderName} from production?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove this order from production. The Shopify order is unaffected.
            The row is hard-purged 30 days from now by the cleanup cron.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? 'Deleting…' : 'Yes, delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
