/**
 * Running one action right now, from Device Monitoring. The mask follows what
 * the action needs: nothing to fill in → just its description and Run; values
 * to give → the plan's generated form (with whatever the context fixes, e.g.
 * the device), validated live against the station. After a run, the same
 * button runs it again with the same values. It's recorded as a manual run,
 * so it shows in Runs like everything else.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import type { ProcedureStep } from "../../../api/types";
import { TERMINAL_RUN_STATES, executionApi, proceduresApi, runsApi } from "../../../api/workflows";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { Glyph } from "../../../components/glyphs";
import { StatusPill } from "../../../components/StatusPill";
import { StepForm } from "../../workflows/StepForm";
import { openParameters, type Action } from "../../workflows/plans";

interface QuickRunProps {
  station: string;
  action: Action;
  registered: string[];
  /** Run as soon as it opens — the one-click ▶ on an action with nothing to fill in. */
  autorun?: boolean;
  /** Changes on every open, so reopening the same action starts afresh. */
  token?: number;
}

export function QuickRun({ station, action, registered, autorun = false, token = 0 }: QuickRunProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { plan, preset } = action;
  const [step, setStep] = useState<ProcedureStep>({ id: "quick", type: "plan", plan: plan.name, kwargs: preset });
  const [runId, setRunId] = useState<string | null>(null);
  const simple = openParameters(action).length === 0;

  const start = useMutation({
    mutationFn: (kwargs: Record<string, unknown>) => executionApi.run(station, plan.name, kwargs),
    onSuccess: (run) => {
      setRunId(run.uuid);
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  // A different action opened in the same panel starts afresh. One click,
  // one run: the token guards against the effect firing twice for it.
  const key = `${plan.name}:${JSON.stringify(preset)}`;
  const ranFor = useRef<number | null>(null);
  useEffect(() => {
    setStep({ id: "quick", type: "plan", plan: plan.name, kwargs: preset });
    setRunId(null);
    if (autorun && ranFor.current !== token) {
      ranFor.current = token;
      start.mutate(preset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, autorun, token]);

  const validation = useQuery({
    queryKey: ["validate-quick", station, JSON.stringify(step)],
    queryFn: () => proceduresApi.validate(station, [{ ...step, station_uuid: station }]),
    placeholderData: (previous) => previous,
  });
  const diagnostics = useMemo(() => validation.data?.diagnostics ?? [], [validation.data]);
  const errors = diagnostics.filter((d) => d.severity === "error");

  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => runsApi.get(runId!),
    enabled: runId !== null,
    refetchInterval: (q) => (q.state.data && TERMINAL_RUN_STATES.includes(q.state.data.state) ? false : 1000),
  });
  const item = run.data?.items[0];
  const busy = start.isPending || (run.data !== undefined && !TERMINAL_RUN_STATES.includes(run.data.state));

  return (
    <>
      {simple ? (
        <>
          {plan.description && <p className="quick-run__desc">{plan.description}</p>}
          <p className="muted step-form__hint">Nothing to fill in{Object.keys(preset).length ? ` — runs on ${Object.values(preset).join(", ")}` : ""}.</p>
        </>
      ) : (
        <StepForm step={step} plan={plan} diagnostics={diagnostics} registered={registered} onChange={setStep} bare fixed={Object.keys(preset)} />
      )}

      <div className="run-launcher__actions">
        <Button variant="primary" disabled={errors.length > 0 || busy} onClick={() => start.mutate(step.kwargs)}>
          {start.isPending ? (
            "Sending…"
          ) : run.data ? (
            <>
              <Glyph name="rerun" size={13} /> Run again
            </>
          ) : (
            <>
              <Glyph name="play" size={12} /> Run now
            </>
          )}
        </Button>
      </div>
      {errors.length > 0 && <p className="muted step-form__hint">Fix the fields marked above to run it.</p>}
      {start.isError && <Alert kind="error">{(start.error as Error).message}</Alert>}

      {run.data && (
        <div className="quick-run__result">
          <div className="quick-run__line">
            <button className="field__link mono" onClick={() => navigate({ to: "/workflows/runs", search: { run: run.data!.code } })}>
              {run.data.code}
            </button>
            <StatusPill status={item?.status === "queued" ? "queued" : run.data.state} />
          </div>
          {item?.status === "queued" && <p className="muted step-form__hint">Waiting behind the station&apos;s queue.</p>}
          {item?.message && <p className="create__error">{item.message.trim().split("\n").at(-1)}</p>}
          {run.data.sync_error && <p className="step-form__warning">{run.data.sync_error}</p>}
        </div>
      )}
    </>
  );
}
