import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { storytellerCookieName } from "@/lib/server/auth-cookies";
import {
  gameRouteError,
  privateResponseHeaders,
} from "@/lib/server/route-errors";
import { closeDayByCode } from "@/lib/server/store";
import { dayCloseSchema } from "@/lib/server/validation";

/*
 * End the day. The nominations have already been recorded on the game's
 * day_state by the storyteller PATCH; this resolves them with the rules engine
 * and freezes the outcome.
 *
 * Server-side because the vote arithmetic is the app's promise to a first-time
 * Storyteller: the phone should not be the thing that decides whether a
 * nomination passed.
 */
export async function POST(request: Request) {
  const routeContext = { operation: "close_day", request };

  try {
    const input = dayCloseSchema.parse(await request.json());
    const credential =
      (await cookies()).get(storytellerCookieName(input.code))?.value ?? "";
    const result = await closeDayByCode(
      input.code,
      credential,
      input.expectedVersion,
    );

    return NextResponse.json(result, { headers: privateResponseHeaders });
  } catch (error) {
    return gameRouteError(error, "Unable to close the day.", routeContext);
  }
}
