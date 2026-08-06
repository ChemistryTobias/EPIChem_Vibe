/** Sample endpoints (`api/routers/samples.py`, ADR 0005). */

import { apiDelete, apiGet, apiGetPage, apiPost, apiPut, query } from "./client";
import type { Sample, SampleWrite } from "./types";

export interface SampleFilters {
  state?: string;
  owner?: string;
  substance?: string;
  /** Substring match against code, name and substance. */
  q?: string;
  limit?: number;
  offset?: number;
}

export const listSamples = (filters: SampleFilters = {}) =>
  apiGetPage<Sample>(`/samples${query(filters)}`);

export const getSample = (ident: string) => apiGet<Sample>(`/samples/${encodeURIComponent(ident)}`);

export const createSample = (body: SampleWrite) => apiPost<Sample>("/samples", body);

/** PUT is a full replace — send every field, not just the changed ones. */
export const replaceSample = (ident: string, body: SampleWrite) =>
  apiPut<Sample>(`/samples/${encodeURIComponent(ident)}`, body);

export const deleteSample = (ident: string) => apiDelete(`/samples/${encodeURIComponent(ident)}`);
