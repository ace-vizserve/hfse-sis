'use client';

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// Create invoice from a list page: pick the customer, then their page opens
// with the invoice form, as QuickBooks asks for the customer first.
export function CreateInvoicePicker({
  customers,
}: {
  customers: Array<{ studentNumber: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button>
          Create invoice
          <ChevronDown className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Choose a customer" />
          <CommandList>
            <CommandEmpty>No linked customer by that name.</CommandEmpty>
            {customers.map((c) => (
              <CommandItem
                key={c.studentNumber}
                value={`${c.name} ${c.studentNumber}`}
                onSelect={() => {
                  setOpen(false);
                  router.push(
                    `/billing/${encodeURIComponent(c.studentNumber)}?new=invoice`
                  );
                }}
              >
                <span className="flex-1 truncate">{c.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {c.studentNumber}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
