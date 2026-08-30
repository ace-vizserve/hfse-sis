'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { LoginSchema, type LoginInput } from '@/lib/schemas/login';
import { createClient } from '@/lib/supabase/client';

const INPUT_CLASS =
  'h-11 w-full rounded-lg border border-hairline bg-white px-3.5 text-[15px] text-ink shadow-input outline-none transition placeholder:text-ink-5 focus:border-brand-indigo focus:ring-4 focus:ring-brand-indigo/10 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/10';

/** Current year, read on the client after mount — see the call site. */
function CopyrightYear() {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return <>{year}</>;
}

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginInput) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      form.setError('password', { message: error.message });
      toast.error(error.message);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  const loading = form.formState.isSubmitting;

  return (
    <div className="grid min-h-svh bg-white lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* ───────────────── Form column ───────────────── */}
      <div className="relative flex flex-col px-6 py-10 sm:px-10 lg:px-16 lg:py-14">
        {/* Lockup */}
        <div className="flex items-center">
          <Image
            src="/hfse-logo.webp"
            alt="HFSE SIS"
            width={180}
            height={72}
            className="hidden md:block"
            priority
          />
        </div>

        {/* Form */}
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="mb-10">
              <Image
                src="/hfse-logo.webp"
                alt="HFSE SIS"
                width={160}
                height={52}
                className="block md:hidden"
                priority
              />
            </div>
            <div className="mb-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">
                Faculty Portal
              </p>
              <h1 className="mt-3 font-serif text-[34px] font-semibold leading-[1.05] tracking-tight text-ink">
                Welcome back.
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-3">
                Sign in with your HFSE staff credentials to continue.
              </p>
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                noValidate
                className="space-y-5"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="block text-[13px] font-medium text-ink-2">
                        Work email
                      </FormLabel>
                      <FormControl>
                        <input
                          type="email"
                          autoComplete="email"
                          autoFocus
                          placeholder="you@hfse.edu.sg"
                          className={INPUT_CLASS}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <FormLabel className="block text-[13px] font-medium text-ink-2">
                          Password
                        </FormLabel>
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-pressed={showPassword}
                          className="text-[12px] font-medium text-ink-4 transition hover:text-ink"
                        >
                          {showPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <FormControl>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          className={INPUT_CLASS}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-[14px] font-medium text-white shadow-button transition-all duration-150 hover:from-brand-indigo-light hover:to-brand-indigo hover:shadow-button-hover active:translate-y-px active:shadow-button-active focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-indigo/25 disabled:cursor-not-allowed disabled:opacity-80"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>

                <p className="pt-1 text-center text-[13px] text-ink-4">
                  Forgot your password? Contact IT Support.
                </p>
              </form>
            </Form>
          </div>
        </div>

        {/* Trust footer */}
        <div className="mt-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-5">
          <Lock className="size-3" strokeWidth={2.25} />
          <span>Encrypted (TLS 1.3)</span>
          <span className="text-hairline-strong">·</span>
          <span>Secure sign-in</span>
        </div>
      </div>

      {/* ───────────────── Brand column (HFSE identity) ───────────────── */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-indigo via-brand-indigo-deep to-brand-navy text-white lg:block">
        {/* Soft brand glows — token-based, no raw color */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-28 -top-24 size-[26rem] rounded-full bg-brand-indigo-soft/30 blur-[120px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -right-20 size-[22rem] rounded-full bg-brand-amber/25 blur-[110px]"
        />
        {/* Faint crest watermark */}
        <Image
          src="/hfse-logo-favicon.webp"
          alt=""
          aria-hidden="true"
          width={520}
          height={520}
          className="pointer-events-none absolute -bottom-20 -right-16 size-[34rem] opacity-[0.05]"
        />

        {/* Content */}
        <div className="relative flex h-full flex-col justify-between p-14">
          {/* Top: wordmark lockup */}
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm">
              <Image
                src="/hfse-logo-favicon.webp"
                alt=""
                width={44}
                height={44}
                className="size-8"
              />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="font-serif text-[15px] font-semibold tracking-tight">
                HFSE International School
              </span>
              <span className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-white/55">
                Singapore · AY2026
              </span>
            </div>
          </div>

          {/* Center: crest hero + tagline + accent */}
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="flex size-24 items-center justify-center rounded-3xl bg-white/10 ring-1 ring-white/15 shadow-brand-tile backdrop-blur-md">
              <Image
                src="/hfse-logo-favicon.webp"
                alt="HFSE crest"
                width={120}
                height={120}
                className="size-14"
                priority
              />
            </span>
            <h2 className="mt-8 max-w-sm font-serif text-[30px] font-semibold leading-[1.15] tracking-tight">
              Every student&apos;s journey, in one trusted record.
            </h2>
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-white/65">
              From application to report card — admissions, attendance, grades
              and evaluation, all in one secure place.
            </p>
            {/* Amber accent chip */}
            <div className="mt-8 inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 backdrop-blur-sm">
              <span className="size-1.5 rounded-full bg-brand-amber" />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/70">
                EduTrust Certified · Singapore
              </span>
            </div>
          </div>

          {/* Bottom: trust row */}
          <div className="flex items-center justify-between border-t border-white/10 pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
            <div className="flex items-center gap-3">
              <span>Secured</span>
              <span className="text-white/20">·</span>
              <span>Audited</span>
              <span className="text-white/20">·</span>
              <span>PDPA-aligned</span>
            </div>
            {/* Year resolved after mount, not during render. `new Date()` in a
                prerendered Client Component bakes the build year into the
                static shell, so Cache Components rejects it. The footer simply
                reads "© HFSE" for the first frame. */}
            <span>
              &copy; <CopyrightYear /> HFSE
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
