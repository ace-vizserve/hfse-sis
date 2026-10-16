export function createdButNotSaved(docNumber: string | undefined): string {
  return `QuickBooks created invoice ${docNumber ?? '(no number)'}, but the SIS couldn't save it. Use Link QB invoice to attach it — don't create it again.`;
}

type ItemLite = {
  Id: string;
  Name: string;
  SalesTaxCodeRef?: { value: string };
};

export function buildInvoiceLines(
  lines: Array<{
    itemId: string;
    description?: string;
    qty: number;
    unitPrice: number;
  }>,
  items: Map<string, ItemLite>
): Array<Record<string, unknown>> {
  return lines.map((l) => {
    const item = items.get(l.itemId);
    if (!item) {
      throw new Error(
        'One of the items is no longer in QuickBooks. Reopen the drawer and pick again.'
      );
    }
    const amount = Math.round(l.qty * l.unitPrice * 100) / 100;
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      ...(l.description?.trim() ? { Description: l.description.trim() } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: item.Id, name: item.Name },
        Qty: l.qty,
        UnitPrice: l.unitPrice,
        // The item's own tax code — "what QuickBooks applies by default".
        ...(item.SalesTaxCodeRef
          ? { TaxCodeRef: { value: item.SalesTaxCodeRef.value } }
          : {}),
      },
    };
  });
}
