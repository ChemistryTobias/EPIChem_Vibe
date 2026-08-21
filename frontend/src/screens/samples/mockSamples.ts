/**
 * Static demo data — the backend has no Sample entity yet (see
 * docs/API.md "What's not here yet"). Replace this file once a real
 * /api/v1/samples route exists; the screen below doesn't need to change.
 */

export interface Sample {
  uuid: string;
  code: string;
  name: string;
  state: string;
  substance: string;
  amount: string;
  location: string;
}

export const MOCK_SAMPLES: Sample[] = [
  {
    uuid: "s1",
    code: "SMP-2026-0041",
    name: "PEDOT:PSS film",
    state: "in_process",
    substance: "PEDOT:PSS",
    amount: "1.5 mL",
    location: "RACK-A/3",
  },
  {
    uuid: "s2",
    code: "SMP-2026-0042",
    name: "Electrolyte solution",
    state: "registered",
    substance: "urn:inchikey:RQQRAHKHDFPBMC-UHFFFAOYSA-L",
    amount: "500 uL",
    location: "RACK-A/5",
  },
  {
    uuid: "s3",
    code: "SMP-2026-0043",
    name: "Annealed coating batch 3",
    state: "characterized",
    substance: "PEDOT:PSS",
    amount: "1.2 mL",
    location: "ARCHIVE/2",
  },
];
