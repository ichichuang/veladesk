import type { Metadata } from "next";

import { DesktopLab } from "../../../features/desktop-lab/desktop-lab";

export const metadata: Metadata = {
  title: "Desktop interaction lab — VelaDesk",
};

export default function DesktopInteractionLabPage() {
  return <DesktopLab />;
}
