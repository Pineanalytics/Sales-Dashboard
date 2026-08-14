/**
 * One-off demo-data seed for the Team Leader Coaching & Field Accompaniment
 * tenant (Phase 1). Creates real auth accounts (via the Admin API — not raw
 * SQL against the auth schema) for 3 supervisors, 10 team leaders, and 50
 * sales reps, then seeds master data, a coaching template, and a spread of
 * accompaniments/action plans so dashboards/maps/reports are demonstrable.
 *
 * Run with: npx tsx scripts/seed-coaching-demo.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const COACHING_FORM_ID = "de8bc27c-c074-4220-a34c-6b07db02a61e";
const DEMO_PASSWORD = "CoachDemo2026!";
const DEMO_EMAIL_DOMAIN = "demo.pinefrostdb.com";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function jitter(coord: number, spreadKm: number) {
  const spreadDeg = spreadKm / 111; // ~111km per degree of latitude
  return coord + (Math.random() - 0.5) * 2 * spreadDeg;
}

const FIRST_NAMES = [
  "James", "Mary", "John", "Grace", "Peter", "Faith", "David", "Ann", "Paul", "Joyce",
  "Samuel", "Ruth", "Daniel", "Esther", "Joseph", "Lucy", "Michael", "Sarah", "Francis", "Agnes",
  "Kevin", "Nancy", "Brian", "Caroline", "Dennis", "Rose", "Eric", "Beatrice", "Charles", "Winnie",
  "Patrick", "Diana", "George", "Elizabeth", "Simon", "Catherine", "Anthony", "Millicent", "Victor", "Irene",
  "Stephen", "Josephine", "Martin", "Damaris", "Robert", "Naomi", "Edwin", "Purity", "Felix", "Consolata",
];
const LAST_NAMES = [
  "Mwangi", "Otieno", "Wanjiru", "Kamau", "Achieng", "Njoroge", "Wafula", "Kimani", "Adhiambo", "Kiptoo",
  "Cheruiyot", "Ochieng", "Muthoni", "Owino", "Wambui", "Barasa", "Nyambura", "Odhiambo", "Karanja", "Auma",
  "Rotich", "Chebet", "Maina", "Akinyi", "Kilonzo", "Mutua", "Wangari", "Onyango", "Njeri", "Koech",
];

const REGION_DEFS: Record<string, string[]> = {
  Nairobi: ["Nairobi Central", "Nairobi East", "Nairobi West"],
  Coast: ["Mombasa", "Kilifi"],
  "Rift Valley": ["Nakuru", "Eldoret", "Nyahururu"],
  Western: ["Kakamega", "Bungoma"],
  Nyanza: ["Kisumu", "Kisii"],
  Central: ["Nyeri", "Murang'a"],
};
const CITY_CENTERS: Record<string, [number, number]> = {
  "Nairobi Central": [-1.2921, 36.8219],
  "Nairobi East": [-1.3167, 36.89],
  "Nairobi West": [-1.3, 36.75],
  Mombasa: [-4.0435, 39.6682],
  Kilifi: [-3.6333, 39.85],
  Nakuru: [-0.3031, 36.08],
  Eldoret: [0.5143, 35.2698],
  Nyahururu: [0.0333, 36.3667],
  Kakamega: [0.2827, 34.7519],
  Bungoma: [0.5667, 34.5667],
  Kisumu: [-0.0917, 34.768],
  Kisii: [-0.6773, 34.7796],
  Nyeri: [-0.4201, 36.9476],
  "Murang'a": [-0.7833, 37.15],
};
const CHANNELS: Record<string, string[]> = {
  "Modern Trade": ["Supermarket", "Mini-market"],
  "Traditional Trade": ["Duka", "Kiosk", "Mama Mboga"],
  "Key Accounts": ["Hotel Chain", "Institutional"],
  HORECA: ["Restaurant", "Bar"],
};

async function createDemoUser(fullName: string, emailPrefix: string) {
  const email = `${emailPrefix}@${DEMO_EMAIL_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  return data.user!.id;
}

async function main() {
  console.log("Creating supervisors...");
  const supervisorIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const name = `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`;
    const id = await createDemoUser(name, `supervisor${i}`);
    supervisorIds.push(id);
  }

  console.log("Creating team leaders...");
  const teamLeaderIds: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const name = `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`;
    const id = await createDemoUser(name, `teamleader${i}`);
    teamLeaderIds.push(id);
  }

  console.log("Creating sales reps...");
  const salesRepIds: string[] = [];
  for (let i = 1; i <= 50; i++) {
    const name = `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`;
    const id = await createDemoUser(name, `salesrep${i}`);
    salesRepIds.push(id);
  }

  console.log("Wiring up profiles (role, field_role, manager_id, assigned_form_id)...");
  for (const id of supervisorIds) {
    await admin
      .from("profiles")
      .update({ role: "user", field_role: "supervisor", status: "approved", assigned_form_id: COACHING_FORM_ID })
      .eq("id", id);
  }
  for (let i = 0; i < teamLeaderIds.length; i++) {
    await admin
      .from("profiles")
      .update({
        role: "user",
        field_role: "team_leader",
        status: "approved",
        assigned_form_id: COACHING_FORM_ID,
        manager_id: supervisorIds[i % supervisorIds.length],
      })
      .eq("id", teamLeaderIds[i]);
  }
  for (let i = 0; i < salesRepIds.length; i++) {
    await admin
      .from("profiles")
      .update({
        role: "user",
        field_role: "sales_rep",
        status: "approved",
        assigned_form_id: COACHING_FORM_ID,
        manager_id: teamLeaderIds[i % teamLeaderIds.length],
      })
      .eq("id", salesRepIds[i]);
  }

  console.log("Seeding regions/territories...");
  const regionIds: Record<string, string> = {};
  for (const region of Object.keys(REGION_DEFS)) {
    const { data } = await admin
      .from("coaching_org_units")
      .insert({ form_id: COACHING_FORM_ID, unit_type: "region", name: region })
      .select("id")
      .single();
    regionIds[region] = data!.id;
  }
  const territoryIds: Record<string, string> = {};
  for (const [region, territories] of Object.entries(REGION_DEFS)) {
    for (const territory of territories) {
      const { data } = await admin
        .from("coaching_org_units")
        .insert({
          form_id: COACHING_FORM_ID,
          unit_type: "territory",
          name: territory,
          parent_id: regionIds[region],
        })
        .select("id")
        .single();
      territoryIds[territory] = data!.id;
    }
  }
  console.log("Seeding distributors...");
  const distributorIds: string[] = [];
  const territoryNames = Object.keys(territoryIds);
  for (let i = 1; i <= 6; i++) {
    const territory = territoryNames[i % territoryNames.length];
    const { data } = await admin
      .from("coaching_org_units")
      .insert({
        form_id: COACHING_FORM_ID,
        unit_type: "distributor",
        name: `${territory} Distributors Ltd`,
        parent_id: territoryIds[territory],
      })
      .select("id")
      .single();
    distributorIds.push(data!.id);
  }

  console.log("Seeding channels/sub-channels...");
  const subChannelIds: string[] = [];
  for (const [channel, subChannels] of Object.entries(CHANNELS)) {
    const { data: parent } = await admin
      .from("coaching_channels")
      .insert({ form_id: COACHING_FORM_ID, name: channel })
      .select("id")
      .single();
    for (const sub of subChannels) {
      const { data: child } = await admin
        .from("coaching_channels")
        .insert({ form_id: COACHING_FORM_ID, name: sub, parent_id: parent!.id })
        .select("id")
        .single();
      subChannelIds.push(child!.id);
    }
  }

  console.log("Seeding routes...");
  const routeIds: string[] = [];
  for (const territory of territoryNames) {
    for (let i = 1; i <= 3; i++) {
      const { data } = await admin
        .from("coaching_routes")
        .insert({
          form_id: COACHING_FORM_ID,
          name: `${territory} Route ${i}`,
          territory_id: territoryIds[territory],
        })
        .select("id")
        .single();
      routeIds.push(data!.id);
    }
  }

  console.log("Seeding 500 outlets...");
  const outletIds: string[] = [];
  const BATCH = 50;
  for (let batchStart = 0; batchStart < 500; batchStart += BATCH) {
    const rows = [];
    for (let i = batchStart; i < batchStart + BATCH; i++) {
      const territory = rand(territoryNames);
      const [baseLat, baseLng] = CITY_CENTERS[territory] ?? [-1.2921, 36.8219];
      rows.push({
        form_id: COACHING_FORM_ID,
        outlet_code: `OUT-${String(i + 1).padStart(4, "0")}`,
        name: `${rand(LAST_NAMES)} ${rand(["Shop", "Store", "Mart", "Trading Co", "Enterprises"])}`,
        trading_name: null,
        contact_person: `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
        phone: `+2547${randInt(10000000, 99999999)}`,
        address: `${territory}, Kenya`,
        channel_id: rand(subChannelIds),
        route_id: rand(routeIds),
        territory_id: territoryIds[territory],
        distributor_id: rand(distributorIds),
        assigned_sales_rep_id: rand(salesRepIds),
        assigned_team_leader_id: rand(teamLeaderIds),
        latitude: jitter(baseLat, 15),
        longitude: jitter(baseLng, 15),
        geofence_radius_m: rand([50, 100, 100, 100, 200]),
      });
    }
    const { data, error } = await admin.from("coaching_outlets").insert(rows).select("id");
    if (error) throw error;
    outletIds.push(...data!.map((r) => r.id));
  }

  console.log("Seeding journey plans (last 14 days)...");
  for (const repId of salesRepIds) {
    const repOutlets = Array.from({ length: 10 }, () => rand(outletIds));
    for (let d = 0; d < 14; d++) {
      const planDate = new Date();
      planDate.setDate(planDate.getDate() - d);
      const dateStr = planDate.toISOString().slice(0, 10);
      const rows = repOutlets.slice(0, randInt(5, 10)).map((outletId, seq) => ({
        form_id: COACHING_FORM_ID,
        sales_rep_id: repId,
        route_id: rand(routeIds),
        plan_date: dateStr,
        outlet_id: outletId,
        planned_sequence: seq,
      }));
      await admin.from("coaching_journey_plans").insert(rows);
    }
  }

  console.log("Seeding coaching template...");
  const { data: template } = await admin
    .from("coaching_templates")
    .insert({ form_id: COACHING_FORM_ID, name: "FMCG Field Excellence Scorecard", version: 1 })
    .select("id")
    .single();
  const templateId = template!.id;

  const SECTIONS: Array<{ title: string; weight: number; questions: string[] }> = [
    {
      title: "Planning & Preparation",
      weight: 1,
      questions: [
        "Journey Plan reviewed before the day started",
        "Daily sales/volume target known",
        "Priority outlets and brands identified",
        "Previous coaching actions reviewed",
      ],
    },
    {
      title: "Sales Driver Check",
      weight: 1,
      questions: [
        "Full stock availability",
        "Cooler availability, functionality and cleanliness",
        "Planogram compliance",
        "Stock rotation / expiry management",
      ],
    },
    {
      title: "Selling Skills",
      weight: 1,
      questions: [
        "Opening the call and relationship building",
        "Identifying customer needs effectively",
        "Handling objections",
        "Closing the sale / securing commitment",
      ],
    },
    {
      title: "Execution in Trade",
      weight: 1,
      questions: [
        "Availability and distribution",
        "Visibility and merchandising",
        "POSM placement and planogram compliance",
        "Pricing compliance",
      ],
    },
    {
      title: "Customer Management",
      weight: 1,
      questions: [
        "Customer relationship and decision-maker engagement",
        "Order accuracy and documentation",
        "Complaint handling",
      ],
    },
    {
      title: "Administration & Compliance",
      weight: 0.5,
      questions: [
        "DSR / Journey Plan compliance",
        "Required documentation complete",
      ],
    },
    {
      title: "Professional Behaviour",
      weight: 0.5,
      questions: [
        "Time management and punctuality",
        "Professional conduct and communication",
      ],
    },
  ];

  const questionIds: string[] = [];
  for (let sIdx = 0; sIdx < SECTIONS.length; sIdx++) {
    const section = SECTIONS[sIdx];
    const { data: sectionRow } = await admin
      .from("coaching_template_sections")
      .insert({ template_id: templateId, title: section.title, weight: section.weight, order_index: sIdx })
      .select("id")
      .single();
    for (let qIdx = 0; qIdx < section.questions.length; qIdx++) {
      const { data: qRow } = await admin
        .from("coaching_template_questions")
        .insert({
          section_id: sectionRow!.id,
          prompt: section.questions[qIdx],
          question_type: "rating_1_5",
          weight: 1,
          is_mandatory: true,
          order_index: qIdx,
        })
        .select("id")
        .single();
      questionIds.push(qRow!.id);
    }
  }

  console.log("Seeding accompaniments, outlet visits, scores, actions, self-evaluations...");
  const ACTION_ISSUES = [
    "Cooler not stocked with priority brands",
    "POSM missing at point of sale",
    "Stock rotation not followed, near-expiry items on shelf",
    "Sales rep struggled to handle price objection",
    "Outlet visit outside planned Journey Plan sequence",
  ];
  for (let i = 0; i < 90; i++) {
    const teamLeaderId = rand(teamLeaderIds);
    const salesRepId = rand(salesRepIds);
    const daysAgo = randInt(0, 60);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const dateStr = date.toISOString().slice(0, 10);
    const status = daysAgo < 2 ? rand(["draft", "submitted"]) : "approved";

    const { data: accompaniment } = await admin
      .from("coaching_accompaniments")
      .insert({
        form_id: COACHING_FORM_ID,
        template_id: templateId,
        team_leader_id: teamLeaderId,
        sales_rep_id: salesRepId,
        route_id: rand(routeIds),
        date: dateStr,
        start_time: `${dateStr}T08:00:00Z`,
        end_time: `${dateStr}T14:00:00Z`,
        status,
      })
      .select("id")
      .single();
    const accompanimentId = accompaniment!.id;

    const visitCount = randInt(2, 4);
    const scores: number[] = [];
    for (let v = 0; v < visitCount; v++) {
      const outletId = rand(outletIds);
      const insideGeofence = Math.random() > 0.15;
      const { data: visit } = await admin
        .from("coaching_outlet_visits")
        .insert({
          accompaniment_id: accompanimentId,
          outlet_id: outletId,
          planned: Math.random() > 0.1,
          arrival_at: `${dateStr}T${String(8 + v * 2).padStart(2, "0")}:00:00Z`,
          departure_at: `${dateStr}T${String(8 + v * 2).padStart(2, "0")}:45:00Z`,
          latitude: jitter(-1.2921, 20),
          longitude: jitter(36.8219, 20),
          gps_accuracy_m: randInt(5, 30),
          distance_from_outlet_m: insideGeofence ? randInt(5, 90) : randInt(150, 500),
          geofence_status: insideGeofence ? "inside" : "outside",
        })
        .select("id")
        .single();

      for (const qId of questionIds) {
        const val = randInt(3, 5);
        scores.push(val);
        await admin.from("coaching_visit_answers").insert({
          outlet_visit_id: visit!.id,
          question_id: qId,
          answer_value: String(val),
        });
      }
    }

    const overallScore = Math.round((scores.reduce((a, b) => a + b, 0) / (scores.length * 5)) * 1000) / 10;
    await admin.from("coaching_accompaniments").update({ overall_score: overallScore }).eq("id", accompanimentId);

    if (Math.random() > 0.4) {
      const actionStatus = rand(["open", "in_progress", "completed", "overdue"]);
      const targetDate = new Date(date);
      targetDate.setDate(targetDate.getDate() + randInt(3, 14));
      await admin.from("coaching_action_plans").insert({
        accompaniment_id: accompanimentId,
        issue: rand(ACTION_ISSUES),
        coaching_area: rand(SECTIONS).title,
        required_action: "Address the identified gap before the next accompaniment",
        owner_id: salesRepId,
        target_date: targetDate.toISOString().slice(0, 10),
        priority: rand(["low", "medium", "high"]),
        status: actionStatus,
        evidence_required: Math.random() > 0.5,
        completed_at: actionStatus === "completed" ? new Date().toISOString() : null,
      });
    }

    await admin.from("coaching_self_evaluations").insert({
      accompaniment_id: accompanimentId,
      sales_rep_id: salesRepId,
      went_well: "Built good rapport with the outlet owner and closed an upsell.",
      biggest_challenge: "Handling a price objection on the priority brand.",
      missed_opportunity: "Did not cross-sell the new SKU.",
      would_do_differently: "Prepare a clearer objection-handling script.",
      support_needed: "More product knowledge training on the new SKU.",
      main_learning: "Confirm stock availability before promising delivery dates.",
    });
  }

  console.log("Done seeding coaching demo data.");
  console.log(`Demo login password for all seeded accounts: ${DEMO_PASSWORD}`);
  console.log(`Example logins: supervisor1@${DEMO_EMAIL_DOMAIN}, teamleader1@${DEMO_EMAIL_DOMAIN}, salesrep1@${DEMO_EMAIL_DOMAIN}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
