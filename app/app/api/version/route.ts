import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Current deployment identity — lets open tabs detect a new deploy and
 *  reload themselves instead of running stale code indefinitely. */
export async function GET() {
  return NextResponse.json({
    v:
      process.env.NEXT_PUBLIC_BUILD_AT ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      "dev",
  });
}
