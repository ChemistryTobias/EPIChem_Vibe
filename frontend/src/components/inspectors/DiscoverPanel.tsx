/**
 * New device, discovered first (plan §6.2, Roadmap 1.3): the station pods
 * that have announced themselves (`epichem-pod serve --epichem …`) or that a
 * URL probe found, with one click to bring each in — as a new station in a
 * lab, or linked to an existing station — registering its devices. Nothing
 * is added until a person picks it here; that's the confirmation §6.2 asks for.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { labsApi, stationsApi } from "../../api/entities";
import type { DiscoveredPod } from "../../api/types";
import { discoveryApi } from "../../api/workflows";
import { Alert } from "../Alert";
import { Button } from "../Button";
import { Glyph, deviceGlyph } from "../glyphs";
import { Field, FieldGroup } from "../Inspector";

import "./DiscoverPanel.css";

export function DiscoverPanel({ onManual, onAdopted }: { onManual: () => void; onAdopted: (stationUuid: string) => void }) {
  const queryClient = useQueryClient();
  const pods = useQuery({ queryKey: ["discovered-pods"], queryFn: discoveryApi.pods, refetchInterval: 5000 });
  const [url, setUrl] = useState("");
  const probe = useMutation({
    mutationFn: () => discoveryApi.probe(url),
    onSuccess: () => {
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["discovered-pods"] });
    },
  });

  const fresh = (pods.data ?? []).filter((p) => !p.station_uuid);
  const linked = (pods.data ?? []).filter((p) => p.station_uuid);

  return (
    <>
      <p className="discover__intro">
        Station pods announce themselves here. Pick one to add its station and devices — or{" "}
        <button className="field__link" onClick={onManual}>
          enter a device by hand
        </button>
        .
      </p>

      <FieldGroup title={`Found${fresh.length ? ` (${fresh.length})` : ""}`}>
        {pods.isPending && <p className="muted">Looking…</p>}
        {pods.data && fresh.length === 0 && <p className="muted">No new pods. Start one (below), or probe its address.</p>}
        {fresh.map((pod) => (
          <PodCard key={pod.uuid} pod={pod} onAdopted={onAdopted} />
        ))}
      </FieldGroup>

      <FieldGroup title="Probe an address">
        <div className="param-row">
          <input
            className="field__input mono"
            placeholder="http://host:60610"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url && probe.mutate()}
          />
          <Button size="sm" onClick={() => probe.mutate()} disabled={!url || probe.isPending}>
            {probe.isPending ? "…" : "Probe"}
          </Button>
        </div>
        {probe.isError && <p className="create__error">{(probe.error as Error).message}</p>}
      </FieldGroup>

      <FieldGroup title="Set up a new pod">
        <p className="muted discover__hint">On the instrument PC (any OS with Python 3.11+):</p>
        <pre className="discover__code mono">{`pip install "epichem-pod @ git+https://github.com/ChemistryTobias/EPIChem_Vibe#subdirectory=bluesky"
epichem-pod init my-station      # edit my-station/station.py: your drivers
epichem-pod serve my-station/station.py \\
    --epichem ${window.location.origin} --api-key <pod key>`}</pre>
        <p className="muted discover__hint">
          It shows up above within half a minute. Your drivers&apos; methods become plans automatically; see
          docs/BLUESKY.md.
        </p>
      </FieldGroup>

      {linked.length > 0 && (
        <FieldGroup title="Already linked">
          {linked.map((pod) => (
            <p key={pod.uuid} className="discover__linked">
              <span className={pod.online ? "discover__dot discover__dot--on" : "discover__dot"} />
              <span className="mono">{pod.station}</span> <span className="muted">{pod.url}</span>
            </p>
          ))}
        </FieldGroup>
      )}
    </>
  );
}

function PodCard({ pod, onAdopted }: { pod: DiscoveredPod; onAdopted: (stationUuid: string) => void }) {
  const queryClient = useQueryClient();
  const labs = useQuery({ queryKey: ["labs"], queryFn: labsApi.list });
  const stations = useQuery({ queryKey: ["stations"], queryFn: stationsApi.list });
  const [mode, setMode] = useState<"new" | "link" | null>(null);
  const [lab, setLab] = useState("");
  const [name, setName] = useState(pod.station);
  const [station, setStation] = useState("");

  const adopt = useMutation({
    mutationFn: () =>
      discoveryApi.adopt(pod.uuid, mode === "link" ? { station_uuid: station } : { lab_uuid: lab, name }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      onAdopted(result.uuid);
    },
  });
  const dismiss = useMutation({
    mutationFn: () => discoveryApi.dismiss(pod.uuid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["discovered-pods"] }),
  });
  const devices = Object.entries(pod.devices);

  return (
    <div className="pod-card">
      <div className="pod-card__head">
        <span className={pod.online ? "discover__dot discover__dot--on" : "discover__dot"} title={pod.online ? "online" : "not heard from lately"} />
        <span className="pod-card__name">{pod.station}</span>
        <button className="pod-card__dismiss" onClick={() => dismiss.mutate()} title="Dismiss">
          ×
        </button>
      </div>
      <p className="pod-card__url mono muted">{pod.url}</p>
      <div className="pod-card__devices">
        {devices.map(([d, info]) => (
          <span key={d} className="pod-card__device" title={info.classname ?? undefined}>
            <Glyph name={deviceGlyph(d, info.classname)} size={14} /> {d}
          </span>
        ))}
      </div>
      <p className="muted pod-card__meta">
        {devices.length} device{devices.length === 1 ? "" : "s"} · {pod.plans.length} plan{pod.plans.length === 1 ? "" : "s"}
      </p>

      {mode === null ? (
        <div className="pod-card__actions">
          <Button size="sm" variant="primary" onClick={() => setMode("new")}>
            Add as station
          </Button>
          <Button size="sm" onClick={() => setMode("link")}>
            Link to station
          </Button>
        </div>
      ) : (
        <div className="pod-card__form">
          {mode === "new" ? (
            <>
              <Field label="Name">
                <input className="field__input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Lab">
                <select className="field__input" value={lab} onChange={(e) => setLab(e.target.value)}>
                  <option value="">Choose…</option>
                  {(labs.data ?? []).map((l) => (
                    <option key={l.uuid} value={l.uuid}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <Field label="Station">
              <select className="field__input" value={station} onChange={(e) => setStation(e.target.value)}>
                <option value="">Choose…</option>
                {(stations.data ?? []).map((s) => (
                  <option key={s.uuid} value={s.uuid}>
                    {s.name}
                    {s.queueserver_url ? " (has a pod)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="pod-card__actions">
            <Button
              size="sm"
              variant="primary"
              disabled={adopt.isPending || (mode === "new" ? !lab || !name.trim() : !station)}
              onClick={() => adopt.mutate()}
            >
              {adopt.isPending ? "Adding…" : mode === "new" ? "Create station" : "Link"}
            </Button>
            <Button size="sm" onClick={() => setMode(null)}>
              Back
            </Button>
          </div>
          {adopt.isError && <Alert kind="error">{(adopt.error as Error).message}</Alert>}
        </div>
      )}
    </div>
  );
}
