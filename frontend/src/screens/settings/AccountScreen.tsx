/**
 * Personal settings (the nav's person): your account's name and email, your
 * password, signing out. `PATCH /users/{id}` (Roadmap 0.2).
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { logout, me } from "../../api/auth";
import { usersApi } from "../../api/entities";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Glyph } from "../../components/glyphs";
import { ScreenHeader } from "../../components/ScreenHeader";
import { formatDate } from "../format";

import "./settings.css";

export function AccountScreen() {
  const queryClient = useQueryClient();
  const whoami = useQuery({ queryKey: ["me-uuid"], queryFn: me });
  const account = useQuery({
    queryKey: ["users", whoami.data?.uuid],
    queryFn: () => usersApi.get(whoami.data!.uuid),
    enabled: Boolean(whoami.data),
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (account.data) {
      setName(account.data.name);
      setEmail(account.data.email ?? "");
    }
  }, [account.data]);
  const save = useMutation({
    mutationFn: () => usersApi.update(account.data!.uuid, { name, email: email || null }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const change = useMutation({
    mutationFn: () => usersApi.update(account.data!.uuid, { password }),
    onSuccess: () => {
      setPassword("");
      setRepeat("");
    },
  });

  async function signOut() {
    await logout();
    queryClient.clear();
  }

  const u = account.data;
  const dirty = u && (name !== u.name || email !== (u.email ?? ""));

  return (
    <>
      <ScreenHeader
        title="Your account"
        subtitle={u ? `Signed in as ${u.name}` : "Loading…"}
        actions={<Button onClick={signOut}>Sign out</Button>}
      />
      <div className="screen">
        <div className="screen__content settings">
          <section className="settings__card">
            <header className="settings__head">
              <span className="settings__avatar settings__avatar--big">
                <Glyph name="user" size={26} />
              </span>
              <h2 className="settings__title">Profile</h2>
            </header>
            <form
              className="settings__fields"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <label className="settings__field">
                <span className="label">Username</span>
                <input className="field__input" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="settings__field">
                <span className="label">Email</span>
                <input className="field__input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <div className="settings__actions">
                <Button size="sm" variant="primary" type="submit" disabled={!dirty || save.isPending}>
                  Save
                </Button>
                {save.isSuccess && !dirty && <span className="muted">Saved.</span>}
              </div>
              {save.isError && <Alert kind="error">{(save.error as Error).message}</Alert>}
              {u && <p className="muted settings__hint">Account created {formatDate(u.created_at)}.</p>}
            </form>
          </section>

          <section className="settings__card">
            <header className="settings__head">
              <h2 className="settings__title">Password</h2>
            </header>
            <form
              className="settings__fields"
              onSubmit={(e) => {
                e.preventDefault();
                change.mutate();
              }}
            >
              <label className="settings__field">
                <span className="label">New password</span>
                <input className="field__input" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <label className="settings__field">
                <span className="label">Repeat it</span>
                <input className="field__input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
              </label>
              {repeat && repeat !== password && <p className="create__error">The two don&apos;t match.</p>}
              <div className="settings__actions">
                <Button size="sm" type="submit" disabled={password.length < 8 || password !== repeat || change.isPending}>
                  Change password
                </Button>
                {change.isSuccess && <span className="muted">Changed.</span>}
              </div>
              {change.isError && <Alert kind="error">{(change.error as Error).message}</Alert>}
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
