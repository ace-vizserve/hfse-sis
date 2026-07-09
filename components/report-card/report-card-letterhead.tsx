import { Globe, Mail, Phone } from 'lucide-react';

import type { SchoolConfig } from '@/lib/sis/school-config';

function formatPeiDate(iso: string | null): string | null {
  if (!iso) return null;
  // Append T00:00:00 so Date parses in local time, not UTC (KD #32).
  return new Date(iso + 'T00:00:00').toLocaleString('en-SG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function ReportCardLetterhead({ config }: { config: SchoolConfig }) {
  const start = formatPeiDate(config.peiRegistrationStartDate);
  const end = formatPeiDate(config.peiRegistrationEndDate);
  const peiPeriod = start && end ? `${start} – ${end}` : null;
  const showPei = config.peiRegistrationNumber || peiPeriod;

  return (
    <div
      className="flex w-full overflow-hidden [print-color-adjust:exact]"
      style={{
        aspectRatio: '1166 / 186',
      }}
    >
      {/* Logo — flex item, sits over the white left area of the bg image */}
      <div className="flex w-[27%] shrink-0 items-center justify-center px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={config.logoUrl || '/hfse-logo.webp'}
          alt={config.organizationName || 'School logo'}
          className="h-auto w-full max-w-[200px] object-contain"
          style={{ maxHeight: '80%' }}
        />
      </div>

      {/* Info — flex item, sits over the dark blue right area of the bg image */}
      <div
        className="w-full flex flex-1 flex-col justify-center gap-0.5 px-6 py-4 text-right text-white"
        style={{
          backgroundImage:
            "url('/report-card/reference/report-card-header-bg.png')",
          backgroundSize: '100% 100%',
        }}
      >
        {config.organizationName && (
          <p className="font-sans text-[14px] font-bold leading-tight text-white">
            {config.organizationName}
          </p>
        )}
        {config.addressLine1 && (
          <p className="text-[10px] leading-tight text-white">
            {config.addressLine1}
          </p>
        )}
        {config.addressLine2 && (
          <p className="text-[10px] leading-tight text-white">
            {config.addressLine2}
          </p>
        )}
        {(config.phoneNumber || config.websiteUrl || config.contactEmail) && (
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[10px] text-white">
            {config.phoneNumber && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3 shrink-0" />
                {config.phoneNumber}
              </span>
            )}
            {config.websiteUrl && (
              <span className="inline-flex items-center gap-1">
                <Globe className="size-3 shrink-0" />
                {config.websiteUrl.replace(/^https?:\/\//, '')}
              </span>
            )}
            {config.contactEmail && (
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3 shrink-0" />
                {config.contactEmail}
              </span>
            )}
          </div>
        )}
        {showPei && (
          <>
            <p className="text-[10px] leading-tight text-white/90">
              {config.peiRegistrationNumber && (
                <>PEI Registration No. {config.peiRegistrationNumber}</>
              )}
            </p>

            <p className="text-[10px] leading-tight text-white/90">
              {peiPeriod && <>Registration Period: {peiPeriod}</>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
