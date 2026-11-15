import { NextResponse, type NextRequest } from "next/server";

/**
 * Answers addresses with broken percent-encoding, such as
 * `/planets/%E0%A4%A`, with 400 Bad Request. Without this, Next.js fails to
 * decode the slug and answers 500, which looks like a fault of the server.
 *
 * It only runs for the addresses with a slug in them (see `config`).
 */
export function proxy(request: NextRequest) {
  try {
    decodeURIComponent(request.nextUrl.pathname);
  } catch {
    return new NextResponse("Bad request: the address is not encoded correctly.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/planets/:path+", "/stars/:path+", "/map/systems/:path+"],
};
