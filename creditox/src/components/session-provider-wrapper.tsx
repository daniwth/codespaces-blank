"use client"

import { SessionProvider } from "next-auth/react";
import React from "react";

// This wrapper is necessary because SessionProvider uses `useContext`
// and must be a client component. The root layout is a server component.
export default function SessionProviderWrapper({
    children,
    session
}: {
    children: React.ReactNode,
    session?: any
}) {
    return (
        <SessionProvider session={session}>
            {children}
        </SessionProvider>
    )
}
