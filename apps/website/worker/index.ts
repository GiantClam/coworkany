import {
  localeFromRequest,
  type Locale,
} from "./locale";

export interface WebsiteWorkerEnv {
  ASSETS: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
}

function isLocaleRoot(pathname: string): boolean {
  return pathname === "/" || pathname === "/index.html";
}

function redirectToLocale(request: Request, locale: Locale): Response {
  const target = new URL(request.url);
  target.pathname = `/${locale}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.href,
      "Cache-Control": "private, no-store",
      Vary: "Accept-Language, Cookie",
    },
  });
}

async function fetch(request: Request, env: WebsiteWorkerEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (isLocaleRoot(pathname)) return redirectToLocale(request, localeFromRequest(request));
  return env.ASSETS.fetch(request);
}

const worker = { fetch };
export default worker;
