import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReportCardSignatureBlock } from '@/components/report-card/report-card-signature-block';

describe('ReportCardSignatureBlock', () => {
  it('T4 (isFinal): renders adviser, principal, and CEO lines', () => {
    render(
      <ReportCardSignatureBlock
        isFinal
        formClassAdviser="Maria T."
        principalName="Dr. Santos"
        ceoName="Jane Lim"
      />
    );
    expect(screen.getByText('Maria T.')).toBeInTheDocument();
    expect(screen.getByText('Dr. Santos')).toBeInTheDocument();
    expect(screen.getByText('Jane Lim')).toBeInTheDocument();
    expect(screen.getByText('Form Teacher')).toBeInTheDocument();
    expect(screen.getByText('School Principal')).toBeInTheDocument();
    expect(screen.getByText('Founder & CEO')).toBeInTheDocument();
  });

  it('T4: falls back to "Form Teacher" name when no adviser, and a blank space (not omitted) for empty principal/CEO', () => {
    render(
      <ReportCardSignatureBlock
        isFinal
        formClassAdviser={null}
        principalName=""
        ceoName=""
      />
    );
    // Adviser name falls back to the literal "Form Teacher" text — it will
    // match both the name <p> and the role-label <p> below it (both render
    // the string "Form Teacher"), so assert there are two matches.
    expect(screen.getAllByText('Form Teacher')).toHaveLength(2);
    // principal/CEO name nodes render but are visually blank (`|| ' '`) —
    // assert the role labels are still present (the space fallback keeps
    // the layout, per the real report-card-document.tsx rule).
    expect(screen.getByText('School Principal')).toBeInTheDocument();
    expect(screen.getByText('Founder & CEO')).toBeInTheDocument();
  });

  it('interim (T1-T3): renders only the Parent Signature block, no adviser/principal/CEO names', () => {
    render(
      <ReportCardSignatureBlock
        isFinal={false}
        formClassAdviser="Maria T."
        principalName="Dr. Santos"
        ceoName="Jane Lim"
      />
    );
    expect(screen.getByText("Parent's Signature")).toBeInTheDocument();
    expect(screen.queryByText('Maria T.')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Santos')).not.toBeInTheDocument();
    expect(screen.queryByText('Jane Lim')).not.toBeInTheDocument();
  });
});
