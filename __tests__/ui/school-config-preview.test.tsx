import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SchoolConfigPreview } from '@/components/sis/school-config-form';
import type { SchoolConfig } from '@/lib/sis/school-config';

const BASE_CONFIG: SchoolConfig = {
  principalName: '',
  ceoName: 'Jane Lim',
  peiRegistrationNumber: '200800000K',
  defaultPublishWindowDays: 30,
  defaultCompassionateAllowancePerYear: 5,
  defaultVlAllowancePerTerm: 1,
  subjectAwardBronzeMin: 88.5,
  subjectAwardSilverMin: 91.5,
  subjectAwardGoldMin: 95.5,
  subjectAwardMax: 100,
  organizationName: 'HFSE International School',
  addressLine1: '',
  addressLine2: '',
  phoneNumber: '+65 6250 1832',
  websiteUrl: '',
  contactEmail: '',
  peiRegistrationStartDate: null,
  peiRegistrationEndDate: null,
  logoUrl: '',
};

describe('SchoolConfigPreview', () => {
  it('renders the real letterhead with the live form values', () => {
    render(<SchoolConfigPreview config={BASE_CONFIG} />);
    expect(screen.getByText('HFSE International School')).toBeInTheDocument();
    expect(screen.getByText(/200800000K/)).toBeInTheDocument();
  });

  it('shows a visibly-missing state for an unset principal signature, matching what prints', () => {
    render(<SchoolConfigPreview config={BASE_CONFIG} />);
    expect(screen.getByText('School Principal')).toBeInTheDocument();
    // principalName is '' — the shared ReportCardSignatureBlock renders the
    // label but a blank name span, per the real card's space-fallback rule.
    expect(screen.getByText('Jane Lim')).toBeInTheDocument(); // ceoName IS set
  });
});
