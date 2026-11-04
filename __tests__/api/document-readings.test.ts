import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();
const getUser = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: { getUser },
    from: () => ({ upsert }),
  }),
}));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => ({ limited: false }),
  userRateLimit: () => ({ limited: false }),
  tooManyRequests: () => new Response(null, { status: 429 }),
}));

const SUPABASE = 'https://project.supabase.co';
const FILE = `${SUPABASE}/storage/v1/object/public/parent-portal/ay2027/documents/1_passport.pdf`;
const BODY = {
  fileUrl: FILE,
  status: 'read',
  passports: [{ expiry: '2030-11-14', number: 'P1234567A' }],
  quality: {
    pages: 1,
    totalPages: 2,
    fileBytes: 1000,
    hasText: false,
    width: null,
    height: null,
    sharpness: 900,
    inkRatio: 0.1,
    brightness: 200,
    contrast: 40,
  },
  enteredNumber: 'P1234567A',
  enteredExpiry: '2030-11-14',
};

async function post(body: unknown, token: string | null = 'token') {
  const { POST } = await import('@/app/api/parent/v2/document-readings/route');
  return POST(
    new Request('http://sis/api/parent/v2/document-readings', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  upsert.mockReset().mockResolvedValue({ error: null });
  getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('POST /api/parent/v2/document-readings', () => {
  it('stores the reading, keeping the first one written for a file', async () => {
    const response = await post(BODY);

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      {
        file_url: FILE,
        status: 'read',
        passports: BODY.passports,
        quality: BODY.quality,
        entered_number: 'P1234567A',
        entered_expiry: '2030-11-14',
        submitted_by: 'user-1',
      },
      { onConflict: 'file_url', ignoreDuplicates: true }
    );
  });

  it('takes a document that only had its quality measured', async () => {
    const response = await post({
      ...BODY,
      status: 'not_read',
      passports: [],
      enteredNumber: null,
      enteredExpiry: null,
    });

    expect(response.status).toBe(200);
  });

  it('needs a signed-in parent', async () => {
    expect((await post(BODY, null)).status).toBe(401);

    getUser.mockResolvedValue({
      data: { user: null },
      error: new Error('bad'),
    });
    expect((await post(BODY)).status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a malformed reading', async () => {
    expect((await post({ ...BODY, status: 'approved' })).status).toBe(400);
    expect((await post({ ...BODY, enteredExpiry: 'soon' })).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a file outside our document bucket', async () => {
    const response = await post({
      ...BODY,
      fileUrl: 'https://evil.example/x.pdf',
    });

    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports a failed save without leaking the database error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    upsert.mockResolvedValue({ error: { message: 'secret detail' } });

    const response = await post(BODY);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'could not save the reading',
    });
    logged.mockRestore();
  });
});
