/**
 * The fields that tell the next refresh "this change was handled" (state,
 * payment date, number). They are saved only once the stage is in step, so a
 * failed stage write is seen as a change again and retried.
 */
export function handledFields(args: {
  state: string;
  paymentDate: string | null;
  docNumber: string | null;
  stageInStep: boolean;
}): {
  state?: string;
  payment_date?: string | null;
  doc_number?: string | null;
} {
  if (!args.stageInStep) return {};
  return {
    state: args.state,
    payment_date: args.paymentDate,
    doc_number: args.docNumber,
  };
}
