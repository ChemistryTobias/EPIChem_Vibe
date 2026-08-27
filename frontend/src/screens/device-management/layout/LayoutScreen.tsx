/** Deliberately empty — the isometric layout editor is a later milestone. */

import { Alert } from "../../../components/Alert";
import { ScreenHeader } from "../../../components/ScreenHeader";

export function LayoutScreen() {
  return (
    <>
      <ScreenHeader title="Layout" subtitle="Metric floor plan" />
      <div className="screen">
        <div className="screen__content">
          <Alert kind="info">Not built yet — the layout editor is a later milestone.</Alert>
        </div>
      </div>
    </>
  );
}
