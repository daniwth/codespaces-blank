import React from "react";

// This layout is for all public-facing pages like landing, about, contact, etc.
// It can be expanded later to include a shared public header or footer.
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
