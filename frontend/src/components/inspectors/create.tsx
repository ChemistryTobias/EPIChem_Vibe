/**
 * Creating a record, in the inspector panel — a third mode beside reading and
 * editing, so making something and then adjusting it look the same.
 *
 * What a kind *needs* is shown straight away; everything else is folded away
 * behind "Additional fields", because a create form that opens with fifteen
 * empty inputs reads as work even when only two of them matter.
 *
 * Geometry is not offered: the backend places a new object in a free slot near
 * its siblings by itself, and it can be dragged or typed exactly afterwards.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { API_BY_KIND } from "../../api/entities";
import type { EntityKind, EntityRow } from "../../api/types";
import { Field } from "../Inspector";
import type { InspectorEdit } from "../Inspector";
import { useEntityIndex } from "./sections";

/** One input in the create form. A `from` turns it into a picker over those kinds. */
interface FieldSpec {
  field: string;
  label: string;
  from?: EntityKind[];
}

interface KindSpec {
  /** Must be filled before Create does anything. `name` is always required
   * and lives in the title, so it isn't listed here. */
  required: FieldSpec[];
  optional: FieldSpec[];
}

const SPECS: Record<EntityKind, KindSpec> = {
  Site: {
    required: [],
    optional: [
      { field: "organisation", label: "Organisation" },
      { field: "address", label: "Address" },
      { field: "timezone", label: "Timezone" },
    ],
  },
  Lab: {
    required: [{ field: "site_uuid", label: "Site", from: ["Site"] }],
    optional: [
      { field: "room_number", label: "Room" },
      { field: "zone_uuid", label: "Zone", from: ["Zone"] },
    ],
  },
  Zone: {
    required: [{ field: "parent_uuid", label: "Parent", from: ["Site", "Lab"] }],
    optional: [{ field: "tag", label: "Tag" }],
  },
  Station: {
    required: [{ field: "lab_uuid", label: "Lab", from: ["Lab"] }],
    optional: [{ field: "zone_uuid", label: "Zone", from: ["Zone"] }],
  },
  Module: {
    required: [{ field: "station_uuid", label: "Station", from: ["Station"] }],
    optional: [],
  },
  Device: {
    required: [{ field: "station_uuid", label: "Station", from: ["Station"] }],
    optional: [],
  },
};

/** Everything Add offers. A device is created through its own control. */
export const ADDABLE: EntityKind[] = ["Site", "Lab", "Zone", "Station", "Module"];

/**
 * The create flow's state, shared by the screens that show the inspector.
 * Returns an `edit` in the same shape the editor uses, so the panel's header
 * needs no special case.
 */
export function useCreator(options: { onCreated?: (kind: EntityKind, row: EntityRow) => void } = {}) {
  const [kind, setKind] = useState<EntityKind | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const queryClient = useQueryClient();

  const close = () => {
    setKind(null);
    setDraft({});
  };

  const create = useMutation({
    mutationFn: async (): Promise<{ kind: EntityKind; row: EntityRow } | null> =>
      kind ? { kind, row: (await API_BY_KIND[kind].create(draft)) as EntityRow } : null,
    onSuccess: async (created) => {
      close();
      await queryClient.invalidateQueries();
      // After the refetch, so whatever the screen selects is already drawn.
      if (created) options.onCreated?.(created.kind, created.row);
    },
  });

  const name = (draft.name as string | undefined) ?? "";
  const complete =
    kind !== null &&
    name.trim() !== "" &&
    SPECS[kind].required.every((spec) => draft[spec.field]);

  const edit: InspectorEdit = {
    editing: true,
    creating: true,
    dirty: complete,
    saving: create.isPending,
    onToggle: close,
    onSave: () => create.mutate(),
    onCancel: close,
    onRename: (value) => setDraft((d) => ({ ...d, name: value })),
  };

  return {
    kind,
    draft,
    edit,
    error: create.error as Error | null,
    open: (next: EntityKind, prefill: Record<string, unknown> = {}) => {
      setDraft(prefill);
      setKind(next);
    },
    close,
    set: (field: string, value: unknown) => setDraft((d) => ({ ...d, [field]: value })),
  };
}

interface CreatePanelProps {
  kind: EntityKind;
  draft: Record<string, unknown>;
  set: (field: string, value: unknown) => void;
  error?: Error | null;
}

export function CreatePanel({ kind, draft, set, error }: CreatePanelProps) {
  const [showOptional, setShowOptional] = useState(false);
  const spec = SPECS[kind];

  const input = (field: FieldSpec) => (
    <CreateField key={field.field} spec={field} value={draft[field.field]} set={set} />
  );

  return (
    <>
      {spec.required.map(input)}

      <button
        className="create__toggle label"
        onClick={() => setShowOptional((v) => !v)}
        aria-expanded={showOptional}
      >
        {showOptional ? "▾" : "▸"} Additional fields
      </button>

      {showOptional && (
        <div className="create__optional">
          {input({ field: "description", label: "Description" })}
          {spec.optional.map(input)}
        </div>
      )}

      {error && <p className="create__error">{error.message}</p>}
    </>
  );
}

function CreateField({
  spec,
  value,
  set,
}: {
  spec: FieldSpec;
  value: unknown;
  set: (field: string, value: unknown) => void;
}) {
  const index = useEntityIndex();

  if (!spec.from) {
    return (
      <Field label={spec.label}>
        <input
          className="field__input"
          value={(value as string | undefined) ?? ""}
          onChange={(e) => set(spec.field, e.target.value === "" ? null : e.target.value)}
        />
      </Field>
    );
  }

  const options = [...index.values()].filter((entry) => spec.from!.includes(entry.kind));
  return (
    <Field label={spec.label}>
      <select
        className="field__input"
        value={(value as string | undefined) ?? ""}
        onChange={(e) => set(spec.field, e.target.value === "" ? null : e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((entry) => (
          <option key={entry.row.uuid} value={entry.row.uuid}>
            {entry.row.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
