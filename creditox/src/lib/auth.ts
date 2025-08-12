import { PrismaAdapter } from "@auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

// Instantiate PrismaClient, but ideally should be a singleton.
// For simplicity in this file, we instantiate it directly.
// In a larger app, you'd import a singleton instance.
const prisma = new PrismaClient();

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text", placeholder: "john.doe@example.com" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const credentialsSchema = z.object({
          email: z.string().email("Invalid email format."),
          password: z.string().min(1, "Password is required."),
        });

        const parsedCredentials = credentialsSchema.safeParse(credentials);

        if (!parsedCredentials.success) {
          // You can throw an error here which will be displayed to the user.
          // For now, we'll just log and return null.
          console.error("Invalid credentials format:", parsedCredentials.error.flatten().fieldErrors);
          return null;
        }

        const { email, password } = parsedCredentials.data;

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.passwordHash) {
          // User not found or is an OAuth-only user.
          return null;
        }

        const passwordsMatch = await bcrypt.compare(password, user.passwordHash);

        if (passwordsMatch) {
          // Return user object that NextAuth will use.
          return user;
        }

        // Incorrect password
        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
    async jwt({ token, user }) {
      // This is called upon sign-in and on every API call that uses `getSession`.
      // The `user` object is only available on sign-in.
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
  },
  pages: {
    signIn: '/login',
    // You can add other pages like:
    // signOut: '/auth/signout',
    // error: '/auth/error', // Error code passed in query string as ?error=
    // verifyRequest: '/auth/verify-request', // (e.g. for email verification)
    // newUser: '/auth/new-user' // New users will be directed here on first sign in (leave the property out to disable)
  },
  // For debugging purposes in development.
  // debug: process.env.NODE_ENV === 'development',
};
