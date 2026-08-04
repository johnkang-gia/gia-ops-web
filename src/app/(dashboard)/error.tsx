"use client";

import ErrorScreen from "@/components/common/ErrorScreen";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} />;
}
