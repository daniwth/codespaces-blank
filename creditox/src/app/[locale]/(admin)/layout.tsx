import React from "react";

// This layout is for the admin/backoffice pages.
// It should be protected and only accessible to users with the ADMIN role.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* <h1>Admin Layout</h1> */}
      {children}
    </div>
  );
}
