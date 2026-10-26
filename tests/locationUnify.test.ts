import { describe, expect, it } from "vitest";
import { buildLocationMap, distanceKm, type LocationStat } from "../lib/locationUnify/cluster";
import { displayName, normalizeLocation } from "../lib/locationUnify/normalize";

const CELL = 0.002;

/** A place with `n` outlets scattered around (lat, lon) over `spread` degrees, on the ~220 m cell grid the loader uses. */
function place(name: string, lat: number, lon: number, n: number, spread = 0.004, sources = ["PINE"]): LocationStat {
  const cells = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const dy = ((i % 5) - 2) * (spread / 4);
    const dx = ((Math.floor(i / 5) % 5) - 2) * (spread / 4);
    const key = `${Math.round((lat + dy) / CELL)}|${Math.round((lon + dx) / CELL)}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  return { name, rows: n, gps: n, lat, lon, sources, cells };
}

const find = (map: ReturnType<typeof buildLocationMap>, raw: string) => map.mapping.find((m) => m.raw === raw)!;

describe("location name normalisation", () => {
  it("drops case, tags, country, county and the sort prefix", () => {
    expect(normalizeLocation("THIKA").key).toBe("thika");
    expect(normalizeLocation("Thika - MBSR").key).toBe("thika");
    expect(normalizeLocation("Nairobi-Thika").key).toBe("thika");
    expect(normalizeLocation("AA Imara Daima").key).toBe("imara daima");
    expect(normalizeLocation("aaa imara").key).toBe("imara");
    expect(normalizeLocation("Nairobi-AA Imara Daima").key).toBe("imara daima");
    expect(normalizeLocation("Makueni County").key).toBe("makueni");
  });

  it("keeps a bare city, numbers and unrelated words", () => {
    expect(normalizeLocation("Nairobi").key).toBe("nairobi");
    expect(normalizeLocation("Githurai 44").key).toBe("githurai 44");
    expect(normalizeLocation("Kitui 1").key).toBe("kitui 1");
  });

  it("recognises addresses and unspecified names", () => {
    expect(normalizeLocation("Qv9g+Jr9, Thika Rd, Nairobi, Kenya").kind).toBe("address");
    expect(normalizeLocation("Unspecified").kind).toBe("unspecified");
    expect(normalizeLocation("").kind).toBe("unspecified");
  });

  it("writes a canonical display name", () => {
    expect(displayName("imara daima")).toBe("Imara Daima");
    expect(displayName("cbd")).toBe("CBD");
  });
});

describe("unifying location names", () => {
  const stats = [
    place("Imara Daima", -1.3225, 36.8856, 80),
    place("AA Imara Daima", -1.305, 36.89, 300, 0.03),
    place("Imara", -1.3166, 36.8895, 120, 0.02),
    place("Nairobi-Imara", -1.3252, 36.8861, 50),
    place("THIKA", -1.056, 37.105, 300, 0.1),
    place("Thika", -1.0562, 37.1048, 4, 0.01),
    place("Thika - MBSR", -1.0558, 37.1051, 90, 0.05),
    place("Thika East", -1.071, 37.105, 60, 0.06),
    place("Thika Road", -1.198, 36.945, 40, 0.1),
    place("Githurai 44", -1.201, 36.906, 200),
    place("Githurai 45", -1.21, 36.926, 220),
    place("Kitengela", -1.491, 36.955, 300, 0.05),
    place("Kitengala", -1.4912, 36.9552, 20, 0.01),
    place("Mvcm+9p5 Imara Daima Foot Bridge, Nairobi, Kenya", -1.3290, 36.8842, 1, 0),
    place("Unspecified", -1.274, 36.92, 20, 0.1),
  ];
  const map = buildLocationMap(stats);

  it("merges different spellings of the same name: THIKA, Thika and Thika - MBSR", () => {
    expect(find(map, "THIKA").canonical).toBe("Thika");
    expect(find(map, "Thika").canonical).toBe("Thika");
    expect(find(map, "Thika - MBSR").canonical).toBe("Thika");
    expect(find(map, "Thika - MBSR").confidence).toBe("High");
  });

  it("merges a name that continues another when the places are close: Imara, Imara Daima, AA Imara Daima", () => {
    const canonical = new Set(["Imara Daima", "AA Imara Daima", "Imara", "Nairobi-Imara"].map((n) => find(map, n).canonical));
    expect([...canonical]).toEqual(["Imara Daima"]);
    expect(find(map, "Imara").method).toBe("name + coordinates");
  });

  it("merges a spelling variant that sits in the same place", () => {
    expect(find(map, "Kitengala").canonical).toBe("Kitengela");
    expect(find(map, "Kitengala").method).toBe("spelling + coordinates");
  });

  it("keeps a different place apart: a direction, a road or a numbered stage", () => {
    expect(find(map, "Thika East").canonical).toBe("Thika East");
    expect(find(map, "Thika Road").canonical).toBe("Thika Road");
    expect(find(map, "Githurai 44").canonical).toBe("Githurai 44");
    expect(find(map, "Githurai 45").canonical).toBe("Githurai 45");
    expect(map.relations.some((r) => r.a === "thika" && r.b === "thika east" && r.kind === "sub-area")).toBe(true);
  });

  it("places an address by the place named in it and where its point falls", () => {
    const row = find(map, "Mvcm+9p5 Imara Daima Foot Bridge, Nairobi, Kenya");
    expect(row.canonical).toBe("Imara Daima");
    expect(row.method).toBe("address -> nearest area");
  });

  it("leaves a name that stands alone exactly as it is spelled", () => {
    const alone = buildLocationMap([place("Upper Mountain (SA)", -0.4, 37.0, 30, 0.1), place("kenol", -0.95, 37.0, 30, 0.1)]);
    expect(find(alone, "Upper Mountain (SA)").canonical).toBe("Upper Mountain (SA)");
    expect(find(alone, "kenol").canonical).toBe("kenol");
    expect(find(alone, "kenol").method).toBe("unchanged");
  });

  it("leaves an unspecified name as it is", () => {
    expect(find(map, "Unspecified").canonical).toBe("Unspecified");
  });

  it("reports each unified place once, with its raw names and a centre", () => {
    const thika = map.groups.find((g) => g.canonical === "Thika")!;
    expect(thika.rawNames.sort()).toEqual(["THIKA", "Thika", "Thika - MBSR"]);
    expect(thika.lat).not.toBeNull();
    expect(distanceKm(thika.lat as number, thika.lon as number, -1.056, 37.105)).toBeLessThan(1);
  });
});

describe("coordinates as a second signal", () => {
  it("reports two differently named places that share the same cells, without merging them", () => {
    const map = buildLocationMap([place("Riverside Court", -1.28, 36.8, 60, 0.01), place("Opposite Mall Stage", -1.2801, 36.8001, 55, 0.01)]);
    expect(find(map, "Riverside Court").canonical).toBe("Riverside Court");
    expect(map.relations.some((r) => r.kind === "shares coordinates")).toBe(true);
  });

  it("reports a small place sitting inside a larger one as a sub-area", () => {
    const map = buildLocationMap([place("Big Estate", -1.28, 36.8, 400, 0.06), place("Small Corner", -1.28, 36.8, 30, 0.004)]);
    expect(map.relations.some((r) => r.kind === "sub-area" && r.a === "small corner")).toBe(true);
  });

  it("does not merge names that merely continue each other when the places are far apart", () => {
    const map = buildLocationMap([place("Rift", -1.0, 36.0, 40, 0.01), place("Rift Valley", -0.2, 36.9, 40, 0.01)]);
    expect(find(map, "Rift Valley").canonical).toBe("Rift Valley");
    expect(map.relations.some((r) => r.kind === "possible variant")).toBe(true);
  });
});

describe("small variants of a bigger place", () => {
  const noGps = (name: string): LocationStat => ({ name, rows: 1, gps: 0, lat: 0, lon: 0, sources: ["PINE"], cells: new Map() });

  it("merges a spacing variant and a one-letter typo that sit inside the bigger place", () => {
    const map = buildLocationMap([
      place("Babadogo", -1.2650, 36.8750, 120, 0.02),
      place("Baba Dogo", -1.2652, 36.8751, 1, 0),
      place("Pipeline", -1.3150, 36.9050, 90, 0.02),
      place("Pipiline", -1.3152, 36.9049, 1, 0),
      place("Dandora", -1.2600, 36.9000, 80, 0.02),
      place("Ndandora", -1.2602, 36.9001, 2, 0.001),
    ]);
    expect(find(map, "Baba Dogo").canonical).toBe(find(map, "Babadogo").canonical);
    expect(find(map, "Pipiline").canonical).toBe("Pipeline");
    expect(find(map, "Ndandora").canonical).toBe("Dandora");
    expect(find(map, "Pipiline").method).toBe("name variant");
  });

  it("merges a typo whose outlets sit inside a big, spread-out place even when they are far from its centre", () => {
    // Pipeline's outlets spread over ~11 km; the typo's outlets are in one of its busy parts, 2.8 km from the centre (beyond the 1.5 km a small name may drift).
    const map = buildLocationMap([place("Pipeline", -1.3150, 36.9050, 600, 0.1), place("Pipelne", -1.3150, 36.9050 + 0.025, 4, 0)]);
    expect(find(map, "Pipelne").canonical).toBe("Pipeline");
    // The same typo's outlets 90 km away are another place.
    const far = buildLocationMap([place("Pipeline", -1.3150, 36.9050, 600, 0.1), place("Pipelne", -0.4, 36.95, 4, 0.002)]);
    expect(find(far, "Pipelne").canonical).toBe("Pipelne");
  });

  it("merges the same letters without a point at all, but not a one-letter typo without one", () => {
    const map = buildLocationMap([place("Kwadege", -1.2, 36.9, 40, 0.02), noGps("Kwa Dege"), noGps("Kwadeje")]);
    expect(find(map, "Kwa Dege").canonical).toBe("Kwadege");
    expect(find(map, "Kwadeje").canonical).toBe("Kwadeje");
  });

  it("keeps a similar name that is somewhere else, a changed trailing letter, and two big places apart", () => {
    const map = buildLocationMap([
      place("Nyeri", -0.4200, 36.9500, 300, 0.05),
      place("Nderi", -1.2300, 36.7400, 1, 0), // a real place elsewhere, 100 km away
      place("South B", -1.3100, 36.8300, 60, 0.01),
      place("South C", -1.3200, 36.8200, 2, 0.001),
      place("Kasarani", -1.2200, 36.8900, 200, 0.03),
      place("Kasarini", -1.9000, 37.4000, 150, 0.03), // a big place of its own, far away
    ]);
    expect(find(map, "Nderi").canonical).toBe("Nderi");
    expect(find(map, "South C").canonical).toBe("South C");
    expect(find(map, "Kasarini").canonical).not.toBe(find(map, "Kasarani").canonical);
  });
});
