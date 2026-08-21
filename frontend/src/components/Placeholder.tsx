/** A screen not wired up yet — structure only, per the current rough pass. */

import { Alert } from "./Alert";
import { ScreenHeader } from "./ScreenHeader";

export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <ScreenHeader title={title} subtitle="Not implemented yet" />
      <div className="screen">
        <div className="screen__content">
          <Alert kind="info">This screen is scaffolding only — nothing is wired up yet.</Alert>
        </div>
      </div>
    </>
  );
}
