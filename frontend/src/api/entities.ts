/**
 * Per-entity endpoint wrappers.
 *
 * Every device-management entity has the identical five-route shape
 * (list / get / create / patch / delete), so one factory covers all of them
 * rather than six near-identical files.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type { Device, Group, Lab, Module, Site, Station, User, Zone } from "./types";

function crud<T>(plural: string) {
  const one = (id: string) => `/${plural}/${encodeURIComponent(id)}`;
  return {
    plural,
    list: () => apiGet<T[]>(`/${plural}?limit=500`),
    get: (id: string) => apiGet<T>(one(id)),
    create: (body: unknown) => apiPost<T>(`/${plural}`, body),
    update: (id: string, body: unknown) => apiPatch<T>(one(id), body),
    remove: (id: string) => apiDelete(one(id)),
  };
}

export const sitesApi = crud<Site>("sites");
export const labsApi = crud<Lab>("labs");
export const zonesApi = crud<Zone>("zones");
export const stationsApi = crud<Station>("stations");
export const modulesApi = crud<Module>("modules");
export const devicesApi = crud<Device>("devices");

/** The endpoints for a kind, for code that works on whatever is selected
 * rather than on one entity — the inspector's editor, the layout's writes. */
export const API_BY_KIND = {
  Site: sitesApi,
  Lab: labsApi,
  Zone: zonesApi,
  Station: stationsApi,
  Module: modulesApi,
  Device: devicesApi,
} as const;

/** Identity (`app/core/access_control/`): the same five routes, plus group members. */
export const usersApi = crud<User>("users");
export const groupsApi = {
  ...crud<Group>("groups"),
  members: (id: string) => apiGet<string[]>(`/groups/${encodeURIComponent(id)}/members`),
  addMember: (id: string, user: string) => apiPost<void>(`/groups/${encodeURIComponent(id)}/members/${user}`, undefined),
  removeMember: (id: string, user: string) => apiDelete(`/groups/${encodeURIComponent(id)}/members/${user}`),
};
