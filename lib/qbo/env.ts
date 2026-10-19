export type QboEnvironment = 'sandbox' | 'production';

export type QboEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
  webhookVerifier: string | null;
};

/** Null when QuickBooks isn't configured on this deployment. */
export function qboEnv(): QboEnv | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    environment:
      process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    webhookVerifier: process.env.QBO_WEBHOOK_VERIFIER || null,
  };
}

export function qboApiBase(environment: QboEnvironment): string {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

export function qboInvoiceUrl(
  environment: QboEnvironment,
  invoiceId: string
): string {
  const host =
    environment === 'production'
      ? 'app.qbo.intuit.com'
      : 'app.sandbox.qbo.intuit.com';
  return `https://${host}/app/invoice?txnId=${encodeURIComponent(invoiceId)}`;
}

/** A page of the QuickBooks web app, e.g. `/app/recvpayment?txnId=12`. */
export function qboAppUrl(environment: QboEnvironment, path: string): string {
  const host =
    environment === 'production'
      ? 'app.qbo.intuit.com'
      : 'app.sandbox.qbo.intuit.com';
  return `https://${host}${path}`;
}
