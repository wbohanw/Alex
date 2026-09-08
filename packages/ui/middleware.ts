import { next } from "@vercel/functions";

export const config = {
  matcher: ["/api/:path*", "/auth/:path*", "/webhook/:path*"],
};

export default function middleware(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("ngrok-skip-browser-warning", "alex-vercel-proxy");

  return next({
    request: { headers },
  });
}
