'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { BillingSettings } from '@/lib/billing/settings.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The QuickBooks bank accounts Record payment offers (HFSE: UOB, PayNow,
// Credit/Debit Card), in the order chosen here.
export function DepositAccountsCard({
  settings,
}: {
  settings: BillingSettings;
}) {
  const run = useWriteAction();
  const [chosen, setChosen] = React.useState<
    Array<{ id: string; label: string }>
  >(() => settings.depositAccounts.map((d) => ({ id: d.id, label: d.label })));
  const names = new Map(settings.depositChoices.map((c) => [c.id, c.name]));
  const save = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/billing/settings/deposit-accounts',
        jsonInit('PUT', { accounts: chosen.map((c, i) => ({ ...c, sort: i })) })
      ),
  });
  const toggle = (id: string, on: boolean) =>
    setChosen((s) =>
      on
        ? [...s, { id, label: names.get(id) ?? id }]
        : s.filter((c) => c.id !== id)
    );
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Record payment
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight">
          Payment accounts
        </CardTitle>
        <CardAction>
          <Button
            variant="default"
            disabled={
              chosen.length === 0 ||
              chosen.length > 10 ||
              chosen.some((c) => !c.label.trim())
            }
            loading={save.isPending}
            loadingText="Saving…"
            onClick={() =>
              run(() => save.mutateAsync(), {
                pending: 'Saving payment accounts…',
                success: 'Payment accounts saved',
              })
            }
          >
            Save accounts
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Tick the accounts payments go into. Record payment lists them in the
          order ticked, under the name you give here. Up to 10.
        </p>
        {settings.depositChoicesError && (
          <FieldError>{settings.depositChoicesError}</FieldError>
        )}
        {settings.depositChoices.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
              <span className="flex-1 pl-7">QuickBooks account</span>
              <span className="w-56">Shown in Record payment as</span>
            </div>
            {settings.depositChoices.map((c) => {
              const pick = chosen.find((x) => x.id === c.id);
              return (
                <div
                  key={c.id}
                  className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
                >
                  <Checkbox
                    id={`dep-${c.id}`}
                    checked={!!pick}
                    onCheckedChange={(v) => toggle(c.id, v === true)}
                    aria-label={c.name}
                  />
                  <label
                    htmlFor={`dep-${c.id}`}
                    className="flex-1 text-sm text-foreground"
                  >
                    {c.name}
                  </label>
                  {pick ? (
                    <Input
                      value={pick.label}
                      maxLength={60}
                      onChange={(e) =>
                        setChosen((s) =>
                          s.map((x) =>
                            x.id === c.id ? { ...x, label: e.target.value } : x
                          )
                        )
                      }
                      aria-label={`Label for ${c.name}`}
                      className="h-8 w-56"
                    />
                  ) : (
                    <span className="w-56 text-sm text-muted-foreground">
                      Not offered
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {settings.depositChoices.length === 0 &&
          !settings.depositChoicesError && (
            <p className="text-sm text-muted-foreground">
              Connect QuickBooks to choose from its bank accounts.
            </p>
          )}
      </CardContent>
    </Card>
  );
}
