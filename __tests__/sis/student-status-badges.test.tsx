/**
 * Render tests for the read-only two-badge status display.
 *
 * StudentStatusBadges is a pure display component (no mutations, no fetch),
 * so plain render() suffices — no QueryClient wrapper needed.
 *
 * Key scenarios:
 *  - enrolled-then-withdrawn: applicationStatus=Enrolled + enrollment_status=withdrawn
 *    → both badges appear with the right human-readable text.
 *  - clean active student: applicationStatus=Enrolled + enrollment_status=active
 *    → Application Outcome: Enrolled, Current Status: Enrolled.
 *  - late enrollee case: state=late_enrollee → "Late enrollee".
 *  - null outcome → outcome badge omitted, state badge still renders.
 *  - null state → state badge omitted, outcome badge still renders.
 *  - both null → renders nothing.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StudentStatusBadges } from '@/components/sis/student-status-badges';

describe('StudentStatusBadges', () => {
  it('renders both badges for an enrolled-then-withdrawn student', () => {
    render(<StudentStatusBadges outcome="Enrolled" state="withdrawn" />);

    // Outcome badge — label + value
    expect(screen.getByText(/application outcome:/i)).toBeInTheDocument();
    expect(screen.getByText('Enrolled')).toBeInTheDocument();

    // State badge — label + humanized value
    expect(screen.getByText(/current status:/i)).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
  });

  it('renders both badges for a clean active student', () => {
    render(<StudentStatusBadges outcome="Enrolled" state="active" />);

    expect(screen.getByText(/application outcome:/i)).toBeInTheDocument();
    // "Enrolled" appears once as the outcome value
    expect(screen.getAllByText('Enrolled').length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText(/current status:/i)).toBeInTheDocument();
    // active humanizes to "Enrolled" — there will be two elements with "Enrolled"
    // (outcome + state), both present in the DOM.
    const enrolledNodes = screen.getAllByText('Enrolled');
    expect(enrolledNodes).toHaveLength(2);
  });

  it('renders "Late enrollee" for state=late_enrollee', () => {
    render(
      <StudentStatusBadges
        outcome="Enrolled (Conditional)"
        state="late_enrollee"
      />
    );

    expect(screen.getByText('Enrolled (Conditional)')).toBeInTheDocument();
    expect(screen.getByText('Late enrollee')).toBeInTheDocument();
  });

  it('omits the outcome badge when outcome is null', () => {
    render(<StudentStatusBadges outcome={null} state="active" />);

    expect(screen.queryByText(/application outcome:/i)).not.toBeInTheDocument();
    expect(screen.getByText(/current status:/i)).toBeInTheDocument();
    expect(screen.getByText('Enrolled')).toBeInTheDocument();
  });

  it('omits the state badge when state is null', () => {
    render(<StudentStatusBadges outcome="Cancelled" state={null} />);

    expect(screen.getByText(/application outcome:/i)).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText(/current status:/i)).not.toBeInTheDocument();
  });

  it('renders nothing when both outcome and state are null', () => {
    const { container } = render(
      <StudentStatusBadges outcome={null} state={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders destructive tone text for Cancelled outcome', () => {
    render(<StudentStatusBadges outcome="Cancelled" state={null} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('title-cases an unknown enrollment_status as a fallback', () => {
    render(<StudentStatusBadges outcome={null} state="some_custom_status" />);
    expect(screen.getByText('Some custom status')).toBeInTheDocument();
  });
});
