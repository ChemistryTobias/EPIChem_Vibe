/**
 * A station's execution binding, live: is its pod reachable, what is it doing,
 * and which of its devices EPIChem knows about. "Register devices" creates a
 * registry Device for every pod device that has none yet — what makes a new
 * station's instruments show up everywhere else in the console.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { executionApi } from "../../api/workflows";
import type { Station } from "../../api/types";
import { Button } from "../Button";
import { Field, FieldGroup } from "../Inspector";
import { StatusPill } from "../StatusPill";

export function ExecutionSection({ station }: { station: Station }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["execution", station.uuid],
    queryFn: () => executionApi.status(station.uuid),
    enabled: Boolean(station.queueserver_url),
    refetchInterval: 5000,
  });
  const palette = useQuery({
    queryKey: ["palette", station.uuid],
    queryFn: () => executionApi.palette(station.uuid),
    enabled: Boolean(station.queueserver_url && status.data?.reachable),
  });
  const register = useMutation({
    mutationFn: () => executionApi.registerDevices(station.uuid),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  if (!station.queueserver_url) {
    return (
      <FieldGroup title="Execution">
        <p className="muted">
          Not executable — set a queueserver URL (the station pod&apos;s HTTP server) to run workflows here.
        </p>
      </FieldGroup>
    );
  }

  const s = status.data;
  const podDevices = Object.keys(palette.data?.devices ?? {});
  const missing = podDevices.filter((d) => !palette.data?.registered.includes(d));

  return (
    <FieldGroup title="Execution">
      <Field label="Pod">
        {status.isPending ? (
          <span className="muted">checking…</span>
        ) : s?.reachable && s.status ? (
          <>
            <StatusPill status={s.status.worker_environment_exists ? s.status.manager_state : "closed"} />{" "}
            <span className="muted">{s.status.items_in_queue} queued</span>
          </>
        ) : (
          <span title={s?.error ?? undefined}>
            <StatusPill status="unreachable" />
          </span>
        )}
      </Field>
      {palette.data && (
        <Field label="Devices in the pod">
          <span className="mono">
            {podDevices.map((d) => (
              <span key={d} className={missing.includes(d) ? "muted" : undefined}>
                {d}{" "}
              </span>
            ))}
          </span>
        </Field>
      )}
      {missing.length > 0 && (
        <p>
          <Button size="sm" onClick={() => register.mutate()} disabled={register.isPending}>
            {register.isPending ? "Registering…" : `Register ${missing.length} device${missing.length === 1 ? "" : "s"}`}
          </Button>
        </p>
      )}
      {register.isError && <p className="create__error">{(register.error as Error).message}</p>}
    </FieldGroup>
  );
}
