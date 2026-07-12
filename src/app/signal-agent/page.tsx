import { SignalAgentWorkspace } from "@/components/signal-agent/SignalAgentWorkspace";

export const metadata = {
  title: "Signal-to-Solution Agent"
};

export default function SignalAgentPage() {
  return (
    <main className="shell">
      <SignalAgentWorkspace />
    </main>
  );
}
