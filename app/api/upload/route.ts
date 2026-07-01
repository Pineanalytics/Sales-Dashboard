import { NextRequest, NextResponse } from "next/server";
import { parseWorkbook, WorkbookParseError } from "@/lib/parseWorkbook";
import { saveSnapshot } from "@/lib/datasetStore";
import { auth } from "@/auth";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in to upload a workbook." }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only administrators can upload a new snapshot." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a \"file\" field." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded. Attach an Excel workbook under the \"file\" field." }, { status: 400 });
  }

  const nameLower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => nameLower.endsWith(ext))) {
    return NextResponse.json({ error: "Unsupported file type. Upload a .xlsx or .xls workbook." }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max size is 25MB.` }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();

  try {
    const dataset = parseWorkbook(buffer);
    const snapshot = await saveSnapshot(dataset);
    return NextResponse.json({ dataset, snapshot }, { status: 200 });
  } catch (err) {
    if (err instanceof WorkbookParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Failed to process uploaded workbook", err);
    return NextResponse.json({ error: "Failed to process the uploaded workbook. Please check the file and try again." }, { status: 500 });
  }
}
