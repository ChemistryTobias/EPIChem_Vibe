/** Sample tracking endpoints (Roadmap 3, plan §7.3). */

import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type { Sample, SampleDetail, SampleState } from "./types";

const enc = encodeURIComponent;

export interface SampleFields {
  name?: string;
  description?: string | null;
  substance?: string | null;
  amount_value?: number | null;
  amount_unit?: string | null;
  notes?: string | null;
}

export const samplesApi = {
  list: () => apiGet<Sample[]>("/samples?limit=500"),
  get: (id: string) => apiGet<SampleDetail>(`/samples/${enc(id)}`),
  create: (body: SampleFields & { name: string; station_uuid?: string | null }) =>
    apiPost<SampleDetail>("/samples", body),
  update: (id: string, body: SampleFields) => apiPatch<SampleDetail>(`/samples/${enc(id)}`, body),
  remove: (id: string) => apiDelete(`/samples/${enc(id)}`),
  addEvent: (id: string, body: { to_state: SampleState; reason?: string | null; station_uuid?: string | null }) =>
    apiPost<SampleDetail>(`/samples/${enc(id)}/events`, body),
};

/**
 * Plan §7.3's lifecycle — a mirror of `TRANSITIONS` in
 * `backend/app/modules/sample_tracking/samples/schema.py`. Only used to offer
 * the right buttons; the backend is what enforces it.
 */
const LIVE_EXTRA: SampleState[] = ["quarantined"];
export const TRANSITIONS: Record<SampleState, SampleState[]> = {
  registered: ["staged", "reserved", "disposed", ...LIVE_EXTRA],
  staged: ["reserved", "registered", ...LIVE_EXTRA],
  reserved: ["in_process", "staged", "registered", ...LIVE_EXTRA],
  in_process: ["processed", ...LIVE_EXTRA],
  processed: ["in_process", "characterized", "consumed", "disposed", "archived", ...LIVE_EXTRA],
  characterized: ["in_process", "archived", "consumed", "disposed", ...LIVE_EXTRA],
  archived: ["staged", ...LIVE_EXTRA],
  quarantined: ["registered", "disposed"],
  consumed: [],
  disposed: [],
};

export const SAMPLE_STATES = Object.keys(TRANSITIONS) as SampleState[];
