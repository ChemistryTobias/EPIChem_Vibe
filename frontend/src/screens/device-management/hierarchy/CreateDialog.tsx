/**
 * Create one device-management entity.
 *
 * One form for all six kinds: they differ only in which parent they need, so
 * a small spec table drives the endpoint and the parent field and everything
 * else — name, description — is shared. Geometry is left out on purpose: the
 * backend places a new object in a free slot near its siblings by itself.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { devicesApi, labsApi, modulesApi, sitesApi, stationsApi, zonesApi } from "../../../api/entities";
import type { EntityKind, ObjectBase } from "../../../api/types";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { Dialog, DialogField } from "../../../components/Dialog";

const APIS = {
  Site: sitesApi,
  Lab: labsApi,
  Zone: zonesApi,
  Station: stationsApi,
  Module: modulesApi,
  Device: devicesApi,
} as const;

const KINDS = Object.keys(APIS) as EntityKind[];

/** Which parent each kind needs, and what it's called in the request body.
 * A site has none; a zone groups either a site or a lab. */
const PARENTS: Partial<Record<EntityKind, { field: string; label: string; from: EntityKind[] }>> = {
  Lab: { field: "site_uuid", label: "Site", from: ["Site"] },
  Zone: { field: "parent_uuid", label: "Parent", from: ["Site", "Lab"] },
  Station: { field: "lab_uuid", label: "Lab", from: ["Lab"] },
  Module: { field: "station_uuid", label: "Station", from: ["Station"] },
  Device: { field: "station_uuid", label: "Station", from: ["Station"] },
};

export function CreateDialog({ kind: initial, onClose }: { kind: EntityKind; onClose: () => void }) {
  const [kind, setKind] = useState<EntityKind>(initial);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parent, setParent] = useState("");
  const queryClient = useQueryClient();

  // The parent lists, already cached by the tree and the tables.
  const sites = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list });
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });

  const spec = PARENTS[kind];
  // Only the name and the uuid matter here, so the kinds collapse to their base.
  const lists: Partial<Record<EntityKind, ObjectBase[]>> = {
    Site: sites.data,
    Lab: labs.data,
    Station: stations.data,
  };
  const options = (spec?.from ?? []).flatMap((from) => lists[from] ?? []);

  // A station is no parent for a lab — switching kind invalidates the choice.
  useEffect(() => setParent(""), [kind]);

  const create = useMutation({
    mutationFn: (): Promise<unknown> =>
      APIS[kind].create({
        name,
        description: description || null,
        ...(spec ? { [spec.field]: parent } : {}),
      }),
    onSuccess: async () => {
      // Everything on screen counts children, so refresh the lot.
      await queryClient.invalidateQueries();
      onClose();
    },
  });

  return (
    <Dialog title={`New ${kind.toLowerCase()}`} onClose={onClose}>
      <form
        className="dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <DialogField label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as EntityKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </DialogField>

        <DialogField label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </DialogField>

        <DialogField label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </DialogField>

        {spec && (
          <DialogField label={spec.label}>
            <select value={parent} onChange={(e) => setParent(e.target.value)} required>
              <option value="">Choose a {spec.label.toLowerCase()}…</option>
              {options.map((row) => (
                <option key={row.uuid} value={row.uuid}>
                  {row.name}
                </option>
              ))}
            </select>
          </DialogField>
        )}

        {spec && options.length === 0 && (
          <Alert kind="info">Create a {spec.label.toLowerCase()} first — there's none to put this in.</Alert>
        )}

        {create.isError && <Alert kind="error">{(create.error as Error).message}</Alert>}

        <div className="dialog__actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
