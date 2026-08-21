# access_control

Identity and (eventually) authorization for the app. Currently: `users`
(accounts), `groups` (named collections of users), `auth` (login/logout,
opaque bearer tokens, `get_current_user`). All built, all unwired -- nothing
in `device_managment/` checks any of this yet, and no actual access
*limitation* exists. See `router.py` for the aggregate router (also unwired,
commented out in `app/core/router.py`).

## Access limitation -- postponed, options on the table

Not built yet, and not decided. Discussed at length; recorded here so the
options aren't lost. Every option below assumes the same baseline: an
`is_admin` flag on `User` bypasses everything, and access is granted to a
user only via the groups they belong to (no per-user grants).

1. **Hierarchical cascade via a separate `AccessGrant` table** (the
   leading option). One table: `group_uuid, scope_type, scope_uuid, level
   (none|read|read_write)`, pointing at any device_managment entity by
   UUID -- zero schema change to Site/Lab/Zone/Station/Module/Device.
   Resolved per group independently (walk the target's ancestor chain --
   device -> station -> lab -> site -- for the nearest grant that group
   holds), then the most permissive result across the user's groups wins.
   `none` at a level is an explicit override that only cancels *that
   group's* inherited access, not other groups'. Creating a child requires
   `read_write` resolved on the parent -- no separate "can create" flag
   needed. Fits EPIChem well specifically because the hierarchy is a real
   containment tree; this is the option that was being converged on.

2. **Flat, per-resource roles (Kadi4Mat's model).** No cascade at all --
   every resource instance holds its own independent role assignments
   (`Role(object_type, object_id, name)`), and roles bundle multiple
   actions (`member: [read]`, `editor: [read, update]`, `admin: [read,
   update, delete, permissions]`) rather than a linear read/read_write
   scale. Groups hold roles the same way users do, unioned at check time.
   Rejected as the primary model here because EPIChem's resources are a
   genuine containment tree (unlike Kadi's largely flat Records/
   Collections) -- flat-per-resource would mean setting a role on every
   Station and every Device individually, with no inheritance. The
   bundled-multiple-actions-per-role idea is worth keeping in mind if a
   level between "read" and "read_write" is ever needed.

3. **Constraint-filter permissions (NetBox's model).** One generic
   `ObjectPermission` (`object_types, actions, constraints`) where
   `constraints` is a raw queryset filter dict (e.g. conceptually
   `{"site__name": "..."}`), checked by re-querying the DB per object per
   check. Strictly more general than option 1 (arbitrary filter, not just
   "under this parent"), but that generality exists because NetBox's data
   isn't tree-shaped (a Device also relates to Interfaces/Cables/VLANs
   that don't nest under one parent). Since EPIChem's hierarchy is
   cleanly tree-shaped, this generality isn't needed and would push the
   "which filter path" burden onto whoever creates a grant.

4. **A `read_group_uuid`/`read_write_group_uuid` column pair directly on
   each object.** Rejected: doesn't support multiple groups owning one
   resource without becoming per-level join tables anyway (same shape as
   option 1, duplicated six times); doesn't give cascading inheritance for
   free (a null column still has to fall back to checking the parent's
   column, i.e. the same ancestor-walk logic, just scattered per-entity
   instead of centralized); has no clean way to express an explicit deny;
   and requires editing every existing entity's schema, which every other
   piece of this module has deliberately avoided.

Also see the LDAP/OIDC question from earlier: NetBox answers it by
stacking multiple Django `AUTHENTICATION_BACKENDS`, tried in order, with
the same authorization layer mixed into all of them -- the analogous shape
here would be `auth.logic.authenticate_user` becoming one of several
registered backends rather than a single hardcoded local check. Not
needed until LDAP/OIDC is actually on deck.
