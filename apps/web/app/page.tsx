import { DESKTOP_ENGINE_VERSION } from "@veladesk/desktop-engine";

export default function HomePage() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">VelaDesk</h1>
      <p className="text-lg">Build your browser home, your way.</p>
      <p className="text-sm text-neutral-500">Development foundation ready.</p>
      <p className="text-xs text-neutral-400">
        @veladesk/desktop-engine {DESKTOP_ENGINE_VERSION}
      </p>
    </main>
  );
}
