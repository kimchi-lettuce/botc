import { env } from "@/env";

/**
 * Observability is opt-in: production only, not killed by the emergency switch,
 * and only when a PostHog project token is actually configured. The token is
 * optional in `src/env.js` so that `pnpm dev` and generic verification builds
 * do not require a PostHog account.
 */
export const observabilityEnabled =
  process.env.NODE_ENV === "production" &&
  env.NEXT_PUBLIC_DISABLE_OBSERVABILITY !== "true" &&
  env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN.length > 0;
