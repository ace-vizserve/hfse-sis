-- Migration 073 — publication "publish anyway" override snapshot.
-- Records what soft-completeness gaps were present when a registrar published a
-- report-card window past the soft warnings ("publish anyway"). Null means the
-- card published clean (no soft gaps). See KD #28/#129/#138.
ALTER TABLE report_card_publications
  ADD COLUMN IF NOT EXISTS published_with_gaps jsonb;

COMMENT ON COLUMN report_card_publications.published_with_gaps IS
  'Null = published clean. Object = soft-gap snapshot at "publish anyway" override time: { gaps: [{code,label,count}], by, at }.';
