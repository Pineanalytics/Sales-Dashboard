import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const runtime="nodejs";
function ok(req:NextRequest){const e=process.env.SCHEDULED_REPORTS_CONTROL_KEY,s=req.headers.get("x-scheduled-reports-key");if(!e||!s)return false;const a=Buffer.from(e),b=Buffer.from(s);return a.length===b.length&&timingSafeEqual(a,b);}
export async function POST(req:NextRequest){if(!ok(req))return NextResponse.json({error:"Invalid agent credentials."},{status:401});const run=await prisma.$transaction(async tx=>{const n=await tx.scheduledReportBackfill.findFirst({where:{status:"QUEUED"},orderBy:{requestedAt:"asc"}});return n?tx.scheduledReportBackfill.update({where:{id:n.id},data:{status:"RUNNING",claimedAt:new Date(),message:"Claimed by Windows report agent."}}):null;});return NextResponse.json({run:run&&{id:run.id,startDate:run.startDate.toISOString().slice(0,10),endDate:run.endDate.toISOString().slice(0,10)}});}