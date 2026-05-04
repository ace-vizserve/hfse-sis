"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { LoginSchema, type LoginInput } from "@/lib/schemas/login";
import { createClient } from "@/lib/supabase/client";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-hairline bg-white px-3.5 text-[15px] text-ink shadow-input outline-none transition placeholder:text-ink-5 focus:border-brand-indigo focus:ring-4 focus:ring-brand-indigo/10 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/10";

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      form.setError("password", { message: error.message });
      toast.error(error.message);
      return;
    }
    router.replace("/");
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Faculty Portal</p>
              <h1 className="mt-3 font-serif text-[34px] font-semibold leading-[1.05] tracking-tight text-ink">
                Welcome back.
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-3">
                Sign in with your HFSE staff credentials to continue.
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="block text-[13px] font-medium text-ink-2">Work email</FormLabel>
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
                        <FormLabel className="block text-[13px] font-medium text-ink-2">Password</FormLabel>
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-pressed={showPassword}
                          className="text-[12px] font-medium text-ink-4 transition hover:text-ink">
                          {showPassword ? "Hide" : "Show"}
                        </button>
                      </div>
                      <FormControl>
                        <input
                          type={showPassword ? "text" : "password"}
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
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-[14px] font-medium text-white shadow-button transition-all duration-150 hover:from-brand-indigo-light hover:to-brand-indigo hover:shadow-button-hover active:translate-y-px active:shadow-button-active focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-indigo/25 disabled:cursor-not-allowed disabled:opacity-80">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? "Signing in…" : "Sign in"}
                </button>

                <p className="pt-1 text-center text-[13px] text-ink-4">
                  Forgot your password? Contact the registrar&apos;s office.
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

      {/* ───────────────── Brand column ───────────────── */}
      <aside className="relative hidden overflow-hidden bg-brand-navy lg:block">
        {/* Layer 1 — top-left indigo glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse 60% 50% at 15% 10%, rgba(99,102,241,0.28), transparent 65%)",
          }}
        />
        {/* Layer 2 — bottom-right sky glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse 50% 40% at 90% 90%, rgba(14,165,233,0.14), transparent 60%)",
          }}
        />
        {/* Layer 3 — hairline grid with radial mask */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
          }}
        />

        {/* Content */}
        <div className="relative flex h-full flex-col justify-between p-14 text-white">
          {/* Top: lockup */}
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-white/15 backdrop-blur-sm">
              <Image src="/hfse-logo-favicon.webp" alt="" width={44} height={44} className="size-8" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="font-serif text-[15px] font-semibold tracking-tight">HFSE International School</span>
              <span className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">
                Singapore · AY2026
              </span>
            </div>
          </div>

          {/* Center: glass product-glimpse card */}
          <div className="flex flex-1 items-center justify-center py-12">
            <div className="w-full max-w-sm -rotate-[1.5deg] rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-glass-card backdrop-blur-xl">
              {/* Window chrome */}
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#FF5F57]" />
                <span className="size-2 rounded-full bg-[#FEBC2E]" />
                <span className="size-2 rounded-full bg-[#28C840]" />
                <span className="ml-3 truncate font-mono text-[10px] text-white/40">
                  /grading / sec-1a
                </span>
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                  Mathematics · Sec-1A · Q3
                </p>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Stat label="Students" value="24" />
                  <Stat label="Status" value="Locked" accent />
                  <Stat label="Average" value="87.4" />
                </div>

                {/* Progress */}
                <div className="mt-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-white/40">Entries complete</span>
                    <span className="font-mono text-[10px] tabular-nums text-white/60">82%</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-brand-indigo-soft to-brand-sky" />
                  </div>
                </div>

                <p className="mt-4 font-mono text-[10px] text-white/40">Last edited 2h ago · 3 pending totals</p>
              </div>
            </div>
          </div>

          {/* Bottom: trust row */}
          <div className="flex items-center justify-between border-t border-white/10 pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
            <div className="flex items-center gap-3">
              <span>✓ Secured</span>
              <span className="text-white/20">·</span>
              <span>✓ Audited</span>
              <span className="text-white/20">·</span>
              <span>✓ Compliant</span>
            </div>
            <span>&copy; {new Date().getFullYear()} HFSE</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</span>
      <span className={`font-serif text-[22px] leading-none tabular-nums ${accent ? "text-brand-mint" : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}
