import { NextResponse } from "next/server";
import { requireMemberApi } from "@/lib/auth";
import { getPhotos } from "@/lib/smugmug";

export const dynamic = "force-dynamic";

export async function GET() {
  const member = await requireMemberApi();
  if (member instanceof NextResponse) return member;
  return NextResponse.json(await getPhotos());
}
