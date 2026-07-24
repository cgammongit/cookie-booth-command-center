import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const securedMiddleware = clerkMiddleware();

export default function proxy(
  ...args: Parameters<typeof securedMiddleware>
) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return NextResponse.next();
  }
  return securedMiddleware(...args);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
