/**
 * Workflow manager endpoints (Roadmap 2): what a station's pod can run, the
 * procedures composed from that, and the runs dispatched to it.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  Device,
  ExecutionStatus,
  Palette,
  Procedure,
  ProcedureStep,
  Run,
  StationQueue,
  ValidationResult,
} from "./types";

const enc = encodeURIComponent;

export const executionApi = {
  status: (station: string) => apiGet<ExecutionStatus>(`/stations/${enc(station)}/execution`),
  palette: (station: string) => apiGet<Palette>(`/stations/${enc(station)}/execution/palette`),
  queue: (station: string) => apiGet<StationQueue>(`/stations/${enc(station)}/execution/queue`),
  openEnvironment: (station: string) => apiPost<void>(`/stations/${enc(station)}/execution/environment/open`, undefined),
  startQueue: (station: string) => apiPost<void>(`/stations/${enc(station)}/execution/queue/start`, undefined),
  registerDevices: (station: string) => apiPost<Device[]>(`/stations/${enc(station)}/execution/devices/register`, undefined),
};

export interface ProcedureBody {
  name?: string;
  description?: string | null;
  station_uuid?: string | null;
  steps?: ProcedureStep[];
}

export const proceduresApi = {
  list: () => apiGet<Procedure[]>("/procedures?limit=500"),
  get: (id: string) => apiGet<Procedure>(`/procedures/${enc(id)}`),
  create: (body: ProcedureBody) => apiPost<Procedure>("/procedures", body),
  update: (id: string, body: ProcedureBody) => apiPatch<Procedure>(`/procedures/${enc(id)}`, body),
  remove: (id: string) => apiDelete(`/procedures/${enc(id)}`),
  validate: (station_uuid: string | null, steps: ProcedureStep[]) =>
    apiPost<ValidationResult>("/procedures/validate", { station_uuid, steps }),
  compile: (id: string) => apiGet<{ items: unknown[] }>(`/procedures/${enc(id)}/compile`),
};

export interface NewRun {
  procedure_uuid: string;
  sample?: {
    name?: string;
    substance?: string;
    amount_value?: number;
    amount_unit?: string;
    description?: string;
  };
  autostart?: boolean;
}

export const runsApi = {
  list: () => apiGet<Run[]>("/runs?limit=200"),
  get: (id: string) => apiGet<Run>(`/runs/${enc(id)}`),
  create: (body: NewRun) => apiPost<Run>("/runs", body),
  stop: (id: string) => apiPost<Run>(`/runs/${enc(id)}/stop`, undefined),
  abort: (id: string) => apiPost<Run>(`/runs/${enc(id)}/abort`, undefined),
};

export const TERMINAL_RUN_STATES = ["completed", "failed", "stopped"];
