/**
 * Running one plan right now, from Device Monitoring: the plan's generated
 * form (with whatever the context fixes, e.g. the device), live validation
 * against the station, Run, and the run's progress until it ends. It's
 * recorded as a manual run, so it shows in Runs like everything else.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import type { PlanRepr, ProcedureStep } from "../../../api/types";
import { TERMINAL_RUN_STATES, executionApi, proceduresApi, runsApi } from "../../../api/workflows";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { StatusPill } from "../../../components/StatusPill";
import { StepForm } from "../../workflows/StepForm";

interface QuickRunProps {
  station: string;
  plan: PlanRepr;
  registered: string[];
  /** Parameters set by where the action was opened from. */
  preset: Record<string, unknown>;
}

export function QuickRun({ station, plan, registered, preset }: QuickRunProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<ProcedureStep>({ id: "quick", type: "plan", plan: plan.name, kwargs: preset });
  const [runId, setRunId] = useState<string | null>(null);

  // A different action opened in the same panel starts afresh.
  const key = `${plan.name}:${JSON.stringify(preset)}`;
  useEffect(() => {
    setStep({ id: "quick", type: "plan", plan: plan.name, kwargs: preset });
    setRunId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const validation = useQuery({
    queryKey: ["validate-quick", station, JSON.stringify(step)],
    queryFn: () => proceduresApi.validate(station, [{ ...step, station_uuid: station }]),
    placeholderData: (previous) => previous,
  });
  const diagnostics = useMemo(() => validation.data?.diagnostics ?? [], [validation.data]);
  const errors = diagnostics.filter((d) => d.severity === "error");

  const start = useMutation({
    mutationFn: () => executionApi.run(station, plan.name, step.kwargs),
    onSuccess: (run) => {
      setRunId(run.uuid);
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => runsApi.get(runId!),
    enabled: runId !== null,
    refetchInterval: (q) => (q.state.data && TERMINAL_RUN_STATES.includes(q.state.data.state) ? false : 1000),
  });
  const item = run.data?.items[0];

  return (
    <>
      <StepForm
        step={step}
        plan={plan}
        diagnostics={diagnostics}
        registered={registered}
        onChange={setStep}
        bare
        fixed={Object.keys(preset)}
      />

      <div className="run-launcher__actions">
        <Button variant="primary" disabled={errors.length > 0 || start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? "Sending…" : "Run now"}
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
