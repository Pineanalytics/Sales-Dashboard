import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
export const runtime="nodejs"; export const dynamic="force-dynamic";
const select={id:true,startDate:true,endDate:true,status:true,requestedAt:true,completedAt:true,message:true} as const;
const day=(d:Date)=>d.toISOString().slice(0,10);
async function admin(){const s=await auth();return s?.user?.role==="ADMIN"?s.user:null;}
function parse(v:unknown){if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const d=new Date(`${v}T00:00:00.000Z`);return Number.isNaN(d.valueOf())?null:d;}
const output=(r:{startDate:Date;endDate:Date})=>({...r,startDate:day(r.startDate),endDate:day(r.endDate)});
export async function GET(){if(!await admin())return NextResponse.json({error:"Administrator access required."},{status:403});const runs=await prisma.scheduledReportBackfill.findMany({orderBy:{requestedAt:"desc"},take:50,select});return NextResponse.json({runs:runs.map(output)});}
export async function POST(req:NextRequest){const user=await admin();if(!user)return NextResponse.json({error:"Administrator access required."},{status:403});const body=await req.json().catch(()=>null),startDate=parse(body?.startDate),endDate=parse(body?.endDate);if(!startDate||!endDate||endDate<startDate)return NextResponse.json({error:"Provide a valid start and end date."},{status:400});if((endDate.valueOf()-startDate.valueOf())/86400000>31)return NextResponse.json({error:"Backfill ranges are limited to 31 days."},{status:400});const run=await prisma.scheduledReportBackfill.create({data:{startDate,endDate,requestedBy:user.email??user.id},select});return NextResponse.json({run:output(run)},{status:201});}