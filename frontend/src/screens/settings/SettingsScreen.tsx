/**
 * General settings (the nav's cog): who can sign in, how they're grouped, how
 * station pods reach this EPIChem, and what build this is. Identity is
 * Roadmap 0.2 (`app/core/access_control/`); there is no access-level logic
 * yet, so every account can change all of this.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet } from "../../api/client";
import { me } from "../../api/auth";
import { groupsApi, usersApi } from "../../api/entities";
import type { Group, User } from "../../api/types";
import { discoveryApi } from "../../api/workflows";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Glyph } from "../../components/glyphs";
import { ScreenHeader } from "../../components/ScreenHeader";
import { StatusPill } from "../../components/StatusPill";

import "./settings.css";

export function SettingsScreen() {
  return (
    <>
      <ScreenHeader title="Settings" subtitle="Accounts, groups, station pods and this build" />
      <div className="screen">
        <div className="screen__content settings">
          <UsersCard />
          <GroupsCard />
          <PodsCard />
          <AboutCard />
        </div>
      </div>
    </>
  );
}

function UsersCard() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: usersApi.list });
  const whoami = useQuery({ queryKey: ["me-uuid"], queryFn: me });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const done = () => queryClient.invalidateQueries({ queryKey: ["users"] });
  const create = useMutation({
    mutationFn: () => usersApi.create({ name, email: email || null, password }),
    onSuccess: () => {
      setAdding(false);
      setName("");
      setEmail("");
      setPassword("");
      done();
    },
  });
  const toggle = useMutation({
    mutationFn: (u: User) => usersApi.update(u.uuid, { active: !u.active }),
    onSuccess: done,
  });

  return (
    <section className="settings__card">
      <header className="settings__head">
        <h2 className="settings__title">Accounts</h2>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add account
          </Button>
        )}
      </header>
      {adding && (
        <form
          className="settings__form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <input className="field__input" placeholder="username" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="field__input" placeholder="email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            className="field__input"
            type="password"
            placeholder="password, 8+ characters"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button size="sm" variant="primary" type="submit" disabled={create.isPending}>
            Create
          </Button>
          <Button size="sm" type="button" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          {create.isError && <Alert kind="error">{(create.error as Error).message}</Alert>}
        </form>
      )}
      <ul className="settings__list">
        {(users.data ?? []).map((u) => (
          <li key={u.uuid} className="settings__row">
            <span className="settings__avatar">
              <Glyph name="user" size={16} />
            </span>
            <span className="settings__name">
              {u.name}
              {u.uuid === whoami.data?.uuid && <span className="muted"> (you)</span>}
            </span>
            <span className="muted settings__meta">{u.email ?? ""}</span>
            <StatusPill status={u.active ? "active" : "inactive"} />
            {u.uuid !== whoami.data?.uuid && (
              <Button size="sm" onClick={() => toggle.mutate(u)} disabled={toggle.isPending}>
                {u.active ? "Deactivate" : "Activate"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GroupsCard() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ["groups"], queryFn: groupsApi.list });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => groupsApi.create({ name }),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });
  return (
    <section className="settings__card">
      <header className="settings__head">
        <h2 className="settings__title">Groups</h2>
      </header>
      <p className="muted settings__hint">Groups don&apos;t restrict anything yet — access levels are still open (see the access-control README).</p>
      <ul className="settings__list">
        {(groups.data ?? []).map((g) => (
          <GroupRow key={g.uuid} group={g} />
        ))}
        {groups.data?.length === 0 && <li className="muted">No groups yet.</li>}
      </ul>
      <form
        className="settings__form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input className="field__input" placeholder="new group" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button size="sm" type="submit" disabled={!name || create.isPending}>
          Add group
        </Button>
        {create.isError && <Alert kind="error">{(create.error as Error).message}</Alert>}
      </form>
    </section>
  );
}

function GroupRow({ group }: { group: Group }) {
  const members = useQuery({ queryKey: ["group-members", group.uuid], queryFn: () => groupsApi.members(group.uuid) });
  return (
    <li className="settings__row">
      <span className="settings__name">{group.name}</span>
      <span className="muted settings__meta">
        {members.data ? `${members.data.length} member${members.data.length === 1 ? "" : "s"}` : ""}
      </span>
    </li>
  );
}

function PodsCard() {
  const pods = useQuery({ queryKey: ["discovered-pods"], queryFn: discoveryApi.pods });
  const online = (pods.data ?? []).filter((p) => p.online).length;
  return (
    <section className="settings__card">
      <header className="settings__head">
        <h2 className="settings__title">Station pods</h2>
        <span className="muted">
          {pods.data ? `${pods.data.length} known · ${online} online` : ""}
        </span>
      </header>
      <p className="muted settings__hint">
        Pods announce themselves to this address with the shared pod key (the API&apos;s{" "}
        <span className="mono">EPICHEM_QSERVER_API_KEY</span>). New ones appear under Hierarchy → New device.
      </p>
      <pre className="settings__code mono">{`epichem-pod serve station.py --epichem ${window.location.origin} --api-key <pod key>`}</pre>
    </section>
  );
}

function AboutCard() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => apiGet<{ status: string }>("/health") });
  return (
    <section className="settings__card">
      <header className="settings__head">
        <h2 className="settings__title">About</h2>
      </header>
      <p className="settings__row">
        <span className="settings__name">API</span>
        <StatusPill status={health.data?.status === "ok" ? "online" : health.isError ? "offline" : "unknown"} />
      </p>
      <Alert kind="warning">This is a very early build of the EPIChem orchestrator — do not use it in production.</Alert>
    </section>
  );
}
