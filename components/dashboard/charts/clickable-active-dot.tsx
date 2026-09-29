'use client';

import * as React from 'react';
import { Dot, type ActiveDotProps } from 'recharts';

import {
  ACTIVE_DOT,
  CLICKABLE_STYLE,
  reportSegment,
  type SegmentClickHandler,
} from './chart-primitives';

/**
 * The `activeDot` of a clickable line or area series. A line has no bar to
 * click, so the clickable part is the point under the pointer — which is
 * where the reader's pointer already is. It is drawn exactly as `ACTIVE_DOT`
 * draws it; only the pointer is new. On a chart with a comparison line, each
 * line's own dot reports its own series, so clicking last year's point opens
 * last year.
 */
export function clickableActiveDot({
  fill,
  categoryKey,
  series,
  onSegmentClick,
}: {
  fill: string;
  categoryKey: string;
  series?: string;
  onSegmentClick: SegmentClickHandler;
}) {
  return function ClickableActiveDot(props: ActiveDotProps) {
    return (
      <g
        style={CLICKABLE_STYLE}
        onClick={() =>
          reportSegment(onSegmentClick, props.payload, categoryKey, series)
        }
      >
        <Dot cx={props.cx} cy={props.cy} {...ACTIVE_DOT} fill={fill} />
      </g>
    );
  };
}
