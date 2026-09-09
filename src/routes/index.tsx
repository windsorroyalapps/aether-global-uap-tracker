import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Toaster } from "sonner";
import { Console } from "@/components/aether/console";
import { listSightings } from "@/lib/uap/queries";

export const Route = createFileRoute("/")({
  loader: () => listSightings(),
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <Console initial={initial} />
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          className: "bg-surface text-fg border border-border",
        }}
      />
    </QueryClientProvider>
  );
}
